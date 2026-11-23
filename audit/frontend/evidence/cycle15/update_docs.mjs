import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../');
const progress = `
## Цикл 15 — оставшиеся High и функциональная глубина (2026-11-23)

- База eb83a0c0; проверенный build 5513db68, текущий main 467512e5 (изменён только MyFiles).
- verification нормализован: 304 static -> static-code; enum валидатора строгий;
  старые значения в verificationLegacy. FE-0253: Rejected только для проверенного
  сценария, отсутствие утечек в целом не доказано.
- High breakdown: исторические 12, актуальные 11, runtime 7, static-only 5.
- FE-0022 подтверждён на мокированной таблице: clickable td/tr без tabindex/role,
  клавиатурной цели нет.
- FE-0059 подтверждён API: потерянный ответ ротации + 185 c > grace -> refresh 401
  revoked, /auth/me 401.
- FE-0325: 3 цикла offline/online с существующей сессией стабильны (~2.6 c);
  stale SW waiting не активируется и не показывается в settings.
- Functional +12 маршрутов (help, menu, it/objects, it/requests, groups-access,
  voice, monitoring, shared-files, admin, file-egress, dlp, chat/open); итого 36
  маршрутных сценариев, E2E 3.
- Остались static-only: FE-0215, FE-0230, FE-0232, FE-0239, FE-0259.
- Итог: 323 записи; Confirmed 269, Suspected 11, Fixed 2, Rejected 41.
  Валидатор 0 ошибок. Отчёт CYCLE_15_REVIEW.md.
`;
fs.appendFileSync(`${DIR}/AUDIT_PROGRESS.md`, progress, 'utf8');
const next = `
## Цикл 15 — очередь (2026-11-23)

- Static-only High: FE-0215 (mailbox), FE-0230 (WebView2), FE-0232/FE-0239
  (fixtures + mutations), FE-0259 (construction object/1C).
- FE-0325: stale SW activation/prompt, expired session offline.
- 11 Suspected: FE-0004, FE-0051, FE-0076, FE-0110, FE-0115, FE-0161,
  FE-0194, FE-0265, FE-0300, FE-0323, FE-0324.
- Довести E2E создания записей (не только диалоги) для ключевых маршрутов.
`;
fs.appendFileSync(`${DIR}/NEXT_ACTIONS.md`, next, 'utf8');
console.log('docs updated');
