# PR_DEPENDENCY_GRAPH — зависимости и пересечения 42 PR

База: `origin/main` @ `926dd9f5`. Ветка: `integration/frontend-remediation`.

## Жёсткие зависимости (stacked)

```
#38 fix/account-guards
└─ #39 fix/account-seq-guards
   └─ #40 fix/account-draft-loss
      └─ #41 fix/account-aibots-lazy
```

Мержить строго по цепочке или только #41 (включает коммиты #38–#40).

## Мягкие зависимости (порядок важен для минимизации конфликтов)

```
#29 auth-refresh-coordination ──► http.js ──► конфликт с #48 auth-misc-batch
#23 auth-2fa-flow ──► Login.jsx/AuthContext ──► #48, #62 накладываются поверх
#27/#28 account-delegate/dept-race ──► useAccountSectionData ──► база для #38–#41
#31..#37 networks-* (6 PR) ──► Networks.jsx ──► #53, #59, #67 накладываются поверх
#47 mail-batch ──► MailComposeHost ──► #66 накладывается поверх
#32 warehouse1c-keyboard ──► Warehouse1C.jsx ──► #66 накладывается поверх
#62 pwa-batch ──► pwaInstall/MainLayout ──► #66 накладывается поверх
```

## Карта пересечений по файлам (файл → список PR)

| Файл | PR | Конфликтовал |
|------|-----|--------------|
| `pages/Networks.jsx` | #31, #33, #34, #35, #36, #37, #53, #59, #67 (7+2) | ДА ×3 |
| `hooks/useAccountSectionData.js` | #27, #28, #38, #39, #40, #41 (5) | нет (sequential chain) |
| `pages/Login.jsx` | #23, #29, #43, #48 (4) | CSS-часть с #48 |
| `contexts/AuthContext.jsx` | #23, #29, #48, #62 (4) | нет |
| `components/layout/MainLayout.jsx` | #52, #62, #66 (3) | нет |
| `api/http.js` (клиент) | #29, #43, #48 (3) | ДА (#48×#29) |
| `App.jsx` | #23, #48, #62 (3) | нет |
| `pages/MyFiles.jsx` | #49 + main V2 | ДА (решён в #49 pre-merge) |
| `components/mail/MailComposeHost.jsx` | #47, #66 | ДА |
| `pages/Warehouse1C.jsx` | #32, #66 | ДА |
| `index.html` | #66 + main | ДА (merge-loss, исправлен) |
| `lib/pwaInstall*` | #62, #66 | ДА |
| `components/networks/useVirtualizedTableWindow.js` | #31, #53/база | ДА (merge-loss, исправлен) |
| `components/chat/ChatComposer*` | #45 + main emoji/sticker | контракт теста обновлён |
| `pages/TasksDialogsLayer.jsx` | #46, #67 | нет |
| `components/tasks/TaskWorkspacePanel*` | #46, #65 | нет |
| `swr` / cache слой | #59, #67 | ДА (Networks) |
| `contexts/NotificationContext.jsx` | #65, +queue правки | нет |
| `pages/account/*` (много файлов) | #27, #28, #38–#41 | цепочка |
| `public/robots.txt` | #66 | новый файл |

## Не входят в программу

- PR #9 — сам аудит (324 записи), источник реестра.
- PR #10 `fix/fe-0064-task-editor-safe-paste` — сторонний PR; FE-0064 отмечен
  в реестре как его зона. `fix/fe-0064-*` НЕ ancestor интеграции — корректно.
- `fix/ai-*` ветки (a1/a4) — не из программы; их коммиты присутствуют в
  интеграции только как часть ранее вмерженного main.

## Верификация целостности

Все 42 remote head'а являются ancestor `integration/frontend-remediation`
(`git merge-base --is-ancestor` = True для каждого). Метод: `git ls-remote
origin | grep fix/` сверен с `git log --merges` интеграционной ветки.
