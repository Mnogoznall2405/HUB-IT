import logging
import os
import pickle
import json
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from datetime import datetime

import torch
import numpy as np
from scipy.spatial.distance import cosine
from pyannote.audio import Model, Inference
import whisperx
from tqdm import tqdm

try:
    from whisperx.diarize import DiarizationPipeline
except ImportError:
    DiarizationPipeline = getattr(whisperx, "DiarizationPipeline", None)

from .audio_processor import ProcessingConfig, retry_on_failure, monitor_memory, cleanup_memory
from config import DEVICE, HF_TOKEN, MODELS_DIR, PROJECT_ROOT, REFERENCE_VOICES_DIR

logger = logging.getLogger(__name__)


def _configure_pyannote_runtime():
    """Настраивает совместимость PyTorch и локальные кэши для pyannote."""
    os.environ.setdefault("TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD", "1")
    os.environ.setdefault("HUGGINGFACE_HUB_CACHE", str(MODELS_DIR))
    os.environ.setdefault("HF_HOME", str(MODELS_DIR / ".hf-home"))
    os.environ.setdefault("TORCH_HOME", str(MODELS_DIR / ".torch"))
    os.environ.setdefault("PYANNOTE_CACHE", str(MODELS_DIR / ".pyannote"))

    ffmpeg_bin = PROJECT_ROOT / "ffmpeg" / "bin"
    if ffmpeg_bin.exists() and hasattr(os, "add_dll_directory"):
        try:
            os.add_dll_directory(str(ffmpeg_bin))
            os.environ["PATH"] = str(ffmpeg_bin) + os.pathsep + os.environ.get("PATH", "")
        except OSError:
            pass

    for directory in (
        MODELS_DIR,
        MODELS_DIR / ".hf-home",
        MODELS_DIR / ".torch",
        MODELS_DIR / ".pyannote",
    ):
        Path(directory).mkdir(parents=True, exist_ok=True)

    try:
        torch.serialization.add_safe_globals([torch.torch_version.TorchVersion])
    except Exception:
        pass


_configure_pyannote_runtime()


def apply_pipeline_tuning(diarize_wrapper, config) -> None:
    """Применяет пользовательские параметры pyannote pipeline (clustering/segmentation)."""
    params = {}
    ct = getattr(config, 'diarization_clustering_threshold', None)
    mdo = getattr(config, 'diarization_min_duration_off', None)
    if ct is not None:
        params['clustering'] = {'threshold': float(ct)}
    if mdo is not None:
        params['segmentation'] = {'min_duration_off': float(mdo)}
    if not params:
        return
    try:
        pipeline = getattr(diarize_wrapper, 'model', diarize_wrapper)
        pipeline.instantiate(params)
        logger.info(f"🎛️ Диаризация: применены параметры {params}")
    except Exception as e:
        logger.warning(f"⚠️ Не удалось применить параметры диаризации {params}: {e}")


def speaker_at_time(diarization_index: Dict[float, str], t: float, radius: float = 0.3) -> Optional[str]:
    """Возвращает спикера в момент t по индексу диаризации; при промахе ищет в радиусе."""
    steps = int(round(radius * 10))
    for i in range(steps + 1):
        offsets = (i / 10.0,) if i == 0 else (i / 10.0, -i / 10.0)
        for off in offsets:
            speaker = diarization_index.get(round(t + off, 1))
            if speaker:
                return speaker
    return None


def vote_speaker_for_span(start_time: float, end_time: float, diarization_index: Dict[float, str]) -> str:
    """Мажоритарный спикер на интервале (шаг 100мс)."""
    speaker_votes = {}
    current_time = start_time
    while current_time <= end_time:
        speaker = diarization_index.get(round(current_time, 1))
        if speaker:
            speaker_votes[speaker] = speaker_votes.get(speaker, 0) + 1
        current_time += 0.1
    return max(speaker_votes, key=speaker_votes.get) if speaker_votes else "SPEAKER_UNKNOWN"


def _word_speaker_runs(words: List[Dict], index: Dict[float, str], fallback: str,
                       min_run_dur: float) -> List[Tuple[str, List[Dict]]]:
    """Группирует слова в серии по спикеру; короткие вспышки сливает с соседями."""
    runs: List[Tuple[str, List[Dict]]] = []
    last = None
    for w in words:
        mid = (w['start'] + w['end']) / 2
        speaker = speaker_at_time(index, mid) or last or fallback
        if runs and runs[-1][0] == speaker:
            runs[-1][1].append(w)
        else:
            runs.append([speaker, [w]])
        last = speaker

    merged: List[Tuple[str, List[Dict]]] = []
    for i, (speaker, ws) in enumerate(runs):
        dur = ws[-1]['end'] - ws[0]['start']
        if merged and dur < min_run_dur and i + 1 < len(runs) and runs[i + 1][0] == merged[-1][0]:
            merged[-1][1].extend(ws)
        elif merged and merged[-1][0] == speaker:
            merged[-1][1].extend(ws)
        else:
            merged.append([speaker, list(ws)])
    return merged


def split_segments_by_word_speakers(segments: List[Dict], diarization_index: Dict[float, str],
                                    word_segments: Optional[List[Dict]],
                                    min_run_dur: float = 0.4) -> List[Dict]:
    """Назначает спикеров на уровне слов и режет сегменты в точках смены спикера.

    Требует word_segments ([{word, start, end}]) — при их отсутствии возвращает
    исходные сегменты с мажоритарным спикером.
    """
    words = sorted(
        (w for w in (word_segments or []) if w.get('start') is not None and w.get('end') is not None),
        key=lambda w: w['start']
    )
    if not segments or not diarization_index:
        return segments

    out: List[Dict] = []
    wi, n = 0, len(words)
    for segment in segments:
        start = float(segment.get('start', 0))
        end = float(segment.get('end', 0))

        if words:
            while wi < n and words[wi]['end'] <= start:
                wi += 1
            j = wi
            seg_words = []
            while j < n and words[j]['start'] < end:
                seg_words.append(words[j])
                j += 1
        else:
            seg_words = []

        base = vote_speaker_for_span(start, end, diarization_index)
        if len(seg_words) < 2:
            segment_with_speaker = segment.copy()
            segment_with_speaker['speaker'] = base
            out.append(segment_with_speaker)
            continue

        runs = _word_speaker_runs(seg_words, diarization_index, base, min_run_dur)
        for speaker, ws in (runs or [[base, seg_words]]):
            segment_with_speaker = segment.copy()
            segment_with_speaker['start'] = ws[0]['start']
            segment_with_speaker['end'] = ws[-1]['end']
            segment_with_speaker['text'] = ' '.join(w['word'] for w in ws)
            segment_with_speaker['speaker'] = speaker
            out.append(segment_with_speaker)

    return out


class SpeakerDiarization:
    """Класс для диаризации спикеров и их идентификации"""
    
    def __init__(self, config: ProcessingConfig, num_speakers: int = 0):
        self.config = config
        self.num_speakers = num_speakers
        self.device = DEVICE
        self.hf_token = HF_TOKEN
        
        # Инициализация компонентов диаризации
        self.diarize_model = None
        self.embedding_model = None
        self.embedding_inference = None
        
        # Кэш эмбеддингов для оптимизации
        self.speaker_embeddings_cache = {}
        
    @retry_on_failure(max_retries=2, delay=2.0)
    def load_diarization_models(self):
        """Загружает модели для диаризации с retry механизмом."""
        try:
            logger.info("🎭 Загрузка моделей диаризации...")
            
            # Проверка памяти
            memory_before = monitor_memory()
            if memory_before > self.config.max_memory_usage_gb * 0.7:
                logger.warning("⚠️ Высокое использование памяти перед загрузкой моделей диаризации, очищаем...")
                cleanup_memory()
            
            # Загружаем модель диаризации
            if DiarizationPipeline is None:
                raise ImportError("WhisperX diarization pipeline is unavailable in the installed whisperx package")

            try:
                self.diarize_model = DiarizationPipeline(
                    token=self.hf_token,
                    device=torch.device(self.device)
                )
            except TypeError:
                # Совместимость со старыми версиями whisperx (параметр use_auth_token)
                self.diarize_model = DiarizationPipeline(
                    use_auth_token=self.hf_token,
                    device=torch.device(self.device)
                )
            apply_pipeline_tuning(self.diarize_model, self.config)
            if self.embedding_inference is None or self.embedding_model is None:
                self.load_embedding_model()
                logger.info(f"вњ… РњРѕРґРµР»Рё РґРёР°СЂРёР·Р°С†РёРё Р·Р°РіСЂСѓР¶РµРЅС‹ РЅР° {self.device}")
                logger.debug(f"рџ’ѕ РџР°РјСЏС‚СЊ РїРѕСЃР»Рµ Р·Р°РіСЂСѓР·РєРё РјРѕРґРµР»РµР№ РґРёР°СЂРёР·Р°С†РёРё: {monitor_memory():.2f} GB")
                return
            
            # Загружаем модель для эмбеддингов спикеров (как в оригинальном коде)
            embedding_source = self._resolve_local_embedding_model_path() or "pyannote/embedding"
            if embedding_source != "pyannote/embedding":
                logger.info(f"📦 Используем локальную embedding-модель: {embedding_source}")

            self.embedding_model = Model.from_pretrained(
                embedding_source,
                token=self.hf_token
            ).to(self.device)

            self.embedding_inference = Inference(
                self.embedding_model,
                window=self.config.speaker_embedding_window,
                device=torch.device(self.device)
            )

            logger.info(f"✅ Модели диаризации загружены на {self.device}")
            logger.debug(f"💾 Память после загрузки моделей диаризации: {monitor_memory():.2f} GB")
            
        except Exception as e:
            logger.error(f"❌ Ошибка загрузки моделей диаризации: {e}")
            cleanup_memory()
            raise
    
    def _resolve_local_embedding_model_path(self) -> Optional[str]:
        """Возвращает путь к локальному snapshot embedding-модели, если он уже скачан."""
        local_model_root = MODELS_DIR / "models--pyannote--wespeaker-voxceleb-resnet34-LM"
        refs_main = local_model_root / "refs" / "main"
        if not refs_main.exists():
            return None

        try:
            snapshot_name = refs_main.read_text(encoding="utf-8").strip()
        except Exception:
            snapshot_name = refs_main.read_text().strip()

        snapshot_dir = local_model_root / "snapshots" / snapshot_name
        required_files = (snapshot_dir / "config.yaml", snapshot_dir / "pytorch_model.bin")
        if all(path.exists() for path in required_files):
            return str(snapshot_dir)
        return None

    @retry_on_failure(max_retries=2, delay=2.0)
    def load_embedding_model(self):
        """Загружает только модель speaker embeddings."""
        if self.embedding_inference is not None and self.embedding_model is not None:
            return self.embedding_inference

        embedding_source = self._resolve_local_embedding_model_path()
        if embedding_source:
            checkpoint_path = Path(embedding_source) / "pytorch_model.bin"
            hparams_path = Path(embedding_source) / "config.yaml"
            logger.info(f"📦 Используем локальную embedding-модель: {embedding_source}")
            self.embedding_model = Model.from_pretrained(
                str(checkpoint_path),
                hparams_file=str(hparams_path),
                token=self.hf_token,
                cache_dir=str(MODELS_DIR / ".pyannote")
            ).to(self.device)
        else:
            self.embedding_model = Model.from_pretrained(
                "pyannote/embedding",
                token=self.hf_token,
                cache_dir=str(MODELS_DIR / ".pyannote")
            ).to(self.device)

        self.embedding_inference = Inference(
            self.embedding_model,
            window=self.config.speaker_embedding_window,
            device=torch.device(self.device)
        )
        return self.embedding_inference

    @retry_on_failure(max_retries=2, delay=1.0)
    def perform_diarization(self, audio_file: str) -> Optional[Dict]:
        """Выполняет диаризацию аудио."""
        try:
            if not self.config.enable_diarization:
                logger.info("ℹ️ Диаризация отключена в конфигурации")
                return None

            logger.info(f"🎭 Диаризация аудио: {Path(audio_file).name}...")
            
            if not self.diarize_model:
                self.load_diarization_models()
            
            # Загружаем аудио
            audio = whisperx.load_audio(audio_file)
            
            # Выполняем диаризацию
            diarize_result = self.diarize_model(
                audio,
                num_speakers=(self.num_speakers or getattr(self.config, 'diarization_num_speakers', 0) or None),
                min_speakers=self.config.diarization_min_speakers,
                max_speakers=self.config.diarization_max_speakers
            )
            
            # Освобождаем память
            del audio
            cleanup_memory()
            
            # Обрабатываем результат диаризации
            diarize_segments = self._normalize_diarization_segments(diarize_result)

            if diarize_segments:
                unique_speakers = len(set(seg.get('speaker', 'UNKNOWN') for seg in diarize_segments))
                logger.info(f"✅ Диаризация завершена: найдено {unique_speakers} спикеров")
            else:
                logger.warning("⚠️ Диаризация не дала результатов")
            
            return diarize_segments
            
        except Exception as e:
            logger.error(f"❌ Ошибка диаризации: {e}")
            cleanup_memory()
            return None

    def _normalize_diarization_segments(self, diarization_result) -> List[Dict]:
        """Приводит результат диаризации WhisperX к списку словарей."""
        if diarization_result is None:
            return []

        if hasattr(diarization_result, "to_dict"):
            diarization_result = diarization_result.to_dict("records")

        if isinstance(diarization_result, list):
            normalized_segments = []
            for segment in diarization_result:
                if not isinstance(segment, dict):
                    continue
                normalized_segments.append({
                    "start": float(segment.get("start", 0)),
                    "end": float(segment.get("end", 0)),
                    "speaker": str(segment.get("speaker", "UNKNOWN")),
                })
            return normalized_segments

        if hasattr(diarization_result, "itertracks"):
            normalized_segments = []
            for turn, _, speaker in diarization_result.itertracks(yield_label=True):
                normalized_segments.append({
                    "start": float(turn.start),
                    "end": float(turn.end),
                    "speaker": str(speaker),
                })
            return normalized_segments

        logger.warning(f"⚠️ Неожиданный формат результата диаризации: {type(diarization_result)}")
        return []
    
    def assign_speakers_to_segments(self, transcription_result: Dict, diarize_segments: List[Dict]) -> List[Dict]:
        """Назначает спикеров сегментам транскрипции."""
        try:
            logger.info("👥 Назначение спикеров сегментам...")
            
            segments = transcription_result.get('segments', [])
            if not segments or not diarize_segments:
                logger.warning("⚠️ Нет сегментов для назначения спикеров")
                return segments

            # Создаем индекс диаризации для быстрого поиска
            diarization_index = self._create_diarization_index(diarize_segments)

            word_segments = transcription_result.get('word_segments')
            if word_segments:
                assigned_segments = split_segments_by_word_speakers(
                    segments, diarization_index, word_segments
                )
                logger.info(f"✅ Спикеры назначены {len(assigned_segments)} сегментам (word-level)")
                return assigned_segments

            assigned_segments = []

            for segment in segments:
                start_time = segment.get('start', 0)
                end_time = segment.get('end', 0)

                # Находим наиболее подходящего спикера для этого сегмента
                speaker = self._find_best_speaker_for_segment(start_time, end_time, diarization_index)

                # Добавляем информацию о спикере
                segment_with_speaker = segment.copy()
                segment_with_speaker['speaker'] = speaker
                assigned_segments.append(segment_with_speaker)

            logger.info(f"✅ Спикеры назначены {len(assigned_segments)} сегментам")
            return assigned_segments
            
        except Exception as e:
            logger.error(f"❌ Ошибка назначения спикеров: {e}")
            return segments
    
    def _create_diarization_index(self, diarize_segments: List[Dict]) -> Dict[float, str]:
        """Создает индекс диаризации для быстрого поиска спикеров."""
        index = {}
        
        for segment in diarize_segments:
            start = segment.get('start', 0)
            end = segment.get('end', 0)
            speaker = segment.get('speaker', 'UNKNOWN')
            
            # Создаем записи для каждой секунды в сегменте
            current_time = start
            while current_time <= end:
                index[round(current_time, 1)] = speaker
                current_time += 0.1  # шаг 100мс
        
        return index
    
    def _find_best_speaker_for_segment(self, start_time: float, end_time: float, diarization_index: Dict[float, str]) -> str:
        """Находит наиболее подходящего спикера для сегмента."""
        speaker_votes = {}
        
        # Собираем голоса спикеров в пределах временного интервала
        current_time = start_time
        while current_time <= end_time:
            time_key = round(current_time, 1)
            if time_key in diarization_index:
                speaker = diarization_index[time_key]
                speaker_votes[speaker] = speaker_votes.get(speaker, 0) + 1
            current_time += 0.1
        
        # Возвращаем спикера с наибольшим количеством голосов
        if speaker_votes:
            return max(speaker_votes, key=speaker_votes.get)
        else:
            return "SPEAKER_UNKNOWN"
    
    def extract_speaker_embeddings(self, audio_file: str, segments_with_speakers: List[Dict]) -> Dict[str, np.ndarray]:
        """Извлекает эмбеддинги для каждого спикера."""
        try:
            logger.info("🧬 Извлечение эмбеддингов спикеров...")
            
            if not self.embedding_inference:
                self.load_embedding_model()
            
            speaker_embeddings = {}
            
            # Группируем сегменты по спикерам
            speakers_segments = {}
            for segment in segments_with_speakers:
                speaker = segment.get('speaker', 'UNKNOWN')
                if speaker not in speakers_segments:
                    speakers_segments[speaker] = []
                speakers_segments[speaker].append(segment)
            
            # Извлекаем эмбеддинги для каждого спикера
            for speaker, speaker_segments in speakers_segments.items():
                try:
                    # Фильтруем сегменты по минимальной длительности
                    valid_segments = [
                        seg for seg in speaker_segments 
                        if (self._get_segment_bounds(seg)[1] - self._get_segment_bounds(seg)[0]) >= self.config.min_speaker_duration
                    ]
                    
                    if not valid_segments:
                        logger.warning(f"⚠️ Нет подходящих сегментов для спикера {speaker}")
                        continue
                    
                    # Извлекаем эмбеддинги для сегментов спикера
                    segment_embeddings = []
                    
                    for segment in valid_segments[:5]:  # Ограничиваем количество сегментов для оптимизации
                        start_time, end_time = self._get_segment_bounds(segment)
                        
                        # Извлекаем эмбеддинг для сегмента
                        embedding = self._extract_segment_embedding(audio_file, start_time, end_time)
                        if embedding is not None:
                            segment_embeddings.append(embedding)
                    
                    if segment_embeddings:
                        # Агрегируем эмбеддинги
                        if self.config.embedding_aggregation_method == "mean":
                            speaker_embedding = np.mean(segment_embeddings, axis=0)
                        elif self.config.embedding_aggregation_method == "median":
                            speaker_embedding = np.median(segment_embeddings, axis=0)
                        else:
                            speaker_embedding = segment_embeddings[0]  # Берем первый
                        
                        speaker_embeddings[speaker] = speaker_embedding
                        logger.debug(f"✅ Эмбеддинг извлечен для {speaker}: {len(segment_embeddings)} сегментов")
                    
                except Exception as e:
                    logger.error(f"❌ Ошибка извлечения эмбеддинга для {speaker}: {e}")
                    continue
            
            logger.info(f"✅ Извлечено эмбеддингов: {len(speaker_embeddings)} спикеров")
            return speaker_embeddings
            
        except Exception as e:
            logger.error(f"❌ Ошибка извлечения эмбеддингов спикеров: {e}")
            return {}
    
    def _extract_segment_embedding(self, audio_file: str, start_time: float, end_time: float) -> Optional[np.ndarray]:
        """Извлекает эмбеддинг для конкретного сегмента аудио."""
        try:
            # Создаем временный ключ для кэширования
            cache_key = f"{audio_file}_{start_time:.2f}_{end_time:.2f}"
            
            if cache_key in self.speaker_embeddings_cache:
                return self.speaker_embeddings_cache[cache_key]
            
            # Загружаем и обрезаем аудио
            from pydub import AudioSegment
            import tempfile
            
            audio = AudioSegment.from_wav(audio_file)
            start_ms = int(start_time * 1000)
            end_ms = int(end_time * 1000)
            segment_audio = audio[start_ms:end_ms]
            
            # Сохраняем во временный файл
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as temp_file:
                segment_audio.export(temp_file.name, format="wav")
                temp_path = temp_file.name
            
            try:
                # Извлекаем эмбеддинг
                embedding = self.embedding_inference(temp_path)
                
                # Конвертируем в numpy array
                embedding_array = self._embedding_to_numpy(embedding)
                
                # Кэшируем результат
                self.speaker_embeddings_cache[cache_key] = embedding_array
                
                return embedding_array
                
            finally:
                # Удаляем временный файл
                Path(temp_path).unlink(missing_ok=True)
            
        except Exception as e:
            logger.error(f"❌ Ошибка извлечения эмбеддинга сегмента: {e}")
            return None
    
    def identify_speakers(self, speaker_embeddings: Dict[str, np.ndarray], reference_voices_dir: str = str(REFERENCE_VOICES_DIR)) -> Dict[str, str]:
        """Возвращает только уверенно распознанных спикеров."""
        identification_details = self.get_speaker_identification_details(
            speaker_embeddings,
            reference_voices_dir=reference_voices_dir
        )
        return {
            speaker: details['display_name']
            for speaker, details in identification_details.items()
            if details.get('identified')
        }

    def get_speaker_identification_details(
        self,
        speaker_embeddings: Dict[str, np.ndarray],
        reference_voices_dir: str = str(REFERENCE_VOICES_DIR)
    ) -> Dict[str, Dict]:
        """Возвращает детали автоопределения по референсным голосам."""
        try:
            logger.info("🔎 Идентификация спикеров...")

            reference_voices_path = Path(reference_voices_dir)
            if not reference_voices_path.exists():
                logger.warning(f"⚠️ Папка с референсными голосами не найдена: {reference_voices_dir}")
                return {}

            expected_dim = next(
                (int(np.asarray(e).ravel().shape[-1]) for e in speaker_embeddings.values() if e is not None),
                None
            )
            reference_embeddings = self._load_reference_embeddings(
                reference_voices_path, expected_dim=expected_dim
            )
            if not reference_embeddings:
                logger.warning("⚠️ Не найдено референсных эмбеддингов")
                return {}

            # отбрасываем референсы с несовместимой размерностью (страховка)
            if expected_dim:
                reference_embeddings = {
                    n: e for n, e in reference_embeddings.items()
                    if np.asarray(e).ravel().shape[-1] == expected_dim
                }
            if not reference_embeddings:
                logger.warning("⚠️ Все референсные эмбеддинги несовместимы по размерности")
                return {}

            identification_details = {}

            for unknown_speaker, unknown_embedding in speaker_embeddings.items():
                best_match = None
                best_similarity = float('inf')

                for ref_name, ref_embedding in reference_embeddings.items():
                    similarity = cosine(unknown_embedding, ref_embedding)
                    if similarity < best_similarity:
                        best_similarity = similarity
                        best_match = ref_name

                display_name = unknown_speaker
                status = "unknown"
                identified = False

                if best_similarity <= self.config.strict_similarity_threshold:
                    confidence = "высокая"
                    display_name = best_match
                    status = "identified"
                    identified = True
                elif best_similarity <= self.config.moderate_similarity_threshold:
                    confidence = "средняя"
                    status = "review"
                elif best_similarity <= self.config.loose_similarity_threshold:
                    confidence = "низкая"
                    status = "review"
                else:
                    confidence = "очень низкая"

                identification_details[unknown_speaker] = {
                    'original_speaker': unknown_speaker,
                    'matched_name': best_match,
                    'display_name': display_name,
                    'distance': round(float(best_similarity), 4),
                    'confidence': confidence,
                    'status': status,
                    'identified': identified
                }

                if identified:
                    logger.info(f"🎯 {unknown_speaker} -> {display_name} (distance: {best_similarity:.3f}, confidence: {confidence})")
                elif status == "review":
                    logger.info(f"🤔 {unknown_speaker} -> возможен {best_match} (distance: {best_similarity:.3f}, confidence: {confidence})")
                else:
                    logger.info(f"❔ {unknown_speaker} не опознан (distance: {best_similarity:.3f})")

            logger.info(f"✅ Идентификация завершена: {len(identification_details)} спикеров")
            return identification_details

        except Exception as e:
            logger.error(f"❌ Ошибка идентификации спикеров: {e}")
            return {}

    def apply_speaker_names(self, segments_with_speakers: List[Dict], speaker_names: Dict[str, str]) -> List[Dict]:
        """Подменяет анонимные метки на реальные имена."""
        if not speaker_names:
            return segments_with_speakers

        renamed_segments = []
        for segment in segments_with_speakers:
            updated_segment = segment.copy()
            original_speaker = updated_segment.get('speaker')
            if original_speaker in speaker_names:
                updated_segment['speaker'] = speaker_names[original_speaker]
            renamed_segments.append(updated_segment)
        return renamed_segments

    def get_unresolved_speakers(self, segments_with_speakers: List[Dict]) -> List[str]:
        """Возвращает список спикеров, которым ещё не присвоено имя."""
        unresolved = {
            str(segment.get('speaker', 'SPEAKER_UNKNOWN'))
            for segment in segments_with_speakers
            if self._is_unresolved_speaker_label(segment.get('speaker', ''))
        }
        return sorted(unresolved)

    def export_unknown_speaker_samples(
        self,
        audio_file: str,
        segments_with_speakers: List[Dict],
        base_filename: str,
        output_dir: Optional[str] = None
    ) -> Dict[str, str]:
        """Экспортирует WAV-сэмплы для спикеров без имени."""
        try:
            unresolved_speakers = self.get_unresolved_speakers(segments_with_speakers)
            if not unresolved_speakers:
                return {}

            from pydub import AudioSegment

            samples_root = Path(output_dir) if output_dir else PROJECT_ROOT / "unassigned_speakers" / base_filename
            samples_root.mkdir(parents=True, exist_ok=True)

            audio = AudioSegment.from_wav(audio_file)
            sample_paths = {}

            for speaker in unresolved_speakers:
                speaker_segments = [
                    segment for segment in segments_with_speakers
                    if segment.get('speaker') == speaker
                ]
                if not speaker_segments:
                    continue

                merged_sample = AudioSegment.silent(duration=0)
                remaining_ms = int(self.config.unknown_speaker_sample_duration * 1000)

                for segment in sorted(
                    speaker_segments,
                    key=lambda item: self._get_segment_bounds(item)[1] - self._get_segment_bounds(item)[0],
                    reverse=True
                ):
                    start_time, end_time = self._get_segment_bounds(segment)
                    start_ms = max(0, int(start_time * 1000))
                    end_ms = min(len(audio), int(end_time * 1000))
                    if end_ms <= start_ms:
                        continue

                    clip = audio[start_ms:end_ms]
                    if len(clip) > remaining_ms:
                        clip = clip[:remaining_ms]

                    if len(merged_sample) > 0:
                        merged_sample += AudioSegment.silent(duration=250)
                    merged_sample += clip
                    remaining_ms -= len(clip)

                    if remaining_ms <= 0:
                        break

                if len(merged_sample) == 0:
                    continue

                sample_path = samples_root / f"{speaker}.wav"
                merged_sample.export(sample_path, format="wav")
                sample_paths[speaker] = str(sample_path)

            if sample_paths:
                logger.info(f"🎧 Сэмплы неизвестных спикеров сохранены: {samples_root}")
            return sample_paths

        except Exception as e:
            logger.error(f"❌ Ошибка экспорта сэмплов неизвестных спикеров: {e}")
            return {}

    @staticmethod
    def _is_unresolved_speaker_label(speaker_label: str) -> bool:
        label = str(speaker_label or "").strip().upper()
        return (
            label.startswith("SPEAKER_")
            or label == "SPEAKER_UNKNOWN"
            or label == "UNKNOWN"
            or label.startswith("НЕИЗВЕСТ")
        )

    @staticmethod
    def _get_segment_bounds(segment: Dict) -> Tuple[float, float]:
        start = segment.get('start', segment.get('start_time', 0))
        end = segment.get('end', segment.get('end_time', 0))

        if start is None:
            start = segment.get('start_time', 0)
        if end is None:
            end = segment.get('end_time', 0)

        return float(start or 0), float(end or 0)

    @staticmethod
    def _embedding_to_numpy(embedding) -> np.ndarray:
        if hasattr(embedding, "detach"):
            return embedding.detach().cpu().numpy().flatten()

        data = getattr(embedding, "data", None)
        if hasattr(data, "cpu"):
            return data.cpu().numpy().flatten()

        return np.asarray(embedding).flatten()

    def _identify_speakers_legacy(self, speaker_embeddings: Dict[str, np.ndarray], reference_voices_dir: str = "reference_voices") -> Dict[str, str]:
        """Идентифицирует спикеров по референсным голосам."""
        try:
            logger.info("🔍 Идентификация спикеров...")
            
            reference_voices_path = Path(reference_voices_dir)
            if not reference_voices_path.exists():
                logger.warning(f"⚠️ Папка с референсными голосами не найдена: {reference_voices_dir}")
                return {}
            
            # Загружаем референсные эмбеддинги
            expected_dim = next(
                (int(np.asarray(e).ravel().shape[-1]) for e in speaker_embeddings.values() if e is not None),
                None
            )
            reference_embeddings = self._load_reference_embeddings(
                reference_voices_path, expected_dim=expected_dim
            )
            
            if not reference_embeddings:
                logger.warning("⚠️ Не найдено референсных эмбеддингов")
                return {}
            
            speaker_identifications = {}
            
            # Сравниваем каждого неизвестного спикера с референсными
            for unknown_speaker, unknown_embedding in speaker_embeddings.items():
                best_match = None
                best_similarity = float('inf')
                
                for ref_name, ref_embedding in reference_embeddings.items():
                    # Вычисляем косинусное расстояние
                    similarity = cosine(unknown_embedding, ref_embedding)
                    
                    if similarity < best_similarity:
                        best_similarity = similarity
                        best_match = ref_name
                
                # Определяем уровень уверенности
                if best_similarity <= self.config.strict_similarity_threshold:
                    confidence = "высокая"
                    speaker_identifications[unknown_speaker] = best_match
                elif best_similarity <= self.config.moderate_similarity_threshold:
                    confidence = "средняя"
                    speaker_identifications[unknown_speaker] = f"{best_match} (средняя уверенность)"
                elif best_similarity <= self.config.loose_similarity_threshold:
                    confidence = "низкая"
                    speaker_identifications[unknown_speaker] = f"{best_match} (низкая уверенность)"
                else:
                    confidence = "очень низкая"
                    speaker_identifications[unknown_speaker] = f"Неизвестный ({unknown_speaker})"
                
                logger.info(f"🎯 {unknown_speaker} -> {speaker_identifications[unknown_speaker]} (сходство: {best_similarity:.3f}, уверенность: {confidence})")
            
            logger.info(f"✅ Идентификация завершена: {len(speaker_identifications)} спикеров")
            return speaker_identifications
            
        except Exception as e:
            logger.error(f"❌ Ошибка идентификации спикеров: {e}")
            return {}
    
    def _load_reference_embeddings(self, reference_voices_path: Path, expected_dim: Optional[int] = None) -> Dict[str, np.ndarray]:
        """Загружает или создает референсные эмбеддинги."""
        reference_embeddings = {}

        # Ищем аудиофайлы в папках с именами спикеров
        for speaker_dir in reference_voices_path.iterdir():
            if speaker_dir.is_dir():
                speaker_name = speaker_dir.name

                # Ищем файл эмбеддинга
                embedding_file = speaker_dir / f"{speaker_name}_embedding.pkl"

                if embedding_file.exists():
                    # Загружаем готовый эмбеддинг
                    try:
                        with open(embedding_file, 'rb') as f:
                            embedding = pickle.load(f)
                        # Устаревший эмбеддинг от другой модели — пересоздаём из аудио
                        dim = int(np.asarray(embedding).ravel().shape[-1]) if embedding is not None else 0
                        if expected_dim and dim != expected_dim:
                            logger.warning(
                                f"⚠️ Эмбеддинг {speaker_name} имеет размерность {dim} "
                                f"(ожидается {expected_dim}), пересоздаём"
                            )
                            embedding_file.unlink(missing_ok=True)
                        else:
                            reference_embeddings[speaker_name] = embedding
                            logger.debug(f"✅ Загружен эмбеддинг для {speaker_name}")
                            continue
                    except Exception as e:
                        logger.error(f"❌ Ошибка загрузки эмбеддинга для {speaker_name}: {e}")
                        continue
                if speaker_name not in reference_embeddings:
                    # Создаем эмбеддинг из аудиофайлов
                    audio_files = list(speaker_dir.glob("*.wav")) + list(speaker_dir.glob("*.mp3"))
                    
                    if audio_files:
                        try:
                            embedding = self._create_reference_embedding(audio_files)
                            if embedding is not None:
                                reference_embeddings[speaker_name] = embedding
                                
                                # Сохраняем эмбеддинг для будущего использования
                                with open(embedding_file, 'wb') as f:
                                    pickle.dump(embedding, f)
                                
                                logger.info(f"✅ Создан и сохранен эмбеддинг для {speaker_name}")
                        except Exception as e:
                            logger.error(f"❌ Ошибка создания эмбеддинга для {speaker_name}: {e}")
        
        return reference_embeddings
    
    def _create_reference_embedding(self, audio_files: List[Path]) -> Optional[np.ndarray]:
        """Создает референсный эмбеддинг из аудиофайлов."""
        try:
            if not self.embedding_inference:
                self.load_embedding_model()
            
            embeddings = []
            
            for audio_file in audio_files[:3]:  # Ограничиваем количество файлов
                try:
                    # Конвертируем в WAV если нужно
                    if audio_file.suffix.lower() != '.wav':
                        from pydub import AudioSegment
                        import tempfile
                        
                        audio = AudioSegment.from_file(str(audio_file))
                        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as temp_file:
                            audio.export(temp_file.name, format="wav")
                            wav_path = temp_file.name
                    else:
                        wav_path = str(audio_file)
                    
                    try:
                        # Извлекаем эмбеддинг
                        embedding = self.embedding_inference(wav_path)
                        
                        embedding_array = self._embedding_to_numpy(embedding)
                        
                        embeddings.append(embedding_array)
                        
                    finally:
                        # Удаляем временный файл если создавали
                        if wav_path != str(audio_file):
                            Path(wav_path).unlink(missing_ok=True)
                    
                except Exception as e:
                    logger.error(f"❌ Ошибка обработки файла {audio_file}: {e}")
                    continue
            
            if embeddings:
                # Усредняем эмбеддинги
                reference_embedding = np.mean(embeddings, axis=0)
                return reference_embedding
            else:
                return None
                
        except Exception as e:
            logger.error(f"❌ Ошибка создания референсного эмбеддинга: {e}")
            return None
    
    def process_diarization(self, audio_file: str, transcription_result: Dict) -> Dict:
        """Основной метод для обработки диаризации спикеров."""
        try:
            logger.info("🎯 Начинаем диаризацию спикеров...")
            
            # Получаем сегменты из результата транскрипции
            transcript_segments = transcription_result.get('segments', [])
            
            # Выполняем диаризацию
            diarization_result = self.perform_diarization(audio_file)
            
            if not diarization_result:
                logger.error("❌ Диаризация не удалась")
                return {'success': False, 'segments': transcript_segments}
            
            # Назначаем спикеров к сегментам транскрипции
            segments_with_speakers = self.assign_speakers_to_segments(
                transcription_result, diarization_result
            )
            
            logger.info(f"✅ Диаризация завершена: {len(segments_with_speakers)} сегментов")
            
            return {
                'success': True,
                'segments': segments_with_speakers,
                'diarization_result': diarization_result
            }
            
        except Exception as e:
            logger.error(f"❌ Ошибка диаризации: {e}")
            return {'success': False, 'segments': transcript_segments}
    
    def save_speaker_embeddings(self, speaker_embeddings: Dict[str, np.ndarray], output_path: str):
        """Сохраняет эмбеддинги спикеров для будущего использования."""
        try:
            embeddings_data = {
                'embeddings': speaker_embeddings,
                'timestamp': datetime.now().isoformat(),
                'config': {
                    'embedding_window': self.config.speaker_embedding_window,
                    'aggregation_method': self.config.embedding_aggregation_method
                }
            }
            
            with open(output_path, 'wb') as f:
                pickle.dump(embeddings_data, f)
            
            logger.info(f"✅ Эмбеддинги спикеров сохранены: {output_path}")
            
        except Exception as e:
            logger.error(f"❌ Ошибка сохранения эмбеддингов: {e}")
