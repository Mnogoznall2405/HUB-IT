import logging
import os
import time
import gc
import psutil
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from functools import wraps
from dataclasses import dataclass

import ffmpeg
import torch
from pydub import AudioSegment, effects, silence
import torchaudio
import numpy as np
from tqdm import tqdm

from config import DEVICE, SAMPLE_RATE, TEMP_DIR, DEMUCS_MODEL, MODELS_DIR

logger = logging.getLogger(__name__)

@dataclass
class ProcessingConfig:
    """Конфигурация параметров обработки"""
    # Чанкинг
    chunk_duration_seconds: int = 300  # 5 минут по умолчанию
    overlap_seconds: int = 30  # 30 секунд перекрытия
    min_chunk_duration: int = 60  # минимальная длина чанка
    max_chunk_duration: int = 600  # максимальная длина чанка
    
    # Детекция пауз (улучшенные параметры)
    silence_threshold_db: int = -35  # более чувствительный порог тишины
    min_silence_duration: int = 1500  # уменьшенная минимальная пауза
    
    # Память и производительность
    max_memory_usage_gb: float = 8.0  # максимальное использование памяти
    enable_gpu_optimization: bool = True
    batch_size: int = 4
    custom_vocabulary: str = ''  # размер батча для обработки
    cpu_threads: Optional[int] = None  # число CPU-потоков для Whisper/Demucs; None = авто
    
    # Retry механизмы
    max_retries: int = 3
    retry_delay: float = 1.0  # задержка между попытками в секундах
    
    # Progress tracking
    enable_progress_bar: bool = True
    log_progress_interval: int = 10  # логировать прогресс каждые N секунд
    
    # Транскрипция
    whisper_model: str = "large-v3"  # модель Whisper
    stt_engine: str = "whisper"  # whisper | gemini | grok | mai — локальный WhisperX или OpenRouter STT
    stt_api_model: Optional[str] = None  # явный model id для API STT (иначе по маппингу)
    stt_chunk_seconds: int = 900  # размер чанка для API STT (~15 мин ≈ 7MB mp3)
    stt_cut_silence: bool = True  # вырезать тишину перед API STT (экономия + резка по паузам)
    stt_min_silence_ms: int = 2500  # тишина короче этого порога не режется
    stt_silence_thresh_db: int = -45  # порог тишины, dBFS
    stt_silence_pad_ms: int = 250  # паддинг вокруг речевых спанов, мс
    language: str = "ru"  # язык для транскрипции
    force_russian_language: bool = True  # игнорировать автоопределение и всегда работать как с русским
    enable_alignment: bool = True  # включить WhisperX forced alignment
    alignment_model_name: Optional[str] = None  # можно явно задать alignment-модель, иначе WhisperX выберет ru-модель сам
    
    # Обработка аудио
    separator_engine: str = "kim"  # kim | melband | viperx | demucs | none — сепаратор вокала
    enable_demucs: bool = True  # legacy: включить разделение источников (переопределяется separator_engine)
    enable_diarization: bool = True  # включить диаризацию
    enable_ai_analysis: bool = True  # включить AI анализ
    
    # Диаризация (новые параметры)
    diarization_min_speakers: int = 1
    diarization_max_speakers: int = 10
    diarization_num_speakers: int = 0  # точное число спикеров, 0 = авто
    diarization_clustering_threshold: Optional[float] = None  # порог слияния кластеров pyannote (ниже = больше спикеров)
    diarization_min_duration_off: Optional[float] = None  # мин. пауза разделения реплик спикера (ниже = ловит короткие перебивки)
    speaker_embedding_window: str = "whole"  # размер окна для эмбеддингов
    voice_activity_detection: bool = True  # детекция голосовой активности
    enable_speaker_identification: bool = True  # сопоставлять SPEAKER_* с reference_voices
    prompt_for_unknown_speakers: bool = True  # спрашивать ФИО для неизвестных спикеров
    export_unknown_speaker_samples: bool = True  # сохранять сэмплы неизвестных голосов
    unknown_speaker_sample_duration: float = 12.0  # длина экспортируемого сэмпла для ручной проверки
    speaker_name_map: Optional[Dict[str, str]] = None  # принудительные имена: {"SPEAKER_02": "ФИО"}
    
    # Идентификация спикеров (новые параметры)
    strict_similarity_threshold: float = 0.25
    moderate_similarity_threshold: float = 0.35
    loose_similarity_threshold: float = 0.45
    min_speaker_duration: float = 3.0  # минимальная длительность для анализа спикера
    embedding_aggregation_method: str = "mean"  # метод агрегации эмбеддингов
    
    # Генерация отчетов
    generate_pdf: bool = True
    generate_html: bool = True
    generate_markdown: bool = True

    # Чекпоинты этапов (temp/<base>_ckpt_*.json) — resume после падения без
    # повтора аудио/STT/диаризации. False = всегда с нуля
    use_checkpoints: bool = True

    # Дата встречи (ДД.ММ.ГГГГ) — для перевода относительных сроков реестра
    # поручений в абсолютные. None = попытаться вытащить из имени файла
    meeting_date: Optional[str] = None

def retry_on_failure(max_retries: int = 3, delay: float = 1.0, exceptions: tuple = (Exception,)):
    """Декоратор для retry механизма"""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            last_exception = None
            for attempt in range(max_retries + 1):
                try:
                    return func(*args, **kwargs)
                except exceptions as e:
                    last_exception = e
                    if attempt < max_retries:
                        logger.warning(f"Попытка {attempt + 1} не удалась для {func.__name__}: {e}. Повтор через {delay}с...")
                        time.sleep(delay * (2 ** attempt))  # экспоненциальная задержка
                    else:
                        logger.error(f"Все {max_retries + 1} попыток не удались для {func.__name__}")
            raise last_exception
        return wrapper
    return decorator

def monitor_memory():
    """Мониторинг использования памяти"""
    process = psutil.Process()
    memory_info = process.memory_info()
    memory_gb = memory_info.rss / 1024 / 1024 / 1024
    return memory_gb

def cleanup_memory():
    """Очистка памяти"""
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    logger.debug(f"Память после очистки: {monitor_memory():.2f} GB")


def resolve_cpu_threads(requested_threads: Optional[int] = None) -> int:
    """Возвращает разумное число CPU-потоков для моделей на CPU."""
    if requested_threads is not None:
        return max(1, int(requested_threads))

    physical_cores = psutil.cpu_count(logical=False) or 0
    logical_cores = os.cpu_count() or 1
    detected_cores = physical_cores or logical_cores

    if detected_cores <= 2:
        return max(1, detected_cores)
    if detected_cores <= 8:
        return max(1, detected_cores - 1)
    return max(1, detected_cores - 2)

class AudioChunker:
    """Класс для интеллектуального разбиения аудио на чанки"""
    
    def __init__(self, config: ProcessingConfig):
        self.config = config
    
    def detect_speech_pauses(self, audio_path: str) -> List[Tuple[float, float]]:
        """Детектирует паузы в речи для оптимального разбиения"""
        try:
            audio = AudioSegment.from_wav(audio_path)
            
            # Детекция тишины
            silent_ranges = silence.detect_silence(
                audio,
                min_silence_len=self.config.min_silence_duration,
                silence_thresh=audio.dBFS + self.config.silence_threshold_db
            )
            
            # Конвертируем в секунды
            pause_points = [(start/1000, end/1000) for start, end in silent_ranges]
            
            logger.info(f"🔍 Обнаружено {len(pause_points)} пауз в речи")
            return pause_points
            
        except Exception as e:
            logger.warning(f"⚠️ Ошибка детекции пауз: {e}. Используем равномерное разбиение.")
            return []
    
    def create_intelligent_chunks(self, audio_path: str) -> List[Dict[str, float]]:
        """Создает интеллектуальные чанки с учетом пауз в речи"""
        try:
            # Получаем длительность аудио
            audio = AudioSegment.from_wav(audio_path)
            total_duration = len(audio) / 1000  # в секундах
            
            logger.info(f"📊 Общая длительность аудио: {total_duration:.1f} секунд")
            
            # Если аудио короткое, возвращаем один чанк
            if total_duration <= self.config.max_chunk_duration:
                return [{'start': 0, 'end': total_duration, 'duration': total_duration}]
            
            # Детектируем паузы
            pauses = self.detect_speech_pauses(audio_path)
            
            chunks = []
            current_start = 0
            
            while current_start < total_duration:
                # Определяем идеальную точку окончания чанка
                ideal_end = current_start + self.config.chunk_duration_seconds
                
                if ideal_end >= total_duration:
                    # Последний чанк
                    chunks.append({
                        'start': current_start,
                        'end': total_duration,
                        'duration': total_duration - current_start
                    })
                    break
                
                # Ищем ближайшую паузу к идеальной точке
                best_split_point = ideal_end
                min_distance = float('inf')
                
                for pause_start, pause_end in pauses:
                    pause_center = (pause_start + pause_end) / 2
                    
                    # Проверяем, что пауза в разумных пределах от идеальной точки
                    if (current_start + self.config.min_chunk_duration <= pause_center <= 
                        current_start + self.config.max_chunk_duration):
                        
                        distance = abs(pause_center - ideal_end)
                        if distance < min_distance:
                            min_distance = distance
                            best_split_point = pause_center
                
                # Создаем чанк
                chunk_duration = best_split_point - current_start
                chunks.append({
                    'start': current_start,
                    'end': best_split_point,
                    'duration': chunk_duration
                })
                
                # Следующий чанк начинается с перекрытием
                current_start = best_split_point - self.config.overlap_seconds
                current_start = max(0, current_start)  # Не уходим в отрицательные значения
            
            logger.info(f"✂️ Создано {len(chunks)} интеллектуальных чанков")
            
            # Логируем информацию о чанках
            for i, chunk in enumerate(chunks):
                logger.info(f"  Чанк {i+1}: {chunk['start']:.1f}s - {chunk['end']:.1f}s ({chunk['duration']:.1f}s)")
            
            return chunks
            
        except Exception as e:
            logger.error(f"❌ Ошибка создания чанков: {e}")
            # Fallback к равномерному разбиению
            return self._create_uniform_chunks(total_duration)
    
    def _create_uniform_chunks(self, total_duration: float) -> List[Dict[str, float]]:
        """Создает равномерные чанки как fallback"""
        chunks = []
        current_start = 0
        
        while current_start < total_duration:
            chunk_end = min(current_start + self.config.chunk_duration_seconds, total_duration)
            chunks.append({
                'start': current_start,
                'end': chunk_end,
                'duration': chunk_end - current_start
            })
            current_start = chunk_end - self.config.overlap_seconds
            if current_start >= chunk_end:  # Избегаем бесконечного цикла
                current_start = chunk_end
        
        return chunks
    
    def extract_chunk(self, audio_path: str, chunk_info: Dict[str, float], output_path: str) -> bool:
        """Извлекает чанк аудио в отдельный файл"""
        try:
            audio = AudioSegment.from_wav(audio_path)
            start_ms = int(chunk_info['start'] * 1000)
            end_ms = int(chunk_info['end'] * 1000)
            
            chunk_audio = audio[start_ms:end_ms]
            chunk_audio.export(output_path, format="wav")
            
            return True
            
        except Exception as e:
            logger.error(f"❌ Ошибка извлечения чанка: {e}")
            return False

class AudioProcessor:
    """Класс для обработки аудио: извлечение, нормализация, разделение источников"""
    
    def __init__(self, config: ProcessingConfig):
        self.config = config
        self.device = DEVICE
        self.compute_type = "float16" if DEVICE == "cuda" else "int8"
        self.cpu_threads = resolve_cpu_threads(config.cpu_threads)

        if self.device == "cpu":
            torch.set_num_threads(self.cpu_threads)
            if hasattr(torch, "set_num_interop_threads"):
                try:
                    torch.set_num_interop_threads(max(1, min(4, self.cpu_threads)))
                except RuntimeError:
                    pass
        
    @retry_on_failure(max_retries=3, delay=1.0, exceptions=(ffmpeg.Error,))
    def extract_audio(self, input_video: str, output_audio: str) -> bool:
        """Извлекает аудио из видео с retry механизмом."""
        try:
            logger.info(f"🎵 Извлечение аудио из {Path(input_video).name}...")
            (ffmpeg.input(input_video).output(output_audio, ac=1, ar=SAMPLE_RATE, loglevel="error")
             .run(overwrite_output=True, capture_stdout=True, capture_stderr=True))
            logger.info(f"✅ Аудио извлечено: {output_audio}")
            return True
        except ffmpeg.Error as e:
            logger.error(f"❌ Ошибка извлечения аудио: {e.stderr.decode('utf-8')}")
            return False

    @retry_on_failure(max_retries=2, delay=2.0)
    def apply_demucs(self, input_path: str, output_path: str) -> bool:
        """Применяет Demucs с оптимизацией памяти и retry."""
        logger.info("🎤 Шаг 1/2: Выделение вокала (Demucs)...")
        try:
            from demucs.apply import apply_model
            from demucs.pretrained import get_model

            # Проверка памяти
            memory_before = monitor_memory()
            if memory_before > self.config.max_memory_usage_gb * 0.8:
                logger.warning("⚠️ Высокое использование памяти, выполняем очистку...")
                cleanup_memory()

            model = get_model(DEMUCS_MODEL)
            if self.config.enable_gpu_optimization and DEVICE == "cuda":
                model.to(self.device)
            
            wav, sr = torchaudio.load(input_path)
            if self.config.enable_gpu_optimization and DEVICE == "cuda":
                wav = wav.to(self.device)
            
            if wav.shape[0] > 1: 
                wav = torch.mean(wav, dim=0, keepdim=True)
            if wav.shape[0] == 1: 
                wav = wav.repeat(2, 1)
            
            wav_batch = wav.unsqueeze(0)
            sources = apply_model(model, wav_batch, device=self.device, progress=True)
            
            vocals_idx = model.sources.index('vocals')
            vocals_stereo = sources[0, vocals_idx]
            vocals_mono = torch.mean(vocals_stereo, dim=0, keepdim=True)
            
            torchaudio.save(output_path, vocals_mono.cpu(), sr)
            
            # Очистка памяти
            del wav, wav_batch, sources, vocals_stereo, vocals_mono
            cleanup_memory()
            
            logger.info("✅ Demucs успешно применен.")
            logger.debug(f"💾 Память после Demucs: {monitor_memory():.2f} GB")
            return True

        except Exception as e:
            logger.error(f"❌ Ошибка Demucs: {e}")
            cleanup_memory()
            return False

    @retry_on_failure(max_retries=2, delay=2.0)
    def apply_separator(self, input_path: str, output_path: str, engine: str) -> bool:
        """Сепарация вокала через audio-separator (kim/melband/viperx или сырой файл модели)."""
        logger.info(f"🎤 Шаг 1/2: Выделение вокала ({engine})...")
        try:
            import shutil
            from audio_separator.separator import Separator
            from config import SEPARATOR_MODELS

            model_file = SEPARATOR_MODELS.get(engine, engine)  # можно передать имя файла модели напрямую
            sep_dir = Path(TEMP_DIR) / "_sep"
            sep_dir.mkdir(exist_ok=True)
            separator = Separator(
                output_dir=str(sep_dir),
                model_file_dir=str(MODELS_DIR),
                output_format='WAV',
                log_level=logging.WARNING,
            )
            separator.load_model(model_filename=model_file)
            outputs = separator.separate(input_path)

            vocal = next(
                (o for o in outputs if '(vocal' in o.lower() or '(dry)' in o.lower()),
                next((o for o in outputs if 'instr' not in o.lower() and 'other' not in o.lower()), None)
            )
            if not vocal:
                raise RuntimeError(f"audio-separator не вернул вокальный стем: {outputs}")
            src = Path(vocal)
            if not src.is_absolute():
                src = sep_dir / vocal if (sep_dir / vocal).exists() else Path(vocal)
            shutil.move(str(src), output_path)
            for leftover in outputs:
                lp = Path(leftover)
                if not lp.is_absolute():
                    lp = sep_dir / leftover if (sep_dir / leftover).exists() else lp
                lp.unlink(missing_ok=True)

            cleanup_memory()
            logger.info(f"✅ Сепарация ({engine}) успешно применена.")
            return True

        except Exception as e:
            logger.error(f"❌ Ошибка сепарации ({engine}): {e}")
            cleanup_memory()
            return False

    @retry_on_failure(max_retries=2, delay=1.0)
    def apply_normalize(self, input_path: str, output_path: str) -> bool:
        """Применяет нормализацию с оптимизацией памяти."""
        logger.info("🔊 Шаг 2/2: Нормализация громкости...")
        try:
            # Проверка памяти
            memory_before = monitor_memory()
            if memory_before > self.config.max_memory_usage_gb * 0.8:
                cleanup_memory()
            
            audio = AudioSegment.from_file(input_path)
            normalized_audio = effects.normalize(audio)
            normalized_audio.export(output_path, format="wav")
            
            # Освобождение памяти
            del audio, normalized_audio
            cleanup_memory()
            
            logger.info("✅ Нормализация завершена.")
            logger.debug(f"💾 Память после нормализации: {monitor_memory():.2f} GB")
            return True
            
        except Exception as e:
            logger.error(f"❌ Ошибка нормализации: {e}")
            cleanup_memory()
            return False
    
    def process_audio(self, input_file: str, output_file: str) -> bool:
        """Основной метод обработки аудио: извлечение, Demucs, нормализация."""
        try:
            logger.info(f"🎵 Начало обработки аудио: {Path(input_file).name}")
            
            # Создаем временные файлы
            temp_dir = Path(TEMP_DIR)
            temp_dir.mkdir(exist_ok=True)
            
            base_name = Path(input_file).stem
            raw_audio_path = temp_dir / f"{base_name}_raw.wav"
            demucs_audio_path = temp_dir / f"{base_name}_demucs.wav"
            
            # Шаг 1: Извлечение аудио
            if not self.extract_audio(input_file, str(raw_audio_path)):
                logger.error("❌ Не удалось извлечь аудио")
                return False
            
            # Шаг 2: Сепарация вокала (если включена)
            engine = (getattr(self.config, 'separator_engine', None) or '').lower()
            if not engine:
                engine = 'demucs' if self.config.enable_demucs else 'none'
            if engine in ('none', 'off'):
                logger.info("ℹ️ Сепарация отключена, пропускаем")
                demucs_audio_path = raw_audio_path
            elif engine == 'demucs':
                if not self.apply_demucs(str(raw_audio_path), str(demucs_audio_path)):
                    logger.warning("⚠️ Demucs не удался, используем исходное аудио")
                    demucs_audio_path = raw_audio_path
            else:
                if not self.apply_separator(str(raw_audio_path), str(demucs_audio_path), engine):
                    logger.warning(f"⚠️ Сепарация ({engine}) не удалась, используем исходное аудио")
                    demucs_audio_path = raw_audio_path
            
            # Шаг 3: Нормализация
            if not self.apply_normalize(str(demucs_audio_path), output_file):
                logger.error("❌ Не удалось нормализовать аудио")
                return False
            
            logger.info(f"✅ Обработка аудио завершена: {Path(output_file).name}")
            return True
            
        except Exception as e:
            logger.error(f"❌ Ошибка обработки аудио: {e}")
            return False
        finally:
            # Очистка временных файлов
            cleanup_memory()
    
    def cleanup_temp_files(self):
        """Очищает временные файлы, созданные AudioProcessor."""
        try:
            temp_dir = Path(TEMP_DIR)
            if temp_dir.exists():
                # Удаляем временные аудио файлы
                for temp_file in temp_dir.glob("*.wav"):
                    try:
                        temp_file.unlink()
                        logger.debug(f"🗑️ Удален временный файл: {temp_file.name}")
                    except Exception as e:
                        logger.warning(f"⚠️ Не удалось удалить {temp_file.name}: {e}")
                
                for temp_file in temp_dir.glob("*.mp3"):
                    try:
                        temp_file.unlink()
                        logger.debug(f"🗑️ Удален временный файл: {temp_file.name}")
                    except Exception as e:
                        logger.warning(f"⚠️ Не удалось удалить {temp_file.name}: {e}")
                        
            logger.info("✅ Временные файлы AudioProcessor очищены")
            
        except Exception as e:
            logger.error(f"❌ Ошибка очистки временных файлов AudioProcessor: {e}")
