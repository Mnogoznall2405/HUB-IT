import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../');

fs.appendFileSync(`${DIR}/AUDIT_PROGRESS.md`, `
## Цикл 17 — воспроизводимость и заблокированные High (2026-11-23)

- База e8930fe9; проверенный код — чистый b95c4cac; frontend и backend из одного
  git archive, без правок владельца. Стенд .state-cycle17, 18007/5227.
- Five E2E с нуля: 5/5 PASS (feed, tasks, chat, myFiles, admin); chat — 2 сообщения,
  0 дублей. Скрипт five-e2e.cjs воспроизводит прогон одной командой.
- Refresh matrix A-D (grace 15 c, MAX_HITS=1): один повтор — 200 и новый токен жив;
  два последовательных — второй 401 и family отозвана; три параллельных — [200,200,401],
  оба победителя мертвы; после grace старый 401, новый жив. Причина — превышение
  лимита reuse, не параллельность.
- FE-0059: заголовок исправлен (исторические 15 c убраны), titleHistory сохранён.
- High: FE-0232 live (связь 1 -> 0 при сбое bulk), FE-0239 live (D2 получил
  руководителя D1), FE-0259 live (черновик потерян при F5); FE-0230 — реальный
  WebView2 host, live не воспроизведён; FE-0215 — blocked (Exchange EWS, не IMAP/SMTP).
- Покрытие: E2E 9, Functional 27, Smoke 2, Blocked 8; Functional+E2E 36/46 (78.3%).
  Новые E2E: public share (access/download/revoke/expiry), KB article, construction
  direction workspace; /dashboard — Functional.
- Реестр: 323 записи, 269/11/2/41; highBreakdown обновлён, runtimeStatus у пяти High;
  валидатор 0 ошибок. Отчёт CYCLE_17_REVIEW.md.
`, 'utf8');

fs.appendFileSync(`${DIR}/NEXT_ACTIONS.md`, `
## Цикл 17 — очередь (2026-11-23)

- FE-0215: EWS-совместимый тестовый сервер/mailbox (IMAP/SMTP не подходит).
- FE-0230: найти воспроизводимый card-local re-render при позднем hostReady.
- FE-0232/FE-0239/FE-0259: исправления — сохранение делегатов при сбое bulk,
  request-id/abort при смене отдела, beforeunload/автосохранение черновика.
- Данные для /computers, /statistics, /database, /it/objects, /my-files/edit.
- Construction: 1C-заявки для вкладок «Заявки» и request-child.
- 11 Suspected: FE-0004, FE-0051, FE-0076, FE-0110, FE-0115, FE-0161,
  FE-0194, FE-0265, FE-0300, FE-0323, FE-0324.
- При появлении исправлений — повторить матрицу refresh и five E2E на новом SHA.
`, 'utf8');
console.log('docs updated');
