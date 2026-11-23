import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../');
const progress = `
## Цикл 14 — runtime-покрытие и критические сценарии (2026-11-23)

- База d2fe61a7; код HEAD 5513db68. Изолированные стенды 18002/5219, 18004/5222 (2FA),
  trial-сборка + прокси 5223. Production не затрагивался.
- Схема verification v2: static-code / local-browser / local-browser-mock / local-api /
  test-harness / production-observer; старые значения в verificationLegacy.
- FE-0253 переведён в Rejected: 12 раундов с принудительным GC дали плато 49–51 MB
  и 23 MB после полного GC; утечки нет.
- FE-0194/FE-0300/FE-0324 остаются Suspected с statusRationale: статический механизм
  подтверждён, но пользовательский эффект требует недоступных данных/сценария.
- Real 2FA flow: FE-0197 и FE-0198 подтверждены без route-mocking (setup -> TOTP ->
  dashboard; backup-коды и remember-device не появляются).
- FE-0083: две вкладки, [200,401,200], новый refresh -> 401 revoked, обе вкладки на /login.
- FE-0023: 10k портов на mobile -> ~30.45 c блокировки, 181642 DOM-узла, heap 930 MB.
- FE-0325 уточнён: свежая офлайн-сессия висит >50 c, но только 2 refresh-попытки;
  reconnect возвращает /login за ~2 c; с сохранённой сессией показывается cached dashboard.
- Функциональные сценарии: +12 маршрутов (всего 24/36 = 66.7%); back и mobile overflow проверены.
- Итог: 323 записи; Confirmed 269, Suspected 11, Fixed-externally 2, Rejected 41.
  Валидатор: 0 ошибок. Отчёт: CYCLE_14_REVIEW.md.
`;
fs.appendFileSync(`${DIR}/AUDIT_PROGRESS.md`, progress, 'utf8');

const next = `
## Цикл 14 — очередь (2026-11-23)

- Осталось Suspected 11: FE-0004, FE-0051, FE-0076, FE-0110, FE-0115,
  FE-0161, FE-0194, FE-0265, FE-0300, FE-0323, FE-0324.

### Блокировано средой
1. FE-0215 — реальный mailbox/IMAP + inline-изображения.
2. FE-0230 — реальный WebView2 с поздним bridgeReady.
3. FE-0232/FE-0239 — подготовленные users/departments fixtures и разрешённые мутации.
4. FE-0259 — настроенный construction object/direction + 1C/SQL.
5. FE-0022 — Warehouse1C balances/movements из 1C/SQL.
6. FE-0161/FE-0300/FE-0324 — production-объёмы данных.

### Приоритет
- Закрыть FE-0215 и FE-0259 на стенде с mail/1C-моками.
- Довести функциональные сценарии до 30+/36 маршрутов.
- Повторить PWA-тест на устаревшем app-shell и с истёкшей сессией.
`;
fs.appendFileSync(`${DIR}/NEXT_ACTIONS.md`, next, 'utf8');
console.log('docs updated');
