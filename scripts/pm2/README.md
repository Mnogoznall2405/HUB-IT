# PM2 Runbook

Frontend остаётся на `IIS` и не переводится под `pm2 serve`.

PM2 используется только для Python-процессов:

- `scripts/pm2/ecosystem.backend.config.js`
- `scripts/pm2/ecosystem.scan.config.js`
- `scripts/pm2/ecosystem.bot.config.js`
- `scripts/pm2/ecosystem.all.config.js`
- `scripts/pm2/start-all.ps1`
- `scripts/pm2/restart-all.ps1`
- `scripts/pm2/stop-all.ps1`
- `scripts/pm2/health-check.ps1`

Если все 3 процесса запущены на одной машине, можно стартовать их одной командой:

```powershell
pm2 start scripts\pm2\ecosystem.all.config.js
pm2 logs --lines 100
```

Более безопасный локальный вариант, который сначала удаляет старые процессы и потом поднимает все заново:

```powershell
powershell -File scripts\pm2\start-all.ps1
```

Пакетный перезапуск:

```powershell
powershell -File scripts\pm2\restart-all.ps1
```

Пакетная остановка:

```powershell
powershell -File scripts\pm2\stop-all.ps1
```

Быстрая проверка процессов и health endpoint:

```powershell
powershell -File scripts\pm2\health-check.ps1
```

Если backend, scan и bot разнесены по разным хостам, одной командой с одного PM2-инстанса их не поднять.
В этом случае на каждом хосте запускается только свой локальный ecosystem-файл.

Основные команды:

```powershell
pm2 start scripts\pm2\ecosystem.backend.config.js --only itinvent-backend
pm2 restart itinvent-backend
pm2 logs itinvent-backend --lines 100
```

```powershell
pm2 start scripts\pm2\ecosystem.scan.config.js --only itinvent-scan
pm2 restart itinvent-scan
pm2 logs itinvent-scan --lines 100
```

```powershell
pm2 start scripts\pm2\ecosystem.bot.config.js --only itinvent-bot
pm2 restart itinvent-bot
pm2 logs itinvent-bot --lines 100
```

Для `VITE_*` переменных:

```powershell
cd WEB-itinvent\frontend
npm run build
```

Важно:

- не держите одновременно `PM2` и `NSSM/Windows Service` для одного и того же процесса;
- если менялись только backend/runtime-переменные, frontend пересобирать не нужно;
- если менялись только `VITE_*`, Python-процессы перезапускать не нужно.
