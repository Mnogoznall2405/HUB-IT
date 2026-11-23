import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../');

fs.appendFileSync(`${DIR}/AUDIT_PROGRESS.md`, `
## Цикл 19 — финальная верификация и контроль качества (2026-11-23)

- Проверенный SHA 9879be04; чистый стенд .state-cycle19 (18009/5229) +
  preview worker; production не затрагивался.
- FE-0326 ОТКЛОНЁН как false positive: повреждённым был тестовый 180-байтный
  PNG (IDAT CRC mismatch), а не артефакт приложения. Валидные small/medium/large
  PNG дают валидные private/public preview; MyFiles E2E 12/12, 0 observations.
- Negative controls усилены: 10/10 EXPECTED_FAILURE с конкретными checks;
  browser launch error = INFRA_FAILURE и не засчитан.
- Positive five E2E 5/5, 49 checks; FE-0232 11/11; FE-0239 8/8; FE-0259 11/11;
  refresh matrix A-D повторена на 9879be04.
- FE-0194: mocked overview с target без name воспроизвёл split TypeError и
  error boundary; реальный триггер не доказан → Suspected.
- Реестр: 324; 268 Confirmed / 12 Suspected / 2 Fixed / 42 Rejected;
  High 12, Medium 124, Low 173, Info 15. Валидатор 0 ошибок.
- Созданы AUDIT_FINAL_REVIEW.md и REMEDIATION_BACKLOG.md.
`, 'utf8');

fs.appendFileSync(`${DIR}/NEXT_ACTIONS.md`, `
## Цикл 19 — итоговая очередь (2026-11-23)

- P0: FE-0197/FE-0198 (2FA/trusted-device), FE-0059/FE-0083 (refresh),
  FE-0232 (delegates), FE-0239 (managers).
- P1: FE-0259 (drafts), FE-0023 (mobile 10k ports).
- P2: FE-0325 (PWA), FE-0215 (EWS, after test double), FE-0194 (monitoring),
  FE-0110 (ONLYOFFICE).
- P3: silent truncation family FE-0161/0300/0323/0324, FE-0051, FE-0076,
  FE-0115, FE-0004, FE-0265.
- Spike: FE-0230 — достижимый card-local re-render; без него не исправлять.
- Test infra: PNG fixture validation, EWS double, ONLYOFFICE/SQL/mobile/PWA
  harness, WebView2 harness.
- FE-0326: приложение не чинить; false positive из-за невалидной фикстуры.
`, 'utf8');
console.log('docs updated');
