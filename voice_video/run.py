"""
Скрипт для запуска VoiceVideo с проверкой готовности системы

Использование:
    python run.py [файл_или_папка] [опции]

Примеры:
    python run.py                          # Интерактивный режим
    python run.py input/audio.mp3          # Обработка файла
    python run.py input/                   # Обработка папки
    python run.py --check                  # Проверка системы
    python run.py --setup                  # Первоначальная настройка
"""

import os
import sys
import argparse
import json
import logging
import importlib.util
import importlib
from pathlib import Path
from typing import Optional, List, Dict, Any


def bootstrap_local_site_packages():
    """Подключает локальные site-packages проекта, если они существуют."""
    root = Path(__file__).resolve().parent
    candidates = [
        root / "site-packages",
        root / "libs",
        root / "venv" / "Lib" / "site-packages",
        root / ".venv" / "Lib" / "site-packages",
    ]
    for candidate in candidates:
        if candidate.exists():
            sys.path.insert(0, str(candidate))


def bootstrap_local_ffmpeg():
    """Добавляет локальный ffmpeg проекта в PATH и DLL-поиск, если он есть."""
    root = Path(__file__).resolve().parent
    candidates = [root / "ffmpeg" / "bin", root / "bin", root / "ffmpeg"]
    for candidate in candidates:
        exe = candidate / "ffmpeg.exe"
        if candidate.exists() and exe.exists():
            os.environ["PATH"] = str(candidate) + os.pathsep + os.environ.get("PATH", "")
            if hasattr(os, "add_dll_directory"):
                try:
                    os.add_dll_directory(str(candidate))
                except OSError:
                    pass
            return


def bootstrap_local_model_cache():
    """Направляет кэши HuggingFace/torch в локальную папку models."""
    root = Path(__file__).resolve().parent
    models_dir = root / "models"
    models_dir.mkdir(exist_ok=True)
    os.environ.setdefault("HUGGINGFACE_HUB_CACHE", str(models_dir))
    os.environ.setdefault("HF_HOME", str(models_dir / ".hf-home"))
    os.environ.setdefault("TORCH_HOME", str(models_dir / ".torch"))


def bootstrap_torch_compat():
    """Совместимость с PyTorch 2.6+ (weights_only load)."""
    os.environ.setdefault("TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD", "1")


def configure_console_encoding():
    """UTF-8 вывод в консоль Windows."""
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        if stream is not None and hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass


class TqdmConsoleHandler(logging.Handler):
    """Обработчик логов, совместимый с tqdm progress-барами."""

    def emit(self, record):
        try:
            from tqdm import tqdm
            tqdm.write(self.format(record))
        except Exception:
            try:
                sys.stderr.write(self.format(record) + "\n")
            except Exception:
                pass


def resolve_cpu_threads(requested_threads: Optional[int] = None) -> int:
    """Разумное число CPU-потоков для моделей на CPU."""
    if requested_threads is not None:
        return max(1, int(requested_threads))
    logical_cores = os.cpu_count() or 1
    try:
        import psutil
        physical_cores = psutil.cpu_count(logical=False) or logical_cores
    except Exception:
        physical_cores = logical_cores
    detected = physical_cores or logical_cores
    if detected <= 2:
        return max(1, detected)
    if detected <= 8:
        return max(1, detected - 1)
    return max(1, detected - 2)


def configure_runtime_environment(device_arg: str = "auto", cpu_threads: Optional[int] = None):
    """Настраивает переменные окружения до загрузки ML-библиотек."""
    if device_arg and device_arg != "auto":
        os.environ["USE_CUDA"] = "true" if device_arg == "cuda" else "false"

    threads = resolve_cpu_threads(cpu_threads)
    for var in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
        os.environ.setdefault(var, str(threads))


def configure_logging(level_name: str = "INFO"):
    """Настраивает логирование в консоль и файл processing.log."""
    level = getattr(logging, level_name.upper(), logging.INFO)
    root = logging.getLogger()
    root.setLevel(logging.DEBUG)

    for handler in list(root.handlers):
        root.removeHandler(handler)

    console = TqdmConsoleHandler()
    console.setLevel(level)
    console.setFormatter(logging.Formatter("%(message)s"))
    root.addHandler(console)

    logs_dir = Path(__file__).resolve().parent / "logs"
    logs_dir.mkdir(exist_ok=True)
    file_handler = logging.FileHandler(logs_dir / "processing.log", encoding="utf-8")
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(
        logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
    )
    root.addHandler(file_handler)


def check_python_version() -> bool:
    """Проверяет версию Python (>= 3.9)."""
    version = sys.version_info
    if version >= (3, 9):
        print(f"✅ Python {version.major}.{version.minor}.{version.micro}")
        return True
    print(f"❌ Требуется Python >= 3.9, установлен {version.major}.{version.minor}.{version.micro}")
    return False


def check_dependencies() -> Dict[str, bool]:
    """Проверяет наличие необходимых пакетов."""
    results = {
        'torch': False,
        'whisperx': False,
        'pyannote.audio': False,
        'librosa': False,
        'soundfile': False,
        'pydub': False,
        'ffmpeg-python': False,
    }
    for package in results:
        try:
            if package == 'pyannote.audio':
                import pyannote.audio  # noqa: F401
            elif package == 'ffmpeg-python':
                import ffmpeg  # noqa: F401
            else:
                __import__(package)
            results[package] = True
            print(f"✅ {package}")
        except ImportError:
            results[package] = False
            print(f"❌ {package} - не установлен")
        except Exception as e:
            results[package] = False
            print(f"⚠️ {package} - ошибка: {e}")
    return results


def check_cuda() -> bool:
    """Проверяет доступность CUDA."""
    try:
        import torch
        if torch.cuda.is_available():
            name = torch.cuda.get_device_name(0)
            print(f"✅ CUDA доступна: {name}")
            return True
        print("⚠️ CUDA недоступна, будет использоваться CPU")
        return False
    except Exception as e:
        print(f"⚠️ Не удалось проверить CUDA: {e}")
        return False


def check_directories() -> bool:
    """Проверяет/создает рабочие директории."""
    root = Path(__file__).resolve().parent
    required = ['input', 'output', 'processed', 'temp', 'logs', 'models', 'reference_voices']
    ok = True
    for name in required:
        directory = root / name
        try:
            directory.mkdir(exist_ok=True)
            print(f"✅ {name}/")
        except Exception as e:
            print(f"❌ {name}/ - {e}")
            ok = False
    return ok


def check_config() -> bool:
    """Проверяет конфигурацию проекта."""
    try:
        import config
        warnings = config.validate_config()
        for warning in warnings:
            print(f"⚠️ {warning}")
        if not warnings:
            print("✅ Конфигурация корректна")
        return True
    except Exception as e:
        print(f"❌ Ошибка конфигурации: {e}")
        return False


def setup_project() -> bool:
    """Первоначальная настройка проекта."""
    print("🔧 Первоначальная настройка проекта...\n")

    ok = check_directories()

    env_path = Path(__file__).resolve().parent / ".env"
    env_example = env_path.with_suffix(".env.example")
    if not env_path.exists():
        env_path.write_text(
            "# API ключи VoiceVideo\n"
            "HF_TOKEN=\n"
            "OPENROUTER_KEY=\n"
            "USE_CUDA=true\n"
            "# OPENAI_MODEL=openai/gpt-6-luna-pro\n"
            "# SEGMENTATION_MODEL=z-ai/glm-5.3-flash\n"
            "# Альтернатива: OPENAI_MODEL=xiaomi/mimo-v2.6-pro\n"
            "# DEFAULT_WHISPER_MODEL=large-v3\n",
            encoding="utf-8",
        )
        print(f"✅ Создан файл {env_path.name} - заполните API ключи")
    else:
        print("✅ Файл .env уже существует")

    print("\n📦 Проверка зависимостей:")
    deps = check_dependencies()
    missing = [name for name, installed in deps.items() if not installed]
    if missing:
        print(f"\n⚠️ Отсутствуют пакеты: {', '.join(missing)}")
        print("💡 Установите зависимости: pip install -r requirements.txt")
        ok = False
    else:
        print("\n✅ Все зависимости установлены")

    print("\n🖥️ CUDA:")
    check_cuda()

    print("\n⚙️ Конфигурация:")
    check_config()

    if ok:
        print("\n✅ Настройка завершена!")
    else:
        print("\n⚠️ Настройка завершена с предупреждениями")
    return ok


def get_system_info() -> Dict[str, Any]:
    """Возвращает информацию о системе."""
    info = {
        'python_version': sys.version,
        'platform': sys.platform,
        'cpu_count': os.cpu_count(),
    }
    try:
        import torch
        info['torch_version'] = torch.__version__
        info['cuda_available'] = torch.cuda.is_available()
        if torch.cuda.is_available():
            info['cuda_device'] = torch.cuda.get_device_name(0)
            info['cuda_version'] = torch.version.cuda
    except Exception:
        info['torch_version'] = None
    try:
        import psutil
        info['memory_total_gb'] = round(psutil.virtual_memory().total / 1024**3, 1)
    except Exception:
        pass
    try:
        import config
        info['device'] = config.DEVICE
        info['openrouter_key_set'] = bool(config.OPENROUTER_KEY)
        info['hf_token_set'] = bool(config.HF_TOKEN)
        info['llm_model'] = config.OPENAI_MODEL
    except Exception:
        pass
    return info


def interactive_mode() -> int:
    """Интерактивный режим выбора файла."""
    print("🎬 VoiceVideo - интерактивный режим\n")
    input_dir = Path(__file__).resolve().parent / "input"

    supported = {'.flac', '.m4a', '.mp3', '.wav', '.aac', '.ogg', '.webm', '.mkv', '.mov', '.avi', '.mp4'}
    files = []
    if input_dir.exists():
        files = [f for f in input_dir.iterdir() if f.is_file() and f.suffix.lower() in supported]

    if not files:
        print(f"📁 Положите аудио/видео файлы в папку: {input_dir}")
        print("   или укажите путь к файлу: python run.py <файл>")
        return 0

    print("Доступные файлы:")
    for i, f in enumerate(files, 1):
        print(f"  {i}. {f.name}")
    print("  0. Выход")

    try:
        choice = input("\nВыберите файл для обработки: ").strip()
    except (EOFError, KeyboardInterrupt):
        print("\n👋 Выход...")
        return 0

    if not choice or choice == "0":
        print("👋 Выход...")
        return 0

    try:
        index = int(choice) - 1
        if not (0 <= index < len(files)):
            raise ValueError
    except ValueError:
        print("❌ Неверный выбор")
        return 1

    return process_file(files[index])


def process_file(file_path, config=None) -> int:
    """Обрабатывает один файл через MainProcessor."""
    from modules.main_processor import MainProcessor, ProcessingConfig

    file_path = Path(file_path)
    config = config or ProcessingConfig()

    print(f"🎵 Обработка файла: {file_path.name}")
    print(f"⚙️ Модель: {config.whisper_model}")
    print(f"🌍 Язык: {config.language}")
    print(f"📊 Размер батча: {config.batch_size}")
    print(f"🧵 CPU-потоки: {config.cpu_threads}")
    print(f"✂️ Длина чанка: {config.chunk_duration_seconds} сек")
    print(
        "🧩 Опции: "
        f"Separator={getattr(config, 'separator_engine', 'demucs') if config.enable_demucs else 'off'}, "
        f"STT={getattr(config, 'stt_engine', 'whisper')}, "
        f"Alignment={'on' if config.enable_alignment else 'off'}, "
        f"Diarization={'on' if config.enable_diarization else 'off'}, "
        f"AI={'on' if config.enable_ai_analysis else 'off'}"
    )

    processor = MainProcessor(config)
    result = processor.process_file(str(file_path))

    if result.get('success'):
        print("\n✅ Обработка завершена!")
        segments = result.get('transcription', {}).get('segments', [])
        print(f"📝 Сегментов: {len(segments)}")
        speakers = {s.get('speaker', 'UNKNOWN') for s in segments}
        if speakers and speakers != {'UNKNOWN'}:
            print(f"👥 Спикеров: {len(speakers)} ({', '.join(sorted(speakers))})")
        reports = result.get('generated_reports', {})
        if reports:
            print("📄 Отчеты:")
            for fmt, path in reports.items():
                print(f"   {fmt}: {path}")
        print(f"⏱️ Время обработки: {result.get('processing_time_formatted', 'неизвестно')}")
        return 0

    print(f"\n❌ Ошибка обработки: {result.get('error', 'неизвестная ошибка')}")
    return 1


def enroll_speaker_voice(voice_path: str, speaker_name: str) -> bool:
    """Добавляет эталонный голос в reference_voices и вычисляет эмбеддинг."""
    try:
        import re as _re
        import config as app_config

        voice_file = Path(voice_path)
        if not voice_file.exists():
            print(f'❌ Файл не найден: {voice_path}')
            return False
        if not speaker_name or not speaker_name.strip():
            print('❌ Укажите имя спикера: --speaker-name "Фамилия Имя"')
            return False

        speaker_name = speaker_name.strip()
        safe_dir = _re.sub(r'[\\/:*?"<>|]', '_', speaker_name)
        speaker_dir = app_config.REFERENCE_VOICES_DIR / safe_dir
        speaker_dir.mkdir(parents=True, exist_ok=True)

        # Конвертируем/копируем в WAV 16kHz mono — формат pyannote
        target_wav = speaker_dir / f"{safe_dir}.wav"
        if not target_wav.exists():
            try:
                from pydub import AudioSegment
                audio = AudioSegment.from_file(str(voice_file))
                duration_s = len(audio) / 1000.0
                if duration_s < 3:
                    print(f'⚠️ Сэмпл очень короткий ({duration_s:.1f}с) — для надёжной идентификации нужно 5-30с')
                audio = audio.set_channels(1).set_frame_rate(16000)
                audio.export(str(target_wav), format='wav')
                print(f'✅ Голос сохранён: {target_wav} ({duration_s:.0f}с)')
            except Exception as e:
                print(f'❌ Не удалось конвертировать аудио: {e}')
                return False

        # Сразу вычисляем эмбеддинг (проверка качества + кэш для прогонов)
        print('🧬 Вычисляю эмбеддинг голоса (загрузка pyannote, ~30с)...')
        from modules.main_processor import ProcessingConfig
        from modules.diarization import SpeakerDiarization
        diar = SpeakerDiarization(ProcessingConfig(enable_ai_analysis=False))
        embedding = diar._create_reference_embedding([target_wav])
        if embedding is None:
            print('❌ Не удалось создать эмбеддинг — проверьте, что на записи чистая речь')
            return False
        import pickle
        pkl = speaker_dir / f"{safe_dir}_embedding.pkl"
        with open(pkl, 'wb') as f:
            pickle.dump(embedding, f)
        print(f'✅ Эмбеддинг сохранён: {pkl.name} (dim={len(embedding)})')
        print(f'\n🎤 Спикер "{speaker_name}" добавлен. При следующем прогоне он будет опознан автоматически.')
        print('   Можно добавить ещё сэмплы этого же голоса в папку — точность вырастет.')
        return True

    except Exception as e:
        print(f'❌ Ошибка добавления голоса: {e}')
        return False


def _parse_speaker_map(raw):
    """'SPEAKER_02=ФИО;SPEAKER_07=ФИО' -> {'SPEAKER_02': 'ФИО', ...}"""
    if not raw:
        return None
    out = {}
    for pair in raw.split(';'):
        if '=' in pair:
            k, v = pair.split('=', 1)
            if k.strip() and v.strip():
                out[k.strip()] = v.strip()
    return out or None


def main() -> int:
    """Точка входа CLI."""
    parser = argparse.ArgumentParser(
        description='VoiceVideo - Система обработки аудио/видео с WhisperX',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Примеры использования:
  python run.py                          # Интерактивный режим
  python run.py input/audio.mp3          # Обработка файла
  python run.py input/ --batch           # Пакетная обработка
  python run.py --check                  # Проверка системы
  python run.py --setup                  # Настройка проекта
        ''',
    )

    parser.add_argument('input_path', nargs='?', help='Путь к файлу или папке для обработки')
    parser.add_argument('--check', action='store_true', help='Проверить готовность системы')
    parser.add_argument('--setup', action='store_true', help='Выполнить первоначальную настройку')
    parser.add_argument('--info', action='store_true', help='Показать информацию о системе')
    parser.add_argument('--model', default='bzikst/faster-whisper-large-v3-ru-podlodka',
                        help='Модель Whisper: tiny/base/small/medium/large-v3 или HF-репо '
                             '(по умолчанию: bzikst/faster-whisper-large-v3-ru-podlodka — '
                             'русская fine-tune large-v3)')
    parser.add_argument('--language', default='ru', help='Язык аудио (по умолчанию: ru)')
    parser.add_argument('--stt-engine', default=None, metavar='ENGINE',
                        help='Движок транскрипции: whisper (локальный GPU), gemini, grok, mai '
                             'или сырой model id с OpenRouter /audio/transcriptions '
                             '(по умолчанию: STT_ENGINE из .env или whisper)')
    parser.add_argument('--device', choices=['auto', 'cuda', 'cpu'], default='auto',
                        help='Устройство для обработки (по умолчанию: auto)')
    parser.add_argument('--cpu-threads', type=int, default=None,
                        help='Число CPU-потоков для Whisper/Demucs (по умолчанию: авто)')
    parser.add_argument('--log-level', choices=['DEBUG', 'INFO', 'WARNING', 'ERROR'],
                        default='INFO', help='Уровень логов в терминале (по умолчанию: INFO)')
    parser.add_argument('--batch', action='store_true', help='Пакетная обработка папки')
    parser.add_argument('--no-diarization', action='store_true', help='Отключить диаризацию спикеров')
    parser.add_argument('--num-speakers', type=int, default=None, metavar='N',
                        help='Точное число спикеров (если известно; иначе авто)')
    parser.add_argument('--separator', default=None,
                        help='Сепаратор вокала: kim | melband | viperx | demucs | none '
                             '(по умолчанию: SEPARATOR_ENGINE из .env или kim)')
    parser.add_argument('--no-demucs', action='store_true',
                        help='Отключить сепарацию вокала (эквивалент --separator none)')
    parser.add_argument('--no-alignment', action='store_true',
                        help='Отключить WhisperX alignment для ускорения')
    parser.add_argument('--no-ai-analysis', action='store_true',
                        help='Отключить AI-анализ и генерацию инсайтов')
    parser.add_argument('--no-speaker-identification', action='store_true',
                        help='Не сопоставлять спикеров с reference_voices')
    parser.add_argument('--no-manual-speakers', action='store_true',
                        help='Не запрашивать ФИО для нераспознанных SPEAKER_*')
    parser.add_argument('--chunk-duration', type=int, default=None,
                        help='Длительность чанков в секундах (по умолчанию: авто, 300)')
    parser.add_argument('--batch-size', type=int, default=None,
                        help='Размер батча (по умолчанию: авто, 4 на CPU)')
    parser.add_argument('--enroll-voice', metavar='FILE', default=None,
                        help='Добавить голос спикера в базу reference_voices (5-30с чистой речи)')
    parser.add_argument('--speaker-name', default=None, metavar='ИМЯ',
                        help='Имя спикера для --enroll-voice (например: "Водопьянов Иван")')
    parser.add_argument('--speaker-map', default=None, metavar='"SPEAKER_02=ФИО;..."',
                        help='Принудительные имена спикеров (перекрывает автоидентификацию)')
    parser.add_argument('--resume-speakers', default=None, metavar='BASE',
                        help='Повторная идентификация/именование спикеров и перегенерация '
                             'анализа и отчётов по output\\<BASE>_transcript.json — без аудио-этапов. '
                             'BASE — имя файла без расширения')
    parser.add_argument('--merge', nargs='+', default=None, metavar='BASE',
                        help='Объединить части одной встречи: --merge part1 part2 [part3]. '
                             'Склеивает транскрипты по времени и строит единый протокол')
    parser.add_argument('--merge-name', default=None, metavar='NAME',
                        help='Имя объединённой встречи (по умолчанию <первая>_merged)')
    parser.add_argument('--fresh', action='store_true',
                        help='Игнорировать чекпоинты этапов — обработка с нуля')
    parser.add_argument('--meeting-date', default=None, metavar='ДД.ММ.ГГГГ',
                        help='Дата встречи для абсолютных сроков в реестре поручений '
                             '(иначе ищется в имени файла)')

    args = parser.parse_args()

    configure_console_encoding()
    configure_runtime_environment(args.device, args.cpu_threads)
    configure_logging(args.log_level)

    chunk_duration = args.chunk_duration or 300
    device = 'cuda' if (args.device == 'cuda' or (args.device == 'auto' and os.environ.get('USE_CUDA', 'true').lower() in ('true', '1', 't'))) else 'cpu'
    batch_size = args.batch_size or (8 if device == 'cuda' else 4)

    if args.setup:
        return 0 if setup_project() else 1

    if args.check:
        print('🔍 Проверка готовности системы...\n')
        ok = check_python_version()
        print('\n📦 Зависимости:')
        deps = check_dependencies()
        ok = all(deps.values()) and ok
        print('\n🖥️ CUDA:')
        check_cuda()
        print('\n📁 Директории:')
        ok = check_directories() and ok
        print('\n⚙️ Конфигурация:')
        ok = check_config() and ok
        if ok:
            print('\n✅ Система готова к работе!')
            return 0
        print('\n❌ Система не готова')
        print('💡 Установите зависимости: pip install -r requirements.txt')
        return 1

    if args.info:
        print('💻 Информация о системе:\n')
        print(json.dumps(get_system_info(), indent=2, ensure_ascii=False))
        return 0

    if args.enroll_voice:
        return 0 if enroll_speaker_voice(args.enroll_voice, args.speaker_name) else 1

    if args.resume_speakers:
        import config as app_config
        from modules.main_processor import MainProcessor, ProcessingConfig
        resume_config = ProcessingConfig(
            enable_diarization=not args.no_diarization,
            enable_ai_analysis=not args.no_ai_analysis,
            enable_speaker_identification=not args.no_speaker_identification,
            prompt_for_unknown_speakers=not args.no_manual_speakers,
            speaker_name_map=_parse_speaker_map(args.speaker_map),
            cpu_threads=args.cpu_threads,
            diarization_num_speakers=(
                args.num_speakers or getattr(app_config, 'DIARIZATION_NUM_SPEAKERS', 0) or 0
            ),
            diarization_clustering_threshold=getattr(app_config, 'DIARIZATION_CLUSTERING_THRESHOLD', None),
            diarization_min_duration_off=getattr(app_config, 'DIARIZATION_MIN_DURATION_OFF', None),
            meeting_date=args.meeting_date,
        )
        res = MainProcessor(resume_config).resume_speaker_naming(args.resume_speakers)
        if res.get('success'):
            print(f"\n✅ Готово: {args.resume_speakers}")
            print(f"👥 Имена применены: {list((res.get('speaker_naming') or {}).get('manual_assignments', {}).keys()) or '—'}")
            print(f"📄 Отчёты: {res.get('generated_reports')}")
            return 0
        print(f"❌ {res.get('error', 'Ошибка повторного именования')}")
        return 1

    if args.merge:
        from modules.main_processor import MainProcessor, ProcessingConfig
        merge_config = ProcessingConfig(
            enable_diarization=False,
            enable_ai_analysis=not args.no_ai_analysis,
            enable_speaker_identification=False,
            prompt_for_unknown_speakers=False,
            meeting_date=args.meeting_date,
        )
        res = MainProcessor(merge_config).merge_meetings(args.merge, args.merge_name)
        if res.get('success'):
            print(f"\n✅ Встреча объединена: {res['base_filename']} ({res['segments_count']} сегментов)")
            print(f"📄 Отчёты: {res.get('generated_reports')}")
            return 0
        print(f"❌ {res.get('error', 'Ошибка объединения')}")
        return 1

    if args.input_path:
        input_path = Path(args.input_path)
        if not input_path.exists():
            print(f'❌ Файл или папка не найдена: {args.input_path}')
            return 1

        import config as app_config
        if args.no_demucs:
            separator_engine = 'none'
        else:
            separator_engine = args.separator or getattr(app_config, 'SEPARATOR_ENGINE', 'kim')
        config_kwargs = dict(
            whisper_model=args.model,
            stt_engine=args.stt_engine or getattr(app_config, 'STT_ENGINE', 'whisper'),
            stt_chunk_seconds=getattr(app_config, 'STT_CHUNK_SECONDS', 900),
            stt_cut_silence=getattr(app_config, 'STT_CUT_SILENCE', True),
            language=args.language,
            enable_diarization=not args.no_diarization,
            enable_demucs=not args.no_demucs,
            separator_engine=separator_engine,
            enable_alignment=not args.no_alignment,
            enable_ai_analysis=not args.no_ai_analysis,
            enable_speaker_identification=not args.no_speaker_identification,
            prompt_for_unknown_speakers=not args.no_manual_speakers,
            speaker_name_map=_parse_speaker_map(args.speaker_map),
            chunk_duration_seconds=chunk_duration,
            batch_size=batch_size,
            cpu_threads=args.cpu_threads,
            diarization_num_speakers=(
                args.num_speakers or getattr(app_config, 'DIARIZATION_NUM_SPEAKERS', 0) or 0
            ),
            diarization_clustering_threshold=getattr(app_config, 'DIARIZATION_CLUSTERING_THRESHOLD', None),
            diarization_min_duration_off=getattr(app_config, 'DIARIZATION_MIN_DURATION_OFF', None),
            use_checkpoints=not args.fresh,
            meeting_date=args.meeting_date,
        )
        from modules.main_processor import ProcessingConfig
        config = ProcessingConfig(**config_kwargs)

        if input_path.is_file():
            return process_file(input_path, config)

        if input_path.is_dir():
            if not args.batch:
                print('❌ Для обработки папки используйте флаг --batch')
                return 1
            print(f'📦 Пакетная обработка папки: {input_path}')
            supported = {'.flac', '.m4a', '.mp3', '.wav', '.aac', '.ogg', '.webm', '.mkv', '.mov', '.avi', '.mp4'}
            files = [f for f in input_path.iterdir() if f.is_file() and f.suffix.lower() in supported]
            if not files:
                print('❌ В папке не найдено поддерживаемых файлов')
                return 1
            print(f'📁 Найдено файлов: {len(files)}')
            successful = 0
            for i, f in enumerate(files, 1):
                print(f'\n[{i}/{len(files)}] Обработка: {f.name}')
                if process_file(f, config) == 0:
                    successful += 1
            print(f'\n📊 Результат: {successful}/{len(files)} файлов обработано успешно')
            return 0 if successful == len(files) else 1

    return interactive_mode()


if __name__ == '__main__':
    try:
        exit(main())
    except KeyboardInterrupt:
        print('\n👋 Выход...')
        exit(0)
    except Exception as e:
        print(f'❌ Критическая ошибка: {e}')
        exit(1)
