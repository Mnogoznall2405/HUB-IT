# Telegram Desktop UI Automation Probe (Windows long-run)

Read-only прототип на Python: наблюдает **Telegram Desktop** через UI Automation, пока окно активно, и копит компактную историю диалогов.

## Что делает

- Логирует **только когда `Telegram.exe` в фокусе**. Иначе — тихий poll, без UIA и без записи.
- **Новый чат** — один раз сохраняет видимую историю из `HistoryInner` («Сообщения»).
- **Уже известный чат** — пишет только **дельту** новых сообщений (входящие/исходящие).
- **Группы / каналы** — определяются по подписи «N участников/подписчиков» или по нескольким отправителям в истории; в отличие от личек, сообщения всех авторов сохраняются.
- Скриншот окна — при первом открытии чата и при появлении новых сообщений (не каждые 5 секунд).
- По `Ctrl+C` строит `output/report.html`: сначала **список всех диалогов**, затем переписки.

**Медиа:** по умолчанию читает локальный media cache Telegram Desktop (`tdata/user_data/...`), расшифровывает TDEF и подставляет фото/видео в пузыри отчёта вместо текста «Фотография…». Auth key / сессии **не** экспортирует.

**Не делает:** клики, ввод, отправку сообщений, извлечение сессий/паролей/ключей.

## Требования

- Windows 10/11
- Python 3.11+ (проверено на 3.12)
- Запущенный Telegram Desktop

## Установка

```powershell
cd C:\Project\Image_scan\telegram_uia_probe
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -U pip
pip install -r requirements.txt
```

## Запуск (долгий режим по умолчанию)

```powershell
cd C:\Project\Image_scan\telegram_uia_probe
.\.venv\Scripts\Activate.ps1
python main.py
```

1. Откройте Telegram и сделайте его активным.
2. Открывайте чаты / переключайтесь — новые диалоги снимаются один раз, дальше только новые сообщения.
3. Можно уводить фокус с Telegram — запись останавливается, state сохраняется.
4. `Ctrl+C` → отчёт `output\report.html`.

Сбросить накопленное и начать заново (архив в `output/archive/`):

```powershell
python main.py --fresh
```

Пересобрать HTML без нового прогона:

```powershell
python main.py --rebuild-report
```

### Параметры

| Флаг | Смысл | По умолчанию |
|------|--------|--------------|
| `--output` | Каталог результатов | `./output` |
| `--poll` | Проверка активного окна (сек) | `0.5` |
| `--inspect` | Чтение HistoryInner при активном Telegram (сек) | `1.5` |
| `--fresh` | Архивировать state/events/chats и начать чисто | off |
| `--no-media-cache` | Не читать media cache Telegram | off |
| `--media-passcode` | Локальный passcode Telegram (или `TELEGRAM_LOCAL_PASSCODE`) | пусто |
| `-v` | Подробный лог | off |

## Результаты

```text
output/
  state.json            # индекс диалогов + known message keys
  chats/<id>.jsonl      # сообщения чата (по строке, без дублей)
  events.jsonl          # компактно: activated/deactivated/chat_opened/messages_delta
  report.html           # список диалогов + переписки + активность
  screenshots/          # PNG окна Telegram (редко)
  media/                # расшифрованные фото/видео из tdata cache + index.json
  ui_trees/             # только если HistoryInner пуст / диагностика
  archive/              # прошлые прогоны после --fresh
```

Привязать медиа к уже сохранённым чатам и пересобрать отчёт:

```powershell
python main.py --rebuild-report
```

## Ограничения

UIA видит только **видимое** окно истории. «Полная история» = то, что Telegram отдал в списке «Сообщения» в момент первого открытия чата (обычно последние N), не архив за годы. Новые сообщения дописываются **только с хвоста** HistoryInner (прокрутка вверх и чужой чат при переключении игнорируются).

Если отчёт уже «замусорен» старыми прогонами — лучше чистый старт:

```powershell
python main.py --fresh
```

## Модули

| Файл | Назначение |
|------|------------|
| `main.py` | Точка входа |
| `telegram_probe/watcher.py` | Долгий цикл, idle без UIA |
| `telegram_probe/chat_state.py` | state.json + chats/*.jsonl + diff |
| `telegram_probe/history_reader.py` | HistoryInner порядок сообщений |
| `telegram_probe/report.py` | HTML: индекс диалогов |
| `telegram_probe/process_watch.py` | Активное окно / Telegram.exe |

## Безопасность

Только для локального исследования UI на своей машине. Не используйте для скрытого наблюдения без разрешения.
