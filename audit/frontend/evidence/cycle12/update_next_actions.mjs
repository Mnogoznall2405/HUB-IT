import fs from 'node:fs';
const p = 'C:/Project/HUB-IT-main/audit/frontend/NEXT_ACTIONS.md';
const add = `
## Цикл 12 — итог перепроверки (2026-11-23)

- Проверены все 322 записи; вердикты: confirmed 292, not-a-defect 15,
  unverifiable 10, wrong-evidence 4, fixed-externally 1.
- Текущий реестр: Confirmed 255, Suspected 51, Rejected 15,
  Fixed-externally 1.
- Системная ложная серия агента A исправлена: MUI Tooltip со строковым
  title даёт aria-label, поэтому FE-0025 отклонён, FE-0034 сужен до
  Vcs/Mfu/UsersTab, FE-0024 сужен до кнопок без Tooltip.
- FE-0225 закрыт как fixed-externally (ref-guard + client_message_id).
- FE-0197/0198 подтверждены: backup-коды и обязательная привязка
  trusted-device недостижимы из-за рано срабатывающего LoginRoute.

### Осталось проверить вживую
1. FE-0215: inline-изображение после autosave черновика (нужен реальный
   mailbox/DS и браузерная проверка потери img).
2. FE-0197/0198: сценарий первичной настройки 2FA и обязательного
   trusted-device на тестовой учётке (подтвердить недостижимость экранов).
3. FE-0230: Desktop-режим с асинхронным bridgeReady — воспроизвести
   «Rendered fewer hooks» при переключении флага.
4. FE-0232/FE-0239: гонки account-admin на тестовых данных (делегаты,
   смена отдела) — проверить потерю связей и запись в чужой отдел.
5. FE-0259: F5/закрытие construction-workspace с несохранённой сводкой.
6. FE-0078/FE-0083: повторный offline/reconnect и межвкладочный refresh
   на локальном стеке (E2E уже фиксировал падения).
7. 51 Suspected: приоритетно FE-0110/FE-0111 (ONLYOFFICE), FE-0051,
   FE-0075/FE-0076 (security-edge), FE-0125, FE-0182.
`;
fs.appendFileSync(p, add, 'utf8');
console.log('NEXT_ACTIONS updated');
