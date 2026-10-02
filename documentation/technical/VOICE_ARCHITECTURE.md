# VoiceVideo (протоколы встреч) — архитектура и эксплуатация

Отдельный контур поверх пайплайна `voice_video/` (бывший `C:\Project\VoiceVideo`,
перенесён в монорепо). Паттерн повторяет Scan Center: независимый FastAPI-процесс,
отдельный worker, auth через основной backend, реестр в PostgreSQL.

## Компоненты

| Компонент | Где | Порт/назначение |
|---|---|---|
| Voice API | `voice_server/app.py` (`python -m voice_server`) | `127.0.0.1:8013`, префикс `/api/v1/voice` |
| Worker | `voice_server/worker_main.py` (`python -m voice_server.worker_main`) | опрашивает очередь, запускает `voice_video/run.py` сабпроцессом |
| Пайплайн | `voice_video/` | Whisper/pyannote, CUDA; данные не коммитятся (см. `.gitignore`) |
| Реестр | PostgreSQL schema `voice`, таблица `voice_jobs` | метаданные задач, настройки, отчёты, спикеры |
| Frontend | `/voice` | `pages/voice-video/*`, права `voice.*` |

Файлы (медиа, отчёты, сэмплы спикеров) хранятся в `voice_video/input|output|unassigned_speakers|reference_voices`;
в БД — только пути и метаданные.

## Права

- `voice.read` — страница, протоколы, отчёты, прослушивание сэмплов. Все read-пользователи видят все протоколы.
- `voice.upload` — загрузка медиа и постановка задач.
- `voice.manage` — именование спикеров, запись эталонных голосов, resume.

Выдача — стандартный интерфейс прав в `account`. Auth: voice_server проверяет токен через
`/api/v1/auth/me` основного backend (`VOICE_AUTH_ME_URL`); forwarded-заголовки из IIS сохраняют
admin IP-allowlist.

## Конфигурация (.env)

- `VOICE_DATABASE_URL` — PostgreSQL (`schema voice`); если пусто — `APP_DATABASE_URL`.
- `VOICE_SERVER_PORT` — по умолчанию 8013.
- `VOICEVIDEO_ROOT` — корень пайплайна (по умолчанию `<repo>/voice_video`).
- `VOICEVIDEO_PYTHON` — интерпретатор с torch/whisperx (по умолчанию текущий python).
- `VOICE_WORKER_CONCURRENCY` — 1 (GPU-bound; поднимать только при запасе VRAM).
- `VOICE_JOB_TIMEOUT_SEC`, `VOICE_UPLOAD_MAX_BYTES` — лимиты.

## Развёртывание

```bash
# 1. Миграция схемы voice (нужен VOICE_DATABASE_URL или APP_DATABASE_URL)
python -m alembic -c voice_server/alembic.ini upgrade head

# 2. Процессы (только voice или весь набор)
pm2 start scripts/pm2/ecosystem.voice.config.js
pm2 start scripts/pm2/ecosystem.all.config.js   # включает voice

# 3. IIS — правило "Voice API Reverse Proxy" уже в public/web.config:
#    /api/v1/voice/* -> http://127.0.0.1:8013/api/v1/voice/*
```

Frontend ходит в `/api/v1/voice/*` через тот же origin, что и остальные API.

## Проверка

```bash
python -m compileall -q voice_server
curl http://127.0.0.1:8013/api/v1/voice/health
cd WEB-itinvent/frontend && npm run build
```

## Разметка диаризации (вкладка «Разметка»)

Ручная разметка «кто когда говорит» для оценки и настройки диаризации. Доступ — `voice.manage`.

1. `POST /api/v1/voice/labeling/projects` — загрузка медиа в `voice_video/labeling/<id>/`,
   запись в `voice.label_projects`, задача `kind=label` в общей очереди.
2. Worker запускает `voice_video/label_draft.py`: диаризация pyannote по **сырому** звуку
   (16 кГц моно, без сепаратора вокала), опционально текст реплик через обычный STT
   (сепаратор → нормализация → STT). Результат — `draft.json` и `audio.mp3` для плеера.
3. Черновик сохраняется в `auto_segments` и, пока никто не правил, в `segments`.
4. Редактор (`VoiceLabelEditor.jsx`): плеер, шкала реплик, смена спикера, разрез/слияние,
   границы по плееру, выбор сотрудника для метки (`/hub/users/assignees`, нужен `tasks.read`;
   без него — ввод имени вручную), объединение меток, отмена, автосохранение.
5. `PUT .../projects/{id}` — сохранение с оптимистической блокировкой по `version`
   (устаревшая вкладка получает 409, чужие правки не затираются).
6. `GET .../projects/{id}/rttm?source=edited|auto&names=0|1` — эталон и черновик модели
   в формате RTTM для подсчёта DER.
7. Волна звука (`peaks.json`, огибающая по 0,1 с) и масштабируемая шкала: границы выбранной
   реплики перетаскиваются мышью.
8. «Качество диаризации»: `GET .../metrics` считает DER (пропуск / лишнее / путаница, допуск
   ±0,25 с, оптимальное сопоставление спикеров) черновика и вариантов против сохранённой
   разметки (`voice_server/labeling_metrics.py`). `POST .../variants {separator}` ставит
   задачу диаризации того же файла по очищенному звуку (`label_draft.py --mode variant`).
9. «Записать голоса в эталоны»: `POST .../enroll` режет до 30 с самых длинных сохранённых реплик
   каждого названного сотрудника (`--mode samples`, звук после сепаратора — как у
   автоопределения в протоколах) и вызывает `run.py --enroll-voice`.

Варианты и запись эталонов идут отдельной задачей (`aux_job_id`), разметка в это время
остаётся доступной для правки. По итогам сравнения основной пайплайн переключается
переменной `DIARIZATION_AUDIO=raw|processed` в `voice_video/.env` (по умолчанию `processed` —
как было); распознавание текста всегда идёт по обработанному звуку.

Таблица создаётся миграцией `20261002_0005` (как и остальные — явной командой при релизе).

## Эксплуатационные замечания

- Одна GPU (Tesla T4): `VOICE_WORKER_CONCURRENCY=1` — очередь последовательная.
- Пайплайн использует глобальные каталоги `voice_video/`; параллельные задачи не предполагаются.
- `torchcodec`/FFmpeg warning от pyannote при импорте — наблюдаемая проблема среды; если
  диarization падает на декодировании, проверить FFmpeg в PATH пайплайна.
- Логи пайплайна — `voice_video/logs/`, stdout сабпроцесса — в логах pm2 `itinvent-voice-worker`.
- Ротация/ретенция отчётов — средствами самого пайплайна (`output/`, `processed/`); БД хранит пути.
