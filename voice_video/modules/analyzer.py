import logging
import json
import re
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any
from datetime import datetime, timedelta
from collections import Counter, defaultdict

import openai
from openai import OpenAI
from tqdm import tqdm

from .audio_processor import ProcessingConfig, retry_on_failure
from config import OPENROUTER_KEY, OPENAI_MODEL, OPENAI_SETTINGS

logger = logging.getLogger(__name__)

class MeetingAnalyzer:
    """Класс для анализа встреч и генерации отчетов"""
    
    def __init__(self, config: ProcessingConfig):
        self.config = config
        self.client = OpenAI(
            api_key=OPENROUTER_KEY,
            base_url="https://openrouter.ai/api/v1",
            timeout=OPENAI_SETTINGS['timeout'],
            max_retries=0,
        ) if (OPENROUTER_KEY and self.config.enable_ai_analysis) else None
        
        # Настройки для анализа
        self.analysis_prompts = {
            'summary': {
                'system': """Ты - эксперт по анализу деловых встреч. Твоя задача - создать краткое, но информативное резюме встречи на основе транскрипции.
                
Требования к резюме:
                1. Выдели основные темы и решения
                2. Укажи ключевые моменты дискуссии
                3. Отметь важные договоренности
                4. Используй структурированный формат
                5. Будь кратким, но полным
                
Формат ответа:
                ## Основные темы
                - [тема 1]
                - [тема 2]
                
                ## Ключевые решения
                - [решение 1]
                - [решение 2]
                
                ## Договоренности
                - [договоренность 1]
                - [договоренность 2]""",
                'user': "Проанализируй следующую транскрипцию встречи и создай структурированное резюме:\n\n{transcript}"
            },
            'action_items': {
                'system': """Ты - эксперт по извлечению задач и действий из деловых встреч. Твоя задача - найти все упоминания задач, поручений и действий, которые нужно выполнить.
                
Требования:
                1. Найди все задачи и поручения
                2. Определи ответственных (если указано)
                3. Найди дедлайны (если указано)
                4. Классифицируй по приоритету
                5. Используй структурированный формат
                
Формат ответа:
                ## Высокий приоритет
                - [задача] | Ответственный: [имя] | Дедлайн: [дата]
                
                ## Средний приоритет
                - [задача] | Ответственный: [имя] | Дедлайн: [дата]
                
                ## Низкий приоритет
                - [задача] | Ответственный: [имя] | Дедлайн: [дата]""",
                'user': "Найди все задачи и поручения в следующей транскрипции встречи:\n\n{transcript}"
            },
            'questions': {
                'system': """Ты - эксперт по анализу деловых встреч. Твоя задача - найти все открытые вопросы, которые остались без ответа или требуют дальнейшего обсуждения.
                
Требования:
                1. Найди прямые вопросы без ответов
                2. Найди темы, требующие дальнейшего обсуждения
                3. Определи проблемы, которые нужно решить
                4. Классифицируй по важности
                5. Используй структурированный формат
                
Формат ответа:
                ## Критические вопросы
                - [вопрос/проблема]
                
                ## Важные вопросы
                - [вопрос/проблема]
                
                ## Обычные вопросы
                - [вопрос/проблема]""",
                'user': "Найди все открытые вопросы и нерешенные проблемы в следующей транскрипции встречи:\n\n{transcript}"
            },
            'participants': {
                'system': """Ты - эксперт по анализу участников деловых встреч. Твоя задача - проанализировать активность и роли участников.
                
Требования:
                1. Определи роли участников
                2. Оцени уровень участия
                3. Найди ключевые вклады каждого
                4. Определи лидеров дискуссии
                5. Используй структурированный формат
                
Формат ответа:
                ## Анализ участников
                
                ### [Имя участника]
                - Роль: [роль]
                - Активность: [высокая/средняя/низкая]
                - Ключевые вклады: [список]
                
                ### [Имя участника]
                - Роль: [роль]
                - Активность: [высокая/средняя/низкая]
                - Ключевые вклады: [список]""",
                'user': "Проанализируй участников следующей встречи:\n\n{transcript}"
            }
        }
    
    @retry_on_failure(max_retries=3, delay=2.0)
    def analyze_meeting(self, segments_with_speakers: List[Dict]) -> Dict[str, Any]:
        """Выполняет полный анализ встречи."""
        try:
            logger.info("📊 Начинаем анализ встречи...")
            
            if not self.client:
                if not self.config.enable_ai_analysis:
                    logger.info("ℹ️ AI анализ отключен в конфигурации, используем базовый анализ")
                else:
                    logger.warning("⚠️ OpenRouter API ключ не настроен, пропускаем AI анализ")
                return self._basic_analysis(segments_with_speakers)
            
            # Подготавливаем транскрипцию для анализа
            formatted_transcript = self._format_transcript_for_analysis(segments_with_speakers)
            
            if not formatted_transcript.strip():
                logger.warning("⚠️ Пустая транскрипция для анализа")
                return self._basic_analysis(segments_with_speakers)
            
            analysis_results = {}

            # Все 4 секции одним вызовом — экономия 3 запросов.
            # При сбое — прежний путь: 4 отдельных вызова.
            combined = self._perform_combined_analysis(formatted_transcript)
            if combined:
                analysis_results.update(combined)
            else:
                logger.info("↩️ Комбинированный анализ не удался — отдельные вызовы")
                analysis_types = ['summary', 'action_items', 'questions', 'participants']

                for analysis_type in tqdm(analysis_types, desc="Анализ встречи"):
                    try:
                        result = self._perform_ai_analysis(analysis_type, formatted_transcript)
                        analysis_results[analysis_type] = result
                        logger.debug(f"✅ Завершен анализ: {analysis_type}")
                    except Exception as e:
                        logger.error(f"❌ Ошибка анализа {analysis_type}: {e}")
                        analysis_results[analysis_type] = f"Ошибка анализа: {str(e)}"
            
            # Добавляем базовую статистику
            analysis_results['statistics'] = self._calculate_statistics(segments_with_speakers)
            
            # Добавляем метаданные
            analysis_results['metadata'] = {
                'analysis_timestamp': datetime.now().isoformat(),
                'total_segments': len(segments_with_speakers),
                'analysis_model': OPENAI_MODEL,
                'transcript_length': len(formatted_transcript)
            }
            
            logger.info("✅ Анализ встречи завершен")
            return analysis_results
            
        except Exception as e:
            logger.error(f"❌ Ошибка анализа встречи: {e}")
            return self._basic_analysis(segments_with_speakers)
    
    def _format_transcript_for_analysis(self, segments_with_speakers: List[Dict]) -> str:
        """Форматирует транскрипцию для анализа AI."""
        try:
            formatted_lines = []
            
            for segment in segments_with_speakers:
                speaker = segment.get('speaker', 'UNKNOWN')
                text = segment.get('text', '').strip()
                start_time = segment.get('start', 0)
                
                if text:
                    # Форматируем время
                    time_str = self._format_time(start_time)
                    formatted_lines.append(f"[{time_str}] {speaker}: {text}")
            
            return "\n".join(formatted_lines)
            
        except Exception as e:
            logger.error(f"❌ Ошибка форматирования транскрипции: {e}")
            return ""
    
    def _format_time(self, seconds: float) -> str:
        """Форматирует время в читаемый вид."""
        try:
            td = timedelta(seconds=seconds)
            total_seconds = int(td.total_seconds())
            hours = total_seconds // 3600
            minutes = (total_seconds % 3600) // 60
            seconds = total_seconds % 60
            
            if hours > 0:
                return f"{hours:02d}:{minutes:02d}:{seconds:02d}"
            else:
                return f"{minutes:02d}:{seconds:02d}"
                
        except Exception:
            return "00:00"
    
    @staticmethod
    def _truncate_transcript(transcript: str, max_len: int = 20000) -> str:
        """Обрезает транскрипт под контекст API: начало + конец."""
        if len(transcript) <= max_len:
            return transcript
        half = max_len // 2
        return transcript[:half] + "\n\n[...средняя часть пропущена...]\n\n" + transcript[-half:]

    @retry_on_failure(max_retries=1, delay=1.0)
    def _perform_combined_analysis(self, transcript: str) -> Optional[Dict[str, str]]:
        """Все 4 секции анализа одним запросом. Возвращает dict или None при ошибке."""
        try:
            if not self.client:
                return None
            transcript = self._truncate_transcript(transcript)
            system = (
                "Ты — эксперт по анализу деловых встреч. Проанализируй транскрипцию и верни СТРОГО "
                "один валидный JSON-объект с четырьмя полями; значения — markdown-текст:\n"
                '"summary" — резюме встречи с разделами "## Основные темы", "## Ключевые решения", '
                '"## Договоренности" (списки "- ...")\n'
                '"action_items" — задачи и поручения с разделами "## Высокий приоритет", '
                '"## Средний приоритет", "## Низкий приоритет"; формат строки '
                '"- [задача] | Ответственный: [имя] | Дедлайн: [срок]"\n'
                '"questions" — открытые вопросы с разделами "## Критические вопросы", '
                '"## Важные вопросы", "## Обычные вопросы"\n'
                '"participants" — анализ участников: для каждого "### [Имя]" и пункты '
                '"- Роль: ...", "- Активность: высокая/средняя/низкая", "- Ключевые вклады: ..."\n'
                "Никакого текста вне JSON."
            )
            response = self.client.chat.completions.create(
                model=OPENAI_MODEL,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": f"Проанализируй транскрипцию встречи:\n\n{transcript}"}
                ],
                max_tokens=OPENAI_SETTINGS['max_tokens'],
                temperature=OPENAI_SETTINGS['temperature']
            )
            content = (response.choices[0].message.content or '').strip()
            if not content:
                return None
            # Достаём JSON-объект из ответа (модель может обернуть в ```)
            m = re.search(r'\{.*\}', content, re.DOTALL)
            parsed = json.loads(m.group(0)) if m else None
            expected = ('summary', 'action_items', 'questions', 'participants')
            if isinstance(parsed, dict) and all(
                    isinstance(parsed.get(k), str) and parsed[k].strip() for k in expected):
                logger.info("✅ Комбинированный анализ: 4 секции за 1 вызов")
                return {k: parsed[k].strip() for k in expected}
            logger.warning("❌ Комбинированный ответ не содержит все 4 секции")
            return None

        except Exception as e:
            logger.error(f"❌ Ошибка комбинированного анализа: {e}")
            raise

    @retry_on_failure(max_retries=1, delay=1.0)
    def _perform_ai_analysis(self, analysis_type: str, transcript: str) -> str:
        """Выполняет AI анализ определенного типа."""
        try:
            if analysis_type not in self.analysis_prompts:
                raise ValueError(f"Неизвестный тип анализа: {analysis_type}")
            
            prompts = self.analysis_prompts[analysis_type]
            transcript = self._truncate_transcript(transcript)
            
            response = self.client.chat.completions.create(
                model=OPENAI_MODEL,
                messages=[
                    {"role": "system", "content": prompts['system']},
                    {"role": "user", "content": prompts['user'].format(transcript=transcript)}
                ],
                max_tokens=OPENAI_SETTINGS['max_tokens'],
                temperature=OPENAI_SETTINGS['temperature']
            )
            
            return response.choices[0].message.content.strip()
            
        except Exception as e:
            logger.error(f"❌ Ошибка AI анализа {analysis_type}: {e}")
            raise
    
    def _basic_analysis(self, segments_with_speakers: List[Dict]) -> Dict[str, Any]:
        """Выполняет базовый анализ без AI."""
        try:
            logger.info("📊 Выполняем базовый анализ...")
            
            analysis = {
                'summary': "Базовый анализ (AI недоступен)\n\nВстреча была обработана и транскрибирована. Для получения детального анализа настройте OpenAI API ключ.",
                'action_items': "AI анализ недоступен. Проверьте транскрипцию вручную для поиска задач и поручений.",
                'questions': "AI анализ недоступен. Проверьте транскрипцию вручную для поиска открытых вопросов.",
                'participants': "AI анализ недоступен. Статистика участников доступна в разделе 'statistics'.",
                'statistics': self._calculate_statistics(segments_with_speakers),
                'metadata': {
                    'analysis_timestamp': datetime.now().isoformat(),
                    'total_segments': len(segments_with_speakers),
                    'analysis_type': 'basic',
                    'ai_available': False
                }
            }
            
            return analysis
            
        except Exception as e:
            logger.error(f"❌ Ошибка базового анализа: {e}")
            return {
                'summary': f"Ошибка анализа: {str(e)}",
                'action_items': "Недоступно",
                'questions': "Недоступно",
                'participants': "Недоступно",
                'statistics': {},
                'metadata': {
                    'analysis_timestamp': datetime.now().isoformat(),
                    'error': str(e)
                }
            }
    
    def _calculate_statistics(self, segments_with_speakers: List[Dict]) -> Dict[str, Any]:
        """Вычисляет статистику встречи."""
        try:
            if not segments_with_speakers:
                return {}
            
            # Базовая статистика
            total_segments = len(segments_with_speakers)
            total_duration = max((seg.get('end', 0) for seg in segments_with_speakers), default=0)
            
            # Статистика по спикерам
            speaker_stats = defaultdict(lambda: {
                'segments_count': 0,
                'total_duration': 0,
                'words_count': 0,
                'avg_segment_duration': 0
            })
            
            speaker_segments = defaultdict(list)
            
            for segment in segments_with_speakers:
                speaker = segment.get('speaker', 'UNKNOWN')
                duration = segment.get('end', 0) - segment.get('start', 0)
                text = segment.get('text', '')
                words = len(text.split()) if text else 0
                
                speaker_stats[speaker]['segments_count'] += 1
                speaker_stats[speaker]['total_duration'] += duration
                speaker_stats[speaker]['words_count'] += words
                speaker_segments[speaker].append(duration)
            
            # Вычисляем средние значения
            for speaker, stats in speaker_stats.items():
                if stats['segments_count'] > 0:
                    stats['avg_segment_duration'] = stats['total_duration'] / stats['segments_count']
                    stats['participation_percentage'] = (stats['total_duration'] / total_duration * 100) if total_duration > 0 else 0
                    stats['words_per_minute'] = (stats['words_count'] / (stats['total_duration'] / 60)) if stats['total_duration'] > 0 else 0
            
            # Общая статистика
            total_words = sum(len(seg.get('text', '').split()) for seg in segments_with_speakers)
            avg_words_per_segment = total_words / total_segments if total_segments > 0 else 0
            
            # Находим самого активного спикера
            most_active_speaker = max(speaker_stats.keys(), 
                                    key=lambda x: speaker_stats[x]['total_duration']) if speaker_stats else None
            
            statistics = {
                'meeting_duration_seconds': total_duration,
                'meeting_duration_formatted': self._format_time(total_duration),
                'total_segments': total_segments,
                'total_words': total_words,
                'avg_words_per_segment': round(avg_words_per_segment, 2),
                'unique_speakers': len(speaker_stats),
                'most_active_speaker': most_active_speaker,
                'speaker_statistics': dict(speaker_stats)
            }
            
            # Добавляем временную статистику
            if total_duration > 0:
                statistics['words_per_minute'] = round(total_words / (total_duration / 60), 2)
                statistics['segments_per_minute'] = round(total_segments / (total_duration / 60), 2)
            
            return statistics
            
        except Exception as e:
            logger.error(f"❌ Ошибка вычисления статистики: {e}")
            return {'error': str(e)}
    
    def extract_keywords(self, segments_with_speakers: List[Dict], top_n: int = 20) -> List[Tuple[str, int]]:
        """Извлекает ключевые слова из транскрипции."""
        try:
            logger.info(f"🔍 Извлечение {top_n} ключевых слов...")
            
            # Объединяем весь текст
            all_text = " ".join(seg.get('text', '') for seg in segments_with_speakers)
            
            if not all_text.strip():
                return []
            
            # Очищаем текст
            cleaned_text = self._clean_text_for_keywords(all_text)
            
            # Разбиваем на слова
            words = cleaned_text.split()
            
            # Фильтруем стоп-слова и короткие слова
            filtered_words = [
                word.lower() for word in words 
                if len(word) >= 3 and word.lower() not in self._get_stop_words()
            ]
            
            # Подсчитываем частоту
            word_counts = Counter(filtered_words)
            
            # Возвращаем топ слова
            keywords = word_counts.most_common(top_n)
            
            logger.info(f"✅ Извлечено {len(keywords)} ключевых слов")
            return keywords
            
        except Exception as e:
            logger.error(f"❌ Ошибка извлечения ключевых слов: {e}")
            return []
    
    def _clean_text_for_keywords(self, text: str) -> str:
        """Очищает текст для извлечения ключевых слов."""
        try:
            # Удаляем знаки препинания и специальные символы
            cleaned = re.sub(r'[^\w\s]', ' ', text)
            
            # Удаляем множественные пробелы
            cleaned = re.sub(r'\s+', ' ', cleaned)
            
            return cleaned.strip()
            
        except Exception as e:
            logger.error(f"❌ Ошибка очистки текста: {e}")
            return text
    
    def _get_stop_words(self) -> set:
        """Возвращает набор стоп-слов."""
        # Базовый набор русских и английских стоп-слов
        stop_words = {
            # Русские
            'и', 'в', 'во', 'не', 'что', 'он', 'на', 'я', 'с', 'со', 'как', 'а', 'то', 'все', 'она', 'так', 'его', 'но', 'да', 'ты', 'к', 'у', 'же', 'вы', 'за', 'бы', 'по', 'только', 'ее', 'мне', 'было', 'вот', 'от', 'меня', 'еще', 'нет', 'о', 'из', 'ему', 'теперь', 'когда', 'даже', 'ну', 'вдруг', 'ли', 'если', 'уже', 'или', 'ни', 'быть', 'был', 'него', 'до', 'вас', 'нибудь', 'опять', 'уж', 'вам', 'ведь', 'там', 'потом', 'себя', 'ничего', 'ей', 'может', 'они', 'тут', 'где', 'есть', 'надо', 'ней', 'для', 'мы', 'тебя', 'их', 'чем', 'была', 'сам', 'чтоб', 'без', 'будто', 'чего', 'раз', 'тоже', 'себе', 'под', 'будет', 'ж', 'тогда', 'кто', 'этот', 'того', 'потому', 'этого', 'какой', 'совсем', 'ним', 'здесь', 'этом', 'один', 'почти', 'мой', 'тем', 'чтобы', 'нее', 'сейчас', 'были', 'куда', 'зачем', 'всех', 'никогда', 'можно', 'при', 'наконец', 'два', 'об', 'другой', 'хоть', 'после', 'над', 'больше', 'тот', 'через', 'эти', 'нас', 'про', 'всего', 'них', 'какая', 'много', 'разве', 'три', 'эту', 'моя', 'впрочем', 'хорошо', 'свою', 'этой', 'перед', 'иногда', 'лучше', 'чуть', 'том', 'нельзя', 'такой', 'им', 'более', 'всегда', 'конечно', 'всю', 'между',
            
            # Английские
            'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i', 'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at', 'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she', 'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what', 'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me', 'when', 'make', 'can', 'like', 'time', 'no', 'just', 'him', 'know', 'take', 'people', 'into', 'year', 'your', 'good', 'some', 'could', 'them', 'see', 'other', 'than', 'then', 'now', 'look', 'only', 'come', 'its', 'over', 'think', 'also', 'back', 'after', 'use', 'two', 'how', 'our', 'work', 'first', 'well', 'way', 'even', 'new', 'want', 'because', 'any', 'these', 'give', 'day', 'most', 'us'
        }
        
        return stop_words
    
    def generate_meeting_insights(self, analysis_results: Dict[str, Any], segments_with_speakers: List[Dict]) -> Dict[str, Any]:
        """Генерирует дополнительные инсайты о встрече."""
        try:
            logger.info("💡 Генерация инсайтов встречи...")
            
            insights = {}
            
            # Анализ динамики разговора
            insights['conversation_dynamics'] = self._analyze_conversation_dynamics(segments_with_speakers)
            
            # Извлечение ключевых слов
            insights['keywords'] = self.extract_keywords(segments_with_speakers)
            
            # Анализ эмоциональной окраски (базовый)
            insights['sentiment_analysis'] = self._basic_sentiment_analysis(segments_with_speakers)
            
            # Анализ структуры встречи
            insights['meeting_structure'] = self._analyze_meeting_structure(segments_with_speakers)
            
            # Рекомендации
            insights['recommendations'] = self._generate_recommendations(analysis_results, insights)
            
            logger.info("✅ Инсайты встречи сгенерированы")
            return insights
            
        except Exception as e:
            logger.error(f"❌ Ошибка генерации инсайтов: {e}")
            return {'error': str(e)}
    
    def _analyze_conversation_dynamics(self, segments_with_speakers: List[Dict]) -> Dict[str, Any]:
        """Анализирует динамику разговора."""
        try:
            if not segments_with_speakers:
                return {}
            
            # Анализ переключений между спикерами
            speaker_switches = 0
            prev_speaker = None
            
            speaker_sequence = []
            
            for segment in segments_with_speakers:
                current_speaker = segment.get('speaker', 'UNKNOWN')
                speaker_sequence.append(current_speaker)
                
                if prev_speaker and prev_speaker != current_speaker:
                    speaker_switches += 1
                
                prev_speaker = current_speaker
            
            # Анализ доминирования в разговоре
            speaker_segments = defaultdict(int)
            for speaker in speaker_sequence:
                speaker_segments[speaker] += 1
            
            total_segments = len(speaker_sequence)
            speaker_dominance = {
                speaker: (count / total_segments * 100) 
                for speaker, count in speaker_segments.items()
            }
            
            # Анализ интерактивности
            unique_speakers = len(set(speaker_sequence))
            avg_switches_per_minute = 0
            
            if segments_with_speakers:
                total_duration = max(seg.get('end', 0) for seg in segments_with_speakers)
                if total_duration > 0:
                    avg_switches_per_minute = speaker_switches / (total_duration / 60)
            
            dynamics = {
                'total_speaker_switches': speaker_switches,
                'avg_switches_per_minute': round(avg_switches_per_minute, 2),
                'speaker_dominance_percentage': speaker_dominance,
                'conversation_balance': self._calculate_conversation_balance(speaker_dominance),
                'interactivity_level': self._assess_interactivity(avg_switches_per_minute, unique_speakers)
            }
            
            return dynamics
            
        except Exception as e:
            logger.error(f"❌ Ошибка анализа динамики разговора: {e}")
            return {'error': str(e)}
    
    def _calculate_conversation_balance(self, speaker_dominance: Dict[str, float]) -> str:
        """Оценивает баланс разговора."""
        if not speaker_dominance:
            return "неопределен"
        
        max_dominance = max(speaker_dominance.values())
        
        if max_dominance > 70:
            return "несбалансированный (один спикер доминирует)"
        elif max_dominance > 50:
            return "умеренно сбалансированный"
        else:
            return "хорошо сбалансированный"
    
    def _assess_interactivity(self, switches_per_minute: float, unique_speakers: int) -> str:
        """Оценивает уровень интерактивности."""
        if switches_per_minute > 10 and unique_speakers > 2:
            return "высокий"
        elif switches_per_minute > 5 or unique_speakers > 2:
            return "средний"
        else:
            return "низкий"
    
    def _basic_sentiment_analysis(self, segments_with_speakers: List[Dict]) -> Dict[str, Any]:
        """Выполняет базовый анализ эмоциональной окраски."""
        try:
            # Простой анализ на основе ключевых слов
            positive_words = {'хорошо', 'отлично', 'замечательно', 'согласен', 'да', 'правильно', 'спасибо', 'благодарю', 'good', 'great', 'excellent', 'yes', 'agree', 'thanks', 'perfect'}
            negative_words = {'плохо', 'нет', 'неправильно', 'ошибка', 'проблема', 'сложно', 'трудно', 'bad', 'no', 'wrong', 'error', 'problem', 'difficult', 'hard'}
            question_words = {'что', 'как', 'когда', 'где', 'почему', 'зачем', 'кто', 'what', 'how', 'when', 'where', 'why', 'who'}
            
            sentiment_counts = {'positive': 0, 'negative': 0, 'neutral': 0, 'questions': 0}
            
            for segment in segments_with_speakers:
                text = segment.get('text', '').lower()
                words = set(text.split())
                
                if '?' in text or any(word in words for word in question_words):
                    sentiment_counts['questions'] += 1
                elif any(word in words for word in positive_words):
                    sentiment_counts['positive'] += 1
                elif any(word in words for word in negative_words):
                    sentiment_counts['negative'] += 1
                else:
                    sentiment_counts['neutral'] += 1
            
            total = sum(sentiment_counts.values())
            
            if total > 0:
                sentiment_percentages = {
                    key: round(count / total * 100, 1) 
                    for key, count in sentiment_counts.items()
                }
            else:
                sentiment_percentages = {key: 0 for key in sentiment_counts.keys()}
            
            # Общая оценка тона встречи
            if sentiment_percentages['positive'] > sentiment_percentages['negative'] * 1.5:
                overall_tone = "позитивный"
            elif sentiment_percentages['negative'] > sentiment_percentages['positive'] * 1.5:
                overall_tone = "негативный"
            else:
                overall_tone = "нейтральный"
            
            return {
                'sentiment_distribution': sentiment_percentages,
                'overall_tone': overall_tone,
                'question_percentage': sentiment_percentages['questions']
            }
            
        except Exception as e:
            logger.error(f"❌ Ошибка анализа эмоциональной окраски: {e}")
            return {'error': str(e)}
    
    def _analyze_meeting_structure(self, segments_with_speakers: List[Dict]) -> Dict[str, Any]:
        """Анализирует структуру встречи."""
        try:
            if not segments_with_speakers:
                return {}
            
            total_duration = max(seg.get('end', 0) for seg in segments_with_speakers)
            
            # Разбиваем встречу на фазы (начало, середина, конец)
            phase_duration = total_duration / 3
            phases = {'opening': [], 'middle': [], 'closing': []}
            
            for segment in segments_with_speakers:
                start_time = segment.get('start', 0)
                
                if start_time < phase_duration:
                    phases['opening'].append(segment)
                elif start_time < phase_duration * 2:
                    phases['middle'].append(segment)
                else:
                    phases['closing'].append(segment)
            
            # Анализ каждой фазы
            phase_analysis = {}
            
            for phase_name, phase_segments in phases.items():
                if phase_segments:
                    speakers_in_phase = set(seg.get('speaker', 'UNKNOWN') for seg in phase_segments)
                    total_words = sum(len(seg.get('text', '').split()) for seg in phase_segments)
                    
                    phase_analysis[phase_name] = {
                        'duration_minutes': round(len(phase_segments) * (total_duration / len(segments_with_speakers)) / 60, 1),
                        'speakers_count': len(speakers_in_phase),
                        'segments_count': len(phase_segments),
                        'total_words': total_words,
                        'dominant_speakers': list(speakers_in_phase)[:3]  # Топ 3
                    }
                else:
                    phase_analysis[phase_name] = {
                        'duration_minutes': 0,
                        'speakers_count': 0,
                        'segments_count': 0,
                        'total_words': 0,
                        'dominant_speakers': []
                    }
            
            return {
                'total_duration_minutes': round(total_duration / 60, 1),
                'phase_analysis': phase_analysis,
                'structure_quality': self._assess_structure_quality(phase_analysis)
            }
            
        except Exception as e:
            logger.error(f"❌ Ошибка анализа структуры встречи: {e}")
            return {'error': str(e)}
    
    def _assess_structure_quality(self, phase_analysis: Dict[str, Any]) -> str:
        """Оценивает качество структуры встречи."""
        try:
            opening_words = phase_analysis.get('opening', {}).get('total_words', 0)
            middle_words = phase_analysis.get('middle', {}).get('total_words', 0)
            closing_words = phase_analysis.get('closing', {}).get('total_words', 0)
            
            total_words = opening_words + middle_words + closing_words
            
            if total_words == 0:
                return "неопределено"
            
            # Идеальная структура: 20% начало, 60% середина, 20% конец
            opening_ratio = opening_words / total_words
            middle_ratio = middle_words / total_words
            closing_ratio = closing_words / total_words
            
            # Оценка отклонения от идеальной структуры
            opening_deviation = abs(opening_ratio - 0.2)
            middle_deviation = abs(middle_ratio - 0.6)
            closing_deviation = abs(closing_ratio - 0.2)
            
            avg_deviation = (opening_deviation + middle_deviation + closing_deviation) / 3
            
            if avg_deviation < 0.1:
                return "отличная"
            elif avg_deviation < 0.2:
                return "хорошая"
            elif avg_deviation < 0.3:
                return "удовлетворительная"
            else:
                return "требует улучшения"
                
        except Exception as e:
            logger.error(f"❌ Ошибка оценки структуры: {e}")
            return "неопределено"
    
    def _generate_recommendations(self, analysis_results: Dict[str, Any], insights: Dict[str, Any]) -> List[str]:
        """Генерирует рекомендации на основе анализа."""
        try:
            recommendations = []
            
            # Анализ статистики
            stats = analysis_results.get('statistics', {})
            dynamics = insights.get('conversation_dynamics', {})
            structure = insights.get('meeting_structure', {})
            
            # Рекомендации по балансу участников
            speaker_dominance = dynamics.get('speaker_dominance_percentage', {})
            if speaker_dominance:
                max_dominance = max(speaker_dominance.values())
                if max_dominance > 70:
                    recommendations.append("Рассмотрите возможность более равномерного распределения времени выступления между участниками")
            
            # Рекомендации по интерактивности
            interactivity = dynamics.get('interactivity_level', '')
            if interactivity == 'низкий':
                recommendations.append("Попробуйте стимулировать больше дискуссий и вопросов от участников")
            
            # Рекомендации по структуре
            structure_quality = structure.get('structure_quality', '')
            if structure_quality in ['требует улучшения', 'удовлетворительная']:
                recommendations.append("Рекомендуется улучшить структуру встречи: четкое открытие, основная часть и заключение")
            
            # Рекомендации по длительности
            duration_minutes = structure.get('total_duration_minutes', 0)
            if duration_minutes > 90:
                recommendations.append("Встреча довольно длинная. Рассмотрите возможность разбиения на несколько коротких сессий")
            elif duration_minutes < 15:
                recommendations.append("Встреча была короткой. Убедитесь, что все важные вопросы были обсуждены")
            
            # Рекомендации по количеству участников
            unique_speakers = stats.get('unique_speakers', 0)
            if unique_speakers > 8:
                recommendations.append("Большое количество участников может затруднить эффективное обсуждение")
            elif unique_speakers < 2:
                recommendations.append("Рассмотрите привлечение дополнительных участников для более продуктивного обсуждения")
            
            # Общие рекомендации
            if not recommendations:
                recommendations.append("Встреча прошла в целом хорошо. Продолжайте поддерживать текущий уровень организации")
            
            return recommendations
            
        except Exception as e:
            logger.error(f"❌ Ошибка генерации рекомендаций: {e}")
            return ["Не удалось сгенерировать рекомендации из-за ошибки анализа"]
