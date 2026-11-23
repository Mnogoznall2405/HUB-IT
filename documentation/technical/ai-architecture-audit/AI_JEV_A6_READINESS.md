# AI JEV — A6: Production Configuration Audit + Staging Benchmark

Дата: 2026-11-23. Main: `8c31457c` (после merge PR #21+#22). Режим: read-only для production — деплой/рестарт/ENV не трогались.

## 1. Фактическая конфигурация запуска

| Компонент | Как запускается | Источник env |
|---|---|---|
| FastAPI backend | PM2 `itinvent-backend` → `start_server.py`, cwd `C:\Project\Image_scan\WEB-itinvent`, interpreter `HUB-IT-main\.venv\pythonw.exe` | `C:\Project\Image_scan\.env` |
| AI chat worker | PM2 `itinvent-ai-chat-worker` → `start_ai_chat_worker.py`, тот же cwd/venv | тот же `.env` |
| Chat-ноды a/b + ~20 прочих воркеров | PM2, тот же venv | тот же `.env` |
| Фронт/proxy | IIS `Default Web Site`, `https://hubit.zsgp.ru` (DefaultAppPool) — фронтенд/прокси, env backend не задаёт | — |
| Автозапуск | Scheduled tasks: `HUB-IT PM2 Manual Recovery` (launch-runtime.ps1), `HUB-IT PM2 Log Rotate`, `HUB-IT Backend Pool Apply` | — |

**Загрузка env** (`WEB-itinvent/backend/config.py`): единственный источник — `PROJECT_ROOT/.env` = `C:\Project\Image_scan\.env` (`load_dotenv`, `override=False`). Legacy `WEB-itinvent/.env`, `backend/.env`, `backend/api/.env` отсутствуют и игнорируются с warning. **Процессное окружение имеет приоритет над .env** — в PM2 `dump.pm2` переменных `AI_JEV_*` нет ⇒ эффективные значения берутся из `.env`.

**Эффективные значения у работающих процессов** (из `.env`): `AI_JEV_ROUTING=1`, `MODE=group`, `THRESHOLD=0.5`, `TIMEOUT_SEC=3`. `JEV_API_KEY` не задан, но `jev_client` использует `OPENROUTER_API_KEY` (задан) — JEV сконфигурирован.

**Развёрнутый код**: `C:\Project\Image_scan` = `origin/feat/my-files-compact-ux` @ `26cfd4ef`, merge-коммиты A5/A5.1 **не являются предками** — в prod работает **старая** версия JEV group-routing (без intent-mode, серверных потолков `execute_bounded`, fail-closed `_TOOL_READ_TOOLS`, `ai_run_profile` телеметрии).

**Ключевая находка — JEV уже включён**: логи `~/.pm2/logs/itinvent-ai-chat-worker-error.log` содержат живые записи `ai_jev_routing probs=… routed=…` и `ai_jev_routing_cache miss` — group-routing активен в production прямо сейчас на старом коде.

**Риск «автоактивации»**: деплой main **не включает** JEV заново — он уже включён; деплой заменит старую маршрутизацию на новую (intent-mode + потолки + fail-closed + телеметрия) при том же `AI_JEV_ROUTING=1`. Отдельного действия «включить флаг» не требуется — требуется осознанный деплой с мониторингом.

## 2. Готовность телеметрии (main `8c31457c`)

| Стадия | Источник | Статус |
|---|---|---|
| queue wait | `ai_chat.run.queue_wait` (enqueue→claim, run_id) | ✅ |
| JEV routing + latency + model + run_id | `ai_jev_routing` | ✅ |
| JEV cache hit/miss + run_id | `ai_jev_routing_cache` | ✅ |
| context / memory | `ai_chat.run.context`, `…memory` | ✅ |
| LLM first / follow-up×N / budget_final / forced_final | `ai_chat.run.llm_*` | ✅ |
| инструменты per round (+ count) | `ai_chat.run.tools` | ✅ |
| execute / send_answer / events | `ai_chat.run.execute|send_answer|result_events_enqueued` | ✅ |
| server total (queue+processing, НЕ TTFT) + outcome + intent + tool counts + tokens | `ai_run_profile_final` | ✅ |
| `used_tools`/`error_tools`/`mode_denied`/`meta_calls` | final profile → экспортёр | ✅ |
| p50/p95 по стадиям, режимам, cache, outcome | `ai_run_profile_export.py` | ✅ (CLI-проверен на синтетике, списки с пробелами разбираются, повреждённые строки → `parse_errors`) |

**Чего не хватает для клиентского TTFT/e2e**: времени отправки→первого видимого ответа в браузере/десктопе, доставки по WebSocket, сетевого RTT — серверная телеметрия заканчивается на `send_answer`. Клиентские метрики отсутствуют — отдельная задача.

## 3. Benchmark — реальный JEV (staging-подобный, read-only)

Провайдер OpenRouter System One доступен; замеры выполнены вызовом **реальной** функции `_route_tool_groups_jev` из main-кода с прод-ключом, на **109 синтетических** русских запросах (без prod-данных). Харнес: `experiments/jev_routing_benchmark.py`.

| Метрика | Значение |
|---|---|
| Запросов | 109 |
| Точность intent_mode (vs разметка) | **101/109 (92.7%)** |
| Пропуск обязательной группы | 5 (в т.ч. cross-group частичные) |
| Запрещённые группы на chat/инъекциях | **0** |
| Ошибок/crash | 0 |
| Cold latency (104 API-вызова) | **p50 = 364 мс, p95 = 488 мс**, max 1211 мс |
| Warm (cache hit) | ~0 мс (15 повторов) |
| Smalltalk bypass | работает (5 запросов = 0 мс, intent=chat без вызова) |
| JEV-недоступность (форсированная) | deterministic fallback `['itinvent','other']`, `intent=None` — **не ложный CHAT**, recovery сохранён, ~2.2 c на refused-connect |

Для сравнения, старый код в prod-логах того же дня: 4 сэмпла, mean ≈ 1.15 c (малая выборка, другая нагрузка).

**Разбор промахов** (8 mode-mismatch):
- 3× read→act на «сделай отчёт в Excel / выгрузи CSV / сводка по парку» — формально промах, **фактически корректно**: генерация артефакта требует ACT-потолка (READ стрипает artifacts). Разметка занижала: «файл = act» — оправданное поведение.
- 1× chat→act «Сочини поздравление» — overroute в ACT, смягчается тем, что ни одна группа не маршрутизирована и мутации всё равно требуют draft-подтверждения.
- 3× → `none` (undecided) на пограничных — безопасный исход (recovery через `ai.request_tool_group`).
- 1× read→act «Проверь доступность порта» — overroute.

**Полный e2e CHAT/READ/ACT с реальным LLM**: **NOT MEASURED** — нет изолированного staging-стенда с БД; прогон по prod-стенду запрещён read-only режимом. Измерена реальная стадия маршрутизации + fallback.

## 4. Качество JEV — выводы

- Модель `typesafe/jev-1.13` уверенно классифицирует 11 групп + mode за один `decide()` (1 сетевой вызов, ~360 мс p50).
- Таймаут/отказ → детерминированный fallback, никогда не «все инструменты» и не ложный CHAT.
- Конфликты `chat+core`, `chat+routed` → READ (unit-доказано).
- Направление ошибок — в основном **overroute в ACT** на словах-действиях («сделай/проверь/выгрузи»): это безопасное направление (ACT всё равно требует draft для мутаций), но шире потолок.

## 5. Рекомендации по порогам

- `AI_JEV_ROUTING_THRESHOLD=0.5` — оставить для старта пилота: ошибок под-роутинга мало, recovery покрывает `none`.
- Рассмотреть в пилоте раздельный порог для `m_mode_act` (0.6–0.65): сейчас `act_prob ≥ 0.5` обгоняет chat/read на нейтральных формулировках. Не ниже 0.5 для act — иначе файлогенерация рискует попасть в READ и потерять artifacts.
- Мониторить `probs_mode` + `mode_denied_calls` + долю `intent=None` в `ai_run_profile_final` и пересмотреть порог по первым ~500 реальных прогонов.

## 6. Блокеры и риски

| Риск | Оценка |
|---|---|
| Деплой main подтянет новую маршрутизацию при уже включённом флаге | Средний: поведение строго защитнее, но меняется (режимные потолки режут спеки) — нужен мониторинг `mode_denied`/`outcome` |
| Полный pipeline с реальным LLM не измерен | Средний: рекомендуем staging-прогон e2e до широкого пилота |
| Точность JEV 92.7% на 109 синтетике | Низкий-средний: промахи преимущественно fail-safe направления |
| Pre-existing `test_claude_transport` FAIL | Низкий: тестовый стенд, не runtime |
| Схема appdb локально отстаёт (0174<0176) | Локальная dev-среда, к prod-БД отношения не подтверждено |

## 7. Решение

**GO для ограниченного пилота** — с оговорками:

1. JEV **уже включён** в prod на старом коде; деплой `8c31457c` — апгрейд защищённости, не новая активация. Перед деплоем подтвердить, что prod `.env` (`C:\Project\Image_scan\.env`) содержит `AI_JEV_ROUTING=1` осознанно (или выставить `0`, если пилот должен начаться с выключенного флага).
2. После деплоя: дашборд по `ai_run_profile_final` (intent distribution, `mode_denied`, `server_total_ms`, tokens) + экспортёр по серии запусков; alarm при доле `intent=None` >15% или `mode_denied` всплеске.
3. Через ~500 прогонов — пересмотр `THRESHOLD` (кандидат: act=0.6).
4. До широкого включения: staging e2e с реальным LLM на копии схемы + клиентская метрика TTFT.
