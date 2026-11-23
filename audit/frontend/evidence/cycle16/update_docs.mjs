import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../');

const progress = `
## Цикл 16 — реальное покрытие и глубокие E2E (2026-11-23)

- База 60dfe457; проверенный код — чистый main 4776ce5f (PR #14), собран с
  локальными VITE_*-флагами из root .env (не публикуется).
- Инвентаризация из App.jsx: 51 route entry, 5 redirect, 46 user-visible,
  12 admin sections, 6 settings tabs.
- Реальное покрытие: E2E 6 (13.0%), Functional 26, Functional+E2E 32/46 (69.6%),
  Smoke-only 7, Blocked 7. «36 сценариев» = 32 route entry, не 100%.
- Новые полные E2E (5): feed publish, tasks create+edit+checklist, chat notes
  send+cross-tab+reload, my-files upload+search+preview, admin user create.
  Всего E2E-сценариев 8.
- FE-0083 подтверждён: 3 parallel refresh -> [200,200,401]; токены победителей
  после burst -> 401, family отозвана; sequential within grace -> [200,200].
- FE-0059 уточнён: старый токен после grace -> 401 revoked, но НОВЫЙ токен той же
  ротации остаётся 200; family не отозвана, причина logout — потеря ответа.
- Blocked: FE-0215 (нет mailbox), FE-0230 (нет WebView2), FE-0232/0239 (нет
  fixtures), FE-0259 (Construction 502), /database и /my-files/edit.
- Итог: 323 записи, Confirmed 269, Suspected 11, Fixed 2, Rejected 41.
  Валидатор 0 ошибок. Отчёт CYCLE_16_REVIEW.md.
`;
fs.appendFileSync(`${DIR}/AUDIT_PROGRESS.md`, progress, 'utf8');

const next = `
## Цикл 16 — очередь (2026-11-23)

- FE-0215: локальный IMAP/SMTP fixture + MAIL_MODULE_ENABLED=1, autosave и
  inline-вложения на реальном backend.
- FE-0230: Windows Desktop/WebView2 host, поздний desktop.hostReady.
- FE-0232/FE-0239: синтетические пользователи/отделы/делегаты, разрешённые
  мутации в одноразовой БД.
- FE-0259: Construction object/direction + 1С-креды, F5/close/unmount.
- E2E-создание записей: /tickets, /vcs, /passwords, /docflow (сейчас диалоги).
- Public shares: реальные токены, скачивание, expiry/отзыв.
- PWA: активация waiting-worker, offline с истёкшей сессией (FE-0325/0084/0085).
- 11 Suspected: FE-0004, FE-0051, FE-0076, FE-0110, FE-0115, FE-0161,
  FE-0194, FE-0265, FE-0300, FE-0323, FE-0324.
`;
fs.appendFileSync(`${DIR}/NEXT_ACTIONS.md`, next, 'utf8');
console.log('docs updated');
