# ADR-0002: Соглашение об именовании модулей Chat (frontend)

## Status

Accepted (2026-06-26)

## Context

После F037 чат разрезан по domain seams (`pages/chat/*`, `components/chat/*`), но накопились 4+ схемы префиксов (`useChat*`, `useChatPage*`, `buildChatPage*`, `chat*Model`) и shallow bag-pipeline слои. Это усложняет навигацию и привело к production ReferenceError при рассинхроне import/usage.

## Decision

| Префикс / суффикс | Слой | Пример |
|-------------------|------|--------|
| `useChat*` | Domain behavior (controllers, models с side effects) | `useChatThreadController` |
| `useChatPage*` | Orchestration только для `ChatPageContent` | `useChatPageCoreBridge` |
| `chat*Model.js` | Pure functions без React | `chatThreadMessageMerge` |
| `buildChat*Props.js` / `buildChatPagePanesBags` | Один слой prop assembly | `buildChatPagePanesBags` |
| `ChatPage*` / `Chat*` | React components | `ChatPageContent`, `ChatThread` |
| `lib/chat/*` | Shared pure utils на границе pages/components | `chatThreadScrollModel` |

Правила:

- Не добавлять новые промежуточные bag-слои (`*InputBags`, identity `*Source` builders).
- `components/chat` не импортирует из `pages/chat` (кроме re-export shim с пометкой deprecated).
- Hooks в `.js`, JSX components в `.jsx`.
- Суффикс `Model` только у pure modules, не у hooks.

## Consequences

- Новые фичи — новые focused hooks/modules, не раздувание `ChatPageContent`.
- Domain controllers реэкспортируются из `pages/chat/controllers/index.js`.
- ESLint `no-undef` + smoke mount `ChatPageContent` обязательны перед merge в chat dirs.
