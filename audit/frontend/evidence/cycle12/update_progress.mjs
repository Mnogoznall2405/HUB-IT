import fs from 'node:fs';
const p = 'C:/Project/HUB-IT-main/audit/frontend/AUDIT_PROGRESS.md';
const src = fs.readFileSync(p, 'utf8');
const marker = '\n## Цикл 12';
const idx = src.lastIndexOf(marker);
const base = idx >= 0 ? src.slice(0, idx + 1) : src + '\n';
const section = `## Цикл 12 — перепроверка всех 322 записей (2026-11-23)

- Проверены все 322 записи: чанки 1–8 (chunk_1..8.json), вердикты в
  evidence/cycle12/verdicts_1..8.json. Чанк 2 перезапущен после падения
  агента; чанк 3 доверифицирован вручную и сверен с отдельным агентом;
  High-12 проверены отдельно.
- Вердикты: confirmed 290 / not-a-defect 17 / unverifiable 10 /
  wrong-evidence 4 / fixed-externally 1; missing 0, дублей id 0.
- После слияния: Confirmed 254, Suspected 50, Fixed-externally 1,
  Rejected 17; всего 322. Severity не менялась: High 12, Medium 122,
  Low 174, Info 14.
- Rejected (17): FE-0025, FE-0037, FE-0060, FE-0106, FE-0111, FE-0116,
  FE-0136, FE-0172, FE-0173, FE-0174, FE-0184, FE-0193, FE-0196,
  FE-0210, FE-0211, FE-0212, FE-0231 — ложные срабатывания/намеренное
  поведение, обоснования в evidence каждой записи.
- Fixed-externally (1): FE-0225 — отправка стикера уже использует
  ref-guard и client_message_id (useChatStickerSending.js:17-50).
- Wrong-evidence (4): FE-0034 (Tooltip даёт aria-label; реальные случаи
  Vcs/Mfu/UsersTab), FE-0115 (revoke находится в mailMessageFileActions.js:357-359),
  FE-0182 и FE-0250 (уточнены file/lines/формулировка).
- Unverifiable (10): FE-0004, FE-0015, FE-0016, FE-0051, FE-0075,
  FE-0076, FE-0157, FE-0253, FE-0323, FE-0324 — переведены в
  Suspected с пояснением.
- High-12 подтверждены: FE-0022, FE-0023, FE-0059, FE-0078, FE-0083,
  FE-0197, FE-0198, FE-0215, FE-0230, FE-0232, FE-0239, FE-0259.
  FE-0197/0198: verifyTwoFactorSetup/Login вызывают applyAuthenticatedPayload
  (setUser) до setStep('setup_complete')/remember-device, LoginRoute
  (App.jsx:237-252) размонтирует Login раньше — экран backup-кодов и
  обязательная привязка устройства недостижимы.
- FE-0230: ChatNotificationsSettingsCard переехал в
  pages/account/settings/notifications/; ранний return null до хуков
  сохранён, путь в реестре обновлён.
- Бэкап перед слиянием: audit/frontend/backups/ISSUES-20261123-093910.json
  (и .md). Валидатор: 0 ошибок. ISSUES.md перегенерирован (247 карточек
  FE-0078+; карточки FE-0025/0034 обновлены вручную).
- Ограничения: перепроверка статическая по коду + ранее снятые runtime-
  доказательства; production не трогали, новые живые пробы не выполнялись.
`;
fs.writeFileSync(p, base + section, 'utf8');
console.log('AUDIT_PROGRESS cycle12 replaced at', idx);
