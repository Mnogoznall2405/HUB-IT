import logging
import json
import re
import sys
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple
from datetime import datetime
import time

from .audio_processor import AudioProcessor, ProcessingConfig
from .transcription import TranscriptionProcessor
from .diarization import SpeakerDiarization
from .analyzer import MeetingAnalyzer
from .segmentation import MeetingSegmentation
from .report_generator import ReportGenerator
from .clips import attach_assignment_clips, find_video_for_base
from config import INPUT_DIR, OUTPUT_DIR, PROCESSED_DIR, TEMP_DIR, PROJECT_ROOT

logger = logging.getLogger(__name__)

class MainProcessor:
    """Главный класс для координации всех процессов обработки аудио/видео файлов"""
    
    def __init__(self, config: ProcessingConfig):
        self.config = config
        
        # Инициализируем все процессоры
        self.audio_processor = AudioProcessor(config)
        self.transcription_processor = TranscriptionProcessor(config.whisper_model, config)
        self.speaker_diarization = SpeakerDiarization(config)
        self.meeting_analyzer = MeetingAnalyzer(config)
        self.meeting_segmentation = MeetingSegmentation(config)
        self.report_generator = ReportGenerator(config)
        
        # Создаем необходимые директории
        self._ensure_directories()
        
        logger.info("🚀 MainProcessor инициализирован")
    
    def _ensure_directories(self):
        """Создает необходимые директории если они не существуют."""
        try:
            Path(INPUT_DIR).mkdir(exist_ok=True)
            Path(OUTPUT_DIR).mkdir(exist_ok=True)
            Path(PROCESSED_DIR).mkdir(exist_ok=True)
            
            logger.info("📁 Директории проверены/созданы")
            
        except Exception as e:
            logger.error(f"❌ Ошибка создания директорий: {e}")

    # ---------- Чекпоинты этапов ----------

    def _ckpt_path(self, base_filename: str, stage: str) -> Path:
        return Path(TEMP_DIR) / f"{base_filename}_ckpt_{stage}.json"

    @staticmethod
    def _extract_meeting_date(name: str) -> Optional[str]:
        """Достаёт дату встречи из имени файла (2026-09-25, 25.09.2026, 25_09_2026)."""
        m = re.search(r'(20\d{2})[-._](\d{1,2})[-._](\d{1,2})', name)
        if m:
            return f"{int(m.group(3)):02d}.{int(m.group(2)):02d}.{m.group(1)}"
        m = re.search(r'(?<!\d)(\d{1,2})[-._](\d{1,2})[-._](20\d{2})(?!\d)', name)
        if m:
            return f"{int(m.group(1)):02d}.{int(m.group(2)):02d}.{m.group(3)}"
        return None

    def _ckpt_load(self, base_filename: str, stage: str, source_file: Path) -> Optional[Any]:
        """Грузит чекпоинт, если он от этого же исходника (путь+размер)."""
        if not getattr(self.config, 'use_checkpoints', True):
            return None
        p = self._ckpt_path(base_filename, stage)
        if not p.exists():
            return None
        try:
            data = json.loads(p.read_text(encoding='utf-8'))
            meta = data.get('_meta', {})
            stat = Path(source_file).stat()
            if meta.get('source') == str(source_file) and meta.get('size') == stat.st_size:
                logger.info(f"♻️ Найден чекпоинт этапа '{stage}'")
                return data.get('payload')
            logger.info(f"↻ Чекпоинт '{stage}' от другого исходника — игнорирую")
            return None
        except Exception:
            return None

    def _ckpt_save(self, base_filename: str, stage: str, source_file: Path, payload: Any) -> None:
        if not getattr(self.config, 'use_checkpoints', True):
            return
        try:
            stat = Path(source_file).stat()
            data = {
                '_meta': {
                    'source': str(source_file),
                    'size': stat.st_size,
                    'mtime': stat.st_mtime,
                    'saved_at': datetime.now().isoformat()
                },
                'payload': payload
            }
            self._ckpt_path(base_filename, stage).write_text(
                json.dumps(data, ensure_ascii=False), encoding='utf-8'
            )
        except Exception as e:
            logger.debug(f"Чекпоинт '{stage}' не сохранён: {e}")

    def process_file(self, file_path: str) -> Dict[str, Any]:
        """Обрабатывает один файл полностью."""
        try:
            start_time = time.time()
            file_path = Path(file_path)
            
            logger.info(f"🎬 Начинаем обработку файла: {file_path.name}")
            
            # Проверяем существование файла
            if not file_path.exists():
                raise FileNotFoundError(f"Файл не найден: {file_path}")
            
            # Получаем базовое имя файла
            base_filename = file_path.stem

            # Дата встречи для реестра поручений: из флага или из имени файла
            if not getattr(self.config, 'meeting_date', None):
                self.config.meeting_date = self._extract_meeting_date(base_filename)
            if not getattr(self.config, 'meeting_date', None):
                # Нет ни флага, ни даты в имени — дата записи из метаданных файла
                from .media_meta import media_recording_date
                self.config.meeting_date = media_recording_date(file_path)
                if self.config.meeting_date:
                    logger.info(f"📅 Дата встречи по метаданным записи: {self.config.meeting_date}")

            # Этап 1: Обработка аудио
            logger.info("🎵 Этап 1: Извлечение и обработка аудио...")

            # Создаем путь для обработанного аудио
            temp_audio_path = TEMP_DIR / f"{base_filename}_processed.wav"

            audio_result = self._ckpt_load(base_filename, 'audio', file_path)
            if audio_result and temp_audio_path.exists():
                logger.info("♻️ Чекпоинт: обработанное аудио уже есть — этап пропущен")
            else:
                audio_result = self.audio_processor.process_audio(str(file_path), str(temp_audio_path))
                if not audio_result:
                    raise Exception("Ошибка обработки аудио")
                self._ckpt_save(base_filename, 'audio', file_path, audio_result)

            processed_audio_path = str(temp_audio_path)
            diarization_audio_path = self._diarization_audio_path(base_filename, processed_audio_path)

            # Этап 2: Транскрипция (+ интегрированная диаризация для облачного STT
            # — идёт параллельно: API по сети, диаризация на GPU)
            transcription_result = self._ckpt_load(base_filename, 'stt', file_path)
            if transcription_result and transcription_result.get('segments'):
                logger.info("♻️ Чекпоинт: транскрипция уже есть — этап пропущен")
            else:
                logger.info("📝 Этап 2: Транскрипция аудио с диаризацией...")
                transcription_result = self.transcription_processor.transcribe_audio(
                    processed_audio_path,
                    self.config.language,
                    diarization_audio_file=diarization_audio_path,
                )
                if not transcription_result or not transcription_result.get('segments'):
                    raise Exception("Ошибка транскрипции")
                self._ckpt_save(base_filename, 'stt', file_path, transcription_result)

            segments_with_speakers = transcription_result['segments']

            # Проверяем, была ли выполнена диаризация в рамках транскрипции
            if transcription_result.get('diarization', False):
                logger.info(f"✅ WhisperX диаризация выполнена: {transcription_result.get('speakers_count', 0)} спикеров")
                diarization_result = {
                    'success': True,
                    'method': 'whisperx_integrated',
                    'speakers_count': transcription_result.get('speakers_count', 0),
                    'segments': segments_with_speakers
                }
            else:
                diarization_result = self._ckpt_load(base_filename, 'diarization', file_path)
                if diarization_result and diarization_result.get('segments'):
                    logger.info("♻️ Чекпоинт: диаризация уже есть — этап пропущен")
                    segments_with_speakers = diarization_result['segments']
                else:
                    # Этап 3: Дополнительная диаризация (если WhisperX диаризация отключена)
                    logger.info("👥 Этап 3: Дополнительная диаризация спикеров...")
                    diarization_result = self.speaker_diarization.process_diarization(
                        diarization_audio_path, transcription_result
                    )
                    if not diarization_result or not diarization_result.get('success'):
                        logger.warning("⚠️ Дополнительная диаризация не удалась")
                        diarization_result = {
                            'success': False,
                            'method': 'pyannote_fallback',
                            'speakers_count': 0,
                            'segments': segments_with_speakers
                        }
                    else:
                        segments_with_speakers = diarization_result['segments']
                    self._ckpt_save(base_filename, 'diarization', file_path, diarization_result)

            speakers_ckpt = self._ckpt_load(base_filename, 'speakers', file_path)
            if speakers_ckpt and speakers_ckpt.get('segments'):
                logger.info("♻️ Чекпоинт: именование спикеров уже выполнено — этап пропущен")
                segments_with_speakers = speakers_ckpt['segments']
                speaker_naming_result = speakers_ckpt.get('naming') or {}
            else:
                logger.info("🪪 Этап 3.5: Идентификация и уточнение спикеров...")
                segments_with_speakers, speaker_naming_result = self._resolve_speaker_names(
                    processed_audio_path,
                    segments_with_speakers,
                    base_filename,
                    diarize_turns=(transcription_result.get('diarize_segments')
                                   or diarization_result.get('diarization_result')),
                )
                self._ckpt_save(base_filename, 'speakers', file_path, {
                    'segments': segments_with_speakers,
                    'naming': speaker_naming_result
                })
            transcription_result['segments'] = segments_with_speakers
            transcription_result['speaker_naming'] = speaker_naming_result
            transcription_result['speakers_count'] = len({segment.get('speaker', 'UNKNOWN') for segment in segments_with_speakers})
            diarization_result['segments'] = segments_with_speakers
            diarization_result['speaker_naming'] = speaker_naming_result
            diarization_result['speakers_count'] = len({segment.get('speaker', 'UNKNOWN') for segment in segments_with_speakers})

            # Этап 4+5: Семантическая сегментация → анализ каждой темы → протокол
            logger.info("🧠 Этап 4-5: Сегментация, по-темный анализ и синтез протокола...")
            detailed_analysis = self.meeting_segmentation.segment_and_analyze_meeting(
                segments_with_speakers
            )
            segmentation_result = detailed_analysis.get('topic_segments', [])
            
            # Этап 6: Базовый анализ встречи
            logger.info("💡 Этап 6: Базовый анализ встречи...")
            analysis_result = self.meeting_analyzer.analyze_meeting(
                segments_with_speakers
            )
            
            # Этап 7: Генерация инсайтов
            logger.info("🔍 Этап 7: Генерация инсайтов...")
            insights = self.meeting_analyzer.generate_meeting_insights(
                analysis_result, segments_with_speakers
            )
            
            # Объединяем результаты анализа
            combined_analysis = {
                **analysis_result,
                'segmentation': segmentation_result,
                'detailed_analysis': detailed_analysis
            }
            
            self._attach_assignment_clips(
                combined_analysis, segments_with_speakers,
                [{'path': str(file_path), 'offset': 0.0}], base_filename)

            # Этап 8: Генерация отчетов
            logger.info("📄 Этап 8: Генерация отчетов...")
            generated_reports = self.report_generator.generate_all_reports(
                combined_analysis, segments_with_speakers, insights, base_filename,
                word_segments=transcription_result.get('word_segments')
            )
            
            # Перемещаем обработанный файл
            self._move_processed_file(file_path)
            
            # Подготавливаем результат
            processing_time = time.time() - start_time
            
            result = {
                'success': True,
                'file_name': file_path.name,
                'base_filename': base_filename,
                'processing_time_seconds': round(processing_time, 2),
                'processing_time_formatted': self._format_duration(processing_time),
                'audio_processing': audio_result,
                'transcription': transcription_result,
                'diarization': diarization_result,
                'speaker_naming': speaker_naming_result,
                'analysis': combined_analysis,
                'insights': insights,
                'segmentation': segmentation_result,
                'detailed_analysis': detailed_analysis,
                'generated_reports': generated_reports,
                'segments_count': len(segments_with_speakers),
                'processed_at': datetime.now().isoformat()
            }
            
            logger.info(f"✅ Файл {file_path.name} успешно обработан за {self._format_duration(processing_time)}")
            return result
            
        except Exception as e:
            logger.error(f"❌ Ошибка обработки файла {file_path}: {e}")
            return {
                'success': False,
                'file_name': file_path.name if 'file_path' in locals() else 'unknown',
                'error': str(e),
                'processed_at': datetime.now().isoformat()
            }

    def _diarization_audio_path(self, base_filename: str, processed_audio_path: str) -> str:
        """Звук для диаризации: сырой (DIARIZATION_AUDIO=raw) или тот же, что для STT."""
        if getattr(self.config, 'diarization_audio', 'processed') != 'raw':
            return processed_audio_path
        raw_path = TEMP_DIR / f"{base_filename}_raw.wav"
        if raw_path.exists():
            logger.info("🎭 Диаризация по сырому звуку (DIARIZATION_AUDIO=raw)")
            return str(raw_path)
        logger.warning("⚠️ DIARIZATION_AUDIO=raw, но сырой звук не найден — диаризация по обработанному")
        return processed_audio_path

    def resume_speaker_naming(self, base_filename: str) -> Dict[str, Any]:
        """Повторная идентификация/именование спикеров и перегенерация анализа
        по сохранённому транскрипту — без повторных аудио-этапов.

        Сценарий: после прогона пользователь добавил голоса через --enroll-voice
        (или готов ввести имена вручную) — команда заново выполняет этапы
        идентификации → анализа → отчётов для output/<base>_transcript.json.
        """
        transcript_path = Path(OUTPUT_DIR) / base_filename / f"{base_filename}_transcript.json"
        if not transcript_path.exists():
            # Обратная совместимость: плоская структура output/<base>_transcript.json
            transcript_path = Path(OUTPUT_DIR) / f"{base_filename}_transcript.json"
        if not transcript_path.exists():
            return {'success': False, 'error': f'Не найден транскрипт: {transcript_path}'}

        try:
            logger.info(f"♻️ Повторное именование спикеров для {base_filename}...")
            data = json.loads(transcript_path.read_text(encoding='utf-8'))
            segments = data.get('segments', [])
            if not segments:
                return {'success': False, 'error': 'В транскрипте нет сегментов'}

            # Восстанавливаем поля start/end, которых ждут этапы обработки
            for s in segments:
                s['start'] = float(s.get('start', s.get('start_time', 0)) or 0)
                s['end'] = float(s.get('end', s.get('end_time', 0)) or 0)

            word_segments = data.get('word_segments')

            if not getattr(self.config, 'meeting_date', None):
                self.config.meeting_date = self._extract_meeting_date(base_filename)

            # Обработанное аудио нужно для эмбеддингов и сэмплов; без него —
            # только ручное именование по уже выгруженным сэмплам
            processed_audio = Path(TEMP_DIR) / f"{base_filename}_processed.wav"
            audio_available = processed_audio.exists()
            if not audio_available:
                logger.warning("⚠️ Обработанное аудио не найдено — автоидентификация и "
                               "экспорт сэмплов недоступны, только ручное именование")

            prev_export = self.config.export_unknown_speaker_samples
            self.config.export_unknown_speaker_samples = prev_export and audio_available
            try:
                segments_with_speakers, speaker_naming_result = self._resolve_speaker_names(
                    str(processed_audio), segments, base_filename
                )
            finally:
                self.config.export_unknown_speaker_samples = prev_export

            # Перегенерируем анализ и отчёты с новыми именами
            logger.info("🧠 Перегенерация анализа (сегментация → темы → протокол)...")
            detailed_analysis = self.meeting_segmentation.segment_and_analyze_meeting(
                segments_with_speakers
            )
            analysis_result = self.meeting_analyzer.analyze_meeting(segments_with_speakers)
            insights = self.meeting_analyzer.generate_meeting_insights(
                analysis_result, segments_with_speakers
            )
            combined_analysis = {
                **analysis_result,
                'segmentation': detailed_analysis.get('topic_segments', []),
                'detailed_analysis': detailed_analysis
            }
            source_parts = (data.get('metadata') or {}).get('source_parts') or []
            if not source_parts:
                vpath = find_video_for_base(base_filename)
                if vpath:
                    source_parts = [{'path': str(vpath), 'offset': 0.0}]
            self._attach_assignment_clips(
                combined_analysis, segments_with_speakers, source_parts, base_filename)
            generated_reports = self.report_generator.generate_all_reports(
                combined_analysis, segments_with_speakers, insights, base_filename,
                word_segments=word_segments
            )

            result = {
                'success': True,
                'base_filename': base_filename,
                'speaker_naming': speaker_naming_result,
                'remaining_unresolved_speakers': speaker_naming_result.get('remaining_unresolved_speakers', []),
                'generated_reports': generated_reports,
                'segments_count': len(segments_with_speakers),
            }
            logger.info(f"✅ Повторное именование завершено для {base_filename}")
            return result

        except Exception as e:
            logger.error(f"❌ Ошибка повторного именования: {e}", exc_info=True)
            return {'success': False, 'error': str(e)}

    def merge_meetings(self, base_filenames: List[str], merged_base: Optional[str] = None) -> Dict[str, Any]:
        """Склеивает части одной встречи (несколько файлов) в единый транскрипт,
        прогоняет анализ и строит общие отчёты.

        Время частей сдвигается кумулятивно (часть 2 идёт после части 1).
        Безымянные метки SPEAKER_xx в частях >1 получают префикс P<N>_ —
        кластеры диаризации у разных файлов разные люди.
        """
        merged_base = merged_base or f"{base_filenames[0]}_merged"
        if not getattr(self.config, 'meeting_date', None):
            self.config.meeting_date = self._extract_meeting_date(base_filenames[0])
        merged_segments: List[Dict[str, Any]] = []
        source_parts: List[Dict[str, Any]] = []
        offset = 0.0
        try:
            for idx, base in enumerate(base_filenames):
                tpath = Path(OUTPUT_DIR) / base / f"{base}_transcript.json"
                if not tpath.exists():
                    tpath = Path(OUTPUT_DIR) / f"{base}_transcript.json"
                if not tpath.exists():
                    return {'success': False, 'error': f'Не найден транскрипт: {tpath}'}
                data = json.loads(tpath.read_text(encoding='utf-8'))
                segs = data.get('segments', [])
                if not segs:
                    return {'success': False, 'error': f'Пустой транскрипт: {base}'}

                part_end = 0.0
                for s in segs:
                    st = float(s.get('start', s.get('start_time', 0)) or 0)
                    en = float(s.get('end', s.get('end_time', 0)) or 0)
                    spk = s.get('speaker', 'SPEAKER')
                    if idx > 0 and re.match(r'^SPEAKER_\d+$', str(spk)):
                        spk = f"P{idx + 1}_{spk}"
                    merged_segments.append({
                        **s,
                        'start': st + offset,
                        'end': en + offset,
                        'start_time': st + offset,
                        'end_time': en + offset,
                        'speaker': spk
                    })
                    part_end = max(part_end, en)
                vpath = find_video_for_base(base)
                source_parts.append({'path': str(vpath) if vpath else '', 'offset': offset})
                offset += part_end
                logger.info(f"📎 Часть {idx + 1} '{base}': {len(segs)} сегментов, длина {part_end:.0f}с")

            merged_segments.sort(key=lambda x: x['start'])
            logger.info(f"🔗 Объединено: {len(merged_segments)} сегментов, {offset/60:.1f} мин")

            # Сохраняем объединённый транскрипт
            out_dir = Path(OUTPUT_DIR) / merged_base
            out_dir.mkdir(parents=True, exist_ok=True)
            (out_dir / f"{merged_base}_transcript.json").write_text(
                json.dumps({'metadata': {'source_parts': source_parts,
                                         'merged_from': base_filenames},
                            'segments': merged_segments}, ensure_ascii=False, indent=2),
                encoding='utf-8'
            )

            logger.info("🧠 Анализ объединённой встречи (сегментация → темы → протокол)...")
            detailed_analysis = self.meeting_segmentation.segment_and_analyze_meeting(merged_segments)
            analysis_result = self.meeting_analyzer.analyze_meeting(merged_segments)
            insights = self.meeting_analyzer.generate_meeting_insights(analysis_result, merged_segments)
            combined_analysis = {
                **analysis_result,
                'segmentation': detailed_analysis.get('topic_segments', []),
                'detailed_analysis': detailed_analysis
            }
            self._attach_assignment_clips(
                combined_analysis, merged_segments, source_parts, merged_base)
            generated_reports = self.report_generator.generate_all_reports(
                combined_analysis, merged_segments, insights, merged_base
            )

            logger.info(f"✅ Объединение завершено: {merged_base}")
            return {
                'success': True,
                'base_filename': merged_base,
                'parts': base_filenames,
                'segments_count': len(merged_segments),
                'generated_reports': generated_reports
            }

        except Exception as e:
            logger.error(f"❌ Ошибка объединения: {e}", exc_info=True)
            return {'success': False, 'error': str(e)}

    def _attach_assignment_clips(self, combined_analysis: Dict[str, Any],
                                 segments: List[Dict[str, Any]],
                                 source_parts: List[Dict[str, Any]],
                                 base_filename: str) -> None:
        """Нарезает видео-клипы под поручения реестра и вставляет ссылки."""
        try:
            da = (combined_analysis or {}).get('detailed_analysis') or {}
            registry = da.get('action_registry')
            if not registry or not source_parts:
                return
            meeting_dir = Path(OUTPUT_DIR) / base_filename
            meeting_dir.mkdir(parents=True, exist_ok=True)
            da['action_registry'] = attach_assignment_clips(
                registry, da.get('topics') or [], segments, source_parts, meeting_dir)
        except Exception as e:
            logger.warning(f"⚠️ Видео-клипы поручений пропущены: {e}")

    def _resolve_speaker_names(
        self,
        audio_file: str,
        segments_with_speakers: List[Dict[str, Any]],
        base_filename: str,
        diarize_turns: Optional[List[Dict[str, Any]]] = None,
    ) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
        """Сначала пытается сопоставить спикеров автоматически, затем спрашивает ФИО для оставшихся."""
        speaker_naming_result = {
            'auto_identifications': {},
            'identification_details': {},
            'manual_assignments': {},
            'unknown_speaker_samples': {},
            'remaining_unresolved_speakers': []
        }

        if not self.config.enable_diarization or not segments_with_speakers:
            return segments_with_speakers, speaker_naming_result

        speaker_embeddings: Dict[str, Any] = {}
        if self.config.enable_speaker_identification:
            try:
                speaker_embeddings = self.speaker_diarization.extract_speaker_embeddings(
                    audio_file,
                    segments_with_speakers,
                    diarize_turns,
                )
                identification_details = self.speaker_diarization.get_speaker_identification_details(
                    speaker_embeddings
                )
                auto_identifications = {
                    speaker: details['display_name']
                    for speaker, details in identification_details.items()
                    if details.get('identified')
                }

                speaker_naming_result['identification_details'] = identification_details
                speaker_naming_result['auto_identifications'] = auto_identifications

                if auto_identifications:
                    segments_with_speakers = self.speaker_diarization.apply_speaker_names(
                        segments_with_speakers,
                        auto_identifications
                    )

            except Exception as e:
                logger.warning(f"⚠️ Автоидентификация спикеров пропущена: {e}")

        # Принудительные имена (--speaker-map) перекрывают автоидентификацию
        forced_map = getattr(self.config, 'speaker_name_map', None) or {}
        forced_map = {k: v for k, v in forced_map.items() if k and v}
        if forced_map:
            segments_with_speakers = self.speaker_diarization.apply_speaker_names(
                segments_with_speakers,
                forced_map
            )
            speaker_naming_result['manual_assignments'].update(forced_map)
            logger.info(f"👤 Принудительные имена применены: {list(forced_map.keys())}")

        unresolved_speakers = self.speaker_diarization.get_unresolved_speakers(segments_with_speakers)

        if unresolved_speakers and speaker_embeddings and getattr(self.config, 'speaker_recurring', False):
            try:
                from .recurring import register_meeting_voices, registry_path
                recurring = register_meeting_voices(
                    registry_path(PROJECT_ROOT),
                    base_filename,
                    {label: speaker_embeddings.get(label) for label in unresolved_speakers},
                    float(getattr(self.config, 'speaker_recurring_similarity', 0.6)),
                )
                speaker_naming_result['recurring'] = recurring
                repeated = {k: v['count'] for k, v in recurring.items() if v.get('count', 1) > 1}
                if repeated:
                    logger.info(f"🔁 Повторяющиеся голоса: {repeated}")
            except Exception as e:
                logger.warning(f"⚠️ Реестр повторяющихся голосов пропущен: {e}")

        if unresolved_speakers and self.config.export_unknown_speaker_samples:
            sample_paths = self.speaker_diarization.export_unknown_speaker_samples(
                audio_file,
                segments_with_speakers,
                base_filename
            )
            speaker_naming_result['unknown_speaker_samples'] = sample_paths

        if unresolved_speakers:
            # Подхватываем ранее выгруженные сэмплы (актуально для resume без аудио)
            samples_dir = Path(PROJECT_ROOT) / "unassigned_speakers" / base_filename
            if samples_dir.exists():
                for speaker in unresolved_speakers:
                    if speaker in speaker_naming_result['unknown_speaker_samples']:
                        continue
                    existing = sorted(samples_dir.glob(f"{speaker}*.wav"))
                    if existing:
                        speaker_naming_result['unknown_speaker_samples'][speaker] = str(existing[0])

        if unresolved_speakers and self.config.prompt_for_unknown_speakers:
            manual_assignments = self._prompt_for_unknown_speakers(
                segments_with_speakers,
                unresolved_speakers,
                speaker_naming_result['unknown_speaker_samples'],
                speaker_naming_result['identification_details']
            )
            speaker_naming_result['manual_assignments'] = manual_assignments

            if manual_assignments:
                segments_with_speakers = self.speaker_diarization.apply_speaker_names(
                    segments_with_speakers,
                    manual_assignments
                )

        speaker_naming_result['remaining_unresolved_speakers'] = self.speaker_diarization.get_unresolved_speakers(
            segments_with_speakers
        )

        # Подсказка --speaker-map по "возможным" совпадениям — чтобы не собирать строку вручную
        # Только правдоподобные совпадения (review = distance ≤ loose-порога);
        # "очень низкая" уверенность в подсказку не попадает — это была бы ложная рекомендация
        review_map = {
            sp: d.get('matched_name')
            for sp, d in (speaker_naming_result.get('identification_details') or {}).items()
            if d.get('status') == 'review' and not d.get('identified') and d.get('matched_name')
        }
        if review_map:
            hint = ';'.join(f"{k}={v}" for k, v in sorted(review_map.items()))
            logger.info(f'💡 Если совпадения верны — подставь: --speaker-map "{hint}"')
            speaker_naming_result['speaker_map_hint'] = hint
            try:
                hint_dir = Path(PROJECT_ROOT) / "unassigned_speakers" / base_filename
                hint_dir.mkdir(parents=True, exist_ok=True)
                (hint_dir / "speaker_map_hint.txt").write_text(
                    f'--speaker-map "{hint}"\n', encoding='utf-8'
                )
            except Exception:
                pass

        return segments_with_speakers, speaker_naming_result

    def _prompt_for_unknown_speakers(
        self,
        segments_with_speakers: List[Dict[str, Any]],
        unresolved_speakers: List[str],
        sample_paths: Dict[str, str],
        identification_details: Dict[str, Dict[str, Any]]
    ) -> Dict[str, str]:
        """Запрашивает у пользователя ФИО для неизвестных спикеров."""
        if not self._can_prompt_for_unknown_speakers():
            if unresolved_speakers:
                logger.info("⌨️ Ручной ввод ФИО пропущен: нет интерактивного терминала")
            return {}

        manual_assignments = {}

        print("\n=== Ручное именование спикеров ===")
        print("Нажмите Enter, чтобы оставить текущую метку SPEAKER_* без изменений.")

        for speaker in unresolved_speakers:
            details = identification_details.get(speaker, {})
            preview = self._build_speaker_preview(segments_with_speakers, speaker)
            sample_path = sample_paths.get(speaker)
            suggestion = details.get('matched_name')
            confidence = details.get('confidence')

            print(f"\n[{speaker}]")
            if suggestion and details.get('status') == 'review':
                print(f"Предположение: {suggestion} ({confidence})")
            if sample_path:
                print(f"Сэмпл: {sample_path}")
            if preview:
                print(f"Текст: {preview}")

            try:
                speaker_name = input("ФИО спикера: ").strip()
            except (EOFError, KeyboardInterrupt):
                print()
                logger.info("⌨️ Ручной ввод ФИО прерван пользователем")
                break
            if speaker_name:
                manual_assignments[speaker] = speaker_name

        return manual_assignments

    def _can_prompt_for_unknown_speakers(self) -> bool:
        """Проверяет, можно ли безопасно использовать input()."""
        stdin = getattr(sys, 'stdin', None)
        stdout = getattr(sys, 'stdout', None)
        return bool(
            stdin
            and stdout
            and hasattr(stdin, 'isatty')
            and hasattr(stdout, 'isatty')
            and stdin.isatty()
            and stdout.isatty()
        )

    def _build_speaker_preview(self, segments_with_speakers: List[Dict[str, Any]], speaker: str) -> str:
        """Собирает короткий текстовый превью для ручного именования спикера."""
        previews = []
        for segment in segments_with_speakers:
            if segment.get('speaker') != speaker:
                continue

            text = " ".join(str(segment.get('text', '')).split())
            if not text:
                continue

            previews.append(text[:160])
            if len(previews) >= 2:
                break

        return " | ".join(previews)

    def process_directory(self, directory_path: str = None) -> Dict[str, Any]:
        """Обрабатывает все файлы в директории."""
        try:
            if directory_path is None:
                directory_path = INPUT_DIR
            
            directory_path = Path(directory_path)
            
            if not directory_path.exists():
                raise FileNotFoundError(f"Директория не найдена: {directory_path}")
            
            logger.info(f"📁 Начинаем обработку директории: {directory_path}")
            
            # Поддерживаемые форматы
            supported_extensions = {'.mp4', '.avi', '.mov', '.mkv', '.mp3', '.wav', '.m4a', '.flac'}
            
            # Находим все поддерживаемые файлы
            files_to_process = []
            for file_path in directory_path.iterdir():
                if file_path.is_file() and file_path.suffix.lower() in supported_extensions:
                    files_to_process.append(file_path)
            
            if not files_to_process:
                logger.warning(f"⚠️ В директории {directory_path} не найдено поддерживаемых файлов")
                return {
                    'success': True,
                    'processed_files': [],
                    'total_files': 0,
                    'successful_files': 0,
                    'failed_files': 0
                }
            
            logger.info(f"📋 Найдено {len(files_to_process)} файлов для обработки")
            
            # Обрабатываем каждый файл
            results = []
            successful_count = 0
            failed_count = 0
            
            for i, file_path in enumerate(files_to_process, 1):
                logger.info(f"📊 Обработка файла {i}/{len(files_to_process)}: {file_path.name}")
                
                result = self.process_file(str(file_path))
                results.append(result)
                
                if result.get('success'):
                    successful_count += 1
                else:
                    failed_count += 1
            
            # Подготавливаем итоговый результат
            batch_result = {
                'success': True,
                'directory_path': str(directory_path),
                'processed_files': results,
                'total_files': len(files_to_process),
                'successful_files': successful_count,
                'failed_files': failed_count,
                'success_rate': round((successful_count / len(files_to_process)) * 100, 1) if files_to_process else 0,
                'processed_at': datetime.now().isoformat()
            }
            
            logger.info(f"✅ Обработка директории завершена: {successful_count}/{len(files_to_process)} файлов успешно")
            return batch_result
            
        except Exception as e:
            logger.error(f"❌ Ошибка обработки директории: {e}")
            return {
                'success': False,
                'error': str(e),
                'processed_at': datetime.now().isoformat()
            }
    
    def _move_processed_file(self, file_path: Path):
        """Перемещает обработанный файл в папку processed."""
        try:
            processed_dir = Path(PROCESSED_DIR)
            processed_dir.mkdir(exist_ok=True)
            
            destination = processed_dir / file_path.name
            
            # Если файл с таким именем уже существует, добавляем timestamp
            if destination.exists():
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                stem = file_path.stem
                suffix = file_path.suffix
                destination = processed_dir / f"{stem}_{timestamp}{suffix}"
            
            file_path.rename(destination)
            logger.info(f"📦 Файл перемещен в processed: {destination.name}")
            
        except Exception as e:
            logger.error(f"❌ Ошибка перемещения файла: {e}")
    
    def _format_duration(self, seconds: float) -> str:
        """Форматирует длительность в читаемый вид."""
        try:
            hours = int(seconds // 3600)
            minutes = int((seconds % 3600) // 60)
            secs = int(seconds % 60)
            
            if hours > 0:
                return f"{hours}ч {minutes}м {secs}с"
            elif minutes > 0:
                return f"{minutes}м {secs}с"
            else:
                return f"{secs}с"
                
        except Exception:
            return "неизвестно"
    
    def get_processing_status(self) -> Dict[str, Any]:
        """Возвращает статус системы обработки."""
        try:
            input_dir = Path(INPUT_DIR)
            output_dir = Path(OUTPUT_DIR)
            processed_dir = Path(PROCESSED_DIR)
            
            # Подсчитываем файлы
            supported_extensions = {'.mp4', '.avi', '.mov', '.mkv', '.mp3', '.wav', '.m4a', '.flac'}
            
            pending_files = []
            if input_dir.exists():
                for file_path in input_dir.iterdir():
                    if file_path.is_file() and file_path.suffix.lower() in supported_extensions:
                        pending_files.append(file_path.name)
            
            processed_files = []
            if processed_dir.exists():
                for file_path in processed_dir.iterdir():
                    if file_path.is_file():
                        processed_files.append(file_path.name)
            
            output_files = []
            if output_dir.exists():
                for file_path in output_dir.iterdir():
                    if file_path.is_file():
                        output_files.append(file_path.name)
            
            status = {
                'system_ready': True,
                'directories': {
                    'input': str(input_dir),
                    'output': str(output_dir),
                    'processed': str(processed_dir)
                },
                'file_counts': {
                    'pending': len(pending_files),
                    'processed': len(processed_files),
                    'output_files': len(output_files)
                },
                'pending_files': pending_files,
                'processed_files': processed_files[-10:],  # Последние 10
                'config': {
                    'chunk_duration': self.config.chunk_duration_seconds,
                    'enable_diarization': self.config.enable_diarization,
                    'enable_ai_analysis': self.config.enable_ai_analysis,
                    'max_memory_usage': self.config.max_memory_usage_gb
                },
                'checked_at': datetime.now().isoformat()
            }
            
            return status
            
        except Exception as e:
            logger.error(f"❌ Ошибка получения статуса: {e}")
            return {
                'system_ready': False,
                'error': str(e),
                'checked_at': datetime.now().isoformat()
            }
    
    def cleanup_temp_files(self):
        """Очищает временные файлы."""
        try:
            logger.info("🧹 Очистка временных файлов...")
            
            # Очищаем временные файлы в каждом процессоре
            self.audio_processor.cleanup_temp_files()
            
            logger.info("✅ Временные файлы очищены")
            
        except Exception as e:
            logger.error(f"❌ Ошибка очистки временных файлов: {e}")
    
    def save_processing_log(self, result: Dict[str, Any], log_filename: str = None):
        """Сохраняет лог обработки в файл."""
        try:
            if log_filename is None:
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                log_filename = f"processing_log_{timestamp}.json"
            
            log_path = Path(OUTPUT_DIR) / log_filename
            
            with open(log_path, 'w', encoding='utf-8') as f:
                json.dump(result, f, ensure_ascii=False, indent=2)
            
            logger.info(f"📋 Лог обработки сохранен: {log_path}")
            
        except Exception as e:
            logger.error(f"❌ Ошибка сохранения лога: {e}")
