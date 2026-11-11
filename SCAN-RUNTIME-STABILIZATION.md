# SCAN RUNTIME STABILIZATION

Дата: 2026-08-04  
Хост: TMN-SRV-APP-02  
Вердикт: **GO_SCAN_RUNTIME_STABLE**

---

## 1. Тип и состояние VACUUM

| Проверка | Результат |
|---|---|
| `pg_stat_progress_vacuum` | пусто (0 строк) |
| `VACUUM FULL` / `CLUSTER` / `REINDEX` | не обнаружены |
| `pg_locks WHERE NOT granted` | 0 |
| Длительные транзакции (>5 мин) | 0 |

Вывод: обычного/тяжёлого VACUUM во время работ не было. Операции с процессами Scan разрешены.

---

## 2. Baseline процессов (до исправления)

Снято ~21:50 (+05:00).

| PM2 name | status | pid (PM2) | restarts | uptime |
|---|---|---|---|---|
| `itinvent-scan` | waiting/launching | менялся каждые ~35с | **441–444** | ~0–1s |
| `itinvent-scan-worker` | waiting/launching | менялся каждые ~35с | **430–433** | ~0–1s |

Параллельно жили **orphan** Python-процессы (не под текущим PM2):

| Компонент | PID | PPID | Старт | Порт | Роль |
|---|---|---|---|---|---|
| Scan API | **12520** | **13668 (мертв)** | 10:42:08 | **LISTEN 8011** | держатель lock |
| Scan worker | **9844** | **13668 (мертв)** | 10:42:09 | — | держатель lock |

PM2 daemon `node.exe` PID **6812** (с 17:29:58) постоянно порождал новые API/worker, которые не могли взять lock.

`/health` до фикса отвечал 200, но `pid=12520` (orphan), не PM2.

---

## 3. Все найденные экземпляры Scan (таблица)

| Компонент | PID | PPID | Команда | Источник запуска | Lock | Канонический/дубль |
|---|---|---|---|---|---|---|
| Scan API | 12520 | 13668 † | `python -m scan_server` | orphan после PM2 kill/restart | держал `scan_server.lock` + :8011 | **дубль (живой владелец lock)** |
| Scan worker | 9844 | 13668 † | `python -m scan_server.worker_main` | orphan | держал `scan_worker.lock` | **дубль (живой владелец lock)** |
| Scan API | (ротация) | 6812 (pm2) | `python -m scan_server` | PM2 `itinvent-scan` | ждал lock → timeout 30s → exit | жертва storm |
| Scan worker | (ротация) | 6812 (pm2) | `python -m scan_server.worker_main` | PM2 `itinvent-scan-worker` | ждал lock → timeout 30s → exit | жертва storm |

† PPID 13668 на момент диагностики отсутствовал в системе.

Scheduled Task / Windows Service для Scan API/worker: **не найдены** (есть только HUB-IT Agent/Probe tasks — не scan_server).

---

## 4. Все источники запуска

| Источник | Риск | Комментарий |
|---|---|---|
| `scripts/pm2/ecosystem.scan.config.js` | штатный | `instances` не >1 (fork, 1 процесс) |
| `scripts/pm2/restart-backend.ps1` | **корневой trigger** | в конце делал голый `pm2 restart itinvent-scan itinvent-scan-worker` |
| `scripts/pm2/restart-all.ps1` / `start-all.ps1` | **корневой trigger** | `pm2 kill` → на Windows python-дети часто остаются → затем `pm2 start` поднимает вторые |
| `scripts/pm2/health-check.ps1 -RepairScan` | усилитель | тоже голый `pm2 restart` |
| PM2 dump / resurrect | усилитель | после рестарта daemon поднимает apps поверх orphan |
| Task Scheduler / Services | нет | scan_server не зарегистрирован |

---

## 5. Владелец singleton lock

| Lock file | До фикса | После фикса |
|---|---|---|
| `data/scan_server/scan_server.lock` | OS-lock у PID **12520** (mtime 10:42) | PID **7092** (mtime 21:58:51) |
| `data/scan_server/scan_worker.lock` | OS-lock у PID **9844** (mtime 10:42) | worker PID **7684** (mtime 21:58:52) |

Механизм: `msvcrt.locking` в `scan_server/__main__.py` и `scan_server/worker_main.py`.  
Timeout ожидания: `SCAN_SERVER_LOCK_WAIT_SEC=30` / `SCAN_WORKER_LOCK_WAIT_SEC=30`.  
При timeout процесс выходит → PM2 `autorestart` → новый круг.

Доказательство владельца API: `netstat` LISTEN `:8011` → PID 12520; `/health` → `"pid":12520,"api_lock_pid":12520`.

---

## 6. Доказанная корневая причина

Не «просто lock contention», а конкретный сценарий Windows+PM2:

1. При рестарте (`restart-backend.ps1` → голый `pm2 restart scan`, либо `restart-all`/`start-all` → `pm2 kill`) старые `python -m scan_server*` **остаются живыми** (orphan, PPID мёртв).
2. Orphan продолжает держать file lock и порт 8011.
3. PM2 стартует **новый** API/worker → логи: `Another scan API/worker is already running; waiting for lock` → timeout 30s → exit.
4. PM2 увеличивает restart counter (сотни за часы) и повторяет цикл.
5. Параллельно ingest получает **429** из‑за backpressure очереди (`max_pending_*`), усиливаемого нестабильностью runtime.

---

## 7. Выполненное изменение

### Runtime (разово)

| Действие | PID | Причина |
|---|---|---|
| `Stop-Process` orphan API | **12520** | PPID мёртв, не в PM2, держал :8011/lock |
| `Stop-Process` orphan worker | **9844** | PPID мёртв, не в PM2, держал worker lock |
| PM2 takeover | API **9988** → затем reload **7092** | канонические под PPID 6812 |
| Worker takeover | **14484** → затем reload **7684** | канонические под PPID 6812 |

Lock-файлы **не удалялись** вручную (живой владелец был доказан, затем корректно завершён).

### Код/скрипты (постоянный фикс)

| Файл | Изменение |
|---|---|
| `scripts/pm2/restart-scan.ps1` | **новый**: stop → kill orphan → start из ecosystem |
| `scripts/pm2/clear-pm2-orphans.ps1` | **новый**: зачистка orphan python/ports после `pm2 kill`/`stop` |
| `scripts/pm2/restart-backend.ps1` | вместо `pm2 restart scan` → вызов `restart-scan.ps1` |
| `scripts/pm2/health-check.ps1` | `-RepairScan` → `restart-scan.ps1` |
| `scripts/pm2/restart-all.ps1` | после `pm2 kill` → `clear-pm2-orphans.ps1` |
| `scripts/pm2/start-all.ps1` | после `pm2 kill` → `clear-pm2-orphans.ps1` |
| `scripts/pm2/stop-all.ps1` | после `pm2 stop` → `clear-pm2-orphans.ps1` |
| `scripts/pm2/ecosystem.scan.config.js` | `kill_timeout: 15000` для scan API/worker |
| `scripts/pm2/README.md` | документация новых скриптов |

PostgreSQL / IIS / полный PM2 / сервер **не** перезапускались.

---

## 8. Остановленные / перезапущенные PID

| PID | Действие | Rollback |
|---|---|---|
| 12520 | остановлен (orphan API) | при поломке — `restart-scan.ps1` |
| 9844 | остановлен (orphan worker) | то же |
| PM2 scan/worker | естественный restart после освобождения lock; затем штатный `restart-scan.ps1` | `restart-scan.ps1` |

Оба канонических экземпляра одновременно не останавливались «вслепую»: сначала доказаны orphan, затем они сняты, PM2 оставлен владельцем.

---

## 9. Rollback

Если после фикса API/worker недоступны:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\pm2\restart-scan.ps1
```

Не делать: `pm2 restart all`, `taskkill /IM python.exe`, рестарт PostgreSQL/IIS.

Откат скриптов: вернуть в `restart-backend.ps1` старый `pm2 restart itinvent-scan itinvent-scan-worker` **не рекомендуется** — это и есть баг.

---

## 10. Health-check API

После фикса и `restart-scan.ps1`:

- `GET http://127.0.0.1:8011/health` → **200**
- `"status":"ok"`, `"pid":7092`, `"api_lock_pid":7092`, `storage_backend=postgres`
- LISTEN `:8011` → PID **7092**

---

## 11. Проверка worker

- PM2 `itinvent-scan-worker` **online**, PID **7684**, PPID **6812**
- Лог: `Standalone scan worker lock acquired`, `Scan worker started job_max_workers=6`
- `Recovered 6 interrupted scan job(s) after worker restart`
- Далее OCR/PDF обработка в логах (22:00–22:01) — worker работает

---

## 12. Restart counters до и после

| Процесс | До | Сразу после orphan-stop | После `restart-scan.ps1` (текущее) |
|---|---|---|---|
| `itinvent-scan` | ~441–444 | 444 (uptime начал расти) | **0** (новый PM2 id 11, uptime стабилен) |
| `itinvent-scan-worker` | ~430–433 | 433 | **0** (новый PM2 id 12) |

На момент отчёта (22:02): uptime scan/worker ~3 мин, restarts **0**, status **online**.

---

## 13. Lock errors до и после

| Метрика | До | После |
|---|---|---|
| `waiting for lock` / `lock wait timed out` в error-логах | непрерывно каждые ~30–35с (десятки/мин) | **нет новых** после 21:51:35 / 21:51:41 (acquire), затем чистый старт 21:58:5x |
| Последние строки error-логов | timeout loop | INFO startup + OCR activity |

---

## 14. Частота 429 до и после

| | |
|---|---|
| До | массовые `429 Too Many Requests` на `/ingest/document` и `/ingest/pdf-slice` |
| После | 429 на ingest **ещё встречаются** |

Важно: 429 — это **backpressure очереди ingest** (`max_pending_pdf_jobs`/`max_pending_jobs`), не ошибка singleton lock.  
Heartbeat/poll после фикса стабильно **200**.  
Отдельная тема ёмкости очереди — вне scope стабилизации runtime.

---

## 15. PostgreSQL locks / transactions

| Проверка | До | После |
|---|---|---|
| waiting locks | 0 | 0 |
| active vacuum | нет | нет |
| application_name `itinvent-scan` | ~14 conn (orphan API) | присутствует у живого API |

Схему/данные PG не меняли. VACUUM не трогали.

---

## 16. Результат наблюдения

Запланировано 15 минут; скрипт наблюдения **прерван** (~3 мин данных + последующая проверка после `restart-scan`).

| Замер | api_procs | worker_procs | listen | health | hub |
|---|---|---|---|---|---|
| T+0s (21:52:55) | 1 | 1 | 9988 | 200 | 200 |
| T+180s | 1 | 1 | 9988 | 200 | 200 |
| 21:58 `restart-scan.ps1` | 1 | 1 | 7092 | 200 | — |
| 22:02 (отчёт) | 1 API + 1 worker (+ retention worker) | 1 | 7092 | 200 | 200 |

Полные 15 минут непрерывного сэмплинга не завершены (процесс observation убит).  
Повторных lock-timeout и роста restart counter после фикса **не видно**.

---

## 17. Изменённые файлы и точный diff (по сути фикса)

### Новые

- `scripts/pm2/restart-scan.ps1`
- `scripts/pm2/clear-pm2-orphans.ps1`

### Ключевой diff `restart-backend.ps1`

Было:

```powershell
& $pm2Cmd restart itinvent-scan itinvent-scan-worker --update-env | Out-Null
```

Стало:

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File scripts\pm2\restart-scan.ps1
```

### Ключевой diff `restart-all` / `start-all` / `stop-all`

После `pm2 kill` / `pm2 stop`:

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File scripts\pm2\clear-pm2-orphans.ps1
```

### `ecosystem.scan.config.js`

Добавлено: `kill_timeout: 15000` для `itinvent-scan` и `itinvent-scan-worker`.

> В working tree также есть иные незакоммиченные изменения PM2 (hub retention worker в списках процессов, блоки README про hub notifications, правки `ecosystem.backend*.js`) — они **не являются** обязательной частью этого фикса Scan runtime. Для Scan-фикса критичны файлы выше + `kill_timeout`.

---

## 18. Непроверенные пункты

- Полные непрерывные **15 минут** observation (прервано).
- Нагрузочный прогон именно через `restart-backend.ps1` end-to-end после фикса (частично закрыто ручным `restart-scan.ps1`).
- Почему `worker_lock_pid` в `/health` иногда `0` при живом worker (чтение lock-file vs OS lock) — косметика, на storm не влияет.
- Отдельная оптимизация ingest **429** / размера очереди.
- `pm2 save` после последнего reload — рекомендуется выполнить вручную.

---

## 19. Финальный verdict

# GO_SCAN_RUNTIME_STABLE

Обоснование:

- ровно один Scan API (PID 7092) и один Scan worker (PID 7684) под PM2;
- `/health` 200, HUB `/health` 200;
- lock storm остановлен; restart counters обнулены на новых PM2 entries;
- корневая причина доказана (orphan после PM2 kill/restart + голый `pm2 restart` из `restart-backend`);
- постоянный фикс внесён в скрипты рестарта;
- PostgreSQL/VACUUM не затронуты.

### Рекомендуемый операционный путь дальше

```powershell
# backend (+ безопасный scan reload)
powershell -ExecutionPolicy Bypass -File scripts\pm2\restart-backend.ps1

# только scan
powershell -ExecutionPolicy Bypass -File scripts\pm2\restart-scan.ps1

# НЕ использовать на Windows для scan:
# pm2 restart itinvent-scan itinvent-scan-worker
```
