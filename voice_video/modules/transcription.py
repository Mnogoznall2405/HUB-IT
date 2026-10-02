import base64
import logging
import os
import json
import re
import time
from typing import Dict, List, Optional, Tuple
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests

import whisperx
import torch
from tqdm import tqdm

try:
    from whisperx.diarize import DiarizationPipeline
except ImportError:
    DiarizationPipeline = getattr(whisperx, "DiarizationPipeline", None)

from .audio_processor import (
    ProcessingConfig,
    retry_on_failure,
    monitor_memory,
    cleanup_memory,
    AudioChunker,
    resolve_cpu_threads,
)
from .diarization import apply_pipeline_tuning, split_segments_by_word_speakers
from config import DEVICE, MODELS_DIR, HF_TOKEN, TEMP_DIR, OPENROUTER_KEY, STT_ENGINE, STT_API_MODELS, STT_CHUNK_SECONDS

logger = logging.getLogger(__name__)


def _configure_whisper_runtime():
    """Совместимость с PyTorch 2.6 и локальный кэш моделей для WhisperX."""
    os.environ.setdefault("TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD", "1")
    os.environ.setdefault("HUGGINGFACE_HUB_CACHE", str(MODELS_DIR))
    os.environ.setdefault("HF_HOME", str(MODELS_DIR / ".hf-home"))

    try:
        from omegaconf.listconfig import ListConfig
        from omegaconf.dictconfig import DictConfig
        torch.serialization.add_safe_globals([ListConfig, DictConfig])
    except Exception:
        pass


_configure_whisper_runtime()

class TranscriptionProcessor:
    """Класс для транскрипции аудио с использованием WhisperX с поддержкой диаризации"""
    
    def __init__(self, whisper_model_name: str, config: ProcessingConfig):
        self.whisper_model_name = whisper_model_name
        self.config = config
        self.device = DEVICE
        self.compute_type = "float16" if DEVICE == "cuda" else "int8"
        self.cpu_threads = resolve_cpu_threads(config.cpu_threads)
        self.hf_token = HF_TOKEN
        self.diarize_model = None  # Добавляем модель диаризации
        
        # Инициализируем чанкер для интеллектуального разбиения
        self.chunker = AudioChunker(config)
        self.align_model = None
        self.align_metadata = None

        if self.device == "cpu":
            torch.set_num_threads(self.cpu_threads)
            if hasattr(torch, "set_num_interop_threads"):
                try:
                    torch.set_num_interop_threads(max(1, min(4, self.cpu_threads)))
                except RuntimeError:
                    pass
        
        # Загружаем правила замен
        replacements_path = Path(__file__).resolve().parent.parent / "replacements.json"
        self.replacement_rules, self.filler_patterns = self._load_replacement_rules(replacements_path)
        
    def _load_replacement_rules(self, filepath: str | Path) -> tuple[dict, list]:
        """Загружает правила замен и список слов для удаления."""
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                rules_data = json.load(f)
            replacement_rules = rules_data.get('rules', {})
            filler_patterns = rules_data.get('filler_words_to_remove', {}).get('patterns', [])
            logger.info(f"✅ Загружено {len(replacement_rules)} правил коррекции и {len(filler_patterns)} паттернов")
            return replacement_rules, filler_patterns
        except Exception as e:
            logger.error(f"❌ Не удалось загрузить правила замен: {e}")
            return {}, []
    
    @retry_on_failure(max_retries=2, delay=2.0)
    def load_whisper_model(self):
        """Загружает модель Whisper с retry механизмом."""
        try:
            logger.info(f"🤖 Загрузка модели Whisper: {self.whisper_model_name}...")
            
            # Проверка памяти
            memory_before = monitor_memory()
            if memory_before > self.config.max_memory_usage_gb * 0.7:
                logger.warning("⚠️ Высокое использование памяти перед загрузкой модели, очищаем...")
                cleanup_memory()
            
            model = whisperx.load_model(
                self.whisper_model_name, 
                self.device, 
                compute_type=self.compute_type,
                download_root=str(MODELS_DIR),
                threads=self.cpu_threads,
            )
            
            logger.info(f"✅ Модель Whisper загружена на {self.device} (threads={self.cpu_threads})")
            logger.debug(f"💾 Память после загрузки модели: {monitor_memory():.2f} GB")
            
            return model
            
        except Exception as e:
            logger.error(f"❌ Ошибка загрузки модели Whisper: {e}")
            cleanup_memory()
            raise
    
    @retry_on_failure(max_retries=2, delay=2.0)
    def load_diarization_model(self):
        """Загружает модель диаризации WhisperX."""
        try:
            if not self.config.enable_diarization:
                logger.info("ℹ️ Диаризация отключена в конфигурации")
                return
                
            logger.info("🎭 Загрузка модели диаризации WhisperX...")
            
            # Проверка памяти
            memory_before = monitor_memory()
            if memory_before > self.config.max_memory_usage_gb * 0.8:
                logger.warning("⚠️ Высокое использование памяти перед загрузкой диаризации, очищаем...")
                cleanup_memory()
            
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

            logger.info(f"✅ Модель диаризации загружена на {self.device}")
            logger.debug(f"💾 Память после загрузки диаризации: {monitor_memory():.2f} GB")
            
        except Exception as e:
            logger.error(f"❌ Ошибка загрузки модели диаризации: {e}")
            self.diarize_model = None
            cleanup_memory()
    
    @retry_on_failure(max_retries=2, delay=2.0)
    def load_alignment_model(self, language: str = "ru"):
        """Загружает forced alignment модель WhisperX."""
        try:
            if not self.config.enable_alignment:
                logger.info("ℹ️ Alignment отключен в конфигурации")
                return None, None

            effective_language = self._resolve_language(language)

            if (
                self.align_model is not None
                and self.align_metadata is not None
                and self.align_metadata.get("language") == effective_language
            ):
                return self.align_model, self.align_metadata

            logger.info(f"🧭 Загрузка alignment-модели для языка: {effective_language}")
            self.align_model, self.align_metadata = whisperx.load_align_model(
                language_code=effective_language,
                device=self.device,
                model_name=self.config.alignment_model_name,
                model_dir=str(MODELS_DIR)
            )

            logger.info("✅ Alignment-модель загружена")
            return self.align_model, self.align_metadata

        except Exception as e:
            logger.error(f"❌ Ошибка загрузки alignment-модели: {e}")
            self.align_model = None
            self.align_metadata = None
            cleanup_memory()
            return None, None

    def _resolve_language(self, language: str = None) -> str:
        """Возвращает язык транскрибации с жёсткой фиксацией на русском."""
        if self.config.force_russian_language:
            return "ru"
        return language or self.config.language or "ru"

    def _apply_alignment(self, result: Dict, audio_source: str, language: str = None) -> Dict:
        """Применяет forced alignment к сегментам транскрипции."""
        try:
            if not self.config.enable_alignment:
                if result is not None:
                    result["alignment"] = False
                return result

            if not result or not result.get("segments"):
                if result is not None:
                    result["alignment"] = False
                return result

            effective_language = self._resolve_language(language)
            align_model, align_metadata = self.load_alignment_model(effective_language)
            if align_model is None or align_metadata is None:
                result["alignment"] = False
                return result

            aligned_result = whisperx.align(
                result["segments"],
                align_model,
                align_metadata,
                audio_source,
                self.device,
                return_char_alignments=False,
            )

            if aligned_result and aligned_result.get("segments"):
                result["segments"] = aligned_result["segments"]
                if "word_segments" in aligned_result:
                    result["word_segments"] = aligned_result["word_segments"]
                result["alignment"] = True
                result["alignment_language"] = effective_language
            else:
                result["alignment"] = False

            return result

        except Exception as e:
            logger.error(f"❌ Ошибка alignment: {e}")
            if result is not None:
                result["alignment"] = False
            cleanup_memory()
            return result

    STT_API_URL = "https://openrouter.ai/api/v1/audio/transcriptions"

    def _stt_api_model_id(self) -> str:
        """Возвращает model id для OpenRouter STT."""
        engine = (getattr(self.config, 'stt_engine', None) or STT_ENGINE or 'whisper')
        if getattr(self.config, 'stt_api_model', None):
            return self.config.stt_api_model
        if '/' in engine:  # передан сырой model id
            return engine
        return STT_API_MODELS.get(engine, engine)

    def _call_stt_api(self, mp3_path: Path, model_id: str, language: str) -> Optional[Dict]:
        """Один вызов OpenRouter /audio/transcriptions с ретраями."""
        data = base64.b64encode(mp3_path.read_bytes()).decode()
        body = {
            'model': model_id,
            'input_audio': {'data': data, 'format': 'mp3'},
            'response_format': 'verbose_json',
        }
        if language:
            body['language'] = language
        headers = {'Authorization': f'Bearer {OPENROUTER_KEY}', 'Content-Type': 'application/json'}
        last_err = None
        for attempt in range(3):
            try:
                r = requests.post(self.STT_API_URL, headers=headers, json=body, timeout=300)
                j = r.json()
                if 'error' in j:
                    last_err = j['error']
                    # verbose_json не поддержан — откатываемся на json
                    if 'verbose_json' in str(last_err):
                        body['response_format'] = 'json'
                        continue
                    logger.warning(f"STT API ошибка ({mp3_path.name}): {str(last_err)[:200]}")
                    time.sleep(2 * (attempt + 1))
                    continue
                return j
            except Exception as e:
                last_err = e
                time.sleep(2 * (attempt + 1))
        logger.error(f"❌ STT API: чанк не распознан после 3 попыток: {last_err}")
        return None

    def _group_words_to_segments(self, words: List[Dict], max_dur: float = 45.0) -> List[Dict]:
        """Режет сплошной поток слов в сегменты по паузам и пунктуации."""
        segments, cur_words, cur_start = [], [], None
        prev_end = None
        for w in words:
            ws, we = w['start'], w['end']
            gap = (ws - prev_end) if prev_end is not None else 0
            if cur_words and (
                gap > 0.9 or
                (re.search(r'[.!?…]["»)\]]*$', cur_words[-1]['word']) and gap > 0.4) or
                (ws - cur_start) > max_dur
            ):
                segments.append({'start': cur_start, 'end': prev_end, 'text': ' '.join(x['word'] for x in cur_words)})
                cur_words, cur_start = [], None
            if cur_start is None:
                cur_start = ws
            cur_words.append(w)
            prev_end = we
        if cur_words:
            segments.append({'start': cur_start, 'end': prev_end, 'text': ' '.join(x['word'] for x in cur_words)})
        return segments

    @staticmethod
    def _piece_time_to_real(piece_map: List[Tuple[float, float, float]], t: float) -> float:
        """Время внутри склеенного mp3 → реальное время аудио.

        piece_map: [(mp3_start_s, real_start_s, dur_s)] — каждый спан речи,
        склеенный в кусок, имеет свой офсет в реальном времени.
        """
        for mp3_s, real_s, dur in piece_map:
            if t <= mp3_s + dur:
                return real_s + max(0.0, t - mp3_s)
        mp3_s, real_s, dur = piece_map[-1]
        return real_s + max(0.0, t - mp3_s)

    def _stt_pieces(self, audio, chunk_s: int):
        """Режет аудио на куски <= chunk_s по тишине (речевые спаны склеиваются).

        Возвращает [(piece, piece_map)] где piece_map —
        [(mp3_start_s, real_start_s, dur_s)] для пересчёта таймкодов.
        """
        from pydub.silence import detect_nonsilent
        chunk_ms = int(chunk_s * 1000)
        total = len(audio)
        min_sil = int(getattr(self.config, 'stt_min_silence_ms', 2500) or 2500)
        thresh = getattr(self.config, 'stt_silence_thresh_db', -45)
        pad = int(getattr(self.config, 'stt_silence_pad_ms', 250) or 250)

        try:
            spans = detect_nonsilent(audio, min_silence_len=min_sil, silence_thresh=thresh)
        except Exception as e:
            logger.warning(f"⚠️ Детекция тишины не удалась ({e}), обычная резка")
            spans = None

        if not spans:
            return [
                (audio[s:s + chunk_ms], [(0.0, s / 1000.0, min(chunk_ms, total - s) / 1000.0)])
                for s in range(0, total, chunk_ms)
            ]

        # Спаны речи с паддингом, склейка близких
        merged = []
        for s, e in spans:
            s, e = max(0, s - pad), min(total, e + pad)
            if merged and s - merged[-1][1] < 300:
                merged[-1][1] = e
            else:
                merged.append([s, e])

        pieces = []
        cur_audio, cur_map, cur_pos = None, [], 0

        def flush():
            nonlocal cur_audio, cur_map, cur_pos
            if cur_audio is not None:
                pieces.append((cur_audio, cur_map))
            cur_audio, cur_map, cur_pos = None, [], 0

        for s, e in merged:
            span = e - s
            while span > chunk_ms:  # длинный спан — жёсткая резка
                flush()
                pieces.append((audio[s:s + chunk_ms], [(0.0, s / 1000.0, chunk_s)]))
                s += chunk_ms
                span = e - s
            if cur_pos + span > chunk_ms:
                flush()
            cur_audio = audio[s:e] if cur_audio is None else cur_audio + audio[s:e]
            cur_map.append((cur_pos / 1000.0, s / 1000.0, span / 1000.0))
            cur_pos += span
        flush()
        return pieces

    def _transcribe_api(self, audio_file: str, language: str = None) -> Dict:
        """Транскрипция через облачный STT (OpenRouter /audio/transcriptions)."""
        from pydub import AudioSegment
        model_id = self._stt_api_model_id()
        chunk_s = getattr(self.config, 'stt_chunk_seconds', None) or STT_CHUNK_SECONDS

        audio = AudioSegment.from_wav(audio_file)
        if getattr(self.config, 'stt_cut_silence', True):
            pieces = self._stt_pieces(audio, chunk_s)
            speech_ms = sum(piece.duration_seconds for piece, _ in pieces) * 1000
            logger.info(f"☁️ STT API: {model_id}, {len(pieces)} чанков ≤{chunk_s}s, "
                        f"речи {speech_ms / 60000:.1f} мин из {audio.duration_seconds / 60:.1f} мин")
        else:
            chunk_ms = chunk_s * 1000
            total = len(audio)
            pieces = [
                (audio[s:s + chunk_ms], [(0.0, s / 1000.0, min(chunk_ms, total - s) / 1000.0)])
                for s in range(0, total, chunk_ms)
            ]
            logger.info(f"☁️ STT API: {model_id}, {len(pieces)} чанков по {chunk_s}s")

        all_words, all_segments, total_cost = [], [], 0.0

        for idx, (piece, piece_map) in enumerate(pieces):
            tmp_path = TEMP_DIR / f"_stt_{idx}_{int(time.time())}.mp3"
            piece.export(str(tmp_path), format='mp3', bitrate='64k', parameters=['-ar', '16000', '-ac', '1'])
            resp = self._call_stt_api(tmp_path, model_id, language)
            try:
                tmp_path.unlink(missing_ok=True)
            except Exception:
                pass
            if resp:
                total_cost += float((resp.get('usage') or {}).get('cost') or 0)
                for w in resp.get('words') or []:
                    all_words.append({
                        'word': w.get('word', ''),
                        'start': self._piece_time_to_real(piece_map, float(w.get('start', 0))),
                        'end': self._piece_time_to_real(piece_map, float(w.get('end', 0))),
                    })
                for s in resp.get('segments') or []:
                    text = (s.get('text') or '').strip()
                    if text:
                        all_segments.append({
                            'start': self._piece_time_to_real(piece_map, float(s.get('start', 0))),
                            'end': self._piece_time_to_real(piece_map, float(s.get('end', 0))),
                            'text': text,
                        })
            else:
                logger.warning(f"⚠️ STT API: чанк {idx} пропущен")
        idx = len(pieces)

        # провайдеры вроде gemini/grok отдают один сегмент на чанк — режем слова по паузам
        if len(all_segments) <= idx and all_words:
            all_segments = self._group_words_to_segments(all_words)
        all_segments.sort(key=lambda s: s['start'])

        result = {
            'segments': all_segments,
            'alignment': bool(all_words),
            'stt_engine': model_id,
            'stt_cost': round(total_cost, 4),
        }
        if all_words:
            result['word_segments'] = all_words
        logger.info(f"✅ STT API: {len(all_segments)} сегментов, {len(all_words)} слов, cost=${total_cost:.4f}")
        return result

    def process_audio_chunks(self, audio_file: str, language: str = None) -> List[Dict]:
        """Обрабатывает аудио по интеллектуальным чанкам с progress tracking."""
        try:
            logger.info(f"📊 Начало обработки аудио по чанкам: {Path(audio_file).name}")
            
            # Создаем интеллектуальные чанки с учетом пауз в речи
            language = self._resolve_language(language)
            chunks = self.chunker.create_intelligent_chunks(audio_file)
            
            if not chunks:
                logger.error("❌ Не удалось создать чанки")
                return []
            
            logger.info(f"📦 Создано {len(chunks)} интеллектуальных чанков")
            
            from pydub import AudioSegment

            model = self.load_whisper_model()
            source_audio = AudioSegment.from_wav(audio_file)
            chunk_dir = TEMP_DIR / f"{Path(audio_file).stem}_chunks"
            chunk_dir.mkdir(exist_ok=True)
            
            # Обрабатываем каждый чанк
            all_segments = []
            
            with tqdm(total=len(chunks), desc="🎤 Транскрипция чанков", 
                     disable=not self.config.enable_progress_bar) as pbar:
                
                for i, chunk in enumerate(chunks):
                    chunk_path = None
                    try:
                        # Проверка памяти перед обработкой чанка
                        memory_usage = monitor_memory()
                        if memory_usage > self.config.max_memory_usage_gb * 0.9:
                            logger.warning(f"⚠️ Высокое использование памяти ({memory_usage:.2f} GB), очищаем...")
                            cleanup_memory()
                        
                        chunk_path = chunk_dir / f"chunk_{i:03d}_{int(chunk['start'] * 1000)}_{int(chunk['end'] * 1000)}.wav"
                        start_ms = int(chunk['start'] * 1000)
                        end_ms = int(chunk['end'] * 1000)
                        chunk_audio = source_audio[start_ms:end_ms]
                        chunk_audio.export(str(chunk_path), format="wav")

                        # Транскрибируем чанк
                        chunk_result = self._transcribe_chunk(model, str(chunk_path), language)
                        
                        if chunk_result and 'segments' in chunk_result:
                            # Корректируем временные метки
                            adjusted_segments = self._adjust_timestamps(chunk_result['segments'], chunk['start'])
                            all_segments.extend(adjusted_segments)
                        
                        pbar.set_postfix({
                            'Чанк': f"{i+1}/{len(chunks)}",
                            'Память': f"{monitor_memory():.1f}GB",
                            'Длительность': f"{chunk['duration']:.1f}s"
                        })
                        pbar.update(1)
                        
                    except Exception as e:
                        logger.error(f"❌ Ошибка обработки чанка {i+1}: {e}")
                        continue
                    finally:
                        if chunk_path is not None:
                            Path(chunk_path).unlink(missing_ok=True)
            
            # Освобождаем память
            del model, source_audio
            if chunk_dir.exists():
                for leftover_chunk in chunk_dir.glob("*.wav"):
                    leftover_chunk.unlink(missing_ok=True)
                chunk_dir.rmdir()
            cleanup_memory()
            
            logger.info(f"✅ Обработка чанков завершена: {len(all_segments)} сегментов")
            return all_segments
            
        except Exception as e:
            logger.error(f"❌ Ошибка обработки аудио по чанкам: {e}")
            cleanup_memory()
            return []
    
    @retry_on_failure(max_retries=2, delay=1.0)
    def _transcribe_chunk(self, model, chunk_path: str, language: str = None) -> Optional[Dict]:
        """Транскрибирует отдельный чанк аудио."""
        try:
            # Загружаем аудио
            language = self._resolve_language(language)
            audio = whisperx.load_audio(chunk_path)
            
            # Транскрибируем
            initial_prompt = getattr(self.config, 'custom_vocabulary', '') or ''
            if not initial_prompt:
                try:
                    import json as _json
                    vocab_path = Path(os.environ.get('VOICE_VOCAB_PATH', ''))
                    if vocab_path.exists():
                        vocab = _json.loads(vocab_path.read_text(encoding='utf-8'))
                        terms = vocab.get('all_terms', [])[:50]
                        if terms:
                            initial_prompt = 'Термины: ' + ', '.join(terms)
                except Exception:
                    pass
            transcribe_kwargs = {'batch_size': self.config.batch_size, 'language': language}
            if initial_prompt:
                transcribe_kwargs['initial_prompt'] = initial_prompt
            result = model.transcribe(audio, **transcribe_kwargs)
            
            # Освобождаем память
            del audio
            
            return result
            
        except Exception as e:
            logger.error(f"❌ Ошибка транскрипции чанка {chunk_path}: {e}")
            return None
    
    def _adjust_timestamps(self, segments: List[Dict], offset: float) -> List[Dict]:
        """Корректирует временные метки сегментов с учетом смещения чанка."""
        adjusted_segments = []
        
        for segment in segments:
            adjusted_segment = segment.copy()
            adjusted_segment['start'] += offset
            adjusted_segment['end'] += offset
            
            # Корректируем временные метки слов, если они есть
            if 'words' in adjusted_segment and adjusted_segment['words']:
                adjusted_words = []
                for word in adjusted_segment['words']:
                    adjusted_word = word.copy()
                    if 'start' in adjusted_word:
                        adjusted_word['start'] += offset
                    if 'end' in adjusted_word:
                        adjusted_word['end'] += offset
                    adjusted_words.append(adjusted_word)
                adjusted_segment['words'] = adjusted_words
            
            adjusted_segments.append(adjusted_segment)
        
        return adjusted_segments
    
    def perform_diarization(self, audio_file: str) -> Optional[List[Dict]]:
        """Выполняет диаризацию аудио с использованием WhisperX."""
        try:
            if not self.config.enable_diarization:
                logger.info("ℹ️ Диаризация отключена")
                return None
                
            logger.info(f"🎭 Начало диаризации: {Path(audio_file).name}")
            
            # Загружаем модель диаризации если не загружена
            if not self.diarize_model:
                self.load_diarization_model()
            
            if not self.diarize_model:
                logger.warning("⚠️ Модель диаризации недоступна")
                return None
            
            # Загружаем аудио
            audio = whisperx.load_audio(audio_file)
            
            # Выполняем диаризацию
            diarize_segments = self.diarize_model(
                audio,
                num_speakers=(getattr(self.config, 'diarization_num_speakers', 0) or None),
                min_speakers=self.config.diarization_min_speakers,
                max_speakers=self.config.diarization_max_speakers
            )

            diarize_segments = self._normalize_diarization_segments(diarize_segments)
            
            # Освобождаем память
            del audio
            cleanup_memory()
            
            logger.info(f"✅ Диаризация завершена: найдено {len(set(seg.get('speaker', 'UNKNOWN') for seg in diarize_segments))} спикеров")
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
    
    def assign_speakers_to_segments(self, segments: List[Dict], diarize_segments: List[Dict],
                                    word_segments: Optional[List[Dict]] = None) -> List[Dict]:
        """Назначает спикеров сегментам транскрипции (word-level при наличии таймкодов слов)."""
        try:
            if not diarize_segments:
                logger.warning("⚠️ Нет данных диаризации для назначения спикеров")
                return segments

            logger.info("👥 Назначение спикеров сегментам транскрипции...")

            # Создаем индекс диаризации для быстрого поиска
            diarization_index = self._create_diarization_index(diarize_segments)

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
    
    @retry_on_failure(max_retries=2, delay=1.0)
    def transcribe_audio(self, audio_file: str, language: str = None,
                         diarization_audio_file: Optional[str] = None) -> Dict:
        """Основной метод транскрипции аудио с поддержкой диаризации.

        diarization_audio_file — отдельный звук для диаризации (например, сырой,
        без сепаратора); по умолчанию тот же, что и для STT.
        """
        diar_audio = diarization_audio_file or audio_file
        try:
            logger.info(f"🎙️ Начало транскрипции: {Path(audio_file).name}")
            
            # Определяем, нужно ли разбивать на чанки
            from pydub import AudioSegment
            language = self._resolve_language(language)
            audio = AudioSegment.from_wav(audio_file)
            duration_seconds = len(audio) / 1000
            
            stt_engine = (getattr(self.config, 'stt_engine', None) or STT_ENGINE or 'whisper')
            diarize_segments = None
            if stt_engine != 'whisper':
                if self.config.enable_diarization:
                    # Параллельно: API-STT идёт по сети, диаризация — на GPU.
                    # Экономия ~10 мин на часовой записи
                    logger.info("⚡ Параллельный запуск: API STT + GPU-диаризация")
                    with ThreadPoolExecutor(max_workers=2) as ex:
                        fut_stt = ex.submit(self._transcribe_api, audio_file, language)
                        fut_diar = ex.submit(self.perform_diarization, diar_audio)
                        result = fut_stt.result()
                        diarize_segments = fut_diar.result()
                else:
                    result = self._transcribe_api(audio_file, language)
            else:
                if duration_seconds > self.config.max_chunk_duration:
                    logger.info(f"📊 Аудио длинное ({duration_seconds:.1f}s), используем интеллектуальный чанкинг")
                    segments = self.process_audio_chunks(audio_file, language)
                    result = {'segments': segments}
                else:
                    logger.info(f"📊 Аудио короткое ({duration_seconds:.1f}s), обрабатываем целиком")
                    model = self.load_whisper_model()
                    audio_data = whisperx.load_audio(audio_file)
                    result = model.transcribe(audio_data, batch_size=self.config.batch_size, language=language)
                    
                    # Очистка
                    del model, audio_data
                    cleanup_memory()
                
                # Применяем коррекции текста
                result = self._apply_alignment(result, audio_file, language)

                # Локальный whisper: диаризация после транскрипции (одна GPU-очередь)
                if self.config.enable_diarization:
                    diarize_segments = self.perform_diarization(diar_audio)

            if result and 'segments' in result:
                result['segments'] = self._apply_text_corrections(result['segments'])

            # Назначаем спикеров к сегментам (общий путь для обоих движков)
            if diarize_segments and result and 'segments' in result:
                result['segments'] = self.assign_speakers_to_segments(
                    result['segments'], diarize_segments, result.get('word_segments')
                )
            
            # Добавляем информацию о диаризации в результат
            if result:
                result['diarization'] = diarize_segments is not None
                result['speakers_count'] = len(set(seg.get('speaker', 'UNKNOWN') for seg in result.get('segments', []))) if diarize_segments else 0
                result['language'] = language
            
            logger.info(f"✅ Транскрипция завершена: {len(result.get('segments', []))} сегментов")
            if result.get('diarization'):
                logger.info(f"🎭 Обнаружено спикеров: {result['speakers_count']}")
            
            return result
            
        except Exception as e:
            logger.error(f"❌ Ошибка транскрипции: {e}")
            cleanup_memory()
            return {'segments': [], 'diarization': False, 'speakers_count': 0}
    
    def _apply_text_corrections(self, segments: List[Dict]) -> List[Dict]:
        """Применяет коррекции текста к сегментам."""
        corrected_segments = []
        
        for segment in segments:
            if 'text' in segment:
                # Применяем правила замен
                corrected_text = self._apply_replacement_rules(segment['text'])
                
                # Удаляем слова-паразиты
                corrected_text = self._remove_filler_words(corrected_text)
                
                # Обновляем сегмент
                corrected_segment = segment.copy()
                corrected_segment['text'] = corrected_text
                corrected_segments.append(corrected_segment)
            else:
                corrected_segments.append(segment)
        
        return corrected_segments
    
    def _apply_replacement_rules(self, text: str) -> str:
        """Применяет правила замен к тексту."""
        corrected_text = text
        
        for wrong, correct in self.replacement_rules.items():
            # Используем регулярные выражения для замены с учетом границ слов
            pattern = r'\b' + re.escape(wrong) + r'\b'
            corrected_text = re.sub(pattern, correct, corrected_text, flags=re.IGNORECASE)
        
        return corrected_text
    
    def _remove_filler_words(self, text: str) -> str:
        """Удаляет слова-паразиты из текста."""
        cleaned_text = text
        
        for pattern in self.filler_patterns:
            # Удаляем паттерны с учетом границ слов
            regex_pattern = r'\b' + re.escape(pattern) + r'\b'
            cleaned_text = re.sub(regex_pattern, '', cleaned_text, flags=re.IGNORECASE)
        
        # Очищаем лишние пробелы
        cleaned_text = re.sub(r'\s+', ' ', cleaned_text).strip()
        
        return cleaned_text
