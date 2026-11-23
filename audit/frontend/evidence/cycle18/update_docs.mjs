import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../');

fs.appendFileSync(`${DIR}/AUDIT_PROGRESS.md`, `
## Цикл 18 — достоверность тестов и проверка High (2026-11-23)

- Чистый SHA 338912d9, отдельная SQLite .state-cycle18; five-e2e переписан:
  сценарий PASS только при выполнении всех явных assertions (49 обязательных
  проверок), а не при отсутствии исключения.
- Negative controls 10/10 падают как должны: API error, missing save, wrong
  record, duplicates, hidden record, login timeout; положительный feed PASS.
- FE-0232 strict: 11/11; links 0 -> 1, injected bulk 500 -> Save items:[] -> 0;
  control 1 -> 1. FE-0239 strict: 8/8; PUT D2 [14], D2 16 -> 14.
  FE-0259 strict: 11/11; plan persisted; daily + weekly drafts lost on F5 без
  beforeunload; title исправлен на «дневная сводка и недельный план».
- FE-0230: 9 хуков до early return, 0 после; parent unmounts via capabilities;
  реальный WebView2 late-hostReady + click не дал краха; статус Suspected,
  severity High (potential impact, reachability unproven).
- FE-0215: EWS-анализ; полный E2E невозможен без EWS test server; возможен
  только limited service-level контрактный тест.
- Новый дефект FE-0326 (Medium): PNG preview artifact preview.png повреждён;
  публичная ссылка на изображение показывает битое превью; оригинал скачивается.
- Реестр: 324 записи; 269 Confirmed / 12 Suspected / 2 Fixed / 41 Rejected;
  High 12, Medium 124, Low 173, Info 15. Валидатор 0 ошибок.
`, 'utf8');

fs.appendFileSync(`${DIR}/NEXT_ACTIONS.md`, `
## Цикл 18 — очередь (2026-11-23)

- FE-0326: валидировать PNG-артефакт или отдавать WebP/thumb/оригинал для image
  preview; добавить decode-тест в preview worker.
- FE-0230: найти достижимый card-local re-render при late hostReady; иначе
  оставить Suspected.
- FE-0215: limited service-level EWS contract test (fake Account/Message), только
  с согласия владельца; полный EWS double — отдельный сервис.
- FE-0232/FE-0239/FE-0259: исправления — не отправлять items:[] при сбое bulk,
  request-id/abort при смене отдела, beforeunload/автосохранение.
- /computers, /statistics: синтетические данные; /database — SQL test set;
  ONLYOFFICE — тестовый сервер.
- 11 Suspected: FE-0004, FE-0051, FE-0076, FE-0110, FE-0115, FE-0161,
  FE-0194, FE-0265, FE-0300, FE-0323, FE-0324.
`, 'utf8');
console.log('docs updated');
