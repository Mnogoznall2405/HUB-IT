# Сводка агента D (state/cache/async) — восстановлена из журнала сессии

Оригинал `evidence/agent-D-state-report.md` утерян при инциденте. Восстановлено из
ответа субагента; позиции включены в ISSUES.md (FE-0046..0051).

## Находки

| № | Категория | Серьёзность | Статус | Суть |
|---|---|---|---|---|
| D-1 → FE-0046 | Отмена запросов/race | Средняя | Confirmed | ItObjectDetail.jsx:60 — сводка «Пароли» теряет AbortSignal; passwordsAPI.getEntries (api/passwords.js:6-9) не поддерживает signal: не отменяется при смене :objectRef/unmount, дублируется при remount |
| D-2 → FE-0047 | Auth/401 | Низкая | Confirmed (код), влияние Suspected | api/http.js:61-64, 281-283 — «эпоха отказа auth» сбрасывается только после /auth/login и /auth/verify-2fa*; passkey (/auth/passkey-login/verify) и trusted-device (/auth/trusted-devices/auth/verify) её не сбрасывают; окно ≤12 мин без автологина |
| D-3 → FE-0048 | Кэш | Низкая | Confirmed | lib/swrCache.js:114-117 — force-чтение присоединяется к уже идущему обычному запросу того же ключа: «Обновить» не гарантирует новый fetch |
| D-4 → FE-0051 | Кэш/гонка read-write | Низкая | Suspected | Инвалидация отсоединяет кэш, но await-нувший вызывающий всё равно применит дофетченный ответ; потребители getCachedGet без перепроверки после await |
| D-5 → FE-0050 | Дублирование (dev-only) | Низкая | Suspected | ChatOpen.jsx:56 — в StrictMode dev createDirectConversation вызывается дважды (lookup закэширован, create — нет) |
| D-6 → FE-0049 | setState после unmount | Низкая | Confirmed | Computers.jsx:950-960 — loadChangesDeferred без abort/cancelled |
| D-7 | Нагрузка (инфо) | — | Confirmed | Monitoring.jsx:151-156 — polling overview+detail каждые 10 с при видимой вкладке; гонок нет, осознанный дизайн |

## Проверено и защищено (главное, по словам агента)
- Все перечисленные детальные страницы сбрасывают состояние при смене route-параметра
  и защищены abort+seq/identity-checks.
- Чат: keyed in-flight, seq-токены, дедуп доставки (alreadyRendered, preview-map),
  порядок по seq, reconnect-backoff + heartbeat + очередь ≤100 (backpressure),
  degraded-poll с Retry-After.
- swrCache: dedupe + отсоединение in-flight при инвалидации.
- AuthContext: refresh-гейт, generation-токены, восстановление из фоновой вкладки,
  общий dedup refresh с 401-интерцептором.
- Debounce есть у всех серверных поисков; черновики чата не теряются при переключении
  бесед (порядок эффектов проверен по ChatPageContent.jsx:294/1132/1144);
  пустых catch {} нет; «вечных loading» не найдено.

## Не проверено (по словам агента)
Live-поведение WS и влияние D-2 (нужен живой прогон); серверный TTL access-токена
(константа 15 мин во фронтенде не сверена с backend); страницы вне перечня
(Mail, Networks, Database, tasks/, mail/, scan-center/, voice-video/ и др.);
StrictMode-дублирование в dev запусками.
