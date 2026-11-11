# Снимки интерфейса для `/about`

Сценарий создаёт в текущем HUB четыре временные учётные записи `viewer`, тестовый чат,
задачу и три безопасных файла. Все идентификаторы записываются в manifest внутри
`.codex_tmp/about-capture/`; этот каталог игнорируется Git.

Команды намеренно требуют `--confirm-current-hub`: их нельзя запускать против HUB
случайно. Пароли, TOTP, cookies и browser state не передаются через аргументы командной
строки и не должны копироваться в репозиторий.

```powershell
# 1. Создать четыре временные viewer-учётки
python scripts\marketing\about_capture_accounts.py --confirm-current-hub prepare

# 2. Взять путь к созданному manifest и подготовить данные
python scripts\marketing\about_capture_dataset.py `
  --manifest .codex_tmp\about-capture\<batch>\manifest.json `
  --confirm-current-hub prepare

# 3. Экспортировать локальный browser state для Playwright
python scripts\marketing\about_capture_dataset.py `
  --manifest .codex_tmp\about-capture\<batch>\manifest.json `
  --confirm-current-hub export-browser-state
```

Для кадров используются Chrome, тёмная тема и mock-ответы из `playwright/` только там,
где нельзя читать настоящие корпоративные данные: почта, адресная книга и локальный
viewer-сценарий. Desktop снимается при viewport 1440×900 / DPR 2, mobile —
390×844 / DPR 3. PNG сохраняются без фильтров, наклона и искусственного размытия.

После съёмки сначала удаляются ресурсы, затем пользователи:

```powershell
python scripts\marketing\about_capture_dataset.py `
  --manifest .codex_tmp\about-capture\<batch>\manifest.json `
  --confirm-current-hub cleanup

python scripts\marketing\about_capture_accounts.py `
  --confirm-current-hub cleanup-users `
  --manifest .codex_tmp\about-capture\<batch>\manifest.json
```

Очистка удаляет только объекты с точными ID из manifest. Учётки дополнительно должны
иметь префикс `marketing_demo_`.
