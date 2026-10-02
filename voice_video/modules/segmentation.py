import logging
import json
import re
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime

from openai import OpenAI
from tqdm import tqdm

from .audio_processor import ProcessingConfig, retry_on_failure
from config import (OPENROUTER_KEY, OPENAI_MODEL, OPENAI_SETTINGS, PROJECT_ROOT,
                    SEGMENTATION_LLM_MODEL, TOPIC_ANALYSIS_MODEL,
                    TOPIC_ANALYSIS_BATCH, SEGMENTATION_MAX_CHARS)

logger = logging.getLogger(__name__)

class MeetingSegmentation:
    """Класс для семантической сегментации встреч с использованием LLM"""
    
    def __init__(self, config: ProcessingConfig):
        self.config = config
        if not hasattr(self.config, "openai_model"):
            self.config.openai_model = OPENAI_MODEL
        self.client = OpenAI(
            api_key=OPENROUTER_KEY,
            base_url="https://openrouter.ai/api/v1",
            timeout=OPENAI_SETTINGS['timeout'],
            max_retries=0,
        ) if (OPENROUTER_KEY and self.config.enable_ai_analysis) else None
        
        # Пути к файлам промптов (относительно корня проекта)
        project_root = Path(__file__).parent.parent
        self.segmentation_prompt_file = project_root / "segmentation_prompt.txt"
        self.analysis_prompt_file = project_root / "analysis_prompt.txt"
        self.protocol_prompt_file = project_root / "protocol_prompt.txt"
    
    def _call_llm(self, prompt_file: str, context: str, max_tokens: int = 8000,
                  use_json_mode: bool = True, model: Optional[str] = None) -> Optional[str]:
        """Универсальный метод для вызова LLM с промптом из файла."""
        model = model or OPENAI_MODEL
        try:
            # Читаем системный промпт из файла
            prompt_path = Path(prompt_file)
            if not prompt_path.exists():
                logger.error(f"❌ Не найден файл промпта: {prompt_file}")
                return None

            with open(prompt_path, "r", encoding="utf-8") as f:
                system_prompt = f.read()
        except FileNotFoundError:
            logger.error(f"❌ Не найден файл промпта: {prompt_file}")
            return None
        except Exception as e:
            logger.error(f"❌ Ошибка чтения файла промпта {prompt_file}: {e}")
            return None

        try:
            # Настраиваем формат ответа
            response_format = {"type": "json_object"} if use_json_mode else None

            # Вызываем API
            response = self.client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": context}
                ],
                max_tokens=max_tokens,
                temperature=OPENAI_SETTINGS['temperature'],
                response_format=response_format
            )

            choice = response.choices[0]
            finish = getattr(choice, 'finish_reason', None)
            content = choice.message.content
            if not content or not content.strip():
                # reasoning-модели иногда возвращают content=None в JSON-режиме —
                # бросаем исключение, чтобы сработал повтор без response_format.
                # finish_reason='length' значит модель сожгла бюджет на reasoning —
                # тогда повтор без формата тоже упадёт: нужен больший max_tokens.
                if finish == 'length':
                    raise RuntimeError(
                        f"LLM исчерпала max_tokens={max_tokens} на reasoning "
                        f"(finish_reason=length), увеличь лимит")
                raise RuntimeError("LLM вернула пустой content")
            if finish == 'length':
                logger.warning(f"⚠️ Ответ {model} обрезан по max_tokens={max_tokens}")
            return content.strip()

        except Exception as e:
            if use_json_mode:
                # Модель может не поддерживать JSON-режим (или адаптер OpenRouter
                # ломает разбор ответа) — повторяем без response_format
                logger.warning(f"Модель {model}: ошибка с JSON-режимом ({e}), пробую без него.")
                return self._call_llm(prompt_file, context, max_tokens, use_json_mode=False, model=model)

            logger.error(f"❌ Ошибка API при вызове LLM ({prompt_file}): {e}", exc_info=True)
            return None
    
    def extract_json_from_response(self, text: str) -> Optional[Any]:
        """Извлекает JSON из ответа LLM."""
        try:
            # Ищем JSON в блоке кода
            match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
            if match:
                json_string = match.group(1)
            else:
                # Ищем JSON по скобкам
                start_bracket = text.find('[')
                start_brace = text.find('{')
                
                if start_bracket == -1 and start_brace == -1:
                    return None
                
                if start_brace != -1 and (start_bracket == -1 or start_brace < start_bracket):
                    start_char, end_char = '{', '}'
                else:
                    start_char, end_char = '[', ']'
                
                start_index = text.find(start_char)
                end_index = text.rfind(end_char)
                
                if start_index == -1 or end_index == -1 or end_index < start_index:
                    return None
                
                json_string = text[start_index:end_index + 1]
            
            return json.loads(json_string)
            
        except json.JSONDecodeError as e:
            logger.warning(f"Не удалось распарсить извлеченный JSON: {str(e)[:200]}...")
            return None
        except Exception as e:
            logger.error(f"Ошибка извлечения JSON: {e}")
            return None
    
    @staticmethod
    def _window_time(line: str) -> Optional[float]:
        """Извлекает абсолютную метку [секунды] из строки транскрипта окна."""
        m = re.match(r'\[(\d+(?:\.\d+)?)\]', str(line))
        return float(m.group(1)) if m else None

    @staticmethod
    def _normalize_segments_json(parsed):
        """Приводит распарсенный ответ LLM к списку сегментов или None."""
        if isinstance(parsed, list):
            return parsed
        if isinstance(parsed, dict):
            if 'start_time' in parsed:  # одиночный сегмент-объект
                return [parsed]
            return next((v for v in parsed.values() if isinstance(v, list)), None)
        return None

    def validate_and_clean_segments(self, segments: List[Dict]) -> List[Dict]:
        """Валидирует и очищает сегменты."""
        if not isinstance(segments, list):
            return []
        
        cleaned = []
        last_end_time = -1.0
        
        for seg in segments:
            if not isinstance(seg, dict):
                continue
            
            try:
                start_time = float(seg['start_time'])
                end_time = float(seg['end_time'])
                topic = str(seg.get('topic_guess', '')).strip()
                
                # Валидация временных меток и топика
                if (start_time < 0 or 
                    end_time <= start_time or 
                    (end_time - start_time < 10) or 
                    start_time < last_end_time or 
                    not topic):
                    continue
                
                cleaned.append({
                    'start_time': start_time,
                    'end_time': end_time,
                    'topic_guess': topic
                })
                
                last_end_time = end_time
                
            except (ValueError, KeyError) as e:
                logger.debug(f"Пропускаем невалидный сегмент: {e}")
                continue
        
        # Сортируем по времени начала
        cleaned.sort(key=lambda x: x['start_time'])
        return cleaned
    
    @retry_on_failure(max_retries=1, delay=2.0)
    def call_llm_for_segmentation(self, transcript: List[Dict]) -> List[Dict]:
        """Выполняет семантическую сегментацию транскрипции."""
        try:
            logger.info("🔍 Выполняем семантическую сегментацию...")
            
            if not self.client:
                if not self.config.enable_ai_analysis:
                    logger.info("ℹ️ AI сегментация отключена в конфигурации")
                else:
                    logger.warning("⚠️ OpenRouter API ключ не настроен, пропускаем сегментацию")
                return []
            
            # Форматируем транскрипцию для анализа
            lines = [
                f"[{s['start']:.1f}] {s.get('speaker', 'SPEAKER')}: {s['text']}"
                for s in transcript
            ]

            # Длинные транскрипты не влезают в контекст flash-модели —
            # сегментируем окнами по границам реплик
            max_chars = int(getattr(self.config, 'segmentation_max_chars', SEGMENTATION_MAX_CHARS) or SEGMENTATION_MAX_CHARS)
            windows: List[List[str]] = []
            cur, cur_len = [], 0
            for line in lines:
                if cur and cur_len + len(line) + 1 > max_chars:
                    windows.append(cur)
                    cur, cur_len = [], 0
                cur.append(line)
                cur_len += len(line) + 1
            if cur:
                windows.append(cur)

            segments: List[Dict] = []
            for wi, win in enumerate(windows):
                win_text = "\n".join(win)
                if len(windows) == 1:
                    context = f"Вот полная транскрипция встречи:\n\n---\n{win_text}\n---"
                else:
                    context = (
                        f"Фрагмент {wi + 1} из {len(windows)} транскрипции встречи "
                        f"(временные метки абсолютные, в секундах от начала):\n\n---\n{win_text}\n---"
                    )

                # ВАЖНО: без response_format — json_object у провайдеров принудительно
                # сгибает вывод в одиночный объект и теряет массив сегментов.
                response_text = self._call_llm(
                    self.segmentation_prompt_file, context,
                    use_json_mode=False,
                    model=SEGMENTATION_LLM_MODEL
                )

                win_segments = self._normalize_segments_json(
                    self.extract_json_from_response(response_text or '')
                )
                if not win_segments:
                    logger.warning(f"❌ Окно {wi + 1}/{len(windows)}: сегментация не удалась, "
                                   f"помечаю одним сегментом")
                    # fallback — чтобы содержимое окна не потерялось при анализе тем
                    start_t = self._window_time(win[0]) or 0.0
                    next_t = self._window_time(windows[wi + 1][0]) if wi + 1 < len(windows) else None
                    last_t = self._window_time(win[-1]) or start_t + 60
                    win_segments = [{
                        'start_time': start_t,
                        'end_time': next_t or last_t + 60,
                        'topic_guess': f'Фрагмент {wi + 1} (автосегментация не удалась)'
                    }]
                segments.extend(win_segments)

            if not segments:
                logger.warning("❌ Не удалось извлечь сегменты из ответа LLM")
                return []

            # Валидируем и очищаем сегменты
            cleaned_segments = self.validate_and_clean_segments(segments)
            
            logger.info(f"✅ Сегментация завершена: найдено {len(cleaned_segments)} тематических сегментов")
            return cleaned_segments
            
        except Exception as e:
            logger.error(f"❌ Ошибка сегментации: {e}", exc_info=True)
            return []
    
    @retry_on_failure(max_retries=1, delay=2.0)
    def call_llm_for_detailed_analysis(self, chunk: List[Dict]) -> Dict[str, Any]:
        """Выполняет детальный анализ сегмента."""
        try:
            logger.debug("🔬 Выполняем детальный анализ сегмента...")
            
            if not self.client:
                if not self.config.enable_ai_analysis:
                    logger.info("ℹ️ Детальный AI анализ отключен в конфигурации")
                    return {"error": "AI analysis disabled in config"}
                logger.warning("⚠️ OpenRouter API ключ не настроен, пропускаем анализ")
                return {"error": "OpenRouter API key not configured"}
            
            # Форматируем сегмент для анализа
            chunk_text = "\n".join(
                f"[{s['start']:.1f}] {s.get('speaker', 'SPEAKER')}: {s['text']}"
                for s in chunk
            )
            
            context = f"Вот фрагмент транскрипции встречи:\n\n---\n{chunk_text}\n---"
            
            # Вызываем LLM с промптом для анализа (быстрая модель — 1 вызов на тему)
            response_text = self._call_llm(self.analysis_prompt_file, context, model=TOPIC_ANALYSIS_MODEL)
            
            if not response_text:
                logger.warning("❌ LLM не вернул ответ для анализа")
                return {"error": "API call failed or returned empty response."}
            
            # Извлекаем JSON из ответа
            analysis = self.extract_json_from_response(response_text)
            
            if isinstance(analysis, dict):
                # Проверяем наличие обязательных ключей
                required_keys = {"topic_title", "summary", "key_decisions", "action_items"}
                if required_keys.issubset(analysis.keys()):
                    return analysis
            
            logger.warning(f"Ответ LLM не прошел валидацию структуры: {response_text[:300]}...")
            return {"error": "LLM did not return a valid or complete JSON object."}
            
        except Exception as e:
            logger.error(f"❌ Ошибка детального анализа: {e}", exc_info=True)
            return {"error": f"Analysis failed: {str(e)}"}

    @retry_on_failure(max_retries=1, delay=2.0)
    def call_llm_for_batch_analysis(self, batch: List[Tuple[Dict, List[Dict]]]) -> Optional[List[Dict[str, Any]]]:
        """Анализирует пачку тем одним вызовом. Возвращает список dict в том же порядке или None при сбое."""
        if not self.client:
            return None
        parts = []
        for idx, (seg_info, chunk) in enumerate(batch, start=1):
            chunk_text = "\n".join(
                f"[{s['start']:.1f}] {s.get('speaker', 'SPEAKER')}: {s['text']}"
                for s in chunk
            )
            parts.append(
                f"=== Фрагмент {idx} (тема: «{seg_info.get('topic_guess','')}», "
                f"{seg_info['start_time']:.0f}–{seg_info['end_time']:.0f}с) ===\n{chunk_text}"
            )
        context = (
            f"Вот {len(batch)} фрагмента транскрипции встречи. Проанализируй КАЖДЫЙ фрагмент "
            f"независимо по всем правилам промпта и верни ОДИН JSON-МАССИВ из ровно {len(batch)} "
            f"объектов в том же порядке и в том же формате, что для одиночного фрагмента.\n\n"
            + "\n\n".join(parts)
        )
        # На батч нужен бюджет пропорционально числу тем (reasoning-модели сжигают токены)
        max_tokens = min(20000, 4500 * len(batch) + 4000)
        response_text = self._call_llm(
            self.analysis_prompt_file, context,
            max_tokens=max_tokens, use_json_mode=False,
            model=TOPIC_ANALYSIS_MODEL
        )
        if not response_text:
            return None
        parsed = self.extract_json_from_response(response_text)
        if parsed is None:
            # Модель часто отдаёт склеенные объекты {…}\n{…}\n{…} без обёртки массива —
            # разбираем последовательно все верхнеуровневые JSON-объекты
            objs = []
            decoder = json.JSONDecoder()
            i = 0
            text = response_text or ''
            while i < len(text):
                j = text.find('{', i)
                if j == -1:
                    break
                try:
                    obj, end = decoder.raw_decode(text, j)
                    objs.append(obj)
                    i = end
                except json.JSONDecodeError:
                    break
            if len(objs) == len(batch) and all(isinstance(x, dict) for x in objs):
                parsed = objs
        # Модель может обернуть массив в объект — достаём список из значений
        if isinstance(parsed, dict):
            for v in parsed.values():
                if isinstance(v, list) and all(isinstance(x, dict) for x in v):
                    parsed = v
                    break
            else:
                if all(isinstance(v, dict) for v in parsed.values()):
                    parsed = list(parsed.values())
                else:
                    parsed = [parsed]
        required_keys = {"topic_title", "summary", "key_decisions", "action_items"}
        if (isinstance(parsed, list) and len(parsed) == len(batch)
                and all(isinstance(x, dict) and required_keys.issubset(x) for x in parsed)):
            return parsed
        logger.warning(
            f"❌ Батч-ответ не прошёл валидацию "
            f"(ожидали {len(batch)} объектов, получили {len(parsed) if isinstance(parsed, list) else 'не-массив'}); "
            f"начало ответа: {(response_text or '')[:200]!r}"
        )
        return None

    def call_llm_for_action_registry(self, topics: List[Dict]) -> Optional[str]:
        """Собирает единый реестр поручений: дедуп, абсолютные даты, группировка."""
        try:
            if not self.client or not topics:
                return None
            def _fmt_t(sec) -> str:
                if sec is None:
                    return ''
                sec = int(sec)
                h, rem = divmod(sec, 3600)
                m, s = divmod(rem, 60)
                return f"{h}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"

            items: List[Dict] = []
            for t in topics:
                time_range = f"{_fmt_t(t.get('start_time'))}–{_fmt_t(t.get('end_time'))}".strip('–')
                for a in (t.get('action_items') or []):
                    if isinstance(a, dict):
                        items.append({
                            'time': time_range,
                            'task': a.get('task', ''),
                            'assignee': a.get('assignee'),
                            'deadline': a.get('deadline'),
                            'topic': t.get('topic_title', '')
                        })
                    else:
                        items.append({'time': time_range, 'task': str(a),
                                      'assignee': None, 'deadline': None,
                                      'topic': t.get('topic_title', '')})
            if not items:
                return None
            meeting_date = getattr(self.config, 'meeting_date', None)
            context = (
                f"Дата совещания: {meeting_date or 'неизвестна'}\n\n"
                "Вот поручения, извлечённые по темам совещания (JSON):\n\n"
                + json.dumps(items, ensure_ascii=False, indent=2)
            )
            prompt_file = PROJECT_ROOT / 'action_registry_prompt.txt'
            response_text = self._call_llm(
                str(prompt_file), context,
                max_tokens=14000, use_json_mode=True,
                model=self.config.openai_model
            )
            # LLM отдаёт JSON, таблицу собираем сами: «|» в тексте или пропущенная
            # колонка больше не ломают разбор поручений в веб-интерфейсе.
            from .action_registry import registry_markdown_from_llm
            return registry_markdown_from_llm(response_text)
        except Exception as e:
            logger.error(f"❌ Ошибка сборки реестра поручений: {e}", exc_info=True)
            return None

    def call_llm_for_protocol(self, topics: List[Dict]) -> Optional[str]:
        """Синтезирует итоговый протокол совещания по проанализированным темам."""
        try:
            if not self.client or not topics:
                return None
            slim = [
                {
                    'topic_title': t.get('topic_title') or t.get('topic_guess', ''),
                    'summary': t.get('summary', ''),
                    'key_decisions': t.get('key_decisions', []),
                    'action_items': t.get('action_items', []),
                    'open_questions': t.get('open_questions', []),
                    'participants': t.get('participants', []),
                    'sentiment': t.get('sentiment', ''),
                    'start_time': t.get('start_time'),
                    'end_time': t.get('end_time'),
                }
                for t in topics
            ]
            context = (
                "Вот проанализированные темы совещания (JSON, в порядке следования):\n\n"
                + json.dumps(slim, ensure_ascii=False, indent=2)
            )
            response_text = self._call_llm(
                str(self.protocol_prompt_file), context,
                max_tokens=20000, use_json_mode=False,
                model=self.config.openai_model
            )
            return response_text

        except Exception as e:
            logger.error(f"❌ Ошибка синтеза протокола: {e}", exc_info=True)
            return None

    def segment_and_analyze_meeting(self, transcript: List[Dict]) -> Dict[str, Any]:
        """Выполняет полную сегментацию и анализ встречи."""
        try:
            logger.info("🤖 Запуск двухэтапного LLM-анализа...")
            
            # Этап 1: Сегментация
            topic_segments = self.call_llm_for_segmentation(transcript)
            
            if not topic_segments:
                logger.warning("❌ Сегментация не удалась. Анализ не будет произведен.")
                return {
                    "participants": sorted(list(set(seg.get("speaker", "SPEAKER") for seg in transcript))),
                    "topics": [],
                    "segmentation_failed": True
                }
            
            # Этап 2: Детальный анализ каждого сегмента
            final_report = {
                "participants": sorted(list(set(seg.get("speaker", "SPEAKER") for seg in transcript))),
                "topics": [],
                "topic_segments": topic_segments,
                "segmentation_successful": True
            }
            
            # Собираем (segment_info, chunk) для каждой темы
            topic_chunks: List[Tuple[Dict, List[Dict]]] = []
            for segment_info in topic_segments:
                chunk = [
                    seg for seg in transcript
                    if segment_info['start_time'] <= seg["start"] < segment_info['end_time']
                ]
                if chunk:
                    topic_chunks.append((segment_info, chunk))
                else:
                    logger.warning(f"⚠️ Не найдены сегменты для темы '{segment_info['topic_guess']}'")

            batch_size = max(1, int(getattr(self.config, 'topic_analysis_batch', TOPIC_ANALYSIS_BATCH) or TOPIC_ANALYSIS_BATCH))
            if batch_size > 1:
                logger.info(f"📦 Батч-анализ тем: по {batch_size} в вызове ({len(topic_chunks)} тем)")

            for bstart in range(0, len(topic_chunks), batch_size):
                batch = topic_chunks[bstart:bstart + batch_size]
                guesses = " | ".join(s.get('topic_guess', '')[:40] for s, _ in batch)
                if len(batch) > 1:
                    logger.info(f"→ Батч {bstart + 1}–{bstart + len(batch)}/{len(topic_chunks)}: {guesses}")
                else:
                    logger.info(f"→ Анализ темы {bstart + 1}/{len(topic_chunks)}: '{batch[0][0].get('topic_guess','')}'")

                results: Optional[List[Dict[str, Any]]] = None
                if len(batch) > 1:
                    try:
                        results = self.call_llm_for_batch_analysis(batch)
                    except Exception as e:
                        logger.warning(f"❌ Батч-вызов не удался: {e} — перехожу на поштучный")
                if results is None:
                    results = [None] * len(batch)

                for (segment_info, chunk), analysis_result in zip(batch, results):
                    if analysis_result is None:
                        # Fallback: одиночный вызов на тему (фолбэк при сбое батча)
                        analysis_result = self.call_llm_for_detailed_analysis(chunk)
                    if "error" in analysis_result:
                        logger.warning(f"❌ Ошибка анализа сегмента '{segment_info['topic_guess']}': {analysis_result['error']}")
                        continue
                    topic_for_report = analysis_result.copy()
                    topic_for_report['start_time'] = segment_info['start_time']
                    topic_for_report['end_time'] = segment_info['end_time']
                    final_report["topics"].append(topic_for_report)
            
            # Этап 2.5: Jev-верификация — дедуп тем-дубликатов (артефакт окон)
            try:
                from .jev import merge_duplicate_topics, check_protocol_coverage
                final_report["topics"] = merge_duplicate_topics(final_report["topics"])
            except Exception as e:
                logger.warning(f"⚠️ Jev дедупликация пропущена: {e}")

            # Этап 3: Синтез итогового протокола по проанализированным темам
            protocol_md = self.call_llm_for_protocol(final_report["topics"])
            if protocol_md:
                # Этап 3.5: Jev — проверка полноты протокола (решения тем vs текст)
                try:
                    missed = check_protocol_coverage(final_report["topics"], protocol_md)
                    if missed:
                        protocol_md += (
                            "\n\n## Дополнительно зафиксированные решения\n"
                            + "\n".join(f"- {d}" for d in missed)
                        )
                        logger.info(f"📌 Jev: добавлено {len(missed)} пропущенных решений в протокол")
                except Exception as e:
                    logger.warning(f"⚠️ Jev проверка протокола пропущена: {e}")
                final_report['protocol_markdown'] = protocol_md

            # Этап 4: Единый реестр поручений (дедуп + абс. даты + группировка)
            try:
                registry_md = self.call_llm_for_action_registry(final_report["topics"])
                if registry_md:
                    final_report['action_registry'] = registry_md
            except Exception as e:
                logger.warning(f"⚠️ Реестр поручений не собран: {e}")

            logger.info(f"✅ Анализ завершен: обработано {len(final_report['topics'])} тем")
            return final_report
            
        except Exception as e:
            logger.error(f"❌ Ошибка сегментации и анализа: {e}", exc_info=True)
            return {
                "participants": sorted(list(set(seg.get("speaker", "SPEAKER") for seg in transcript))) if transcript else [],
                "topics": [],
                "error": str(e)
            }
