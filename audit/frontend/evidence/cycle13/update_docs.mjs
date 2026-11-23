import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../');
const progress = `
## Цикл 13 — глубокая runtime-верификация (2026-11-23)

- База: audit-коммит a7174909 (322 записи), проверка кода на HEAD 8462d971 + рабочее дерево.
- Изолированный стенд: e2e/stack/local_backend.py (SQLite .state-cycle13, 18002) + vite 5219;
  trial-сборка вне dist + vite preview 5221. Production/IIS/PM2/.env не затрагивались.
- Качество реестра: заполнены все 23 записи без lines (0 пустых), исправлены 4 wrong-evidence,
  для всех 323 записей добавлены originalClaim/originalEvidence/currentConclusion/reverificationHistory
  и statusModel с объяснением 290 confirmed-вердиктов vs 254 Confirmed-статусов.
- Live High: FE-0197 и FE-0198 подтверждены в браузере (после verify URL сразу /dashboard,
  backup-коды и trusted-device sheet не появляются); FE-0083 подтверждён API-пробой
  [401,200,200] -> /auth/me 401; FE-0078 прошёл E2E chat-realtime 3/3 и переведён в Fixed-externally.
- FE-0230: попытка live-симуляции позднего desktop.hostReady не дала React-ошибки; статус Confirmed (static).
- 50 Suspected перепроверены 6 независимыми агентами: подтверждено 24, опровергнуто 23,
  unverifiable 9, fixed-externally 1 (без учёта live-ручных High).
- Новый дефект FE-0325 (Medium, Confirmed): offline cold reload PWA висит на «Загружаем раздел…»
  >65 c; AuthContext бесконечно ретраит refresh при status=0, SW отдаёт shell 200.
- Глубокие тесты: 12 раундов x 8 маршрутов с принудительным GC — heap плато 49-51 MB,
  монотонного роста нет (FE-0253 остаётся unverifiable); SW регистрируется/контролирует,
  offline shell 200, но auth recovery не завершается.
- Итог: 323 записи; Confirmed 269, Suspected 12, Fixed-externally 2, Rejected 40;
  High 12, Medium 123, Low 173, Info 15. Валидатор: 0 ошибок.
- Подробный отчёт: CYCLE_13_REVIEW.md; evidence/cycle13/.
`;
fs.appendFileSync(`${DIR}/AUDIT_PROGRESS.md`, progress, 'utf8');

const next = `
## Цикл 13 — итог и очередь (2026-11-23)

- 323 записи: Confirmed 269, Suspected 12, Fixed-externally 2, Rejected 40.
- Новый дефект: FE-0325 (PWA offline cold reload >65 c).
- FE-0078 закрыт live E2E; FE-0197/0198/0083 подтверждены live.
- Оставшиеся Suspected: FE-0004, FE-0051, FE-0076, FE-0110, FE-0115,
  FE-0161, FE-0194, FE-0253, FE-0265, FE-0300, FE-0323, FE-0324.

### Приоритет следующего цикла
1. FE-0325: исправить offline recovery (status=0, navigator.onLine, таймаут) и
   добавить E2E offline cold reload; проверить PWA/Desktop.
2. FE-0110/FE-0112/FE-0113/FE-0119: реальный ONLYOFFICE Document Server.
3. FE-0215/FE-0216: реальный mailbox + inline-изображения (autosave/restore).
4. FE-0230: реальный WebView2 с поздним bridgeReady.
5. FE-0098/FE-0161/FE-0300/FE-0324: искусственные большие объёмы на стенде.
6. FE-0259/FE-0260/FE-0261: 1C/SQL-данные construction.
7. 429/500 UI и полный multi-tab UI-сценарий refresh.
`;
fs.appendFileSync(`${DIR}/NEXT_ACTIONS.md`, next, 'utf8');
console.log('progress/next updated');
