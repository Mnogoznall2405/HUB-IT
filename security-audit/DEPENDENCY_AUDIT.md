# HUB-IT — аудит зависимостей

Дата первичного аудита: 2026-11-13. Повторная проверка: 2026-11-13 ~16:50. Проверки выполнялись локально, без установки пакетов в репозиторий и без production-запросов.

## 1. Фактически запущенные проверки

| Инструмент | Команда / область | Результат (повторно) |
|---|---|---|
| `npm audit` | `WEB-itinvent/frontend`, `--json --omit=dev` | **12 уязвимостей: 9 high, 1 moderate, 2 low; 0 critical** |
| `npm audit` | `mobile-hub`, `--json --omit=dev` | **23 уязвимости: 1 critical, 8 high, 6 moderate, 8 low** |
| `pip-audit 2.10.1` | `.venv\Lib\site-packages` (129 пакетов) | **2 уязвимых пакета, 3 advisory** (было 220/17) |
| `git` + regex | tracked-файлы и история по ключевым именам | секретов в git не найдено; `.env` не отслеживается |
| `dotnet list package --vulnerable` | Desktop NuGet | **не запускался**: restore пишет `obj/`, режим read-only |

Semgrep, CodeQL, Gitleaks, OSV-Scanner в окружении отсутствуют и **не запускались**. `pip-audit` установлен во временный venv вне репозитория; проект не изменялся.

## 2. Web frontend (`WEB-itinvent/frontend`)

Текущий `package-lock.json`:

| Пакет | Версия | Тип | Оценка |
|---|---|---|---|
| `xlsx-js-style` | **1.2.0** (внутри `XLSX.version = 0.18.5`) | direct, prod | **High**: тот же уязвимый SheetJS 0.18.5 (CVE-2023-30533 prototype pollution, CVE-2024-22363 ReDoS), но под другим именем пакета; `npm audit` его **не помечает** |
| `xlsx` | удалён из `package.json` и lock | — | прямого `xlsx` больше нет; это не устранило уязвимый парсер |
| `axios` | 1.15.2 | direct, prod | текущим audit не flagged |
| `dompurify` | 3.4.17 | direct, prod | не flagged |
| `react-router-dom` | 7.18.5 | direct, prod | не flagged |
| `lodash-es` | 4.18.1 | transitive (Excalidraw/mermaid) | high; исправление требует major-обновления Excalidraw |
| `nanoid` | 3.3.11 | transitive | high; исправление через Excalidraw |
| `chevrotain` / `langium` / `mermaid` / `@mermaid-js/parser` | transitive | prod | high-цепочка через `lodash-es`/`chevrotain` |
| `vite` | 7.3.2 | dev | не flagged |

**Подтверждённый путь `xlsx-js-style`:** `src/lib/excelPreview.js:77-83` (`await import('xlsx-js-style')`, затем `XLSX.read`) используется в:
- `components/mail/officeAttachmentPreview.js` — предпросмотр Excel-вложения письма;
- `pages/myFiles/useMyFilesPreviewController.js` — предпросмотр «Моих файлов»;
- `pages/SharedFile.jsx` — **публичная** страница share-ссылки.

В `excelPreview.js` добавлены лимиты: 25 МБ, 50 листов, 5000 строк и 512 столбцов на лист, `sheetRows`; это снижает DoS-поверхность, но **не заменяет исправленный парсер**. Тест `src/lib/excelPreview.test.js` проверяет обычный workbook и `Object.prototype.polluted`, но не воспроизводит известный prototype-pollution payload, поэтому не доказывает отсутствие CVE-2023-30533.

**Рекомендация:** заменить `xlsx-js-style` на SheetJS ≥0.20.3 с официального CDN (в npm исправленной версии нет) либо на поддерживаемый парсер; разбор — в Web Worker с таймаутом; добавить фикстуру с реальным prototype-pollution payload. Не полагаться на `npm audit` для alias-пакетов.

## 3. Mobile (`mobile-hub`)

| Пакет | Версия | Тип | Оценка |
|---|---|---|---|
| `axios` | 1.21.0 | direct, prod | текущим audit не flagged (обновлён с 1.19.0) |
| `decode-uri-component` | 0.5.0 (локальный shim `file:./vendor/...`) | direct | high; shim сохраняет ту же уязвимую версию, не митигирует |
| `shell-quote` | 1.10.0 | transitive `react-native` → `react-devtools-core` | **critical** по audit, но devtools/CLI-цепочка, не production runtime |
| `@expo/cli`, `brace-expansion`, `compression`, `js-yaml`, `node-forge`, `source-map-js`, `zod` | transitive | tooling/build | high; reachability не доказана |

`shell-quote` не следует считать production-критичным без доказанного попадания в APK; это ограничение, а не подтверждённая уязвимость мобильного клиента.

## 4. Python backend (`.venv`, 129 пакетов)

Повторный `pip-audit` показал **2 уязвимых пакета / 3 advisory** вместо 220/17. Ключевые пакеты обновлены: `python-multipart 0.0.33`, `pypdf 7.0.1`, `pillow 13.0.0`, `starlette 1.10.0`, `fastapi 0.162.5`, `aiohttp 3.14.5`, `cryptography 50.0.2`, `urllib3 2.8.0`, `oauthlib 4.0.1`.

| Пакет | Версия | Advisory | Влияние / reachability |
|---|---|---|---|
| `python-jose` | 3.5.0 | PYSEC-2026-4298 (CVE-2026-85394) | HMAC initialization принимает DER public key; приложение использует HS256 с симметричным секретом, поэтому **не эксплуатируется текущей конфигурацией**; фикса нет — мониторинг/замена |
| `ecdsa` | 0.19.2 | PYSEC-2026-1325 (Minerva timing), без фикса | не используется для HS256; низкий практический риск |

Остальные ранее перечисленные advisory (`python-multipart`, `pypdf`, `pillow`, `starlette`, `aiohttp`, `cryptography`, `urllib3`, `oauthlib`) текущим audit **не подтверждаются** — версии обновлены. Это не заменяет полный OSV/SCA-скан и проверку фактического runtime: `.venv` может содержать dev/test-пакеты, а production-процесс мог быть запущен со старым интерпретатором до обновления.

## 5. Desktop (NuGet)

Версии из `desktop/Hub.Desktop/Hub.Desktop.csproj`: `Microsoft.Web.WebView2 1.0.4078.44`, `Microsoft.WindowsAppSDK.Foundation 1.8.260709000`, `xunit 2.9.3`, `Microsoft.NET.Test.Sdk 18.8.1`.

`dotnet list package --vulnerable` **не запускался**: restore/create `obj/` нарушает read-only режим. Известных advisory по этим версиям в рамках ручной проверки не выявлено; это **не** заменяет машинный аудит.

## 6. CI/CD и supply chain

- `.github/workflows/chat-followup-check.yml`: actions pinned by SHA, `permissions: contents: read`, `persist-credentials: false`, `npm ci --ignore-scripts --no-audit --no-fund`; секретов в workflow нет.
- `.env.example` содержит placeholder-ключи, но **`MAIL_CREDENTIALS_KEY` совпадает с активным ключом в `.env`** — это отдельная Critical-находка (CRIT-02), а не только dependency-раздел.
- `xlsx` удалён, но `xlsx-js-style` — прямой production-импорт с уязвимым SheetJS; это regression/неполное исправление HIGH-07.
- Для Python `requirements.txt` задаёт диапазоны; воспроизводимость обеспечивается `constraints.txt`. Если деплой ставит без `-c constraints.txt`, версии могут уехать.

## 7. Приоритет обновлений

1. **xlsx-js-style** — заменить на исправленный парсер или SheetJS ≥0.20.3 вне npm (High, подтверждённый путь, включая публичную share-страницу).
2. **decode-uri-component (mobile shim)** — заменить на актуальную версию/убрать shim (High по audit, reachability проверить).
3. **Excalidraw/mermaid-цепочка** — обновить или изолировать редактор схем (`lodash-es`, `nanoid`, `chevrotain`, `langium`).
4. **shell-quote** — обновить tooling/React Native цепочку; проверить, не попадает ли в release APK.
5. **python-jose/ecdsa** — мониторинг; замена JWT-библиотеки или явная проверка ключей.
6. **Desktop NuGet** — запустить `dotnet list package --vulnerable` в отдельной копии/после разрешения записи `obj/`.

## 8. Ограничения

- `npm audit`/`pip-audit` не доказывают эксплуатацию; severity берётся из advisory.
- `npm audit` не помечает `xlsx-js-style`, хотя внутри тот же SheetJS 0.18.5; отсутствие записи в audit не означает отсутствие уязвимости.
- `pip-audit` запускался по фактическому `.venv`, который может содержать dev/test-пакеты; production-процесс не перезапускался.
- `npm audit` mobile включал dev/CLI-цепочки (`shell-quote`), поэтому critical не переносится автоматически на APK.
- Динамическая детонация вредоносных XLSX/PDF/изображений не выполнялась.
