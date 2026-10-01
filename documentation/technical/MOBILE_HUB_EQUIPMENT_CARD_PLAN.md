# Карточка оборудования Expo — копирование, компоновка, функции

| Поле | Значение |
|---|---|
| Статус | Шаги 1, 2, 3, 4-A и Н-1…Н-3 приняты. Шаг 5-A и Ш5-5 приняты; шаг C авторизации принят, его backend выложен (C-4). preview 1.1.60 опубликован. Ш5-6…Ш5-8 выполнены, на проверке (без сборки — версия 1.1.61 будет отдельной задачей). 4-B и выпуск обычной версии — ждут условий и разрешения |
| Дата | 2026-09-30 |
| Область | `mobile-hub`, экран карточки оборудования; точечно `WEB-itinvent/backend` (даты) |
| Стек | Expo / React Native, Fluent-токены (`useFluentTokens`), существующий `databaseApi` |
| Роли | Руководитель (Claude) ставит задачи и проверяет. Исполнитель (AI-агент) реализует строго по плану |

## Правила для исполнителя

- Делать только свой шаг и только перечисленные в нём файлы. Если нужен файл вне списка — остановиться и сообщить руководителю.
- Не добавлять npm/pip-зависимости. Всё нужное уже есть: `expo-clipboard`, `expo-haptics`, `Share` из `react-native`, `@expo/vector-icons`.
- Не менять `AccountField` и `AccountScreenScaffold` (`src/screens/account/AccountChrome.tsx`): они используются в экранах аккаунта.
- Не ломать экран списка `NativeDatabaseScreen.tsx`: он использует `NativeEquipmentActions` для массовых операций (`targets`).
- Цвета только из `tokens`, без хардкода, кроме уже принятого `#fff` на primary-кнопках. Зона нажатия ≥ 44×44. Поддержка тёмной темы и крупного системного шрифта.
- Сохранять существующие `testID` там, где элемент остаётся. Если элемент переезжает, `testID` переносится вместе с ним.
- Не запускать deployment, PM2, перезапуски, не обращаться к production-БД. Не коммитить.
- Рабочее дерево грязное: не трогать чужие изменения, без `git reset`/`git checkout --`.
- Отчёт в конце шага:
  1. Что сделано.
  2. Список файлов.
  3. Команды проверок с фактическим результатом.
  4. Отклонения от плана и почему.
  5. Что не проверено.

## Решения пользователя (2026-09-30)

1. Копирование — по иконке ⧉ справа от значения и по долгому нажатию на строку. Короткое нажатие на строку не копирует.
2. Действия — закреплённая панель внизу экрана: «Редактировать» + «Действия ▾» (открывает список). «Удалить карточку» — в меню ⋮ заголовка.
3. Статус чиним в приложении. Даты «Создано/Изменено» добавляем на сервере. Перезапуск бэкенда — только с отдельного разрешения пользователя.
4. В итерацию входят: «Поделиться / Скопировать всё», «Последнее обслуживание», улучшенный редактор. QR-кода в этой итерации нет.
5. Текст «Поделиться» содержит: идентификацию, сотрудника и размещение, сеть, статус и описание.
6. Пустые поля скрываются, в секции есть кнопка «Показать пустые (N)».
7. Поля выводятся строкой: подпись слева, значение справа.
8. Порядок: сначала шаг 1 (копирование + статус) отдельным изменением, потом шаг 2.

## Текущее состояние (факты из кода на момент составления плана, до шага 1)

Раздел исторический: номера строк и утверждения ниже описывают код до изменений. Актуальное состояние — в «Журнале выполнения».

- Экран: `mobile-hub/src/screens/database/NativeEquipmentDetailScreen.tsx`. Вкладка «Карточка» — строки ~520–594, редактор — модалка в строках ~661–772, `EditorOptionStrip` — горизонтальная лента чипов.
- Действия: `mobile-hub/src/components/database/NativeEquipmentActions.tsx`. Рендерит сетку кнопок (`surface="general" | "works"`) и модалку операции.
- Модель: `mobile-hub/src/database/nativeDatabaseModel.ts` (`equipmentTitle`, `equipmentOwner`, `equipmentLocation`, `formatDatabaseDate`, `equipmentWorkKinds`, `equipmentWorkKindLabel`).
- API: `mobile-hub/src/api/databaseApi.ts`, `normalizeEquipmentRecord` (~строка 305), тип `EquipmentRecord` (~строка 10).
- Уведомления: `mobile-hub/src/components/nativeToast.tsx` — `showNativeToast()` + `NativeToastHost`. Хост сейчас подключён только в `NativeChatThreadScreen.tsx`.
- Каркас `AccountScreenScaffold` уже поддерживает `rightAction` (кнопка справа в заголовке) и `footer` (закреплённая нижняя панель).
- **Баг статуса.** `GET /equipment/{inv_no}` возвращает строку из `queries.get_equipment_by_inv` с полем `status` (`s.DESCR as status`), а `normalizeEquipmentRecord` читает только `status_name`/`STATUS_NAME`. Поэтому в шапке «Статус не указан», а в поле «Статус» — «—».
- **Баг дат.** `get_equipment_by_inv` (`WEB-itinvent/backend/database/queries.py`, ~строка 613) не выбирает дату создания и изменения, поэтому «Создано/Изменено» всегда «—».
- История работ: `getEquipmentWorkHistories(equipment, kinds)` → `histories: { kind, last_date, count, time_ago_str }[]`. Автора работы в ответе нет.
- Тесты экранов: `mobile-hub/src/screens/database/NativeDatabaseScreens.test.tsx` (`databaseApi` замокан целиком, фикстура `equipment` ~строка 100). Тесты API: `mobile-hub/src/api/databaseApi.test.ts`. Тесты модели: `mobile-hub/src/database/nativeDatabaseModel.test.ts`. `expo-clipboard` замокан в `src/test/setup.ts`.
- Команды проверки `mobile-hub` (см. `mobile-hub/README.md`): `npm run lint`, `npm run test:ci`. Точечно: `npx jest <path>`.

---

## Шаг 1. Копирование и исправление статуса

Один исполнитель. Файлы:

- `mobile-hub/src/components/database/NativeCopyableField.tsx` — новый;
- `mobile-hub/src/screens/database/NativeEquipmentDetailScreen.tsx`;
- `mobile-hub/src/api/databaseApi.ts`;
- `mobile-hub/src/api/databaseApi.test.ts`;
- `mobile-hub/src/screens/database/NativeDatabaseScreens.test.tsx`.

### 1.1. Компонент `NativeCopyableField`

Props: `tokens`, `label`, `value`, `copyLabel` (родительный падеж для уведомления, например «Серийный номер»), `copyValue?` (если копировать нужно не то, что показано), `testID`, `multiline?`, `trailing?` (дополнительная иконка-кнопка, например «написать письмо»).

Поведение:

- Строка: подпись слева (`textSecondary`, 12–13 px), значение справа (`textPrimary`, 14–15 px, `fontWeight 600`, выравнивание вправо).
- Если значение длиннее 28 символов, содержит перевод строки или задан `multiline`, значение переносится на отдельную строку под подписью, выравнивание влево.
- `selectable` — только у многострочных значений (`multiline`, описание). У остальных значений `selectable` не ставить: на Android выделяемый текст сам перехватывает долгое нажатие и конфликтует с копированием (уточнено после проверки шага 1).
- Справа иконка `content-copy` (18 px, `tokens.iconMuted`) в `Pressable` с зоной 44×44. `testID={`${testID}-copy`}`, `accessibilityLabel="Скопировать: <label>"`.
- Долгое нажатие на всю строку (`onLongPress`, стандартная задержка) тоже копирует. Короткое нажатие на строку ничего не делает.
- Копирование:
  1. `await Clipboard.setStringAsync(text.trim())`; если результат `=== false` — считать ошибкой.
  2. `Haptics.selectionAsync()` — ошибки проглатывать.
  3. ``showNativeToast(copiedMessage ?? `${copyLabel} скопирован`)``. Для слов женского и среднего рода передавать готовую строку через проп `copiedMessage` (например, «Модель скопирована», «Описание скопировано»).
- При ошибке — `showNativeToast('Не удалось скопировать')`.
- Пустое значение (`''`): строка «—» без иконки и без долгого нажатия, с `accessible` и `accessibilityLabel="<label>: не указано"`. `null`/`undefined` → компонент возвращает `null`. Скрытие пустых полей и «Показать пустые» решает родитель в шаге 2 (уточнено после проверки шага 1).
- Доступность: у строки `accessibilityLabel="<label>: <value>"`, `accessibilityHint="Долгое нажатие — скопировать"`, `accessibilityActions=[{ name: 'copy', label: 'Скопировать' }]`, `onAccessibilityAction` → копирование.

### 1.2. Подключение на экране

- В `NativeEquipmentDetailScreen` добавить `<NativeToastHost />` внутрь разметки экрана, последним элементом, чтобы уведомление было над контентом.
- Заменить `AccountField` на `NativeCopyableField` для полей: Тип, Модель, Производитель, Серийный номер, Аппаратный S/N, Part number, Размещение, E-mail, IP-адрес, MAC-адрес, Сеть, Домен, Описание (`multiline`).
- Статус и даты остаются `AccountField`, без копирования.
- Сотрудник: строка-переход «Склад в Хабе и в 1С» остаётся. Добавить справа отдельную иконку копирования ФИО (`employee_name`, без отдела) и долгое нажатие на эту строку. Если перехода нет (нет права `warehouse_1c.read`) — обычный `NativeCopyableField` с `copyValue={employee_name}`.
- Шапка: «Инв. № …» превратить в плашку-кнопку с иконкой ⧉. Нажатие на плашку копирует инв. № («Инвентарный номер скопирован»), `testID="native-equipment-copy-inv"`.

### 1.3. Статус

В `normalizeEquipmentRecord`: `status_name: asText(readFirst(row, ['status_name', 'STATUS_NAME', 'status', 'STATUS']))`.

Перед правкой проверить через `rg`, что ни один другой ответ, проходящий через `normalizeEquipmentRecord`, не использует `status` в другом смысле (например, статус job). Результат проверки — в отчёт.

### 1.4. Тесты шага 1

- `databaseApi.test.ts`: ответ с `{ inv_no: '1', status: 'В работе' }` → `status_name === 'В работе'`; приоритет у `status_name`, если есть оба.
- `NativeDatabaseScreens.test.tsx`:
  - нажатие на `…-copy` у серийного номера вызывает `Clipboard.setStringAsync('<serial из фикстуры>')` и показывает `testID="native-toast"` с текстом;
  - долгое нажатие на строку тоже копирует;
  - для пустого поля (`part_no: ''`) нет иконки копирования;
  - `Clipboard.setStringAsync` отклонён → уведомление «Не удалось скопировать»;
  - `native-equipment-copy-inv` копирует инв. №;
  - в `offlineMode` копирование работает.
- Прогнать: `npx jest src/screens/database src/api/databaseApi.test.ts src/database`, затем `npm run lint`.

### Приёмка шага 1

Любое из перечисленных полей копируется иконкой и долгим нажатием, появляется уведомление. Прокрутка и короткие нажатия ничего не копируют. Статус с сервера отображается в шапке и в поле. Существующие тесты зелёные.

---

## Шаг 2. Компоновка, действия, функции

Два исполнителя параллельно, файлы не пересекаются:

- **2-A (mobile)** — один исполнитель последовательно, подшаги 2.1 → 2.6. Каждый подшаг заканчивается зелёными `npx jest src/screens/database src/database src/components/database`.
- **2-B (backend)** — подшаг 2.7.

### 2.1. Шапка-«паспорт»

Файлы: `NativeEquipmentDetailScreen.tsx`, `nativeDatabaseModel.ts` (+ тест).

- `equipmentIcon(item)` в `nativeDatabaseModel.ts` — по ключевым словам `type_name + model_name` (как в `equipmentWorkKinds`):

  | Ключевые слова | Иконка |
  |---|---|
  | монитор/monitor | `monitor` |
  | ноутбук/laptop/notebook | `laptop` |
  | принтер/МФУ (`isPrinterLikeEquipment`) | `printer` |
  | ИБП/UPS | `power-plug-battery-outline` |
  | телефон/phone | `phone-classic` |
  | ПК/системный блок | `desktop-tower-monitor` |
  | иначе | `devices` |

- `equipmentStatusTone(statusName)`:

  | Статус | Тон |
  |---|---|
  | «в работе», «использ» | `success` |
  | «склад», «резерв» | `info` |
  | «ремонт» | `warning` |
  | «списан», «утерян», «утилиз» | `danger` |
  | иначе | `neutral` |

  Цвета брать из существующих токенов (`tokens.success`/`tokens.warning`/`tokens.error`/`tokens.primary`/`tokens.textSecondary` — какие реально есть в `fluentTokens`, проверить).
- Шапка:
  - иконка 56×56;
  - модель (`equipmentTitle`) крупно;
  - строка «Производитель · Тип»;
  - ряд плашек: «Инв. № … ⧉» (из шага 1), статус с цветной точкой, «S/N … ⧉» (если есть; копирует S/N).
- Тесты модели: `equipmentIcon` и `equipmentStatusTone` на типовых строках.

### 2.2. Секции и пустые поля

Файлы: `NativeEquipmentDetailScreen.tsx`, при необходимости новый `mobile-hub/src/components/database/NativeEquipmentSection.tsx`.

Порядок секций:

1. **Устройство:** Модель, Тип, Производитель, Серийный номер, Аппаратный S/N, Part number.
2. **Сотрудник и размещение:** Сотрудник (переход на склад + копирование ФИО), Отдел, E-mail (с `trailing`-иконкой `email-outline` → `mailto:` через существующий хелпер открытия внешних ссылок, как в адресной книге — найти через `rg openExternalUrl`), Размещение.
3. **Обслуживание** — из 2.4.
4. **Сеть:** Сетевое имя, IP-адрес, MAC-адрес, Домен.
5. **Описание:** текст; если больше 4 строк — свёрнут (`numberOfLines={4}`), кнопка «Ещё»/«Свернуть». Копирование — полное значение.
6. **Служебное:** Создано, Изменено, Изменил (`changed_by`, появится после 2.7).

Правила пустых значений:

- Пустые поля в секции не выводятся. Внизу секции ссылка «Показать пустые (N)» / «Скрыть пустые», состояние локальное для секции. `testID="native-equipment-section-<key>-empty-toggle"`.
- Если в секции все поля пустые — секция не выводится совсем. Исключение: «Устройство» — всегда, с одной ссылкой-переключателем.

Статус в секциях не дублировать: он в шапке.

### 2.3. Нижняя панель действий и меню ⋮

Файлы: `NativeEquipmentActions.tsx`, `NativeEquipmentDetailScreen.tsx`, новый `mobile-hub/src/components/database/NativeEquipmentActionBar.tsx`, `nativeDatabaseModel.ts` (текст для «Поделиться»).

`NativeEquipmentActions` — добавить управляемый режим, не меняя поведение по умолчанию:

- новый проп `triggers?: 'grid' | 'none'` (по умолчанию `'grid'` — как сейчас; экран списка не трогаем);
- `forwardRef` + `useImperativeHandle`, наружу метод `open(kind)`, где `kind`: `'owner' | 'location' | 'act-only' | EquipmentWorkKind | 'delete'`.
- При `triggers='none'` сетка кнопок не рендерится, модалка работает как раньше.

`NativeEquipmentActionBar` (передаётся в `footer` каркаса):

- Две кнопки в ряд: «Редактировать» (primary, `testID="native-equipment-edit"` — перенести со старой кнопки) и «Действия ▾» (outline, `testID="native-equipment-actions-open"`).
- «Действия» открывают нижнюю панель (`NativeModal`, стиль как у существующих sheet'ов) со списком:
  - «Передать сотруднику», «Сменить размещение», «Сформировать акт» — сохранить `testID` `native-equipment-transfer-owner|location|act-only`;
  - затем разделитель и работы по `equipmentWorkKinds(equipment)` — `testID` `native-equipment-record-work-<kind>`.

  Выбор пункта закрывает панель и вызывает `actionsRef.current.open(kind)`.
- Без `database.write` панели нет. Если прав нет вовсе — `footer` не передаётся.
- В `offlineMode` кнопки неактивны (`opacity 0.5`) с подписью «Недоступно без сети».
- Учесть нижний отступ: проверить, как `footer` соотносится с нижней навигацией (`useNativeBottomNavInset`). Последняя секция контента не должна уходить под панель.
- Старые кнопка «Редактировать» и сетка `NativeEquipmentActions surface="general"` в контенте убираются. На вкладке «Работы» сетка работ может остаться (`surface="works"`) — не удалять.

Меню ⋮ (`rightAction` каркаса, иконка `dots-vertical`, `testID="native-equipment-menu"`), нижняя панель со списком:

- «Скопировать всё» (`testID="native-equipment-copy-all"`) → `Clipboard.setStringAsync(equipmentShareText(item))` + уведомление «Карточка скопирована».
- «Поделиться» (`testID="native-equipment-share"`) → `Share.share({ message: equipmentShareText(item), title: equipmentTitle(item) })`. Отмену пользователем не считать ошибкой.
- Разделитель, затем «Удалить карточку» — красным, только если `canDeleteEquipment` (admin). Открывает существующий сценарий `open('delete')` с его подтверждением. Сохранить `testID="native-equipment-delete"`.

`equipmentShareText(item)` в `nativeDatabaseModel.ts`. Пустые строки пропускаются. Блоки разделяются пустой строкой, пустые блоки не выводятся:

```
<Модель>
Инв. №: …
Тип: …
Производитель: …
Статус: …
S/N: …
HW S/N: …
P/N: …

Сотрудник: <ФИО> (<отдел>)
E-mail: …
Размещение: <филиал · размещение>

Сетевое имя: …
IP: …
MAC: …
Домен: …

Описание:
<текст как есть>
```

«Размещение не указано» и «Сотрудник не назначен» (заглушки из `equipmentLocation`/`equipmentOwner`) в текст не попадают: брать исходные поля.

### 2.4. Последнее обслуживание

Файл: `NativeEquipmentDetailScreen.tsx`.

- Если `equipmentWorkKinds(equipment)` не пуст, в секции «Обслуживание» строки по каждому виду работ: «Чистка компьютера — 08.09.2026 · 3 недели назад» (`last_date` через `formatDatabaseDate` без времени или с ним — как в `NativeEquipmentWorkHistoryCard`; `time_ago_str`). Если записей нет — «нет записей».
- Ссылка «Все работы →» переключает вкладку на `works`.
- Данные: переиспользовать загрузку вкладки `works` (`loadTab('works')`) в фоне после загрузки карточки, онлайн. Требования:
  - нет повторного запроса, если `works` уже в `loadedTabs` или в снимке;
  - переход на вкладку «Работы» после фоновой загрузки не делает второй запрос;
  - фоновая загрузка не показывает спиннер и `tabError` на других вкладках. Сейчас `tabLoading`/`tabError` общие — развести по вкладкам или вести отдельный флаг для фоновой загрузки. Выбор за исполнителем, описать в отчёте;
  - в автономном режиме — только из снимка;
  - ошибка фоновой загрузки не показывается как ошибка экрана, секция просто не выводится.
- Секция не выводится для устройств без сценариев обслуживания.

### 2.5. Улучшенный редактор

Файлы: `NativeEquipmentDetailScreen.tsx`, новый `mobile-hub/src/components/database/NativeEquipmentOptionPicker.tsx`, `nativeDatabaseModel.ts` (валидация + тест).

- `EditorOptionStrip` заменить полем-выбором. Строка «Тип: Системный блок ›» открывает `NativeEquipmentOptionPicker` — нижняя панель:
  - `TextInput` поиска (фильтр `toLocaleLowerCase('ru-RU')`, подстрока);
  - `FlatList` вариантов, выбранный отмечен галочкой;
  - пустой результат — «Ничего не найдено»;
  - загрузка — спиннер.

  Для полей: Статус, Тип, Модель, Филиал, Размещение. Сохранить существующие зависимости: смена типа сбрасывает модель, смена филиала сбрасывает размещение. Модель неактивна, пока не выбран тип; размещение — пока не выбран филиал (с подсказкой).
- Выбор сотрудника оставить как есть: поиск уже есть.
- Состояние «без изменений»: при открытии запомнить исходный `editDraft`. «Сохранить» неактивна, пока черновик равен исходному (сравнение по полям, `null`/`''` считать равными). Отправляемый payload не менять — контракт PATCH тот же.
- Несохранённые правки: «Отмена» и системная кнопка «Назад» (`onRequestClose`) при изменённом черновике показывают `Alert.alert('Отменить изменения?', …, [Остаться, Отменить])`.
- Валидация перед сохранением (`validateEquipmentDraft` в `nativeDatabaseModel.ts`):
  - IP — пусто или IPv4 (4 октета 0–255);
  - MAC — пусто или 12 hex-символов с разделителями `:` / `-` / без разделителей.

  Ошибка показывается под полем, сохранение блокируется. Формат MAC не переписывать.
- MAC и IP: `autoCapitalize="characters"` для MAC, `"none"` для IP; `autoCorrect={false}`; `keyboardType` для IP — `numbers-and-punctuation`.
- Тесты:
  - `validateEquipmentDraft` на корректных и некорректных значениях;
  - экран: «Сохранить» неактивна без изменений;
  - неверный IP не отправляет `updateEquipment`;
  - выбор модели через picker с поиском;
  - «Отмена» с изменениями показывает `Alert`.

### 2.6. Поле `changed_by` и даты в приложении

Файлы: `databaseApi.ts` (+ тест).

- В `EquipmentRecord` добавить `changed_by?: string`. В `normalizeEquipmentRecord` читать `['ch_user', 'CH_USER', 'changed_by']`.
- Поле опциональное: старые снимки в кэше без него должны открываться.
- `date_create`/`date_last_modify` уже читаются. Проверить, что ISO-строка от FastAPI (`2026-08-18T17:26:00`) корректно форматируется `formatDatabaseDate`.

### 2.7. Сервер: даты карточки (исполнитель 2-B)

Файлы:

- `WEB-itinvent/backend/database/queries.py` — только `get_equipment_by_inv`;
- новый тест `tests/test_equipment_detail_dates.py`.

- По образцу существующего `_pick_first` для IP/MAC добавить необязательные колонки:
  - дата создания: кандидаты `CREATE_DATE`, `DATE_CREATE` → алиас `date_create`;
  - дата изменения: `CH_DATE`, `DATE_LAST_MODIFY` → `date_last_modify`;
  - автор: `CH_USER` → `ch_user`.
- Колонки нет — поле не выбирается, запрос не падает. Fallback `QUERY_GET_EQUIPMENT_BY_INV` не менять.
- Остальные алиасы, включая `status`, не трогать: на них опирается веб.
- Через `rg "date_create|DATE_CREATE|date_last_modify|ch_user" WEB-itinvent/frontend/src` найти веб-потребителей и описать в отчёте, изменится ли что-то в вебе. Веб не править.
- Тест: мок `get_db`/`_get_table_columns` (посмотреть стиль в `tests/test_equipment_request_database_scope.py`, `tests/test_equipment_locations_api.py`):
  - колонки есть → SQL содержит `i.CREATE_DATE as date_create`, `i.CH_DATE as date_last_modify`, `i.CH_USER as ch_user`;
  - колонок нет → SQL их не содержит;
  - `_get_table_columns` бросает исключение → запрос без них.
- Прогнать: `pytest -q tests/test_equipment_detail_dates.py tests/test_equipment_request_database_scope.py tests/test_equipment_locations_api.py tests/test_equipment_history_api.py`.
- Не обращаться к реальной БД. Реальное наличие колонок в `ITEMS` проверяет руководитель отдельно, read-only и с разрешения пользователя.

### Приёмка шага 2

- Шапка показывает иконку типа, модель, производителя и тип, плашки инв. №/статус/S/N.
- Пустые поля скрыты, переключатель работает.
- Нижняя панель: «Редактировать» и «Действия»; все прежние операции доступны через список. Удаление — только в ⋮ у администратора.
- «Скопировать всё» и «Поделиться» формируют текст по шаблону.
- Последнее обслуживание видно на вкладке «Карточка» без лишних запросов.
- Редактор: выбор с поиском, блокировка сохранения без изменений, подтверждение выхода, валидация IP/MAC.
- После выкладки сервера видны «Создано/Изменено/Изменил»; до выкладки секция «Служебное» скрыта.
- `npm run lint`, `npm run test:ci` (mobile) и указанный `pytest` зелёные.

---

## Проверка руководителем после каждого шага

1. Прочитать дифф и сверить с планом: список файлов, запреты, сохранность `testID`, экран списка не затронут.
2. Самостоятельно прогнать тесты шага.
3. Визуальная проверка по возможности (харнесс без правок репозитория): светлая и тёмная тема, ширина 360 dp, крупный шрифт, автономный режим, прокрутка без случайного копирования.
4. При замечаниях — вернуть исполнителю списком.

## Выкладка (не входит в задачи исполнителей)

Уточнено после подготовки выкладки 2026-09-30. Первоначальный текст раздела устарел: он не учитывал, что backend работает из рабочего дерева.

- Mobile — см. «Сборка и публикация APK» в разделе «Что осталось до выпуска».
- Backend (2.7) — см. раздел «Выкладка backend — подготовка 2026-09-30». Решение о варианте принимает пользователь, выполнение — только после его явного разрешения.
- Порядок выкладки mobile/backend не важен: без дат секция «Служебное» просто скрыта.

## Риски

- Долгое нажатие внутри `ScrollView` может конфликтовать с жестом прокрутки на части устройств — проверить на реальном Android.
- `NativeToastHost` смонтирован и в чате. `showNativeToast` рассылает всем хостам, но видимым будет только хост активного экрана.
- Если `works` не развести по флагам загрузки, фоновая загрузка обслуживания будет мигать спиннером на других вкладках (см. 2.4).
- Редактор по-прежнему отправляет полный черновик. Одновременная правка карточки с веба может перетереть поля (lost update) — существующее поведение, в этой итерации не меняем.

## Журнал выполнения

### Шаг 1 — Devin (AI-агент) — 2026-09-30
Статус: выполнен
Сделано:
- 1.1. Создан `NativeCopyableField` + экспортируемый helper `copyNativeFieldValue`: строка «подпись — значение», перенос значения на отдельную строку при длине > 28, переводе строки или `multiline`; `Text` со `selectable`; иконка `content-copy` 18 px `iconMuted` в `Pressable` 44×44 (`testID` `…-copy`); копирование по иконке и по `onLongPress` строки; короткое нажатие не копирует; `Clipboard.setStringAsync(trim())`, `=== false` считается ошибкой; `Haptics.selectionAsync()` с проглатыванием ошибок; `showNativeToast(copiedMessage ?? '<copyLabel> скопирован')`; при ошибке — «Не удалось скопировать». Пустое значение (`''`) рендерит «—» без иконки и без long-press; `null`/`undefined` — `null`. Доступность: `accessibilityLabel`, `accessibilityHint`, `accessibilityActions` (`copy`) → копирование.
- 1.2. В `NativeEquipmentDetailScreen` добавлен `<NativeToastHost />` сиблингом после `AccountScreenScaffold` (последним элементом, над контентом). `AccountField` заменён на `NativeCopyableField` для: Тип, Модель, Производитель, Серийный номер, Аппаратный S/N, Part number, Размещение, E-mail, IP-адрес, MAC-адрес, Сеть, Домен, Описание (`multiline`). Статус, Создано, Изменено остались `AccountField`. Строка «Сотрудник — Склад в Хабе и в 1С»: добавлена иконка `native-equipment-employee-copy` (копирует `employee_name`) и `onLongPress` на самой строке; без права `warehouse_1c.read` — `NativeCopyableField` с `copyValue={employee_name}`. Шапка: «Инв. № …» стала плашкой-кнопкой `testID="native-equipment-copy-inv"` с иконкой ⧉ — копирует `inv_no` («Инвентарный номер скопирован»).
- 1.3. В `normalizeEquipmentRecord`: `status_name` читает `['status_name', 'STATUS_NAME', 'status', 'STATUS']`.
- 1.4. Добавлены тесты: в `databaseApi.test.ts` — алиас `status` → `status_name`, приоритет `status_name` при обоих полях; в `NativeDatabaseScreens.test.tsx` — копирование S/N иконкой и долгим нажатием (toast `native-toast` «Серийный номер скопирован»), пустое поле без иконки, отказ буфера → «Не удалось скопировать», плашка инв. №, копирование в `offlineMode`.
Файлы:
- `mobile-hub/src/components/database/NativeCopyableField.tsx` — новый, компонент строки с копированием и helper `copyNativeFieldValue`.
- `mobile-hub/src/screens/database/NativeEquipmentDetailScreen.tsx` — изменён, подключение полей/плашки/сотрудника и `NativeToastHost`.
- `mobile-hub/src/api/databaseApi.ts` — изменён, fallback `status_name` на `status`/`STATUS`.
- `mobile-hub/src/api/databaseApi.test.ts` — изменён, +2 теста нормализации статуса.
- `mobile-hub/src/screens/database/NativeDatabaseScreens.test.tsx` — изменён, +5 тестов копирования.
Проверки (фактический вывод, без пересказа «всё ок»):
- `npx jest src/screens/database src/api/databaseApi.test.ts src/database` (параллельный прогон) → 6 suites, 79 tests: 3 упали по таймауту 5 с — `NativeDatabasePerformance.test.tsx` (1), `NativeDatabaseScreens.test.tsx` (1 существующий + 1 новый). Изолированные перепрогоны: `NativeDatabaseScreens.test.tsx` — 39/39 за 22 с; `NativeDatabasePerformance.test.tsx` — 3/3 за 3.9 с. Повтор серийно (`--runInBand`): 6/6 suites, 79/79 tests.
- `npm run lint` (`tsc --noEmit`) → exit 0, ошибок нет.
- `npm run test:ci` → 333 suites: 330 passed, 3 failed; 2196 tests: 2193 passed, 3 failed. Все 3 падения — таймауты в файлах вне шага: `NativeMailScreens.test.tsx` (удаление в trash, 5 с), `NativeDocflowScreens.test.tsx` (учётные данные 1С, 5 с), `nativeSnapshotStorage.integration.test.ts` (конкурентная замена шардов, 15 с). Изолированный перепрогон этих 3 сьютов: 171/171 passed — флаки от нагрузки окружения, не регрессии.
- Backend pytest не запускался: шаг 1 не включает backend-файлов.
Отклонения от плана:
- План 1.1 содержит формулировку «пустое значение: компонент возвращает `null`» и рядом «в шаге 1 для пустого значения показывать „—“ без иконки». Выбрано второе: `''` → строка «—» без копирования; `null`/`undefined` → `null`. Соответствует ожиданию теста «для пустого поля нет иконки» и поведению бывшего `AccountField`.
- Размещение: `copyValue` — исходные `branch_name`/`location_name` через « · », а не отображаемый `equipmentLocation()` с заглушками — чтобы в буфер не попадало «Размещение не указано». Аналогично «Сотрудник»: копируется `employee_name` без отдела.
Расхождения плана с кодом:
- План говорит «`NativeToastHost` сейчас подключён только в `NativeChatThreadScreen.tsx`» — подтверждено; добавлен и в детальном экране.
- Проверка `status` по 1.3: в `queries.py` `status` встречается только как `s.DESCR as status` в `QUERY_GET_EQUIPMENT_BY_INV` и в динамическом `get_equipment_by_inv` — та же семантика «описание статуса». Списочный запрос по сотруднику использует `status_name`. Конфликтующих смыслов `status` в ответах, проходящих через `normalizeEquipmentRecord`, не найдено.
Не проверено:
- Реальное устройство Android: долгое нажатие внутри `ScrollView` vs прокрутка (известный риск плана), светлая/тёмная тема, 360 dp, крупный системный шрифт — нет доступа к устройству/эмулятору из среды выполнения.
- Визуально, что toast показывается только хостом активного экрана — проверено только тестами по `testID="native-toast"`.
Вопросы руководителю:
- нет

### Проверка шага 1 — руководитель — 2026-09-30

Вердикт: **на доработку**. Функционально шаг выполнен, журнал совпадает с диффом. До сборки нужно исправить вёрстку (З-1).

Проверки руководителя:

- `npm run lint` (`tsc --noEmit`) → exit 0.
- `npx jest src/screens/database src/api/databaseApi.test.ts src/database src/components --runInBand` → 54 suites, 280 tests: 279 passed, 1 failed. Падает существующий тест `searches equipment and opens the native detail route` (таймаут 5 с на холодном старте). Изолированно `NativeDatabaseScreens.test.tsx` → 39/39 за 6,5 с. Нестабильный тест, не регрессия шага 1.
- Семантика `status` дополнительно сверена со снимком последних карточек (`WEB-itinvent/backend/services/equipment_recent_cards_service.py`, ключ `status` = описание статуса) — вывод исполнителя подтверждён.

Замечания:

| № | Важность | Где | Суть | Что сделать |
|---|---|---|---|---|
| З-1 | Обязательно | `NativeCopyableField.tsx`, стиль `textWrapStacked` | Нет `flex: 1, minWidth: 0`. В RN `flexShrink` по умолчанию 0, поэтому блок с длинным значением (> 28 символов: описание, e-mail, размещение) занимает всю ширину строки и выталкивает иконку ⧉ за край карточки. Тесты jest вёрстку не ловят | `textWrapStacked: { flex: 1, minWidth: 0, flexDirection: 'column', alignItems: 'stretch', gap: 2 }` |
| З-2 | Желательно | `NativeCopyableField.tsx`, `Text selectable` | На Android выделяемый текст перехватывает долгое нажатие: вместо копирования начинается выделение, `onLongPress` строки может не сработать | `selectable` только при `multiline`. Для остальных значений убрать |
| З-3 | Мелочь | `NativeEquipmentDetailScreen.tsx`, строка сотрудника (`native-equipment-employee-compare`) | В автономном режиме `disabled={offlineMode}` выключает и `onLongPress` → долгое нажатие не копирует ФИО, хотя копирование должно работать без сети | Не делать строку `disabled`. В `onPress` открывать склад только при `!offlineMode`; `accessibilityState.disabled` и приглушение оставить для перехода. `onLongPress` работает всегда |
| З-4 | Мелочь | `NativeCopyableField.tsx`, ветка пустого значения | `View` с `accessibilityLabel` без `accessible` — TalkBack подпись не прочитает | Добавить `accessible` и `accessibilityLabel="<label>: не указано"` |
| З-5 | План | Раздел 1.1 | Противоречие «возвращает `null`» / «показывать „—“» и требование `selectable` у всех значений | Исправлено руководителем в тексте 1.1. Выбор исполнителя («—» для `''`, `null` для `null`/`undefined`) принят |

Приемлемые отклонения исполнителя: `NativeToastHost` стоит соседним элементом после каркаса экрана; размещение и сотрудник копируются без заглушек «не указано».

### Доработка шага 1 (задача исполнителю)

Файлы:

- `mobile-hub/src/components/database/NativeCopyableField.tsx`;
- `mobile-hub/src/screens/database/NativeEquipmentDetailScreen.tsx`;
- `mobile-hub/src/screens/database/NativeDatabaseScreens.test.tsx`.

1. Исправить З-1 — З-4 по таблице выше. Больше ничего не менять.
2. Тесты:
   - в `offlineMode` долгое нажатие на `native-equipment-employee-compare` вызывает `Clipboard.setStringAsync(<employee_name>)`, а обычное нажатие не открывает склад (фикстура должна давать право `warehouse_1c.read` — проверить, как это мокается в файле);
   - у значения без `multiline` нет `selectable`, у описания — есть (через `props.selectable` найденного `Text`);
   - пустое поле: `accessible === true` и `accessibilityLabel` содержит «не указано».
3. Прогнать: `npx jest src/screens/database src/api/databaseApi.test.ts src/database --runInBand` и `npm run lint`. Если снова упадёт `searches equipment and opens the native detail route` — перепрогнать файл изолированно и записать оба результата. Сам тест не менять.
4. Дописать в журнал подраздел `### Доработка шага 1 — <исполнитель> — <дата>` в том же формате. В таблице в начале плана поставить статус «Доработка шага 1 выполнена, на проверке».

### Доработка шага 1 — Devin (AI-агент) — 2026-09-30
Статус: выполнен
Сделано:
- З-1. `textWrapStacked`: добавлены `flex: 1, minWidth: 0` — длинное значение больше не выталкивает иконку ⧉ за край строки.
- З-2. `selectable` теперь `selectable={multiline}`: у обычных значений выделяемый текст убран, у `multiline` (Описание) остался.
- З-3. Строка `native-equipment-employee-compare` больше не `disabled`: `onPress` открывает склад только при `!offlineMode`; `accessibilityState={{ disabled: offlineMode }}` и приглушение `opacity 0.5` сохранены; `onLongPress` копирует ФИО всегда.
- З-4. Ветка пустого значения: `View` получил `accessible` и `accessibilityLabel="<label>: не указано"` вместо «<label>: —».
Файлы:
- `mobile-hub/src/components/database/NativeCopyableField.tsx` — изменён, правки З-1, З-2, З-4.
- `mobile-hub/src/screens/database/NativeEquipmentDetailScreen.tsx` — изменён, правка З-3 (убран `disabled`, guard в `onPress`).
- `mobile-hub/src/screens/database/NativeDatabaseScreens.test.tsx` — изменён: импорт `within`; +2 теста (offline long-press на `native-equipment-employee-compare` без открытия склада; `selectable` только у multiline-описания); тест пустого поля расширен проверками `accessible === true` и `accessibilityLabel` ⊃ «не указано».
Проверки (фактический вывод, без пересказа «всё ок»):
- `npx jest src/screens/database src/api/databaseApi.test.ts src/database --runInBand` → 6/6 suites, 81/81 tests, ~9 с. `searches equipment and opens the native detail route` в этот раз не падал, изолированный перепрогон не потребовался.
- `npm run lint` (`tsc --noEmit`) → exit 0, ошибок нет.
- `npm run test:ci` не запускался: в «Доработке шага 1» указаны только jest-scope и lint.
Отклонения от плана:
- Тест пустого поля добавлен расширением существующего `renders an empty field without a copy affordance` (тот же объект проверки), а не отдельным `it`.
Расхождения плана с кодом:
- нет
Не проверено:
- Реальное устройство Android: вёрстка stacked-строки и поведение долгого нажатия — jest вёрстку и жесты не проверяет; правки З-1/З-2/З-3 подтверждены только кодом и unit-тестами.
Вопросы руководителю:
- нет

### Шаг 2-A (mobile, 2.1–2.6) — Devin (AI-агент) — 2026-09-30
Статус: выполнен
Сделано:
- 2.1. `equipmentIcon` (иконка по типу/модели/производителю) и `equipmentStatusTone` (success/warning/danger/neutral по нормализованному статусу) в `nativeDatabaseModel` + тесты. Шапка-«паспорт»: иконка в скруглённой плашке, название, «Инв. №» — копируемая плашка, плашка статуса с цветной точкой по тону, плашка S/N с копированием.
- 2.2. Новый `NativeEquipmentSection` — секция скрывает пустые поля, «Показать пустые (N)»/`«Скрыть пустые»` (`native-equipment-section-<key>-empty-toggle`), секция целиком скрыта, если все поля пусты (кроме «Устройство»). Порядок секций по плану: Устройство → Сотрудник и размещение → Обслуживание → Сеть → Описание → Служебное. Описание через `NativeEquipmentDescriptionField`: `numberOfLines={4}`, «Ещё/Свернуть» по факту переполнения (замер строк), копирование полного значения.
- 2.3. `equipmentShareText` в модели. `NativeEquipmentActions`: режим `triggers="none"` + `ref.open(kind)` — все действия (запись работ, передача, удаление и т.д.) открываются программно, список триггеров при этом не рендерится. Новый `NativeEquipmentActionBar` (нижняя панель «Редактировать»/«Действия», `NativeActionSheetItem`/`NativeActionSheetDivider` для меню). В шапке scaffold — `⋮` (`native-equipment-menu`): «Скопировать всё», «Поделиться» (Share), «Удалить карточку» только при праве на удаление, в оффлайне заблокировано.
- 2.4. Секция «Обслуживание» на вкладке «Карточка»: строки вида «Чистка компьютера — 20.08.2026, 05:00 · 4 дн. назад» (formatDatabaseDate + time_ago_str) либо «нет записей», ссылка «Все работы →» переключает вкладку. Данные — фоновый `loadTab('works', false, silent=true)` после загрузки карточки: без спиннера/`tabError`, без повторного запроса при `loadedTabs`/снимке, в оффлайне только снимок, при ошибке секция скрыта (`worksSummaryFailed`). Секция не выводится при пустом `equipmentWorkKinds`.
- 2.5. Новый `NativeEquipmentOptionPicker` — нижняя панель с `TextInput` поиска (`toLocaleLowerCase('ru-RU')`, подстрока), FlatList с галочкой на выбранном, «Ничего не найдено», спиннер при загрузке. `EditorOptionStrip` заменён строками-выборами для Статус/Тип/Модель/Филиал/Размещение; зависимости сохранены (тип→сброс модели, филиал→сброс размещения; модель/размещение неактивны с подсказкой). Dirty-check: «Сохранить» неактивна, пока черновик равен исходному (`null`/`''` равны). «Отмена» и `onRequestClose` при изменённом черновике — `Alert.alert('Отменить изменения?', …, [Остаться, Отменить])`. `validateEquipmentDraft` в модели: IP — пусто или 4 октета 0–255; MAC — пусто или 12 hex с `:`/`-`/без разделителей; ошибки под полями, сохранение блокируется, формат MAC не переписывается. IP: `autoCapitalize="none"`, `autoCorrect={false}`, `keyboardType="numbers-and-punctuation"`; MAC: `autoCapitalize="characters"`, `autoCorrect={false}`.
- 2.6. `EquipmentRecord.changed_by?: string`, читается из `['ch_user', 'CH_USER', 'changed_by']`; старые снимки без поля открываются. В секцию «Служебное» добавлена строка «Изменил» (AccountField, скрыта при пустом значении). ISO `2026-08-18T17:26:00` корректно форматируется `formatDatabaseDate` (тест API).
Файлы:
- `mobile-hub/src/database/nativeDatabaseModel.ts` — изменён: equipmentIcon, equipmentStatusTone, equipmentShareText, validateEquipmentDraft, EquipmentDraftErrors.
- `mobile-hub/src/database/nativeDatabaseModel.test.ts` — изменён: тесты иконки/тона/share-текста/валидации.
- `mobile-hub/src/components/database/NativeEquipmentSection.tsx` — новый: секция с переключателем пустых полей + `NativeEquipmentDescriptionField`.
- `mobile-hub/src/components/database/NativeEquipmentActionBar.tsx` — новый: нижняя панель действий + item/divider меню.
- `mobile-hub/src/components/database/NativeEquipmentOptionPicker.tsx` — новый: панель выбора с поиском.
- `mobile-hub/src/components/database/NativeEquipmentActions.tsx` — изменён: `triggers`, `open(kind)` через ref.
- `mobile-hub/src/screens/database/NativeEquipmentDetailScreen.tsx` — изменён: шапка-паспорт, секции, нижняя панель, меню ⋮, обслуживание, редактор.
- `mobile-hub/src/screens/database/NativeDatabaseScreens.test.tsx` — изменён: новые тесты 2.2–2.5, переписана навигация действий под панель.
- `mobile-hub/src/api/databaseApi.ts` — изменён: `changed_by`.
- `mobile-hub/src/api/databaseApi.test.ts` — изменён: тест `changed_by`/`date_last_modify`.
Проверки (фактический вывод, без пересказа «всё ок»):
- 2.1: `npx jest src/screens/database src/database src/components/database --runInBand` — первый прогон: таймаут `searches equipment and opens the native detail route`; изолированный перепрогон файла → PASS (флаки, тест не менялся). Повторный прогон scope — зелёный.
- 2.2: тот же scope → 5/5 suites, 61/61.
- 2.3: тот же scope → 5/5 suites, 61/61.
- 2.4: файл экранов — первый прогон поймал реальную гонку (префетч `works` ломал lease вкладки при старте на «Работах») → исправлено пропуском префетча при `tab === 'works'`; повторный прогон: единичный флаки `stores an opened equipment card…` (изолированно PASS), затем 45/45.
- 2.5: `src/screens/database src/database --runInBand` → 5/5 suites, 70/70.
- 2.6: `src/api/databaseApi.test.ts --runInBand` → 23/23.
- Итоговый scope: `npx jest src/screens/database src/api/databaseApi.test.ts src/database --runInBand` → 6/6 suites, 93/93.
- `npm run lint` (`tsc --noEmit`) → exit 0.
- `npm run test:ci` → 333/333 suites, 2210/2210 tests, ~710 с, падений нет.
Отклонения от плана:
- 2.4: `tabLoading`/`tabError` не разводились по вкладкам — выбран отдельный «тихий» режим `loadTab('works', false, true)` + флаг `worksSummaryFailed` для скрытия секции при ошибке/оффлайне без снимка.
- 2.4: до окончания фоновой загрузки в секции показывается текст «Загрузка…» (не спиннер), что план не запрещает.
- 2.5: смешанные разделители MAC (`AA:BB-…`) считаются невалидными — принят единый разделитель или его отсутствие, это согласуется с формулировкой «разделителями : / - / без разделителей».
- 2.5: значение строки выбора при отсутствии id в загруженных опциях откатывается на имя из карточки (`equipment.*_name`), чтобы не показывать «Не выбрано» для уже выбранного значения.
- «Изменил» добавлен в «Служебное» в 2.6 (п. 6 порядка секций плана), как `AccountField` — единообразно с «Создано»/«Изменено».
Расхождения плана с кодом:
- нет
Не проверено:
- Реальное устройство: нижняя панель над клавиатурой/safe-area, жесты шторки пикера, крупный шрифт и узкая ширина — jest вёрстку и жесты не проверяет.
- «Изменил»/даты будут пусты до серверной части (шаг 2-B, исполнитель другой) — поле опционально, секция просто скрывается.
Вопросы руководителю:
- нет

### Шаг 2-B (backend, 2.7) — Devin (AI-агент) — 2026-09-30
Статус: выполнен
Сделано:
- 2.7. В `get_equipment_by_inv` по образцу `_pick_first` добавлены необязательные колонки из `ITEMS`: дата создания `CREATE_DATE`→`date_create` (fallback `DATE_CREATE`), дата изменения `CH_DATE`→`date_last_modify` (fallback `DATE_LAST_MODIFY`), автор `CH_USER`→`ch_user`. Колонки нет в INFORMATION_SCHEMA — поле не выбирается, запрос не падает; при ошибке чтения метаданных запрос выполняется без новых колонок. Fallback `QUERY_GET_EQUIPMENT_BY_INV` и остальные алиасы (включая `status`) не тронуты.
Файлы:
- `WEB-itinvent/backend/database/queries.py` — изменён: только `get_equipment_by_inv` (`optional_extra_select`).
- `tests/test_equipment_detail_dates.py` — новый: мок `get_db`/`_get_table_columns`; колонки есть → алиасы в SQL; только вторые кандидаты → `DATE_CREATE`/`DATE_LAST_MODIFY`; колонок нет → SQL их не содержит; `_get_table_columns` бросает → запрос без них.
Проверки (фактический вывод, без пересказа «всё ок»):
- `python -m pytest -q tests/test_equipment_detail_dates.py tests/test_equipment_request_database_scope.py tests/test_equipment_locations_api.py tests/test_equipment_history_api.py` → **35 passed** (4 новых + 31 существующий), 132 с.
Веб-потребители (`rg` по `WEB-itinvent/frontend/src`):
- `ch_user`/`CH_USER` читаются в `detailModel.js` (`buildDetailActSummary` — сводка акта, другой эндпоинт) и в панели истории `EquipmentDetailHistoryPanel.jsx` (эндпоинт истории). Ответ `get_equipment_by_inv` ни один веб-компонент по этим ключам не читает.
- `create_date`/`ch_date` веб ждёт как `create_date`/`ch_date` (сводка акта), а не `date_create`/`date_last_modify` — наши алиасы вебом не подхватываются.
- Итог: в вебе ничего не меняется, веб не правился.
Отклонения от плана:
- нет
Расхождения плана с кодом:
- нет
Не проверено:
- Реальный SQL Server: наличие колонок `CREATE_DATE`/`CH_DATE`/`CH_USER` в production `ITEMS` не проверялось (БД не трогал); если колонок нет — поля просто не вернутся, приложение покажет пустые «Создано/Изменено/Изменил».
- Перезапуск backend не выполнялся — изменение подхватится при штатном деплое/рестарте.
Вопросы руководителю:
- нет

### Проверка доработки шага 1 — руководитель — 2026-09-30

Вердикт: **принято**. З-1 — З-4 исправлены в коде так, как записано в плане.

- `npm run lint` → exit 0.
- `npx jest src/screens/database src/api/databaseApi.test.ts src/database src/components/database --runInBand` → 92/93. Упал существующий нестабильный тест `searches equipment and opens the native detail route` (таймаут). Изолированно файл прошёл 48/48 дважды. К этому плану не относится, чинить отдельно.
- Остаётся проверить на устройстве: у описания долгое нажатие может начинать выделение текста вместо копирования (ожидаемо по 1.1). Иконка ⧉ работает всегда.

### Проверка шага 2 — руководитель — 2026-09-30

Вердикт: **2-B принят, 2-A — на доработку**. Объём выполнен в границах плана. Список файлов соблюдён, `NativeDatabaseScreen.tsx` не тронут, `testID` сохранены.

Проверки руководителя:

- `npx jest src/screens/database src/api/databaseApi.test.ts src/database src/components/database --runInBand` → 6/6 suites, 93/93.
- `npm run lint` (`tsc --noEmit`) → exit 0.
- `python -m pytest -q tests/test_equipment_detail_dates.py` → 4 passed. Тест изолирован моками, к БД не обращается.
- `queries.py`: имена колонок только из фиксированного списка кандидатов, пользовательский ввод в SQL не попадает. Алиас `status` и fallback-запрос не тронуты.

Замечания:

| № | Важность | Где | Суть | Что сделать |
|---|---|---|---|---|
| Ш2-1 | Обязательно | `NativeEquipmentDetailScreen.tsx`, `editErrors = validateEquipmentDraft(editDraft)` и проверка в `saveEditor` | Валидируется весь черновик. Если в legacy-карточке уже лежит невалидный IP/MAC (два адреса через запятую, `DHCP`, IPv6), поле сразу красное при открытии редактора. Сохранить любую другую правку (статус, сотрудник) нельзя, пока не исправлен IP | Проверять IP/MAC, только если значение поля отличается от `initialDraft` (с той же нормализацией `null`/`''`, что в `editDirty`). Неизменённое поле без ошибки и без красной рамки |
| Ш2-2 | Обязательно | `NativeEquipmentDetailScreen.tsx`, `<NativeEquipmentActions ref={actionsRef} … onChanged={() => loadEquipment(true)} />` | Работа, записанная через нижнюю панель, вызывает только `loadEquipment(true)`. Тихая предзагрузка `works` после этого не срабатывает (`loadedTabs` уже содержит `works`) → «Обслуживание» показывает старую дату, список на вкладке «Работы» не обновляется. Регрессия: раньше сетка работ вызывала `loadTab('works', true)` | В `onChanged` ref-экземпляра после `loadEquipment(true)` принудительно перезагружать `works`: `loadTab('works', true, tab !== 'works')`, если у оборудования есть `equipmentWorkKinds`. Передачи и акты по-прежнему обновляют карточку |
| Ш2-3 | Желательно | `nativeDatabaseModel.ts`, `equipmentStatusTone` | «Не используется» содержит «использ» → зелёный `success` | Перед проверкой `success` обрабатывать отрицание «не использ» / «не в работе» → `neutral`. Добавить тест |
| Ш2-4 | Желательно | `NativeDatabaseScreens.test.tsx` | Нет тестов на ключевые сценарии 2.3 | Добавить: «Скопировать всё» → `Clipboard.setStringAsync(<текст equipmentShareText>)` и уведомление «Карточка скопирована»; «Поделиться» → `Share.share` с `message`, отказ `Share.share` не показывает ошибку; без `database.write` нет `native-equipment-edit` и `native-equipment-actions-open`; не-администратор не видит `native-equipment-delete` в меню ⋮; тест на Ш2-2 (после записи работы через панель `getEquipmentWorkHistories` вызывается повторно, в «Обслуживании» новая дата); тест на Ш2-1 (невалидный legacy-IP не блокирует смену статуса) |
| Ш2-5 | Мелочь | `validateEquipmentDraft` | Журнал утверждает, что смешанные разделители MAC (`AA:BB-CC…`) не принимаются, но регулярное выражение `([0-9a-fA-F]{2}[:-]){5}` их пропускает | Единый разделитель через обратную ссылку: `^[0-9a-fA-F]{2}([:-])(?:[0-9a-fA-F]{2}\1){4}[0-9a-fA-F]{2}$`. Добавить тест на смешанные разделители |
| Ш2-6 | Мелочь | `NativeEquipmentSection.tsx`, `NativeEquipmentDescriptionField` | Число строк меряется один раз: сначала мелькает весь текст, потом сворачивается; при смене `value` после обновления признак «длинное» не пересчитывается | Сбрасывать `totalLines` и `expanded` при смене `value` (например, `useEffect` по `value`). Мерить скрытой копией текста или принять мелькание — решить и описать в журнале |
| Ш2-7 | Мелочь | `NativeEquipmentDetailScreen.tsx`, плашка статуса в шапке | `View` с `accessibilityLabel` без `accessible` — TalkBack не прочитает | Добавить `accessible` |

Приемлемые отклонения исполнителя: тихий режим `loadTab(…, silent)` вместо разведения флагов по вкладкам; «Загрузка…» в секции «Обслуживание»; fallback имени из карточки в строках выбора редактора.

Не проверено (нужен Android): нижняя панель и отступ нижней навигации; окно выбора с поиском и клавиатура (прозрачная модалка внутри модалки редактора); переходы «⋮ → Удалить» и «Действия → пункт» (закрытие одной модалки и открытие другой); тёмная тема, 360 dp, крупный шрифт.

### Доработка шага 2-A (задача исполнителю)

Файлы:

- `mobile-hub/src/screens/database/NativeEquipmentDetailScreen.tsx`;
- `mobile-hub/src/components/database/NativeEquipmentSection.tsx`;
- `mobile-hub/src/database/nativeDatabaseModel.ts`;
- `mobile-hub/src/database/nativeDatabaseModel.test.ts`;
- `mobile-hub/src/screens/database/NativeDatabaseScreens.test.tsx`.

1. Исправить Ш2-1 — Ш2-7 по таблице выше. Больше ничего не менять. Серверную часть (2-B) не трогать.
2. Тесты — перечисленные в Ш2-3, Ш2-4, Ш2-5.
3. Прогнать:
   - `npx jest src/screens/database src/api/databaseApi.test.ts src/database src/components/database --runInBand`;
   - `npm run lint`;
   - `npm run test:ci`.

   Если снова упадёт `searches equipment and opens the native detail route`, перепрогнать файл изолированно и записать оба результата. Сам тест не менять.
4. Дописать в журнал подраздел `### Доработка шага 2-A — <исполнитель> — <дата>` в том же формате. В таблице в начале плана поставить статус «Доработка шага 2-A выполнена, на проверке». Остальной текст плана не менять.

### Доработка шага 2-A — Devin (AI-агент) — 2026-09-30
Статус: выполнен
Сделано (по Ш2-1…Ш2-7):
- Ш2-1. `editErrors` фильтрует результат `validateEquipmentDraft` по полям, отличающимся от `initialDraft` (та же нормализация `null`/`''`, что у `editDirty`). Неизменённый невалидный legacy-IP/MAC не подсвечивается и не блокирует сохранение других полей; изменённое значение валидируется как раньше.
- Ш2-2. `onChanged` ref-экземпляра `NativeEquipmentActions` после `loadEquipment(true)` принудительно вызывает `loadTab('works', true, tab !== 'works')`, если `equipmentWorkKinds(equipment)` непуст: на вкладке «Карточка» — тихо (обновляет секцию «Обслуживание»), на «Работы» — обычным способом. Передачи и акты по-прежнему обновляют карточку через `loadEquipment(true)`.
- Ш2-3. `equipmentStatusTone` до проверки `success` отсекает отрицания «не использ» / «не в работе» → `neutral`. Тесты добавлены.
- Ш2-4. Добавлены тесты: «Скопировать всё» → `Clipboard.setStringAsync(<equipmentShareText>)` и тост «Карточка скопирована»; «Поделиться» → `Share.share` с `message`, отказ не показывает ошибку; без `database.write` нет `native-equipment-edit` и `native-equipment-actions-open`; не-администратор не видит `native-equipment-delete` в ⋮; тест Ш2-2 (повторный вызов `getEquipmentWorkHistories`, новая дата в «Обслуживании»); тест Ш2-1 (невалидный legacy-IP не блокирует смену статуса).
- Ш2-5. MAC-валидация переведена на единый разделитель через обратную ссылку: `^[0-9a-fA-F]{2}([:-])(?:[0-9a-fA-F]{2}\1){4}[0-9a-fA-F]{2}$`; смешанные `:`/`-` отклоняются. Тест добавлен.
- Ш2-6. Выбран вариант «скрытая мерная копия»: видимый текст сразу `numberOfLines={4}` (если не развёрнут), полную высоту меряет абсолютно позиционированная копия с `opacity: 0` и `onTextLayout` — мелькания полного текста нет. При смене `value` (`useEffect` по вычисленному `display`) `totalLines` и `expanded` сбрасываются, признак «длинное» пересчитывается. Мерная копия скрыта от доступности: `accessibilityElementsHidden` + `importantForAccessibility="no-hide-descendants"`.
- Ш2-7. Плашке статуса в шапке добавлен `accessible` — TalkBack читает `Статус: …`.
Файлы:
- `mobile-hub/src/database/nativeDatabaseModel.ts` — изменён: отрицание в `equipmentStatusTone`, единый разделитель в `validateEquipmentDraft`.
- `mobile-hub/src/components/database/NativeEquipmentSection.tsx` — изменён: скрытое измерение описания, сброс при смене `value`.
- `mobile-hub/src/screens/database/NativeEquipmentDetailScreen.tsx` — изменён: `editErrors` только по изменённым полям, повторная загрузка works в `onChanged`, `accessible` у плашки статуса.
- `mobile-hub/src/database/nativeDatabaseModel.test.ts` — изменён: кейсы Ш2-3 и Ш2-5.
- `mobile-hub/src/screens/database/NativeDatabaseScreens.test.tsx` — изменён: +6 тестов (Ш2-4, Ш2-2, Ш2-1).
Проверки (фактический вывод, без пересказа «всё ок»):
- `npx jest src/screens/database src/api/databaseApi.test.ts src/database src/components/database --runInBand` → 6/6 suites, **99/99 tests**. На первом прогоне упал 1 новый тест Ш2-2: сводку запрашивал при открытой модалке действий, а в RNTL v14 `accessibilityViewIsModal` прячет соседний контент из запросов. Тест дополнен закрытием модалки (`Закрыть операцию`) — повторные прогоны стабильно зелёные. Тест `searches equipment and opens the native detail route` не падал.
- `npm run lint` (`tsc --noEmit`) → exit 0.
- `npm run test:ci` → **333/333 suites, 2216/2216 tests**.
Отклонения от плана:
- В тесте Ш2-2 сводка проверяется после закрытия модалки действий (семантика `accessibilityViewIsModal`), а не одновременно с ней; само требование — повторный запрос и новая дата — проверено полностью.
Расхождения плана с кодом:
- нет
Не проверено:
- Реальное устройство: поведение скрытой мерной копии описания и `accessibilityViewIsModal` под TalkBack проверены только тестовым окружением.
Вопросы руководителю:
- нет

### Проверка доработки шага 2-A — руководитель — 2026-09-30

Вердикт: **принято**. Ш2-1 — Ш2-7 исправлены, журнал совпадает с кодом. Код по плану (шаги 1, 2-A, 2-B) завершён.

Проверки руководителя:

- `npx jest src/screens/database src/api/databaseApi.test.ts src/database src/components/database --runInBand` → 6/6 suites, 99/99.
- `npm run lint` (`tsc --noEmit`) → exit 0.
- `npm run test:ci` руководитель не запускал (~12 мин). У исполнителя: 333/333 suites, 2216/2216 tests.

Проверено в коде:

- Ш2-1 — `editErrors` снимает ошибку с неизменённых IP/MAC. Тест: legacy `DHCP, 10.0.0.7` не блокирует смену статуса.
- Ш2-2 — `onChanged` ref-экземпляра делает `loadTab('works', true, tab !== 'works')`. Тест: повторный `getEquipmentWorkHistories` и новая дата в «Обслуживании».
- Ш2-3 — отрицания «не использ» / «не в работе» → `neutral`.
- Ш2-5 — единый разделитель MAC через обратную ссылку.
- Ш2-6 — невидимая мерная копия (`position: absolute; left/right: 0; opacity: 0`, скрыта от доступности), сброс по смене `value`.
- Ш2-7 — `accessible` у плашки статуса.

Замечания на следующую итерацию (не блокируют):

| № | Суть | Предложение |
|---|---|---|
| Н-1 | После операции `loadEquipment(true)` и `loadTab('works', …)` идут параллельно, и обе пишут снимок `database-item-details`. `loadTab` пишет `equipment` из замыкания (до операции) и может перезаписать свежую карточку → при следующем офлайн-открытии возможно устаревшее описание. Онлайн-открытие обновляет данные | Писать снимок works поверх актуального снимка (перечитывать перед записью) или выполнять `loadTab` после `loadEquipment` с актуальной карточкой |
| Н-2 | `works` перезагружается и после передач/актов — лишние запросы | Перезагружать `works` только для действий вида `EquipmentWorkKind` (передавать вид действия в `onChanged`) |
| Н-3 | Нестабильный тест `searches equipment and opens the native detail route` (таймаут 5 с на холодном старте при общем прогоне) | Отдельная задача вне плана |

### Замечания Н-1…Н-3 — Devin (AI-агент) — 2026-09-30
Статус: выполнены по выбору пользователя («Н-1, Н-2 и Н-3»)
Сделано:
- Н-1. Гонка снимка `database-item-details` устранена двумя приёмами из предложения руководителя:
  - `equipmentRef` (`useRef`) всегда держит свежую карточку: обновляется синхронно в `applyCachedDetail`, в `loadEquipment` (после `getEquipment`) и в `saveEditor` (после `updateEquipment`) — эффект-зеркало `[equipment]` оставлен как страховка, но записи снимка больше не зависят от тайминга коммита React;
  - `loadTab` перед записью перечитывает актуальный снимок (`readNativeEntitySnapshot`) и сливает поля: `equipment` берётся из `equipmentRef.current` (fallback — `latest.equipment`, затем замыкание), `acts`/`history`/`workHistory`/`unavailableWorkKinds` — свежие только для загруженной вкладки, остальные — из прочитанного снимка; `loadedTabs` — объединение;
  - в `onChanged` вызовы упорядочены: `await loadEquipment(true)` (запись карточки — awaited) → при необходимости `await loadTab('works', …)` — тихая перезагрузка работ не может стартовать до завершения записи свежей карточки.
- Н-1 попутно закрыл скрытый дефект Ш2-2: при наличии снимка с `loadedTabs: ['works']` тихая force-перезагрузка отсекалась ранним `return`. Теперь выход только для `silent && !force` (и офлайна) — принудительная тихая перезагрузка выполняется.
- Н-2. `onChanged` в `NativeEquipmentActions` переведён на сигнатуру `(kind: NativeEquipmentActionKind) => Promise<void> | void`: `runTransfer` передаёт `owner`/`location`/`act-only`, `runWork` — вид работ. На экране карточки `loadTab('works', …)` вызывается только если `kind` входит в `equipmentWorkKinds(equipment)`; `loadEquipment(true)` выполняется после любой успешной мутации. На works-поверхности (`NativeEquipmentActions` сеткой) `onChanged` по-прежнему перезагружает `works` — там действия только работы.
- Н-3. Таймаут теста `searches equipment and opens the native detail route` увеличен: `waitFor` — 10 с, jest-timeout теста — 30 с. Семантика и ассерты не менялись.
Файлы:
- `mobile-hub/src/components/database/NativeEquipmentActions.tsx` — изменён: `onChanged(kind)`, экспорт типов `NativeEquipmentActionKind`/`NativeEquipmentActionsHandle`.
- `mobile-hub/src/screens/database/NativeEquipmentDetailScreen.tsx` — изменён: `equipmentRef`, merge-запись снимка в `loadTab`, исправление раннего `return`, `onChanged` с фильтром по виду действия.
- `mobile-hub/src/screens/database/NativeDatabaseScreens.test.tsx` — изменён: таймауты навигационного теста (Н-3); стейтфул-снимок в тесте Ш2-2 (проверяет и повторный запрос, и свежую карточку в снимке — ловит ранний `return` и гонку записи); новый тест «не перезагружает works после передачи» (Н-2).
Проверки (фактический вывод):
- `npx jest src/screens/database src/api/databaseApi.test.ts src/database src/components/database --runInBand` → 6/6 suites, **100/100 tests**. На первом прогоне упал стейтфул-тест Ш2-2: `persisted.equipment.description` был `''` — `equipmentRef` обновлялся только эффектом, который не успевал до записи снимка; исправлено синхронными присвоениями `equipmentRef.current` в точках `setEquipment`. Повторно стабильно зелёный.
- `npm run lint` (`tsc --noEmit`) → exit 0 (попутно исправлена ошибка типизации `persisted` в тесте — сужение до `never`).
- `npm run test:ci` → **333/333 suites, 2217/2217 tests**. Тест `searches equipment and opens the native detail route` не падал.
Отклонения от плана:
- В `onChanged` выбрано последовательное выполнение (`await loadEquipment` → `await loadTab`) — второй вариант из предложения руководителя; перечитывание снимка в `loadTab` реализовано дополнительно как защита для остальных вызовов `loadTab` (pull-to-refresh, смена вкладки).
- Таймаут увеличен до 10 с/30 с вместо номинальных 5 с — запас на холодный старт общего прогона.
Расхождения плана с кодом:
- нет
Не проверено:
- Реальное устройство/эмулятор Android — недоступны (adb подключён, устройств нет). Поведение снимка офлайн проверено только моками `nativeSnapshotCache`.
Вопросы руководителю:
- нет

### Выкладка backend (вариант Б) и сборка APK — Devin (AI-агент) — 2026-09-30
Статус: backend выложен; APK собраны; проверка на Android невозможна на этой машине
Сделано (по решению пользователя: вариант Б, сборка APK, установка эмулятора):
- Preflight: `pm2 jlist` — все процессы online, `itinvent-backend` restarts=0; `/health`×4 и `/health/ready`×3 → 200; бэкап 10 изменённых файлов и HEAD-версии `queries.py` в `C:\Backups\hubit-backend-20260930\` (11 файлов, для отката — копировать обратно и повторить скрипт).
- Рестарт: `restart-backend.ps1 -SkipScanRestart` — `itinvent-backend` online (PID 28728, порт 8001, uptime ~22 с), `itinvent-scan`/`itinvent-scan-worker` не трогались; окно недоступности ~20 с.
- Post-check: `/health` 8001/8002/8011/8012 и `/health/ready` 8001/8002/8012 → 200; `pm2 jlist` — backend online, счётчик рестартов не растёт; read-only зонд `get_equipment_by_inv` по 4 базам (ITINVENT/MSK/OBJ/SPB) — `date_create`, `date_last_modify`, `ch_user`, `status` возвращаются во всех; логи backend — стартап чистый, ошибок/трейсбэков нет (`http.slow`/`sql.slow` — прежний уровень шума).
- Эмулятор: пакет `emulator` 37.1.11 и `system-images;android-36;google_apis;x86_64` установлены, AVD `hubit_check` создан — но запуск невозможен: машина VMware-гость (`VMware7,1`) без nested-виртуализации, `x86_64 emulation requires hardware acceleration` / VMX не проброшен в CPUID. Включение WHPX не выполнялось (бессмысленно без VMX и требует перезагрузки production-сервера). AVD и образы оставлены — пригодятся, если гипервизору включат nested-виртуализацию.
- APK (версия уже была поднята пользователем до 1.1.59/61): первая сборка упала на `AccessDeniedException` в `.gradle-hub\caches\8.13\transforms\a1fd2675…` — удалены 3 осиротевшие директории трансформ-кэша, повтор успешен.
  - `dist/hubit-mobile-emulator-x86_64.apk` (54 362 689 байт, sha256 `05de1c68…`), audit — `signing: debug-preview`, `abis: [x86_64]`.
  - `dist/hubit-mobile-preview.apk` (70 663 341 байт, sha256 `d225b715…`, `abis: [arm64-v8a, armeabi-v7a]`) — для установки на реальный телефон пользователем.
- Публикация preview (разрешена пользователем): `publish-apk.ps1 -IisUpdateRoot C:\inetpub\wwwroot\hub-desktop-updates -ExpectedSignerSHA256 fac61745… -AllowDebugPreviewSigner` — версия `mobile/preview/1.1.59/` + `latest.json` записаны атомарно. `-AllowDebugPreviewSigner` применён осознанно: канал preview исторически на этом же сертификате. Внешняя проверка `node scripts/mobile/verify-published-apk.mjs` → manifest 200 (`application/json`, no-cache, 1.1.59/61), APK 200, size/sha256/signer совпали, `verified: true`.
Проверки (фактический вывод):
- `restart-backend.ps1 -SkipScanRestart` → «Backend ready: PM2 PID 28728 listening on port 8001».
- health-зонды выше; `get_equipment_by_inv` — см. пост-чек.
- `build-apk.ps1 -Local -Variant emulator -Architectures x86_64 -AllowDebugSigning` → BUILD SUCCESSFUL (после чистки битого transform-кэша); `-Variant preview -Architectures dual` → BUILD SUCCESSFUL in 11m 22s.
Отклонения от плана:
- Подпись — `debug-preview` (`-AllowDebugSigning`): release keystore и `HUBIT_ANDROID_*` на этой машине отсутствуют; debug-preview — тот же сертификат, что у опубликованного preview-канала (audit `signer_sha256 fac61745…` совпадает с прежним feed), внутренний upgrade совместим. Stable-канал этой сборкой не покрыть.
- Проверка на Android не выполнялась: эмулятор не запускается (см. выше), устройств в adb нет. Чек-лист остаётся за пользователем/руководителем — APK `hubit-mobile-preview.apk` готов к установке.
- `health-check.ps1` не использовался (известные ложные сбои парсинга `pm2 jlist`); проверки — прямыми `/health` и `pm2 jlist`.
- Публикация APK выполнена после отдельного разрешения пользователя (см. выше).
Расхождения плана с кодом:
- нет
Не проверено:
- Поведение сервисов за пределами health/probe (зависший `test_tickets_employee_crud.py` относится к чужим изменениям заявок — за владельцем).
- Дым-тест приложения на устройстве.
Вопросы руководителю:
- Рекомендуется наблюдение логов backend ещё ~15 мин после рестарта (на момент записи ошибок нет).

### Шаг 3 — Devin (AI-агент) — 2026-09-30
Статус: выполнено, на проверке
Сделано (по 3.1–3.4):
- 3.1 `NativeCopyableField` — единая вертикальная раскладка: подпись сверху (12 px, `textSecondary`), под ней ряд «значение 14 px влево, `flexShrink: 1` + иконка ⧉ 18 px вплотную (gap 8)». Порог 28 символов и `textAlign: 'right'` убраны. Зона нажатия иконки 44×44 — через `hitSlop=13` (константа `copyIconHitSlop` экспортирована), без пустой колонки. `trailing` идёт после иконки копирования. Между строками hairline-разделитель `tokens.borderSoft` у всех строк (поле не знает свою позицию в секции — вариант «допустим у всех»), минимальная высота 48 px. Долгое нажатие, `accessibilityActions`, пустое значение («—» без иконки, `accessible`, «…: не указано»), `selectable` только у `multiline` — без изменений; testID `…` и `…-copy` сохранены.
- 3.2 `NativeEquipmentDescriptionField` — та же раскладка: подпись сверху, текст, затем ряд «Ещё/Свернуть» + иконка ⧉ вплотную; без кнопки «Ещё» иконка стоит сразу под текстом. Измерение строк (Ш2-6) не тронуто.
- 3.3 Строка `native-equipment-employee-compare` — подпись «Сотрудник» сверху, ФИО и иконка ⧉ вплотную, «Склад в Хабе и в 1С» строкой ниже; шеврон › у правого края. Поведение (нажатие, долгое нажатие, офлайн) не менялось.
- 3.4 Шапка — рядом с заголовком иконка ⧉ (`testID="native-equipment-copy-title"`, `hitSlop` до 44×44), долгое нажатие на заголовок тоже копирует; копируется `model_name`, при пустом — `equipmentTitle(equipment)`; уведомление «Модель скопирована»; `accessibilityLabel="Скопировать модель: <название>"`. Плашки инв. № и S/N не менялись.
Файлы:
- `mobile-hub/src/components/database/NativeCopyableField.tsx` — вертикальная раскладка, `copyIconHitSlop`, hairline-разделитель.
- `mobile-hub/src/components/database/NativeEquipmentSection.tsx` — `NativeEquipmentDescriptionField` в той же раскладке; ряд «Ещё/Свернуть» + ⧉.
- `mobile-hub/src/screens/database/NativeEquipmentDetailScreen.tsx` — шапка с `native-equipment-copy-title` и долгим нажатием (`native-equipment-title`), строка сотрудника, компактный `inlineCopyButton` + `hitSlop` (иконка mailto), стили `heroTitleRow`/`heroCopyButton`/`employeeCompareValueRow`.
- `mobile-hub/src/screens/database/NativeDatabaseScreens.test.tsx` — +3 теста 3.6.
Проверки (фактический вывод):
- `npx jest src/screens/database src/api/databaseApi.test.ts src/database src/components/database --runInBand` → **6/6 suites, 103/103 tests** (console-шум `act(...)` — прежний, тесты зелёные).
- `npm run lint` → exit 0 (`tsc --noEmit`).
- `npm run test:ci` → **333/333 suites, 2220/2220 tests**; `searches equipment and opens the native detail route` не падал.
Отклонения от плана:
- Разделитель добавлен у всех строк секции — план допускает («иначе допустим у всех»): у поля нет данных о позиции в секции; `marginBottom` строк заменён `paddingVertical` + hairline.
- Для проверки долгого нажатия на заголовок добавлен новый testID `native-equipment-title` (существующие testID не менялись).
Расхождения плана с кодом:
- нет
Не проверено:
- Визуальная проверка на Android (360 dp, крупный шрифт, тёмная тема) — относится к пункту 1 «Что осталось до выпуска»; на этой машине эмулятор недоступен (см. запись о выкладке).
Вопросы руководителю:
- нет

### Шаг 4-A — Devin (AI-агент) — 2026-09-30
Статус: выполнено, на проверке
Сделано (по 4.1–4.3):
- 4.1 Ярлык «Сканировать QR»: первый в `SHORTCUTS`, `id: 'hubit_scan_qr'`, подписи «Сканировать QR»/«Сканировать QR оборудования» (строковые ресурсы `hubit_shortcut_scan_qr_short/long`), intent `android:data="hubit://database?scan=1"`. Иконка — выбран отдельный векторный drawable `res/drawable/hubit_shortcut_scan_qr.xml` (фон `#071d30` — цвет adaptiveIcon приложения — и белый глиф «рамка сканера + линия»): зависимости не нужны, плагин пишет XML при `prebuild`. Остальные три ярлыка не тронуты; всего 4 — лимит видимых статических ярлыков.
- 4.2 Параметр `scan=1`: добавлен в разрешённые ключи `nativeDatabaseFeature` (`scan` принимается только со значением `1`, прочие → `null`), сериализуется в `routePathFromHref` (`/(shell)/database?scan=1`), сохраняется в `portalPathFromNativeRoute` — маршрут переживает вход/2FA. `NativeDatabaseScreen`: эффект при `scan === '1'` один раз открывает `NativeDatabaseQrScannerModal` и сбрасывает параметр (`router.setParams({ scan: undefined })`, ref-защёлка от повторов); без `database.read` параметр сбрасывается без открытия — экран «Нет доступа».
- 4.3 `android-app-links.cjs`: при `HUBIT_ANDROID_ENABLE_APP_LINKS=1` фильтр `autoVerify: true` только для `https://hubit.zsgp.ru` с `path: '/database'` и `pathPrefix: '/database/'`. При любом другом значении флага конфиг — `{}` (поведение без изменений).
Файлы:
- `mobile-hub/plugins/withHubitAndroidShortcuts.js` + `withHubitAndroidShortcuts.test.js`
- `mobile-hub/android-app-links.cjs`
- `mobile-hub/src/navigation/androidAppLinks.test.ts`
- `mobile-hub/src/database/nativeDatabaseFeature.ts` + `nativeDatabaseFeature.test.ts`
- `mobile-hub/src/navigation/moduleRegistry.ts`
- `mobile-hub/src/navigation/systemIntent.ts` + `systemIntent.test.ts`
- `mobile-hub/src/screens/database/NativeDatabaseScreen.tsx`
- `mobile-hub/src/screens/database/NativeDatabaseScreens.test.tsx`
Проверки (фактический вывод):
- `npx jest plugins src/navigation src/database src/screens/database --runInBand` → **19/19 suites, 185/185 tests** (console-шум `act(...)` — прежний).
- `npm run lint` → exit 0 (`tsc --noEmit`).
- `npm run test:ci` → **333/333 suites, 2226/2226 tests**.
Отклонения от плана:
- Существующий тест `nativeDatabaseFeature` требовал `scan=1 → null` (scan раньше считался неподдерживаемым workflow): обновлён под новый контракт — `scan=1` маппится, `scan=2`/`scan=yes` по-прежнему `null`. Проверки не ослаблены.
Расхождения плана с кодом:
- нет
Не проверено:
- Реальная установка ярлыка/сканера и verified App Links на Android-устройстве — часть 4-B (release-подпись, `assetlinks.json`, `adb pm get-app-links`, проверка камерой) за руководителем/пользователем.
Вопросы руководителю:
- нет

### Шаг 5-A — Devin (AI-агент) — 2026-09-30
Статус: выполнено, на проверке
Сделано (по пунктам 1–8 целевого поведения):
- п.1 Первый QR оборудования: камера не закрывается (`continuous`-режим сканера при `database.write`), снизу карточка `native-scan-batch-card` — модель/инв. №/сотрудник/место, кнопки «Открыть» (`native-scan-batch-open` → тот же `openEquipmentFromQr`/`nativeEquipmentDestination`, включая офлайн-подготовку снимка) и «+ Ещё QR» (`native-scan-batch-more` — сворачивает панель в полоску).
- п.2 Со второго QR — панель `native-scan-batch-list`: «Выбрано: N» + «Действия (N)» + строки (модель, инв. №, сотрудник, ✕ `native-scan-batch-remove-*`). Новый код → `Haptics.selectionAsync` и строка вверху списка. Повтор — не добавляется, строка подсвечивается ~1 с, тост «Уже в списке». Сворачивание в полоску `native-scan-batch-strip` «Выбрано: N ▲».
- п.3 «Действия (N)» (`native-scan-batch-actions`) закрывает камеру и открывает панель `native-database-scan-batch` на экране базы: список строк + существующий `NativeEquipmentActions` с `targets` = позиции со статусом `ready`, `testIDPrefix="native-database-scan-batch"`.
- п.4 Не добавляются: расходник при непустом списке — тост «Расходники в список не добавляются» (пустой список — прежний одиночный путь `openConsumableFromQr`); QR другой базы — тост «Другая база: <имя>. Список собирается по одной базе» (база батча — база первой позиции); номер не найден — строка «Не найдено», в `targets`/`Действия` не входит; лимит 100 — тост «Не больше 100 за раз» (`SCAN_BATCH_LIMIT`).
- п.5 Дедупликация в кадре: один и тот же `result.data` не срабатывает чаще раза в 1,5 с (`lastScanRef`); одиночный режим (`!continuous`) по-прежнему блокируется `scanned`.
- п.6 Офлайн: строки резолвятся из снимков — выделен общий `findCachedEquipment` (список → `database-inbox` → `readNativeEquipmentCatalogSnapshot`); нет данных — «Нет данных офлайн»; «Действия» неактивны + подпись «Нужна сеть». Без `database.write` — прежнее одиночное поведение (сканер не накапливает, `continuous` выключен, панель не рендерится).
- п.7 Сохранность: `useNativeScanBatch` держит список в памяти и пишет в `nativeSnapshotCache` через `readNativeEntitySnapshot`/`writeNativeEntitySnapshot`, ключ `scan-batch:{databaseId}` под пользователя — переживает сворачивание и перезапуск. После успешного действия список очищается, при частичной ошибке остаются `retry_inv_nos` (`onChanged(kind, result)`). При выходе стирается вместе со всеми снимками пользователя (`clearNativeSnapshots` → `clearEncryptedNativeSnapshots` стирает все `snapshot-{user}-*` файлы, включая shard с ключом батча).
- п.8 Закрытие сканера с непустым списком — `Alert` «Список из N позиций сохранится. Закрыть?» (крестик и системная «назад» — общий `requestScannerClose`); на экране базы список доступен кнопкой «Выбрано: N» (`native-database-scan-batch-open`).
Файлы:
- `mobile-hub/src/database/useNativeScanBatch.ts` — новый хук (список, дедуп с `pendingRef`, одна база, лимит 100, снимок, `remove`/`clear`/`keepOnly`) + `useNativeScanBatch.test.ts` (7 тестов)
- `mobile-hub/src/components/database/NativeScanBatchPanel.tsx` — новый оверлей: карточка первого QR / список / полоска
- `mobile-hub/src/components/database/NativeDatabaseQrScannerModal.tsx` — `continuous`-режим, дедуп 1,5 с, `overlay`-слот, ошибка не блокирует поток (карточка ошибки сверху, автоскрытие 2,5 с)
- `mobile-hub/src/components/database/NativeEquipmentActions.tsx` — минимально: `onChanged(kind, result?: TransferResult)` — в вызове передаётся итоговый `next`, чтобы экран мог оставить `retry_inv_nos`
- `mobile-hub/src/screens/database/NativeDatabaseScreen.tsx` — подключение хука, `handleScannerScan`, `requestScannerClose`, панель `native-database-scan-batch`, кнопка «Выбрано: N», `<NativeToastHost />`, выделен `findCachedEquipment` из `openEquipmentFromQr` без изменения поведения
- `mobile-hub/src/screens/database/NativeDatabaseScreens.test.tsx` — `mockQrScanData` в моке камеры (код QR задаётся тестом), `getConsumableById` в моке API, +10 тестов шага 5
- `mobile-hub/src/screens/database/NativeDatabasePerformance.test.tsx` — только дополнен мок `nativeSnapshotCache` (не хватало `readNativeEntitySnapshot`/`writeNativeEntitySnapshot` для нового хука); файл вне списка плана — минимальная совместимость
Проверки (фактический вывод):
- `npx jest src/database src/components/database src/screens/database --runInBand` → **6/6 suites, 100/100 tests** (console-шум `act(...)`/`VirtualizedList` — прежний).
- `npm run lint` (`tsc --noEmit`) → **exit 2**: единственная ошибка `src/screens/addressBook/NativeAddressBookScreen.tsx(79,16) TS2339 'employee_code'` — чужая недописанная правка в рабочем дереве (файл `M`, к шагу 5-A отношения не имеет). В файлах шага 5-A ошибок нет.
- `npm run test:ci` → **335/336 suites, 2288/2290 tests**. Падают 2 теста в `src/screens/addressBook/NativeAddressBookScreen.test.tsx` (`queryAllByType`, 'Ivanov Ivan Ivanovich') — та же чужая WIP-правка адресной книги; до шага 5-A эти тесты проходили, мои файлы их не затрагивают.
Отклонения от плана:
- `NativeEquipmentActions` — разрешённая минимальная правка: `onChanged` получает `result?: TransferResult`, чтобы при частичной ошибке оставить только `retry_inv_nos`. Существующие вызовы (1 аргумент) совместимы.
- Снимок батча — в существующем entity-скоупе `database-item-details` (ключ `scan-batch:{db}`), а не новым scope: `nativeSnapshotCache.ts` вне списка файлов шага; очистка при выходе всё равно срабатывает — `clearEncryptedNativeSnapshots` стирает все файлы пользователя независимо от scope.
- `native-database-scan-batch-*` в панели экрана — под префиксом `NativeEquipmentActions`; собственные testID оверлея — `native-scan-batch-*`.
Расхождения плана с кодом:
- нет
Не проверено:
- Реальная камера, вибрация, ярлык «Сканировать QR» и чек-лист «Проверка на Android» — нет устройства/эмулятора (сервер — VMware-гость без nested-виртуализации, adb устройств нет). Ждёт проверки на устройстве пользователя/руководителя.
Вопросы руководителю:
- `NativeAddressBookScreen.tsx` в дереве недописан и ломает `tsc`/`test:ci` — правку оставил нетронутой, нужен владелец.

### Проверка Н-1…Н-3, шагов 3, 4-A и 5-A — руководитель — 2026-10-01

Проверки руководителя (фактически):

- `npx jest src/database src/components/database src/screens/database src/auth src/api src/navigation plugins src/accessibility src/cache src/components/layout --runInBand` → 67/67 suites, 591/591 tests;
- `npx tsc --noEmit` → exit 2, 7 ошибок только в `src/screens/addressBook/NativeAddressBookScreen.test.tsx` (чужая незавершённая правка адресной книги, к этим шагам не относится).

Итог:

- **Н-1…Н-3 — приняты.** `equipmentRef`, merge-запись снимка в `loadTab`, выход только для `silent && !force`, `onChanged(kind)` соответствуют предложению; стейтфул-тест ловит исходную гонку.
- **Шаг 3 — принят.** Раскладка «подпись сверху, значение + ⧉ вплотную», `copyIconHitSlop`, копирование модели в шапке с fallback на `equipmentTitle` — по плану.
- **Шаг 4-A — на доработку** (Ш4-1).
- **Шаг 5-A — на доработку** (Ш5-1…Ш5-4).

Замечания:

- **Ш4-1 (средне).** `NativeDatabaseScreen.tsx`, эффект `deepScan`: `deepScanRef.current = true` ставится один раз и не сбрасывается.
  - Если приложение живо и экран базы уже в стеке, повторное нажатие ярлыка «Сканировать QR» (`scan=1`) сканер не откроет.
  - Если `allowed` в момент эффекта ещё `false` (права не загружены), защёлка срабатывает, параметр сбрасывается, сканер не откроется и позже.
  - Исправить: сбрасывать защёлку, когда `scan` отсутствует (`if (deepScan !== '1') { deepScanRef.current = false; return; }`); не потреблять параметр, пока права не определены.
  - Тест: `scan=1` → сканер → закрыть → снова `scan=1` на том же смонтированном экране → сканер открывается второй раз.
- **Ш5-1 (высокий).** `resolveEquipmentForScan` онлайн глотает любую ошибку и возвращает `null` → строка «Не найдено».
  - Таймаут, обрыв сети, 5xx, 401/403 выглядят как «номера нет».
  - Строка остаётся в списке, повторный скан той же этикетки даёт «Уже в списке» — позиция застревает до ручного ✕.
  - Исправить: «Не найдено» (`missing`) только при HTTP 404. Любая другая ошибка — позиция **не добавляется**, тост «Нет связи с сервером — отсканируйте ещё раз» (допустимо иначе: статус `error` с кнопкой «Повторить» в строке — описать в журнале).
  - Тесты: 404 → «Не найдено»; ошибка сети → позиции нет, тост, повторный скан того же кода добавляет её.
- **Ш5-2 (средне).** Строки `offline-missing` никогда не перезапрашиваются: после появления сети остаются «Нет данных офлайн» и не попадают в «Действия».
  - Исправить: при переходе `offlineMode: true → false` перезапросить все позиции не в статусе `ready` (последовательно или с ограничением параллельности), обновить строки.
  - Тест: офлайн-скан неизвестного номера → выход в онлайн → строка становится готовой.
- **Ш5-3 (средне; пробел плана руководителя).** «Открыть» на карточке первого QR оставляет позицию в сохранённом списке. Следующая сессия сканирования (даже через день) покажет «Выбрано: 2» со старой позицией.
  - Исправить: если в списке ровно одна позиция и нажато «Открыть» — очистить список перед переходом. При 2+ позициях «Открыть» из строки (если есть) список не трогает.
  - Тест: один скан → «Открыть» → снова открыть сканер → список пуст.
- **Ш5-4 (низкий).** `NativeDatabaseQrScannerModal`: `lastScanRef` помнит только последний код. Две этикетки в кадре чередуются → каждый кадр вызывает `onScanned` → поток тостов «Уже в списке».
  - Исправить: помнить время по каждому коду (`Map<data, lastAt>`), срабатывать для кода не чаще раза в 1,5 с.
  - Тест: чередование A, B, A, B в пределах 1,5 с → по одному вызову на код.
- **Ш-мусор.** Убрать временные файлы исполнителя в `mobile-hub/`: `jest-acc.txt`, `jest-acc2.txt`, `jest-acc3.txt`, `jest-nav.txt`, `jest-nav2.txt`, `nul`.

Не проверено руководителем: всё на устройстве (камера, вибрация, ярлык, App Links) — чек-листы шагов 4 и 5.

### Доработка шагов 4-A и 5-A (задача исполнителю)

Исправить Ш4-1, Ш5-1…Ш5-4 и удалить временные файлы (Ш-мусор) по описанию выше. Не менять backend, обычный режим «Выбрать» и уже принятое поведение шагов 1–3.

Прогнать из `mobile-hub`:

- `npx jest src/database src/components/database src/screens/database src/navigation plugins --runInBand`;
- `npx tsc --noEmit` — ошибок в файлах шагов быть не должно (ошибки `NativeAddressBookScreen.test.tsx` — чужие, указать в журнале, если ещё есть);
- `npm run test:ci`.

Записать в журнал отдельной записью «Доработка шагов 4-A и 5-A — исполнитель — дата» по шаблону; статус в шапке — «Доработка 4-A/5-A выполнена, на проверке».

### Доработка шагов 4-A и 5-A — Devin (AI-агент) — 2026-10-01

Статус: **выполнено, на проверке**.

Сделано по замечаниям:

- **Ш4-1.** `NativeDatabaseScreen.tsx`: защёлка `deepScanRef` сбрасывается, когда параметра `scan` нет (`if (deepScan !== '1') { deepScanRef.current = false; return; }`), и параметр не потребляется, пока `allowed` не определён — при `!allowed` эффект просто возвращается без сброса `scan` и без установки защёлки. Повторный запуск ярлыка на том же смонтированном экране открывает сканер снова. Тест: `scan=1` → сканер → закрыть → `scan=1` повторно → сканер открывается (`reopens the scanner when scan=1 arrives again on the same mounted screen`).
- **Ш5-1.** `resolveEquipmentForScan` возвращает `null` («Не найдено») только при `axios.isAxiosError(cause) && cause.response?.status === 404`; прочие ошибки пробрасываются. В `useNativeScanBatch.add` резолв обёрнут: брошенная ошибка → `kind: 'error'`, позиция не добавляется, pending-запись снимается (код можно отсканировать повторно). Экран показывает тост «Нет связи с сервером — отсканируйте ещё раз». Тесты: хук (`error` → не добавляет → повторный `add` добавляет), экран (404 → «Не найдено»; `ERR_NETWORK` → позиции нет + тост + повторный скан того же кода добавляет, повтор через `Date.now` spy, т.к. в модале дедуп кода 1,5 с).
- **Ш5-2.** В `useNativeScanBatch` эффект по переходу `offlineMode: true → false`: последовательно перезапрашивает все позиции не в `ready` через `resolveEquipment` и обновляет строки (запись снимка сохраняется обычным эффектом). Ошибка резолва при перезапросе оставляет `offline-missing`. Тест хука: офлайн-скан неизвестного номера → `offline-missing` → `rerender` с `offlineMode: false` → строка `ready`.
- **Ш5-3.** В `onOpen` карточки первого QR: если `scanBatchItems.length === 1` — `scanBatchClear()` перед навигацией; снимок записывается пустым, следующая сессия сканирования пустая. При 2+ позициях «Открыть» на карточке не существует (карточка ровно для одной позиции), поведение списка не менялось. Тест: один скан → «Открыть» → `router.push` → переоткрыть сканер → карточки/полоски нет.
- **Ш5-4.** `NativeDatabaseQrScannerModal`: вместо одного `lastScanRef` — `Map<data, at>` по каждому коду (`SAME_CODE_DELAY_MS` = 1,5 с); чистка записей старше 30 с при размере > 64; очистка при закрытии модалки. Тест: A, B, A, B подряд → «Выбрано: 2», тоста «Уже в списке» нет (дубли подавлены в модале, не долетая до экрана).
- **Ш-мусор.** Удалены `jest-acc.txt`, `jest-acc2.txt`, `jest-acc3.txt`, `jest-nav.txt`, `jest-nav2.txt`, `nul` из `mobile-hub/`.

Файлы:

- `src/screens/database/NativeDatabaseScreen.tsx` — правки Ш4-1, Ш5-1 (axios 404, тост), Ш5-3;
- `src/database/useNativeScanBatch.ts` — `kind: 'error'` в `ScanBatchAddResult`, перезапрос при выходе в онлайн (Ш5-1, Ш5-2);
- `src/components/database/NativeDatabaseQrScannerModal.tsx` — `Map`-дедуп по коду (Ш5-4);
- `src/database/useNativeScanBatch.test.ts` — +2 теста (Ш5-1, Ш5-2);
- `src/screens/database/NativeDatabaseScreens.test.tsx` — мок `getEquipment` в тесте «Не найдено» переведён на axios-объект 404 (plain `Error('404')` теперь трактуется как сбой сети, а не отсутствие номера), +5 тестов (Ш4-1, Ш5-1 ×2, Ш5-3, Ш5-4).

Проверки (фактический вывод):

- `npx jest src/database/useNativeScanBatch.test.ts --runInBand` → 1/1 suite, 9/9 tests;
- `npx jest src/screens/database/NativeDatabaseScreens.test.tsx --runInBand` → 76/76;
- `npx jest src/database src/components/database src/screens/database src/navigation plugins --runInBand` → **20/20 suites, 210/210 tests**;
- `npx tsc --noEmit` → **exit 0, ошибок нет** (чужие ошибки адресной книги из замечания руководителя на этот момент исправлены владельцем — файлы не трогал);
- `npm run test:ci` → **337/338 suites, 2324/2325 tests**; единственное падение — `src/addressBook/addressBookSearchIndex.test.ts` (`buildMs` 167 > 150 мс, перфоманс-гейт V8). Перезапуск этого сьюта отдельно → 5/5 зелёно; флаки под нагрузкой полного прогона, к изменениям не относится (файлы адресной книги не трогал).

Отклонения и расхождения плана с кодом:

- Ш5-1 реализован вариантом «позиция не добавляется + тост» (один из двух предложенных руководителем); альтернатива со статусом `error` и кнопкой «Повторить» в строке не делалась.
- Ошибки `getEquipment`, не являющиеся axios-ответами (например, `Mobile session changed`, `Сервер вернул некорректную карточку`), тоже трактуются как `error` — осознанно: «не нашёл» строго по 404.
- Backend, обычный «Выбрать», поведение шагов 1–3 не менялись. Коммитов/сборок/публикации не было.

Не проверено: на устройстве — повторный вызов ярлыка, потоковый скан с двумя этикетками в кадре, перезапрос после реального обрыва/восстановления сети. Нет Android-устройства/эмулятора (VMware-гость без nested-виртуализации).

Вопросы руководителю: нет.

### Проверка доработки шагов 4-A и 5-A — руководитель — 2026-10-01

Проверки руководителя (фактически): `npx jest src/database src/components/database src/screens/database src/auth src/api src/navigation plugins src/accessibility src/cache src/components/layout src/network src/lifecycle --runInBand` → 74/74 suites, 629/629 tests; `npx tsc --noEmit` → exit 2, одна ошибка в `src/screens/addressBook/NativeAddressBookScreen.test.tsx` (`recent` вместо `recents`, чужая правка адресной книги). Временные файлы удалены.

Итог:

- **Шаг 4-A — принят** (Ш4-1 закрыт; без `database.read` параметр `scan` остаётся до появления права — допустимо).
- **Ш5-1, Ш5-3, Ш5-4, Ш-мусор — приняты.**
- **Ш5-2 — на доработку** как Ш5-5.

Замечание:

- **Ш5-5 (средне).** `useNativeScanBatch.ts`, эффект перезапроса при выходе в онлайн: зависимости `[offlineMode, resolveEquipment, setBatch]`.
  - `resolveEquipmentForScan` зависит от `findCachedEquipment`, а тот — от `equipment` (`NativeDatabaseScreen.tsx`).
  - При выходе в онлайн экран перезагружает список → меняется `equipment` → новая функция `resolveEquipment` → cleanup ставит `cancelled = true` посреди перезапроса, повторный запуск эффекта выходит сразу (`wasOffline` уже `false`). Обновятся ноль или одна строка.
  - Тест исполнителя этого не ловит: в нём ссылка на резолвер не меняется.
  - Исправить: хранить резолвер в `ref` (`resolveRef.current = resolveEquipment` на каждом рендере), эффект зависит только от `offlineMode`; перезапрос не отменяется сменой резолвера, отменяется только размонтированием, сменой базы/пользователя или повторным уходом в офлайн.
  - Тест: офлайн-скан двух неизвестных номеров → выход в онлайн с одновременной сменой ссылки на `resolveEquipment` (rerender с новой функцией) → обе строки `ready`.

### Доработка Ш5-5 (задача исполнителю)

Исправить Ш5-5 по описанию выше. Файлы: `src/database/useNativeScanBatch.ts` + `useNativeScanBatch.test.ts`; экран — только если без него нельзя. Прогнать `npx jest src/database src/components/database src/screens/database --runInBand`, `npx tsc --noEmit` (чужие ошибки адресной книги — указать), `npm run test:ci`. Журнал — «Доработка Ш5-5 — исполнитель — дата»; статус — «Ш5-5 выполнено, на проверке».

### Доработка Ш5-5 — Devin (AI-агент) — 2026-10-01

Статус: **выполнено, на проверке**.

Сделано:

- `useNativeScanBatch.ts`: резолвер перенесён в ref — `resolveRef.current = resolveEquipment` синхронизируется отдельным эффектом на каждом рендере (объявлен до эффекта перезапроса, поэтому на том же коммите перезапрос уже видит новую функцию). Эффект перезапроса зависит от `[offlineMode, userId, databaseId, setBatch]` — смена ссылки `resolveEquipment` больше не попадает в deps и не отменяет перезапрос; отмена остаётся при размонтировании, смене базы/пользователя и повторном уходе в офлайн. Экран не менялся.

Файлы:

- `src/database/useNativeScanBatch.ts` — `resolveRef` + deps эффекта без `resolveEquipment`;
- `src/database/useNativeScanBatch.test.ts` — +2 теста.

Проверки (фактический вывод):

- `npx jest src/database/useNativeScanBatch.test.ts --runInBand` → 1/1 suite, **11/11 tests**;
- `npx jest src/database src/components/database src/screens/database --runInBand` → **6/6 suites, 109/109 tests**;
- `npx tsc --noEmit` → **exit 0, ошибок нет** (чужой ошибки `NativeAddressBookScreen.test.tsx` из замечания уже нет — владелец исправил);
- `npm run test:ci` → **338/338 suites, 2329/2329 tests** (флаки-гейт `addressBookSearchIndex` на этом прогоне прошёл).

Тесты к замечанию:

1. `re-resolves all rows when the resolver reference changes while going online (Ш5-5)` — тест ровно из замечания: два офлайн-скана → `rerender` с `offlineMode: false` и **новой** функцией `resolveEquipment` → обе строки `ready`, оба вызова прошли новым резолвером.
2. `is not cancelled when the resolver identity changes mid-refresh (Ш5-5)` — усиленный сценарий: первый резолв остаётся pending, в этот момент приходит новая ссылка → перезапрос не отменяется, обе строки `ready`. Проверено: на прежнем коде этот тест падает (временно возвращал `resolveEquipment` в deps — красный), после фикса зелёный.

Отклонения: нет. Backend, экран, обычный «Выбрать», шаги 1–3 не трогал. Коммитов/сборок/публикации не было.

Не проверено: на устройстве — перезапрос после реального обрыва/восстановления сети (нет Android-устройства/эмулятора, VMware-гость без nested-виртуализации).

Вопросы руководителю: нет.

## Что осталось до выпуска

1. **Проверка на Android (обязательно).** Выполняет пользователь или руководитель на устройстве/эмуляторе:
   - долгое нажатие и копирование во время прокрутки; выделение в описании;
   - нижняя панель и нижняя навигация; конец контента не перекрыт;
   - окно выбора с поиском и клавиатура;
   - переходы «⋮ → Удалить» и «Действия → пункт»;
   - уведомления о копировании;
   - светлая/тёмная тема, 360 dp, крупный системный шрифт, автономный режим.
2. ~~Проверка Н-1…Н-3 руководителем~~ — приняты 2026-10-01.
3. ~~Выкладка backend (2-B)~~ — выполнена исполнителем 2026-09-30 по варианту Б с разрешения пользователя (см. журнал).
4. **Сборка и публикация APK** — по решению пользователя, по `mobile-hub/README.md` и `documentation/technical/MOBILE_HUB_APK_DISTRIBUTION.md`:
   1. повысить `version` и `versionCode` в конфигурации приложения;
   2. подписанная сборка `npm run build:apk:local` (переменные `HUBIT_ANDROID_*` — из защищённого окружения, не через CLI и не в Git); проверить `dist/hubit-mobile-preview.audit.json`;
   3. установить на Android и пройти чек-лист из пункта 1;
   4. публикация `scripts/mobile/publish-apk.ps1` — внешняя публикация, только с явного разрешения пользователя;
   5. откат — по `MOBILE_HUB_APK_DISTRIBUTION.md` (предыдущий manifest/APK).

   Порядок выкладки mobile/backend не важен.

## Выкладка backend — подготовка 2026-09-30

Подготовка выполнена руководителем, только чтение. Ничего не перезапускалось и не менялось.

### Факты

| Проверка | Результат |
|---|---|
| Колонки `ITEMS` (`INFORMATION_SCHEMA.COLUMNS`) | `CREATE_DATE` (datetime), `CH_DATE` (datetime), `CH_USER` (nvarchar) есть во всех 4 базах: ITINVENT, MSK-ITINVENT, OBJ-ITINVENT, SPB-ITINVENT |
| Новый `get_equipment_by_inv` (код рабочего дерева) на реальных базах, только SELECT | Во всех 4 базах возвращает `date_create`, `date_last_modify` (datetime), `ch_user` (str), `status` (str) |
| Откуда запущен backend | PM2 `itinvent-backend`, `cwd = C:\Project\Image_scan\WEB-itinvent` — прямо из рабочего дерева. Старт 2026-09-29 09:32:49 UTC |
| HEAD | `e6622c7a`, закоммичен ≈ 2026-09-29 07:00 UTC (до старта backend). Коммитов после старта нет |
| Что выйдет при рестарте | 10 Python-файлов, изменённых после старта backend (+746 / −100 строк): `database/queries.py` (наш), `api/v1/address_book.py`, `services/address_book_service.py`, `api/v1/tickets.py`, `services/tickets_service.py`, `appdb/json_store.py`, `json_db/manager.py`, `local_store.py`, `api/v1/chat/ws.py`, `chat/realtime.py` |
| Scan | Код `scan_server/`, `scan_agent/` после старта scan (2026-09-29 04:19 UTC) не менялся |
| Здоровье до выкладки | `/health/ready` 8001 и 8002, `/health` 8011, `/health/ready` 8012 → 200 |

Чужие изменения, которые выйдут вместе с нашим:

- **Адресная книга:** новый endpoint `/filters`, флаги доступа к полям.
- **Заявки:** личные телефоны и e-mail требуют прав `address_book.personal_*` — меняется доступ пользователей к персональным данным.
- **Хранилища** (`json_store`, `json_db/manager`, `local_store`): обновятся только в backend. Chat, bot и workers останутся на старом коде — временное расхождение версий общих модулей.
- **Чат** (`chat/ws.py`, `chat/realtime.py`): в процессе backend чат отключён (`HUBIT_RUNTIME_ROLE=api`), при рестарте backend эти правки не заработают.

Тесты изменений (`conftest.py` подменяет БД на sqlite):

- `test_equipment_detail_dates.py` 4/4.
- `test_address_book_api.py` 24/24, `test_address_book_service.py` 71/71, `test_chat_websocket_rate_limiter.py` 6/6, `test_chat_websocket_error_codes.py` 5/5, `test_tickets_api_permissions.py` 11/11.
- `test_tickets_employee_crud.py` **зависает** на 3-м тесте. Зависимость от порядка: `test_list_with_employees` отдельно проходит, в группе `TestListEmployees` виснет. Стек `faulthandler` снять не удалось. Нужна диагностика владельцем изменений заявок.

Откат:

- Для `queries.py` работающая версия совпадает с HEAD (отличие только наша правка) — откатывается надёжно.
- Для остальных 9 файлов работающая версия может быть промежуточной незакоммиченной и нигде не сохранена — полный откат не гарантирован.

Инструмент post-check:

- `scripts/pm2/health-check.ps1` сейчас ложно сообщает, что scan и sandbox-control не работают (`PM2 snapshot unavailable`: не разбирается `pm2 jlist`).
- Его рекомендации (`restart-scan`, `-RepairScan`, `restart-ai-agents`) выполнять нельзя.
- Починка — отдельная задача «Fix PM2 snapshot parsing in health-check.ps1».

### Варианты

**А. Отложить (рекомендация руководителя).**
- Приложение работает без дат: «Служебное» скрыта.
- `queries.py` выйдет со следующим штатным рестартом backend, когда владелец изменений адресной книги/заявок их завершит и `test_tickets_employee_crud.py` станет зелёным.
- Владельца предупредить: любой рестарт backend выкладывает все 10 файлов.

**Б. Выложить все 10 файлов** — только после подтверждения владельца чужих изменений и разбора зависшего теста.

1. Preflight (только чтение):
   - `pm2 jlist`;
   - `/health` всех сервисов → 200;
   - резервная копия 10 файлов вне репозитория (например, `C:\Backups\hubit-backend-20260930\`);
   - сохранить HEAD-версию `queries.py` для отката.
2. Команда. Код scan не менялся, поэтому его рестарт пропускается штатным параметром:
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File C:\Project\Image_scan\scripts\pm2\restart-backend.ps1 -SkipScanRestart
   ```
3. Эффект:
   - портал и мобильное API недоступны ~10–40 с;
   - chat и scan не затрагиваются;
   - включаются даты карточки, новая политика персональных данных в заявках, новый API адресной книги.
4. Откат: для нашей правки — вернуть HEAD-версию `queries.py` и повторить команду. Для чужих файлов полный откат не гарантирован.
5. Post-check:
   - встроенная проверка готовности скрипта;
   - прямые `/health/ready` 8001, 8002, `/health` 8011, `/health/ready` 8012 → 200;
   - `pm2 jlist`: `itinvent-backend` online, счётчик рестартов не растёт;
   - read-only зонд `get_equipment_by_inv` по 4 базам (поля дат присутствуют);
   - в течение 10–15 минут — логи backend без новых ошибок.

   `health-check.ps1` не использовать до его починки.

**В. Выложить только `queries.py`.** Требует временно убрать чужие изменения из рабочего дерева — затрагивает чужую работу. Не рекомендуется, только с согласия владельца.

### Проверка плана — руководитель — 2026-09-30

| № | Важность | Замечание | Исправление в плане |
|---|---|---|---|
| П-1 | Критично | Выкладка не учитывала, что backend работает из рабочего дерева: рестарт выкладывает 10 файлов, а не один | Раздел «Выкладка» уточнён; добавлен раздел «Выкладка backend — подготовка» с вариантами А/Б/В |
| П-2 | Важно | «Колонки на обеих базах» — баз 4 | Факты по 4 базам — в разделе подготовки |
| П-3 | Важно | Post-check через `health-check.ps1` сейчас даёт ложные сбои; `GET /equipment/<inv>` требует авторизации | Post-check заменён на прямые `/health`, `pm2 jlist` и read-only зонд |
| П-4 | Важно | Нет отката backend; scan перезапускался без необходимости | Добавлены откат и `-SkipScanRestart` |
| П-5 | Важно | «Сборка Expo» описана одной строкой | Добавлен пункт «Сборка и публикация APK» |
| П-6 | Мелочь | «Текущее состояние» устарело | Раздел помечен как исторический |
| П-7 | Мелочь | Противоречие текста уведомления по умолчанию в 1.1 | 1.1 приведён к коду: ``copiedMessage ?? `${copyLabel} скопирован` `` |

## Шаг 3. Компактные поля и копирование названия

Добавлен 2026-09-30 по замечанию пользователя: «скопировать модель и само название далеко друг от друга».

### Проблема (по коду `NativeCopyableField` и шапке)

- Строка поля — «подпись у левого края, значение прижато вправо (`textAlign: 'right'`), иконка ⧉ в отдельной колонке 44 px справа». На широком экране подпись и значение разнесены на всю ширину, взгляду приходится прыгать.
- Для длинных значений (> 28 символов) раскладка меняется на «подпись сверху, значение слева», а иконка остаётся у правого края — далеко от текста. Одна карточка использует две разные раскладки.
- Название модели в шапке (крупный заголовок) не копируется. Чтобы скопировать модель, нужно спуститься к полю «Модель» в секции «Устройство».

### Решение

Одна раскладка для всех полей: подпись над значением, иконка вплотную к тексту. Макет согласован с пользователем.

Файлы:

- `mobile-hub/src/components/database/NativeCopyableField.tsx`;
- `mobile-hub/src/components/database/NativeEquipmentSection.tsx` (`NativeEquipmentDescriptionField`);
- `mobile-hub/src/screens/database/NativeEquipmentDetailScreen.tsx`;
- `mobile-hub/src/screens/database/NativeDatabaseScreens.test.tsx`.

3.1. **`NativeCopyableField` — всегда вертикальная раскладка:**
- сверху подпись (12 px, `textSecondary`);
- под ней ряд: текст значения (14–15 px, `textPrimary`, `flexShrink: 1`, выравнивание влево) и сразу за ним иконка ⧉ (16–18 px, `iconMuted`), отступ 6–8 px;
- зона нажатия иконки ≥ 44×44 — через `hitSlop`, а не через широкую колонку, чтобы не появлялся пустой промежуток;
- `trailing` (например, `mailto`) — после иконки копирования, так же вплотную;
- порог 28 символов и `textAlign: 'right'` убрать;
- между строками — тонкий разделитель `tokens.borderSoft` (у последней строки секции не нужен, если это просто сделать; иначе допустим у всех), минимальная высота строки 48 px;
- долгое нажатие на строку, `accessibilityActions`, пустое значение («—» без иконки, `accessible`, «…: не указано»), `selectable` только у `multiline` — без изменений;
- `testID` сохранить: `…` для строки, `…-copy` для иконки.

3.2. **`NativeEquipmentDescriptionField`** — та же раскладка: подпись сверху, текст, «Ещё/Свернуть» и иконка ⧉ вплотную после кнопки «Ещё» или после текста. Измерение строк (Ш2-6) не трогать.

3.3. **Строка сотрудника с переходом на склад** (`native-equipment-employee-compare`) — подпись «Сотрудник» сверху, ФИО и иконка ⧉ вплотную, «Склад в Хабе и в 1С» строкой ниже. Шеврон › остаётся у правого края: это признак перехода. Поведение (нажатие, долгое нажатие, офлайн) не менять.

3.4. **Шапка:**
- рядом с заголовком-моделью — иконка ⧉ вплотную к тексту (`testID="native-equipment-copy-title"`, `hitSlop` до 44×44);
- долгое нажатие на заголовок тоже копирует;
- копируется `model_name`, если он пуст — `equipmentTitle(equipment)`;
- уведомление «Модель скопирована»;
- `accessibilityLabel="Скопировать модель: <название>"`.

   Плашки инв. № и S/N не менять.

3.5. **Не менять:** порядок секций, скрытие пустых полей, «Обслуживание», «Служебное» (`AccountField`), нижнюю панель, меню ⋮, редактор.

3.6. **Тесты:**
- `native-equipment-copy-title` копирует `model_name` фикстуры и показывает «Модель скопирована»;
- долгое нажатие на заголовок копирует;
- при пустом `model_name` копируется `equipmentTitle`;
- существующие тесты копирования (иконка, долгое нажатие, пустое поле, офлайн, сотрудник) остаются зелёными без ослабления проверок.

   Прогнать:
   - `npx jest src/screens/database src/api/databaseApi.test.ts src/database src/components/database --runInBand`;
   - `npm run lint`;
   - `npm run test:ci`.

### Приёмка шага 3

У всех копируемых полей подпись над значением, а иконка ⧉ стоит сразу за текстом. Модель копируется прямо из шапки. Тесты и lint зелёные. Визуально проверяется на Android (360 dp, крупный шрифт, тёмная тема) — пункт 1 «Что осталось до выпуска».

## Шаг 4. QR: быстрое действие на ярлыке и открытие приложения с камеры

Добавлен 2026-09-30 по запросу пользователя:

- сканировать QR из быстрых действий по удержанию иконки приложения;
- при сканировании QR обычной камерой телефона открывать HUB-IT, если оно установлено.

### Факты (проверено руководителем, только чтение)

| Что | Состояние |
|---|---|
| Быстрые действия на ярлыке | Уже есть статические Android shortcuts: плагин `mobile-hub/plugins/withHubitAndroidShortcuts.js` (+ `withHubitAndroidShortcuts.test.js`). Сейчас три: «Чат», «Задачи», «Scan Center» (модуль сканов документов). Intent: `hubit://portal?path=…` в `MainActivity`. Пункта «Сканировать QR» нет |
| Сканер QR в приложении | Есть: `NativeDatabaseQrScannerModal` на экране `NativeDatabaseScreen` (`qrScannerOpen`). Открыть его параметром маршрута нельзя: экран принимает только `q`, `mode`, `consumable`, `databaseId` |
| Что зашито в печатный QR | Ссылка `https://<origin>/database?inv_no=<инв>&db_id=<база>` (`buildEquipmentQrLink`, `WEB-itinvent/frontend/src/pages/database/qrModel.js`), `origin` — адрес портала, с которого печатали. Для расходников — `?consumable=<id>&db_id=…` |
| Разбор входящих ссылок | `app/+native-intent.tsx` → `routeSystemIntentPath` (`src/navigation/systemIntent.ts`): `https://hubit.zsgp.ru/database?inv_no=…&db_id=…` → карточка `/database/<инв>?databaseId=…` (есть тест в `systemIntent.test.ts`). `hubit://…` тоже разбирается. Маршрут сохраняется через вход/2FA |
| Почему камера сейчас открывает браузер | HTTPS App Links выключены: `android-app-links.cjs` добавляет intent-filter только при `HUBIT_ANDROID_ENABLE_APP_LINKS=1`, и фильтр слишком широкий (`pathPrefix: '/'` — перехватывал бы весь портал). `scripts/build-apk.ps1` принудительно ставит флаг `0` без постоянной release-подписи |
| `assetlinks.json` на production | Не опубликован: `https://hubit.zsgp.ru/.well-known/assetlinks.json` отдаёт HTML главной страницы (SPA fallback, `text/html`). Скрипт публикации уже есть: `scripts/mobile/publish-assetlinks.ps1` (fail-closed, backup, атомарная замена; см. `MOBILE_HUB_APK_DISTRIBUTION.md`) |
| Сборка | `build-apk.ps1` выполняет `expo prebuild --platform android --clean`, поэтому изменения плагинов и `app.config.ts` попадают в APK |

Вывод:

- Быстрое действие — небольшая правка приложения.
- Открытие с камеры требует трёх вещей: узкого verified-фильтра App Links только для `/database`, опубликованного `assetlinks.json` с fingerprint постоянной release-подписи и release-сборки с `HUBIT_ANDROID_ENABLE_APP_LINKS=1`.
- Без verified App Links Android 12+ открывает ссылку в браузере, окна выбора не будет.
- Custom-схема `hubit://` в печатный QR не подходит: без установленного приложения камера не откроет ничего полезного.

### 4-A. Приложение (исполнитель)

Файлы:

- `mobile-hub/plugins/withHubitAndroidShortcuts.js` + `withHubitAndroidShortcuts.test.js`;
- `mobile-hub/android-app-links.cjs` + его тест (найти через `rg buildAndroidHttpsAppLinksConfig`, например `src/navigation/androidAppLinks.test.ts`);
- `mobile-hub/src/database/nativeDatabaseFeature.ts` (+ тест);
- `mobile-hub/src/navigation/systemIntent.ts` (+ `systemIntent.test.ts`) — только если параметр `scan` теряется при разборе;
- `mobile-hub/src/screens/database/NativeDatabaseScreen.tsx`;
- `mobile-hub/src/screens/database/NativeDatabaseScreens.test.tsx`.

4.1. **Ярлык «Сканировать QR»:**
- новый статический shortcut первым в списке: `id: 'hubit_scan_qr'`, короткая подпись «Сканировать QR», длинная «Сканировать QR оборудования»;
- intent `hubit://database?scan=1`;
- иконка — отдельный векторный drawable со сканером, если он добавляется без новых зависимостей; иначе `@mipmap/ic_launcher`, как у остальных (решение описать в журнале);
- остальные три ярлыка не менять. Итого 4 — лимит видимых статических ярлыков Android.

4.2. **Параметр `scan=1` → открыть сканер:**
- `routeSystemIntentPath('hubit://database?scan=1')` и `hrefForPortalPath('/database?scan=1')` должны вести на `/(shell)/database` с параметром `scan=1`; добавить `scan` в разрешённые ключи `nativeDatabaseFeature`;
- `NativeDatabaseScreen`: при `scan === '1'` один раз открыть `NativeDatabaseQrScannerModal`, затем убрать параметр из маршрута (`router.setParams({ scan: undefined })` или эквивалент), чтобы сканер не открывался повторно при возврате на экран или повороте;
- без права `database.read` — обычный экран «нет доступа», сканер не открывается;
- без разрешения камеры — штатный запрос разрешения из модалки;
- если пользователь не вошёл — после входа/2FA открывается база со сканером (штатный механизм сохранения маршрута; проверить тестом, если такой тест есть для других маршрутов).

4.3. **Узкий фильтр App Links** (`android-app-links.cjs`):
- при `HUBIT_ANDROID_ENABLE_APP_LINKS=1` фильтр `autoVerify: true` только для `https://hubit.zsgp.ru` с `path: '/database'` и `pathPrefix: '/database/'`. Больше никаких путей: вход, 2FA, почта, задачи должны по-прежнему открываться в браузере;
- по умолчанию (флаг не `1`) — без изменений, фильтра нет;
- тест: при флаге `1` в конфиге только эти два пути, при `0` — пустой объект.

4.4. **Тесты:**
- плагин: в `shortcuts.xml` есть `hubit_scan_qr` с `hubit://database?scan=1`, строки ресурсов созданы, ярлыков 4;
- `routeSystemIntentPath('hubit://database?scan=1')` → маршрут базы с `scan=1`;
- экран базы с `scan=1` открывает сканер один раз и сбрасывает параметр;
- без `database.read` сканер не открывается;
- существующие тесты `systemIntent` (включая `https://hubit.zsgp.ru/database?inv_no=…`) зелёные.

   Прогнать:
   - `npx jest plugins src/navigation src/database src/screens/database --runInBand`;
   - `npm run lint`;
   - `npm run test:ci`.

### 4-B. Выпуск (руководитель и пользователь, только с явного разрешения)

1. Убедиться, что release-подпись постоянная: `dist/hubit-mobile-preview.audit.json` → `signing=release`, SHA-256 сертификата. Fingerprint брать из audit, не из CLI с паролями.
2. Собрать release APK с `HUBIT_ANDROID_ENABLE_APP_LINKS=1` (`npm run build:apk:local`; скрипт сам откажет без release-подписи).
3. Опубликовать `assetlinks.json` через `scripts/mobile/publish-assetlinks.ps1` — запись в каталог IIS на production, **отдельное разрешение пользователя**:
   - preflight — проверка кандидата скриптом, точный путь активного frontend IIS, backup существующего файла (сейчас файла нет — SPA fallback);
   - откат — удалить HUB-IT entry или восстановить backup;
   - post-check: `https://hubit.zsgp.ru/.well-known/assetlinks.json` отдаёт `application/json` с package `ru.zsgp.hubit.mobile` и нужным fingerprint, а не HTML.
4. Установить APK на Android и проверить `adb shell pm get-app-links ru.zsgp.hubit.mobile` → `hubit.zsgp.ru: verified` (или «Открывать поддерживаемые ссылки» в настройках приложения).
5. Проверка на устройстве:
   - удержание иконки → «Сканировать QR» → открывается сканер, в том числе когда приложение не запущено и когда требуется вход;
   - QR этикетки камерой телефона (Google Камера / Lens и штатный сканер производителя) → открывается HUB-IT на карточке нужной базы;
   - без установленного приложения та же ссылка открывает портал в браузере;
   - ссылки входа, 2FA и почты по-прежнему открываются в браузере.
6. Опубликовать APK через `scripts/mobile/publish-apk.ps1` — отдельное разрешение.

### Риски шага 4

- **Штатные сканеры производителей.** Некоторые (Xiaomi/POCO, Huawei и др.) открывают ссылку во встроенном браузере, игнорируя App Links. Это ограничение прошивки, проверяется на устройстве; обход — ярлык «Сканировать QR».
- **Этикетки с другим адресом.** Напечатанные с другого адреса портала (IP, localhost, другой домен) не совпадут с `hubit.zsgp.ru` и в приложении не откроются.
- **Старые этикетки.** Формат `INV_NO: …` — не ссылка: камера покажет текст. Такие этикетки открываются только сканером внутри приложения.
- **Сертификат подписи.** Его смена ломает verified App Links до обновления `assetlinks.json`.
- **Плитка в шторке** (Quick Settings tile) в объём не входит: нужен нативный модуль. Если потребуется — отдельный шаг.

## Шаг 5. Один сканер QR: карточка или список для акта перемещения

Добавлен 2026-09-30 по запросу пользователя. Нужно сканировать QR нескольких единиц техники, чтобы они выделялись и по ним можно было сделать акт перемещения.

Решение пользователя: **один «умный» сканер без режимов**. После первого QR — карточка «Открыть / + Ещё QR», со второго QR — список «Выбрано: N» и «Действия (N)».

### Факты (проверено руководителем, только чтение)

| Что | Состояние |
|---|---|
| Сервер | Всё готово, **backend не меняется**. `POST /equipment/transfer` (сотруднику), `/equipment/transfer/location` (размещение), `/equipment/transfer/act-only` (акт без перемещения): `inv_nos` до 2000, `operation_id` — идемпотентность, фоновая задача `/transfer/act-jobs/{job_id}`, акты группируются по прежнему владельцу. Все позиции одного запроса — одна база (заголовок базы) |
| Множественные действия в приложении | Есть. `NativeEquipmentActions` принимает `targets` (массив `EquipmentRecord`), шлёт `inv_nos`, показывает «Выбрано карточек: N», акты, открытие файла, отправку на почту, `retry_inv_nos`. Используется в `NativeDatabaseScreen` панелью `native-database-selection` с `testIDPrefix="native-database-bulk"` |
| Ограничение текущего выбора | `selectedEquipment` фильтрует только загруженный список `equipment`, поэтому отсканированная карточка вне страницы в выбор не попадает |
| Сканер | `NativeDatabaseQrScannerModal`: после первого кода `scanned=true`, вызывает `onScanned` и закрывается (`openEquipmentFromQr` → `setQrScannerOpen(false)` → переход в карточку). Расходник — `openConsumableFromQr`. Офлайн — поиск в загруженном списке, снимке `database-inbox` и каталоге `readNativeEquipmentCatalogSnapshot` |
| Карточка по номеру | `getEquipment(invNo, databaseId)` в `databaseApi.ts` |

### Целевое поведение

1. **Первый QR оборудования.** Камера не закрывается. Снизу появляется карточка: модель, инв. номер, сотрудник, место и две кнопки:
   - «Открыть» — переход в карточку, как сейчас (тот же `nativeEquipmentDestination`, та же офлайн-подготовка снимка);
   - «+ Ещё QR» — просто продолжить сканирование.
2. **Второй и следующие QR** добавляются в список. Карточка превращается в панель «Выбрано: N»:
   - строка: модель, инв. номер, сотрудник, ✕ (убрать);
   - новый код — вибрация `Haptics.selectionAsync` и строка вверху списка;
   - повтор того же номера не добавляется, строка подсвечивается на ~1 с, тост «Уже в списке»;
   - панель сворачивается в полоску «Выбрано: N ▲» и разворачивается, чтобы не закрывать камеру.
3. **«Действия (N)»** закрывает камеру и открывает экран/лист со списком и существующей панелью `NativeEquipmentActions` (`targets` = список, `testIDPrefix="native-database-scan-batch"`). Всё остальное — акты, открыть/отправить, повтор ошибок — уже реализовано.
4. **Кто не добавляется:**
   - расходник — тост «Расходники в список не добавляются», в списке ничего не меняется (одиночный расходник, пока список пуст, открывается как сейчас);
   - QR другой базы, чем у первой позиции списка, — тост «Другая база: <имя>. Список собирается по одной базе»;
   - номер не найден (404) — строка с пометкой «Не найдено», в «Действия» не уходит;
   - лимит 100 позиций — тост «Не больше 100 за раз».
5. **Задержка повторного срабатывания.** Один и тот же код в кадре не срабатывает чаще раза в 1,5 с (сейчас защищает `scanned`, для потока нужна проверка «тот же текст + время»).
6. **Сеть и права:**
   - без сети сканирование работает, данные строк — из снимков (как в `openEquipmentFromQr`); нет в снимках — строка «Нет данных офлайн» только с номером; «Действия» неактивны с подписью «Нужна сеть»;
   - без `canWrite` вместо «+ Ещё QR» ничего нет: сканер работает как раньше, в список не добавляет.
7. **Сохранность.** Список хранится в памяти экрана и в `nativeSnapshotCache` (ключ по пользователю и базе), переживает сворачивание и перезапуск. После успешного действия список очищается; при частичной ошибке остаются только `retry_inv_nos`. Выход пользователя очищает список (штатная очистка снимков — проверить, что ключ туда попадает).
8. **Закрытие сканера с непустым списком.** Подтверждение «Список из N позиций сохранится. Закрыть?»; список доступен кнопкой «Выбрано: N» на экране базы.

### 5-A. Приложение (исполнитель)

Файлы:

- `mobile-hub/src/components/database/NativeDatabaseQrScannerModal.tsx` — потоковый режим, нижняя карточка/список;
- новый `mobile-hub/src/database/useNativeScanBatch.ts` (+ тест) — список, дедупликация, база, лимит, сохранение в снимок;
- новый `mobile-hub/src/components/database/NativeScanBatchPanel.tsx` — карточка первого QR и список;
- `mobile-hub/src/screens/database/NativeDatabaseScreen.tsx` — подключение, «Действия (N)» → `NativeEquipmentActions` с `targets`, кнопка «Выбрано: N» после закрытия сканера;
- `mobile-hub/src/screens/database/NativeDatabaseScreens.test.tsx`.

Не трогать: backend, `NativeEquipmentActions` (разве что проп для очистки списка через `onChanged` — описать в журнале), обычный режим «Выбрать» в списке.

Сканер из ярлыка «Сканировать QR» (шаг 4, `scan=1`) — тот же, новый пункт на иконке не добавлять.

Тесты:

- первый QR: карточка с «Открыть» и «+ Ещё QR»; «Открыть» ведёт туда же, куда сейчас;
- два разных QR → «Выбрано: 2», «Действия (2)» отдают в `submitEquipmentTransfer` оба `inv_nos`;
- повтор не дублирует; ✕ удаляет;
- расходник, другая база, 404, 101-я позиция — не добавляются, текст ошибки;
- офлайн: строки из снимка, «Действия» неактивны;
- без `canWrite` поведение как до шага;
- частичная ошибка оставляет в списке только `retry_inv_nos`, успех очищает;
- список восстанавливается из снимка после перемонтирования экрана.

Прогнать:

- `npx jest src/database src/components/database src/screens/database --runInBand`;
- `npm run lint`;
- `npm run test:ci`.

### Проверка на Android (после сборки)

- 5 этикеток подряд без закрытия камеры, повтор одной — без дубля;
- «Действия» → «Передать сотруднику» → акты по прежним владельцам открываются;
- «Сформировать акт» без перемещения; «Сменить размещение»;
- свернуть приложение посреди сканирования — список на месте;
- режим полёта: сканирование работает, отправка заблокирована;
- ярлык «Сканировать QR» открывает тот же сканер.

### Риски шага 5

- **Ошибочная массовая передача.** Защита: экран «Действия» показывает весь список перед отправкой, лимит 100, повторная отправка идемпотентна через `operation_id`.
- **Старые этикетки** `INV_NO: …` без базы: позиция считается из текущей базы; расхождение баз ловится только по 404.
- **Сканер цепляет соседний QR** на плотно наклеенных этикетках: дедупликация не спасает от лишней позиции, поэтому строка удаляется ✕, а вибрация сообщает о каждом добавлении.

## Выпуск обычной (не preview) версии

Добавлено 2026-09-30 по вопросу пользователя. Выполнять только с явного разрешения на каждую операцию.

### Факты

- Все опубликованные APK, включая последнюю сборку 1.1.59 (61), подписаны сертификатом `debug-preview` `fac61745…`.
- `scripts/mobile/publish-apk.ps1` публикует только в канал `preview` (`$channel = 'preview'` задан в коде).
- Постоянный ключ не создан; скрипт `mobile-hub/scripts/prepare-release-signing.ps1` есть, процедура — `MOBILE_HUB_APK_DISTRIBUTION.md`, раздел «Постоянная подпись».
- Android не обновляет приложение с другой подписью: каждому пользователю preview нужно один раз удалить приложение и установить обычную версию. На телефоне пропадут офлайн-кэш и неотправленная очередь (чат, почта); серверные данные не затрагиваются.

### Условия выпуска

1. Приняты шаги 3, 4-A, 5-A, шаг A офлайн-входа (`MOBILE_HUB_OFFLINE_AUTH_PLAN.md`), проверены Н-1…Н-3.
2. Пройдены проверки на Android из этого плана и плана офлайн-входа.
3. Решена выкладка backend (вариант А/Б/В).

### Порядок

1. **Ключ.** Пользователь сам запускает `prepare-release-signing.ps1`: рабочий keystore и две резервные копии на разных носителях вне Git. Пароль не передаётся через CLI и не попадает в отчёты.
2. **Канал `stable` в скриптах** — отдельная задача исполнителю:
   - параметр канала в `publish-apk.ps1` (`preview` по умолчанию, `stable` — только с `signing=release`);
   - имя файла без `Preview`;
   - ссылка на скачивание на портале показывает stable, preview остаётся для тестировщиков;
   - тесты скриптов; production не трогать.
3. **Сборка** `npm run build:apk:local` с `HUBIT_ANDROID_ENABLE_APP_LINKS=1`; в audit — `signing=release` и SHA-256 сертификата.
4. **`assetlinks.json`** — шаг 4-B, отдельное разрешение.
5. **Публикация** в `stable`: отдельное разрешение, post-check `verify-published-apk.mjs`, откат — `manage-apk-feed.ps1 -Action RestoreManifest`.
6. **Переход пользователей.** Перед публикацией разослать инструкцию: отправить неотправленное, удалить preview, установить обычную версию, войти заново. Preview-канал больше не обновлять, чтобы не было двух подписей в работе.

### Сборка и публикация preview 1.1.60 — Devin (Cognition) — 2026-10-01

Статус: preview 1.1.60 (62) опубликован, ждёт проверки на Android. Разрешение пользователя на сборку и публикацию получено 2026-10-01.

Сделано (та же процедура, что у записи 2026-09-30):

- Версия: `mobile-hub/package.json` → `version 1.1.60`, `hubit.androidVersionCode 62`; создан `release-notes/1.1.60.json` (6 пунктов changelog — офлайн-сессия, C-2, AppLock). `app.config.ts` читает новые значения через `readMobileVersionMetadata` — проверено `node -e …` → `1.1.60 / 62`.
- Предсборка: `npx tsc --noEmit` → exit 0. `npm run test:ci` → 337/338 наборов, единственное падение `scripts/mobile-version.test.js` — ожидаемо: сгенерированный `android/` ещё нёс 1.1.59/61 до prebuild. После `npx expo prebuild --platform android --clean` тот же тест → 3/3, `mobile-version.cjs` → «Mobile version synchronized: 1.1.60 (62)». Итоговое состояние тестов — зелёное.
- Сборка: `powershell -File scripts/build-apk.ps1 -Local -Variant preview -Architectures dual -AllowDebugSigning` → `BUILD SUCCESSFUL in 39m 14s` (719 задач). App Links не включались (4-B ждёт).
- Audit `dist/hubit-mobile-preview.audit.json`: `version 1.1.60`, `version_code 62`, `signing debug-preview`, `signer_sha256 fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c` — **совпадает с 1.1.59**, `size_bytes 70 730 781`, `sha256 bbfb446d5d46eec33aa5e6dba8be11749342e9ed7dc38274763318f5b7f32c7c`, `abis [arm64-v8a, armeabi-v7a]`, minified+resource_shrinking.
- Публикация: `powershell -File scripts/mobile/publish-apk.ps1 -IisUpdateRoot C:\inetpub\wwwroot\hub-desktop-updates -ExpectedSignerSHA256 fac61745… -AllowDebugPreviewSigner` → `mobile/preview/1.1.60/HUB-IT-Mobile-Preview-1.1.60.apk` + атомарный `latest.json` (schema 2, min_supported_version_code 1).
- Внешняя проверка: `node scripts/mobile/verify-published-apk.mjs` → manifest 200 (`application/json`, `no-cache`), version `1.1.60`/62, APK 200 (`application/vnd.android.package-archive`), size/sha256/signer совпали → **`verified: true`**.

Отклонения от плана:

- Подпись `debug-preview` (`-AllowDebugSigning` + `-AllowDebugPreviewSigner`): release-keystore/`HUBIT_ANDROID_*` на машине нет — тот же сертификат, что у опубликованного preview-канала, upgrade совместим. Stable-канал не покрывается.
- `test:ci` фактически зелёный: единственное падение — ожидаемая рассинхронизация версий до prebuild; после prebuild тест проходит (зафиксировано отдельным прогоном).

Не проверено:

- Дым-тест на устройстве (эмулятор недоступен — VMware-гость без nested-виртуализации; AVD `hubit_check` сохранён). Чек-лист п.1 «Что осталось до выпуска» — за пользователем/руководителем.
- Обновление по воздуху на реальном устройстве (канал/манифест проверены извне по HTTPS).

Откат (если потребуется): вернуть `latest.json` на 1.1.59 по `MOBILE_HUB_APK_DISTRIBUTION.md`; файл 1.1.59 остаётся в `mobile/preview/1.1.59/`.

Вопросы руководителю: нет.

### Ш5-6…Ш5-8 — Devin (Cognition) — 2026-10-01

Статус: **выполнены, на проверке**. Только `mobile-hub`; backend, версия, APK — не трогались.

Сделано:

- **Ш5-6.** Обе панели «Выбрано: N» — обычная (`native-database-selection`) и скан-список (`native-database-scan-batch`) — получили `paddingBottom: emptyListInset` (= `useNativeBottomNavInset()`), как у списков экрана. Кнопки действий в `selectionActions` не трогались; ограничивать высоту строк не потребовалось.
- **Ш5-7.** `NativeDatabaseQrScannerModal` рендерит `NativeToastHost` внутри нативной Modal (в конце `styles.root`, над камерой и overlay-панелью); тосты «Уже в списке», «Нет связи…», «Другая база…» видны внутри сканера. `NativeToastHost` получил проп `muted`; внешний хост экрана — `muted={qrScannerOpen}`, поэтому при закрытии тост не всплывает второй раз. QR расходника открывает карточку всегда: при 0–1 позициях — `clear()` + `openConsumableFromQr` сразу; при 2+ — `Alert` «Список из N позиций сбросится. Открыть расходник?» (Отмена / Открыть).
- **Ш5-8.** Новый жизненный цикл списка сканирования:
  - Каждое открытие сканера (кнопка QR, `scan=1`) — с пустого списка: эффект на переходе `qrScannerOpen` false→true вызывает `scanBatchClear()`, сворачивает панель.
  - Закрытие (✕ / «назад» через `onRequestClose` → `requestScannerClose`): 0–1 позиция — закрывает и очищает без вопроса; 2+ — `Alert` «Список из N позиций сбросится. Закрыть?» (Отмена / Закрыть→clear+close).
  - «Действия (N)» — без изменений: закрывает сканер, открывает панель, список сохраняется.
  - Кнопка «Скрыть» заменена на «Отменить» (`native-database-scan-batch-cancel` → `requestScanBatchDiscard`): очищает список и закрывает панель; при 2+ — `Alert` «Список из N позиций сбросится. Отменить?» (Назад / Отменить).
  - Плашка `native-database-scan-batch-open` и стили `scanBatchStrip`/`scanBatchStripText` удалены — висячих списков на экране больше нет.
  - `useNativeScanBatch` больше не читает снимок `scan-batch:<db>` (запись осталась — после `clear()` пишется `{items: []}`; `sanitizeItems` удалён как мёртвый код). Гонка «восстановление после clear» устранена по построению — чтения нет вовсе. Dedup-карта сканера по-прежнему сбрасывается на каждое открытие (эффект на `visible`).
  - Успешный акт очищает список, частичная ошибка оставляет `retry_inv_nos` — как было.

Файлы:

- `src/screens/database/NativeDatabaseScreen.tsx` — inset на двух панелях, эффект сброса при открытии сканера, новые `requestScannerClose`/`requestScanBatchDiscard`, ветка consumable в `handleScannerScan`, удалена плашка и стили, `muted` на внешнем хосте;
- `src/components/database/NativeDatabaseQrScannerModal.tsx` — `NativeToastHost` внутри модалки, `testID="native-qr-scanner-modal"`;
- `src/components/nativeToast.tsx` — проп `muted`;
- `src/database/useNativeScanBatch.ts` — убрано восстановление снимка;
- `src/database/useNativeScanBatch.test.ts` — тест восстановления → «не восстанавливает» + «пустой снимок после clear»;
- `src/screens/database/NativeDatabaseScreens.test.tsx` — переписаны тесты старого поведения и добавлены новые.

Переписанные тесты (закрепляли старое поведение):

- `restores the batch list from the snapshot after the screen remounts` → `does not restore a saved batch after the screen remounts (Ш5-8)`;
- `asks before closing the scanner with a non-empty batch` → `closes the scanner with one item without asking and resets the list` + `asks before closing the scanner with 2+ items and «Закрыть» resets the list` (формулировка «сохранится» → «сбросится»);
- `rejects consumables and foreign databases while the batch list is non-empty` → `opens the consumable card and resets a one-item batch on a consumable QR (Ш5-7)` + `asks «Открыть расходник?» over a 2+ item batch` + `still rejects equipment from a foreign database…`;
- `enforces the 100 item limit with a toast` — список набирается 100 сканами вместо посева снимком.

Новые тесты:

- `shows scanner toasts inside the open modal and does not duplicate them after close (Ш5-7)` — `native-toast` внутри `native-qr-scanner-modal`, один узел в дереве, после закрытия не остаётся;
- `«Отменить» on the batch panel resets the list, asking first at 2+ items (Ш5-8)`;
- `clears the leftover batch when the scanner reopens via scan=1 (Ш5-8)` — остаток списка после «Действия» сбрасывается при новом открытии;
- `adds the bottom nav inset to the selection and scan batch panels (Ш5-6)` — `paddingBottom >= 66` на обеих панелях;
- hook: `does not restore a stale batch snapshot on mount`, `persists an empty snapshot after clear`.

Проверки (фактический вывод, из `mobile-hub`):

- `npx jest src/database src/components/database src/screens/database src/components --runInBand` → **54/54 наборов, 320/320 тестов**;
- `npx tsc --noEmit` → **exit 0**;
- `npm run test:ci` → **341/341 наборов, 2386/2386 тестов**. Промежуточные прогоны дважды ловили разные чужие полу-правки (дерево в процессе параллельной работы): `ChatAttachmentPanel.test.tsx` (новый untracked, писался в 12:14–12:16) и `nativeChatStorageQueue.ts` (изменён в 12:25) — каждый сьют зелёный в изоляции после завершения чужой правки; к файлам этой задачи отношения не имеют.

Отклонения и заметки:

- Формулировка Alert на «Отменить» панели — «…сбросится. Отменить?» (кнопки «Назад»/«Отменить») — тот же смысл, что «Закрыть?», но глагол соответствует действию панели.
- Snapshot-запись оставлена; восстановление убрано полностью — «старый список не восстанавливается» выполнено сильнее минимального варианта («clear() при открытии»), гонка с асинхронным чтением исключена.
- Тост `Расходники в список не добавляются` убран из `handleScannerScan` (заменён новым поведением); другие вызовы `showNativeToast` не менялись.

Не проверено: физическая приёмка на Android (перекрытие навигацией при реальном fontScale, видимость тоста поверх нативной Modal, аппаратная кнопка «назад») — нет устройства; ждёт проверки руководителя на 1.1.61.

Вопросы руководителю: нет.
