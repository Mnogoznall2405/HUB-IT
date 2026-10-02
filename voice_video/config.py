"""
Файл конфигурации для системы обработки аудио/видео

Содержит все основные настройки, пути к файлам и параметры системы.
Этот файл позволяет централизованно управлять конфигурацией.

Автор: AI Assistant
Дата: 2024
"""

import os
from pathlib import Path
from dotenv import load_dotenv
import torch
from typing import Dict, List, Optional

# Загружаем переменные окружения из .env файла
load_dotenv()

# API ключи (из .env файла)
HF_TOKEN = os.getenv('HF_TOKEN')
OPENROUTER_KEY = os.getenv('OPENROUTER_KEY')

if not HF_TOKEN or not OPENROUTER_KEY:
    print('Предупреждение: Переменные HF_TOKEN и OPENROUTER_KEY не установлены в файле .env')
    print('Некоторые функции могут быть недоступны')

# Базовые пути проекта
PROJECT_ROOT = Path(__file__).parent
BASE_DIR = PROJECT_ROOT

INPUT_DIR = BASE_DIR / 'input'
OUTPUT_DIR = BASE_DIR / 'output'
PROCESSED_DIR = BASE_DIR / 'processed'
TEMP_DIR = BASE_DIR / 'temp'
LOGS_DIR = BASE_DIR / 'logs'
MODELS_DIR = BASE_DIR / 'models'
REFERENCE_VOICES_DIR = BASE_DIR / 'reference_voices'

# Создаем необходимые директории
for directory in [INPUT_DIR, OUTPUT_DIR, PROCESSED_DIR, TEMP_DIR, LOGS_DIR, MODELS_DIR, REFERENCE_VOICES_DIR]:
    directory.mkdir(exist_ok=True)

# Настройки устройства
USE_CUDA = os.getenv('USE_CUDA', 'true').lower() in ('true', '1', 't')

if USE_CUDA and torch.cuda.is_available():
    DEVICE = 'cuda'
else:
    if USE_CUDA:
        print('Предупреждение: USE_CUDA=true, но CUDA недоступна. Используется CPU.')
    DEVICE = 'cpu'

# Настройки аудио
SAMPLE_RATE = 16000
AUDIO_CHANNELS = 1
AUDIO_BITRATE = '128k'

# Поддерживаемые форматы
SUPPORTED_AUDIO_FORMATS = ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.wma']
SUPPORTED_VIDEO_FORMATS = ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v']
SUPPORTED_FORMATS = SUPPORTED_AUDIO_FORMATS + SUPPORTED_VIDEO_FORMATS

# Настройки моделей
DEFAULT_LLM_MODEL = os.getenv('DEFAULT_LLM_MODEL', 'openai/gpt-6-luna-pro')
SEGMENTATION_LLM_MODEL = os.getenv('SEGMENTATION_MODEL', DEFAULT_LLM_MODEL)
# Модель для по-темного анализа (по умолчанию — основная Luna;
# для быстрой поставь в .env: TOPIC_ANALYSIS_MODEL=xiaomi/mimo-v2.6-pro-ultraspeed)
TOPIC_ANALYSIS_MODEL = os.getenv('TOPIC_ANALYSIS_MODEL', DEFAULT_LLM_MODEL)
# Сколько тем анализировать одним вызовом (батч). 1 = по одному (максимальная глубина)
TOPIC_ANALYSIS_BATCH = int(os.getenv('TOPIC_ANALYSIS_BATCH', '3'))
# Макс. символов транскрипта в одном окне сегментации
SEGMENTATION_MAX_CHARS = int(os.getenv('SEGMENTATION_MAX_CHARS', '60000'))

# Jev (typesafe/jev-1.13) — верификационный слой: дедуп тем, полнота протокола.
# Типизированные ответы (noul/choice/score), генерации текста нет.
JEV_ENABLED = os.getenv('JEV_ENABLED', 'true').lower() in ('true', '1', 't')
JEV_DEDUP_THRESHOLD = float(os.getenv('JEV_DEDUP_THRESHOLD', '0.8'))
JEV_COVERAGE_THRESHOLD = float(os.getenv('JEV_COVERAGE_THRESHOLD', '0.5'))
JEV_MODEL = os.getenv('JEV_MODEL', 'typesafe/jev-1.13')
DEFAULT_WHISPER_MODEL = os.getenv('DEFAULT_WHISPER_MODEL', 'bzikst/faster-whisper-large-v3-ru-podlodka')

# Движок транскрипции: 'whisper' — локальный WhisperX на GPU,
# 'gemini' / 'grok' / 'mai' — облачный STT через OpenRouter /audio/transcriptions
STT_ENGINE = os.getenv('STT_ENGINE', 'whisper')
STT_API_MODELS = {
    'gemini': 'google/gemini-3.5-transcribe',   # лучшая точность, таймкоды слов, ~$0.18/час
    'grok': 'x-ai/grok-stt-1.0',                # все сущности верно, таймкоды слов, ~$0.10/час
    'mai': 'microsoft/mai-transcribe-2',        # сегментная разметка, дословно, ~$0.10/час
}
STT_CHUNK_SECONDS = int(os.getenv('STT_CHUNK_SECONDS', '900'))  # ~15 мин → ~7MB mp3 (лимит ~9-10MB)

WHISPER_MODELS = {
    'tiny': {'size': '39 MB', 'speed': 'очень быстро', 'quality': 'низкое'},
    'base': {'size': '74 MB', 'speed': 'быстро', 'quality': 'среднее'},
    'small': {'size': '244 MB', 'speed': 'средне', 'quality': 'хорошее'},
    'medium': {'size': '769 MB', 'speed': 'медленно', 'quality': 'очень хорошее'},
    'large': {'size': '1550 MB', 'speed': 'очень медленно', 'quality': 'отличное'},
    'large-v2': {'size': '1550 MB', 'speed': 'очень медленно', 'quality': 'отличное'},
    'large-v3': {'size': '1550 MB', 'speed': 'очень медленно', 'quality': 'превосходное'},
}

DIARIZATION_MODEL = 'pyannote/speaker-diarization-3.1'
DEMUCS_MODEL = 'htdemucs'

# Сепарация вокала перед транскрипцией (audio-separator / demucs / выкл)
# kim — Kim Vocal 2 (ONNX, ~66 МБ, самый быстрый, качество = demucs на тестах)
# melband — MelBand Roformer Vocals (SDR 12.6, тяжёлая, ~460 МБ)
# viperx — BS-Roformer Viperx-1297 (SDR 11.8, медленная)
# demucs — классический htdemucs
# none — без сепарации
SEPARATOR_ENGINE = os.getenv('SEPARATOR_ENGINE', 'kim')
SEPARATOR_MODELS = {
    'kim': 'Kim_Vocal_2.onnx',
    'melband': 'vocals_mel_band_roformer.ckpt',
    'viperx': 'model_bs_roformer_ep_317_sdr_12.9755.ckpt',
}

# Поддерживаемые языки
SUPPORTED_LANGUAGES = {
    'ru': 'Русский',
    'en': 'English',
    'de': 'Deutsch',
    'fr': 'Français',
    'es': 'Español',
    'it': 'Italiano',
    'pt': 'Português',
    'pl': 'Polski',
    'tr': 'Türkçe',
    'uk': 'Українська',
    'zh': '中文',
    'ja': '日本語',
    'ko': '한국어',
    'ar': 'العربية',
}

DEFAULT_LANGUAGE = 'ru'

# Настройки OpenAI / OpenRouter API
OPENAI_MODEL = os.getenv('OPENAI_MODEL', DEFAULT_LLM_MODEL)

OPENAI_SETTINGS = {
    'temperature': 0.3,
    'max_tokens': 8000,
    'timeout': 60,
    'max_retries': 3,
    'retry_delay': 2,
}

# Слова-паразиты для удаления из транскрипции
FILLER_WORDS = {
    'ru': ['эм', 'эээ', 'ммм', 'ааа', 'ну', 'вот', 'как бы', 'типа', 'короче', 'блин'],
    'en': ['um', 'uh', 'er', 'ah', 'like', 'you know', 'actually', 'basically'],
}

# Текстовые замены для коррекции транскрипции
TEXT_REPLACEMENTS = {
    'ru': {
        'щас': 'сейчас',
        'чё': 'что',
        'тока': 'только',
        'када': 'когда',
        'прям': 'прямо',
        'норм': 'нормально',
        'оч': 'очень',
    },
    'en': {
        'gonna': 'going to',
        'wanna': 'want to',
        'gotta': 'got to',
        'kinda': 'kind of',
        'sorta': 'sort of',
    },
}

# Настройки памяти
MEMORY_SETTINGS = {
    'max_usage_percent': 80,
    'cleanup_threshold': 90,
    'monitoring_interval': 5,
    'warning_threshold': 75,
}

# Настройки чанкинга аудио
CHUNKING_SETTINGS = {
    'default_duration': 30,
    'min_duration': 10,
    'max_duration': 300,
    'overlap_duration': 2,
    'silence_threshold': -40,
    'min_silence_duration': 0.5,
}

# Настройки диаризации
DIARIZATION_SETTINGS = {
    'min_speakers': 1,
    'max_speakers': 10,
    'embedding_window': 1.5,
    'clustering_threshold': 0.7,
    'min_segment_duration': 0.5,
}

# Тонкая настройка pyannote community-1 (через .env):
# DIARIZATION_NUM_SPEAKERS — точное число спикеров (0 = авто)
# DIARIZATION_CLUSTERING_THRESHOLD — порог слияния кластеров (ниже = больше спикеров)
# DIARIZATION_MIN_DURATION_OFF — мин. пауза для разделения реплик (ниже = ловит короткие перебивки)
DIARIZATION_NUM_SPEAKERS = int(os.getenv('DIARIZATION_NUM_SPEAKERS', '0') or '0')
DIARIZATION_CLUSTERING_THRESHOLD = (
    float(os.getenv('DIARIZATION_CLUSTERING_THRESHOLD'))
    if os.getenv('DIARIZATION_CLUSTERING_THRESHOLD') else None
)
DIARIZATION_MIN_DURATION_OFF = (
    float(os.getenv('DIARIZATION_MIN_DURATION_OFF'))
    if os.getenv('DIARIZATION_MIN_DURATION_OFF') else None
)

# Какой звук отдавать диаризации: processed — после сепаратора и нормализации
# (как раньше), raw — исходный 16 кГц моно. Выбирать по сравнению DER на
# вкладке «Разметка» (/voice). На распознавание слов не влияет.
DIARIZATION_AUDIO = os.getenv('DIARIZATION_AUDIO', 'processed').strip().lower()
if DIARIZATION_AUDIO not in ('raw', 'processed'):
    DIARIZATION_AUDIO = 'processed'

def _env_flag(name: str, default: str = '0') -> bool:
    return os.getenv(name, default).strip().lower() in ('1', 'true', 'yes', 'on')


# Назначение спикера словам по наибольшему пересечению с репликами диаризации
# (детерминированно при одновременной речи). 0 — прежний индекс «100 мс -> спикер».
DIARIZATION_OVERLAP_ASSIGN = _env_flag('DIARIZATION_OVERLAP_ASSIGN')
# Эмбеддинги для узнавания по голосу: до 15 самых длинных реплик, центральные ≤8 с,
# нормированные векторы. 0 — прежние 5 первых реплик целиком.
SPEAKER_EMBEDDINGS_IMPROVED = _env_flag('SPEAKER_EMBEDDINGS_IMPROVED')

# STT API: вырезание тишины перед отправкой (1 = резать, 0 = слать всё)
STT_CUT_SILENCE = os.getenv('STT_CUT_SILENCE', '1').strip().lower() in ('1', 'true', 'yes', 'on')

# Настройки идентификации спикеров
SPEAKER_IDENTIFICATION_SETTINGS = {
    'similarity_threshold': 0.7,
    'embedding_model': 'speechbrain/spkrec-ecapa-voxceleb',
    'max_reference_duration': 30,
}

# Настройки Demucs
DEMUCS_SETTINGS = {
    'device': 'auto',
    'shifts': 1,
    'overlap': 0.25,
    'split': True,
    'segment': 10,
}

# Форматы отчетов
REPORT_FORMATS = ['json', 'markdown', 'html', 'pdf']

# Настройки HTML отчетов
HTML_SETTINGS = {
    'include_css': True,
    'responsive_design': True,
    'dark_theme_support': True,
    'include_charts': False,
}

# Настройки PDF отчетов
PDF_SETTINGS = {
    'page_size': 'A4',
    'margin': '2cm',
    'font_family': 'DejaVu Sans',
    'font_size': '12pt',
    'include_toc': True,
}

# Уровни логирования
LOG_LEVELS = {
    'DEBUG': 10,
    'INFO': 20,
    'WARNING': 30,
    'ERROR': 40,
    'CRITICAL': 50,
}

# Настройки логирования
LOGGING_SETTINGS = {
    'level': 'INFO',
    'format': '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    'date_format': '%Y-%m-%d %H:%M:%S',
    'max_file_size': 10485760,
    'backup_count': 5,
    'encoding': 'utf-8',
}

# Максимальные размеры файлов (в байтах)
MAX_FILE_SIZES = {
    'audio': 524288000,   # 500 MB
    'video': 2147483648,  # 2 GB
}

# Запрещенные расширения файлов
FORBIDDEN_EXTENSIONS = ['.exe', '.bat', '.cmd', '.com', '.scr', '.pif', '.vbs', '.js', '.jar']

# Настройки анализа ключевых слов
KEYWORD_ANALYSIS_SETTINGS = {
    'min_word_length': 3,
    'max_keywords': 20,
    'exclude_common_words': True,
    'use_stemming': True,
}

# Настройки анализа тональности
SENTIMENT_ANALYSIS_SETTINGS = {
    'model': 'basic',
    'confidence_threshold': 0.6,
    'analyze_by_speaker': True,
}

# Настройки анализа динамики разговора
CONVERSATION_DYNAMICS_SETTINGS = {
    'interruption_threshold': 0.5,
    'pause_threshold': 2.0,
    'speaking_time_analysis': True,
    'turn_taking_analysis': True,
}

# Промпты для AI-анализа
AI_PROMPTS = {
    'summary': """
Проанализируй следующую транскрипцию встречи и создай краткое резюме.
Включи основные темы, ключевые решения и важные моменты обсуждения.
Отвечай на русском языке.

Транскрипция:
{transcript}

Резюме:""",
    'action_items': """
Проанализируй транскрипцию встречи и выдели все задачи и действия, которые были назначены или обсуждены.
Для каждой задачи укажи ответственного (если упоминается) и срок выполнения (если указан).
Отвечай на русском языке.

Транскрипция:
{transcript}

Задачи и действия:""",
    'questions': """
Проанализируй транскрипцию встречи и выдели все открытые вопросы, которые требуют дальнейшего обсуждения или решения.
Отвечай на русском языке.

Транскрипция:
{transcript}

Открытые вопросы:""",
    'participants': """
Проанализируй транскрипцию встречи и определи участников, их роли и уровень участия в обсуждении.
Отвечай на русском языке.

Транскрипция:
{transcript}

Участники встречи:""",
}


def get_config_summary() -> Dict:
    """Возвращает краткую сводку текущей конфигурации."""
    return {
        'project_root': str(PROJECT_ROOT),
        'whisper_model': DEFAULT_WHISPER_MODEL,
        'language': DEFAULT_LANGUAGE,
        'supported_formats': len(SUPPORTED_FORMATS),
        'memory_limit': MEMORY_SETTINGS['max_usage_percent'],
        'chunk_duration': CHUNKING_SETTINGS['default_duration'],
        'report_formats': REPORT_FORMATS,
        'ai_enabled': bool(OPENROUTER_KEY),
    }


def validate_config() -> List[str]:
    """Проверяет конфигурацию и возвращает список предупреждений."""
    warnings = []

    if not OPENROUTER_KEY:
        warnings.append('OPENROUTER_KEY не установлен - AI анализ будет недоступен')

    for name, path in [('INPUT_DIR', INPUT_DIR), ('OUTPUT_DIR', OUTPUT_DIR), ('PROCESSED_DIR', PROCESSED_DIR)]:
        if not path.exists():
            warnings.append(f'Директория {name} не существует: {path}')

    if DEFAULT_WHISPER_MODEL not in WHISPER_MODELS:
        warnings.append(f'Неизвестная модель Whisper: {DEFAULT_WHISPER_MODEL}')

    if DEFAULT_LANGUAGE not in SUPPORTED_LANGUAGES:
        warnings.append(f'Неподдерживаемый язык: {DEFAULT_LANGUAGE}')

    return warnings


def get_model_info(model_name: str) -> Optional[Dict]:
    """Возвращает информацию о модели Whisper."""
    return WHISPER_MODELS.get(model_name)


def get_language_name(code: str) -> str:
    """Возвращает название языка по коду."""
    return SUPPORTED_LANGUAGES.get(code, code)


def is_supported_format(file_path: str) -> bool:
    """Проверяет, поддерживается ли формат файла."""
    return Path(file_path).suffix.lower() in SUPPORTED_FORMATS


def get_file_type(file_path: str) -> str:
    """Определяет тип файла (audio/video/unknown)."""
    ext = Path(file_path).suffix.lower()
    if ext in SUPPORTED_AUDIO_FORMATS:
        return 'audio'
    if ext in SUPPORTED_VIDEO_FORMATS:
        return 'video'
    return 'unknown'


if __name__ == '__main__':
    print('🔧 Проверка конфигурации...')

    config_summary = get_config_summary()
    print('\n📋 Текущая конфигурация:')
    for key, value in config_summary.items():
        print(f'   {key}: {value}')

    warnings = validate_config()
    if warnings:
        print('\n⚠️ Предупреждения:')
        for warning in warnings:
            print(f'   • {warning}')
    else:
        print('\n✅ Конфигурация корректна')
