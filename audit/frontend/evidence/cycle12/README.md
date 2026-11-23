# Cycle 12 — перепроверка реестра frontend (2026-11-23)

## Что проверено

Все 322 записи `audit/frontend/ISSUES.json` (FE-0001…FE-0324, без FE-0021 и
FE-0055). Проверка статическая по текущему коду рабочего дерева, с опорой на
ранее снятые runtime-доказательства; production не трогали, новых живых проб
не выполняли.

## Артефакты

- `chunk_1.json` … `chunk_8.json` — входные списки по 41/41/41/41/41/41/41/35.
- `verdicts_1.json` … `verdicts_8.json` — по одному вердикту на ID:
  `confirmed | fixed-externally | wrong-evidence | not-a-defect | unverifiable`.
- `cycle12_summary.json` — итоговые счётчики.
- `merge_cycle12.mjs` / `finalize_cycle12.mjs` — слияние вердиктов в реестр.
- `code_3.md` / `pack_*.md` — рабочие выгрузки кода и карточек (не источник
  истины).
- `TEST`-скрипты (`inspect_chunks.mjs`, `make_packs.mjs`, `make_code_pack.mjs`)
  оставлены для воспроизводимости.

## Итог

| Вердикт | Кол-во |
|---|---|
| confirmed | 290 |
| not-a-defect | 17 |
| unverifiable | 10 |
| wrong-evidence | 4 |
| fixed-externally | 1 |
| **Всего** | **322** |

Статусы реестра после слияния: Confirmed 254, Suspected 50,
Fixed-externally 1, Rejected 17. Severity не менялась: High 12, Medium 122,
Low 174, Info 14.

## Ключевые корректировки

- **FE-0025** — Rejected: MUI Tooltip со строковым `title` выставляет
  `aria-label` (node_modules/@mui/material/Tooltip/Tooltip.js:453-460), имена
  у кнопок есть.
- **FE-0034** — wrong-evidence: цитируемые SharedFolder/Voice/Passwords
  кнопки обёрнуты в Tooltip; реальные случаи — `Vcs.jsx:686-698`,
  `Mfu.jsx:988-994`, `UsersTab.jsx:321`.
- **FE-0115** — wrong-evidence: синхронный `revokeObjectURL` находится в
  `mailMessageFileActions.js:357-359`, а не в `useMailMessageFileActions.js`.
- **FE-0225** — fixed-externally: стикер-отправка уже использует ref-guard и
  `client_message_id` (`pages/chat/useChatStickerSending.js:17-50`).
- **FE-0106, FE-0111, FE-0116, FE-0136, FE-0172, FE-0173, FE-0174, FE-0184,
  FE-0193, FE-0196, FE-0210, FE-0211, FE-0212, FE-0231** — Rejected: ложные
  срабатывания или намеренное поведение, обоснования в `evidence` каждой
  записи. FE-0111: бэкенд отклоняет save старой сессии после restore;
  FE-0116: при phase=blocked показывается статус блокировки, а не
  устаревшее предупреждение.
- **FE-0004, FE-0015, FE-0016, FE-0051, FE-0075, FE-0076, FE-0157, FE-0253,
  FE-0323, FE-0324** — unverifiable → Suspected с пояснением.
- **FE-0125** — confirmed: невалидный `?folder=` остаётся в URL и повторяет
  ошибку (MyFiles.jsx:163,320-322).

## High-12 (проверены вручную)

FE-0022, FE-0023, FE-0059, FE-0078, FE-0083, FE-0197, FE-0198, FE-0215,
FE-0230, FE-0232, FE-0239, FE-0259 — все подтверждены.

FE-0197/0198: `verifyTwoFactorSetup`/`verifyTwoFactorLogin` вызывают
`applyAuthenticatedPayload` (setUser) до `setStep('setup_complete')` и
`setRememberDeviceOpen(true)`; `LoginRoute` (App.jsx:237-252) размонтирует
Login раньше, поэтому backup-коды и обязательная привязка trusted-device
недостижимы.

## Ограничения

- Часть записей подтверждена по ранее снятым runtime-доказательствам; новые
  браузерные пробы не выполнялись.
- FE-0215, FE-0197/0198, FE-0230, FE-0232, FE-0239, FE-0259 требуют живой
  проверки на тестовом стенде (см. NEXT_ACTIONS.md).
- Ветка/рабочее дерево содержат параллельные правки пользователя; аудит
  зафиксирован на снимке 2026-11-23, приложение не изменялось.
