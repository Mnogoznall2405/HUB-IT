# RESULTS — отчёты исполнителя

## INIT — ожидание очереди куратора

**Статус выполнения:** BLOCKED
**Дата:** 2026-11-20

### Состояние
- `ui-review/TASKS.md` отсутствует — очередь задач куратором ещё не создана.
- Создан скелет каталогов: `screenshots/before`, `screenshots/after`, `reports`.
- Свои задачи не формирую — жду `TASKS.md` от куратора.

### Контекст проекта (для быстрого старта)
- Приложение: `desktop/Hub.Desktop` — WPF, `net8.0-windows10.0.17763.0`.
- Нативный чат: `Native/Views/ChatView.xaml` (+ `.xaml.cs`), VM — `Native/ViewModels/ChatViewModel.cs`, `ChatItemViewModels.cs`.
- Темы: `Native/Themes/HubTheme.xaml`, `HubColorsDark.xaml`, `HubColorsLight.xaml` (DynamicResource-палитра).
- Векторные иконки хрома: `Native/Views/VectorIcons.cs`, `VectorIcon.cs`.
- Сборка: `tools\dotnet-sdk-8\dotnet.exe build desktop\Hub.Desktop\Hub.Desktop.csproj -c Release`.
- Тесты: `tools\dotnet-sdk-8\dotnet.exe test desktop\Hub.Desktop.sln -c Release` (последний прогон 2023/2023).
- Запуск нативного окна: `HUB.Desktop.exe --native`.
- Рабочие скриншоты уже ведутся: `desktop/screenshots/` (генератор — тест `NativeScreenshots.GenerateAllPages`), живой захват — `desktop/scripts/capture-window.ps1`.

---

## FIX — Постоянно видимые скроллбары (замечание пользователя: «убери эти скролы»)

**Статус выполнения:** DONE_FOR_REVIEW
**Дата:** 2026-11-20

### Выполненные изменения
- Постоянные серые скроллбары заменены Telegram-подобным оверлеем поверх
  контента; по финальному замечанию пользователя ползунок полностью невидим
  (`Opacity=0`) — прокрутка колесом/тачпадом/клавиатурой работает как прежде.
- Оверлей — неявный дефолт для всех `ScrollViewer` приложения, включая
  внутренние скроллеры шаблонных списков.
- Починена прокрутка колесом в колонке диалогов: внутренний `ListBox` с
  отключённым скроллом перехватывал `MouseWheel` — переведён на
  `ChatFlatListBoxStyle` (шаблон без внутреннего ScrollViewer, событие всплывает
  к общему скроллеру колонки).
- Починено превью фото-вложений на живых данных: `RebuildAttachmentItems`
  выполнялся в `Apply()` до назначения `ImageLoader` — превью не стартовало
  никогда. Теперь сеттер `ImageLoader` пересобирает вложения; добавлен
  fallback распознавания фото по расширению файла (.png/.jpg/.jpeg/.gif/.webp/.bmp),
  т.к. бэкенд не всегда шлёт `mime_type`. Тот же fallback — в плитках
  медиагалереи.

### Изменённые файлы
- `desktop/Hub.Desktop/Native/Themes/HubTheme.xaml` — `HubOverlayScrollViewerStyle`
  + неявный дефолт `ScrollViewer`, тонкий thumb-стиль.
- `desktop/Hub.Desktop/Native/Views/ChatView.xaml` — `ChatOverlayListBoxStyle`
  (лента сообщений), `ChatFlatListBoxStyle` (список диалогов — фикс колеса),
  оверлей-скроллер колонки.
- `desktop/Hub.Desktop/Native/Views/HubWindow.xaml` — nav-ScrollViewer на новый стиль.
- `desktop/Hub.Desktop/Native/ViewModels/ChatItemViewModels.cs` — таймингоый
  фикс `ImageLoader` + `HasImageExtension` + fallback в галерее.

### Техническое решение
Шаблон ScrollViewer: `ScrollContentPresenter` во всю ячейку, `PART_Vertical/HorizontalScrollBar`
поверх (`Panel.ZIndex`), `Opacity=0` — бар существует и синхронизирует offset,
но не рендерится. PART-имена сохранены — `ChatScrollAssist` и привязки работают
(`FindScrollViewer` обходит визуальное дерево).
Превью фото: `IsImage` = kind=="image" || mime image/* || `HasImageExtension(FileName)`;
пересборка `AttachmentItems` в сеттере `ImageLoader`; `MarkDeleted` обнуляет
сохранённые модели, чтобы не воскрешать вложения удалённого сообщения.

### Сборка и тесты
- `dotnet build desktop\Hub.Desktop.sln -c Release`: 0 ошибок, 0 предупреждений.
- `dotnet test --filter NativeScreenshots`: 1/1 (все кадры обеих тем + 4 размера окна).
- `dotnet test --filter NativeChat|ChatScroll|Grouping|Attachment`: 244/244.
- Полный прогон: 2025/2026 — единственный фейл `DownloadMessageSourceFetchesEmlForOpenDetail`
  оказался устаревшей тестовой dll (исходник уже под новый шов `MessageSourceSaver`);
  после пересборки 1/1 зелёный.

### Скриншоты
- Живое окно: `ui-review/screenshots/after/live-chat-open.png` (1280×800, 94 диалога,
  реальная переписка «Заметки» — скроллбаров нет, фото-вложение показано
  превью-плиткой в пузыре).
- Фикстуры: `desktop/screenshots/04-chat.png`, `L04-chat.png`, `07-mail.png`,
  `07c-mail-scrolled.png` и комплект.

### Проверка критериев
- Скроллбар не занимает место в раскладке и не виден без наведения — как в tdesktop.
- Колесо/PageUp/PageDown/тачпад-скролл работают прежним образом.
- Виртуализация списков сохранена (Recycling + CanContentScroll через шаблон).

### Известные ограничения
- Ползунок совсем невидим (требование пользователя «убери вообще»): позиция
  прокрутки не считывается визуально — как в мобильном Telegram без hover.
- Всплывающий поиск пользователей/жалоб/задач — в своих скроллерах, тоже
  под глобальным оверлеем.

### Передача куратору
Готово к визуальной и функциональной приёмке.

---

## UI-001 — контраст в тёмной теме (названия диалогов + входящий текст) — ИСПРАВЛЕНО

### Воспроизведение
`defects/UI-001-dark-direct-1280x720.png`: невыбранные названия диалогов
(«IT-отдел», «Поддержка HUB», «Заметки», «Сергей Козлов») и текст входящих
сообщений почти чёрные на тёмном фоне.

### Корень
Два стиля без базового `Foreground` — наследовали чёрный дефолт WPF:
- `ChatRowTitleTextStyle` (заголовок строки диалога) — только триггер `IsSelected`.
- Стиль `TextBlock` тела сообщения (`ChatView.xaml`) — только триггеры
  `IsOwn`/`IsDeleted`; входящее неудалённое оставалось чёрным.

Скан файла: остальные TextBlock-стили с fg-триггерами базовую кисть имеют.

### Фикс (ChatView.xaml)
- `ChatRowTitleTextStyle`: базовый `Foreground = HubTextBrush` — невыбранное
  имя читается; выбранное по-прежнему `HubChatOnAccentBrush` (белый на акценте).
- Тело сообщения: базовый `Foreground = HubTextBrush`; `IsOwn` → `HubChatOutTextBrush`,
  `IsDeleted` → `HubChatSecondaryBrush` — различия сохранены.

### Бонусный дефект, найденный на тех же кадрах (фидбек пользователя)
«Все строки выглядят закреплёнными»: 📌 и 🔕 висели на каждой строке.
Корень — `VectorIcon.OnDataChanged` делал локальное присвоение
`self.Visibility = Visible`, что уничтожало чужой `Visibility`-биндинг
(`IsPinned`/`IsMuted`). Фикс: управление только `_path.Visibility`
(VectorIcon.cs) — биндинги владельца не трогаем. Статическое Data +
привязанная видимость теперь работают вместе: 📌 у закреплённых остался,
у остальных пропал; 🔕 только у заглушённых.

### Проверки
- Сборка Release: 0/0; полный прогон: **2027/2027**; чат-фильтр: 195/195.
- Фикстурные кадры (1280×800 + комплект размеров, обе темы):
  `desktop/screenshots/04l-chat-unread.png` — личный диалог, выделенная
  Ирина + невыделенные Заметки/Сергей: имена читаются, входящий текст белый.
  `desktop/screenshots/L04l-chat-unread.png` — то же в светлой теме.
  `04-chat.png` — группа IT-отдел: пин 📌 у реально закреплённого остался.
- Живое окно (--native, реальные данные, 94 диалога):
  `ui-review/screenshots/after/live-chat-rows-fixed.png` — 📌 только у трёх
  верхних реально закреплённых диалогов (сортировка pinned-first), имена и
  превью читаемы в тёмной теме.

### Критерии
- ≥4.5:1 обычный текст: `HubTextBrush` (#FFFFFF dark / #0B1A29 light) на
  `#17212B`/surface — проходит с большим запасом.
- Свой/чужой/удалённое/мета/ссылки — раздельные кисти, без «всё белое».
- Выделенная строка различима без фокуса (HubChatOnAccentBrush на акценте).

## UI-003 — «Повторить» после ошибки истории не грузил текущий чат — ИСПРАВЛЕНО

### Воспроизведение
`defects/UI-003-history-transport-error.png` / `UI-003-history-after-retry.png`:
при сбое чтения истории лента показывала «Сообщений пока нет», а баннерный
«Повторить» перезапрашивал только список диалогов — счётчик запросов истории
оставался 0, лента пустой.

### Корень
`RetryCommand` безусловно вызывал `LoadConversationsCoreAsync` (список), а ошибка
истории писалась в тот же `BannerErrorText` — у ленты не было ни собственного
состояния ошибки, ни повтора именно загрузки сообщений.

### Фикс
`ChatViewModel.cs`:
- Новые `HistoryErrorText`/`HasHistoryError` + `RetryHistoryCommand` — повтор
  запрашивает историю выбранного диалога (`LoadMessagesSafelyAsync`).
- Баннерный `RetryCommand` диспетчеризует: при `HasHistoryError` грузит историю
  текущего диалога, иначе — список диалогов (прежний сценарий сохранён).
- `IsMessagesEmpty` требует `!HasHistoryError` — «Сообщений пока нет» при сбое
  не утверждается; запоздалый/чужой результат отброшен `ReferenceEquals`-guard +
  отменой прежнего токена.
- Смена/снятие выбора очищает `HistoryErrorText`.

`ChatView.xaml`: в области ленты — отдельная панель ошибки (причина + кнопка
«Повторить», `AutomationProperties.Name="Повторить загрузку сообщений"`),
показывается по `HasHistoryError` вместо пустого состояния.

`FakeHubApiClient.cs`: хук `ChatMessagesAsyncFactory` — полностью управляемый
ответ истории для гонок/задержек.

### Проверки (изолированный `IHubApiClient`, 7 тестов — все зелёные)
- `HistoryTransportErrorShowsErrorStateNotEmptyClaim` — видна причина и повтор;
  `IsMessagesEmpty=false`, сообщений нет — честной «пустоты» не утверждается.
- `BannerRetryReloadsHistoryOfCurrentConversation` — «Повторить» баннера после
  восстановления грузит историю того же `c1` (счётчик фабрики 1, сообщения
  появились, баннер/ошибка очищены) — ровно сценарий стенда.
- `RetryHistoryCommandReloadsAndClearsError` — отдельная кнопка панели ленты.
- `SecondHistoryFailureKeepsErrorAndRetryAvailable` — повторный сбой остаётся
  ошибкой, повтор доступен.
- `LateRetryResponseDoesNotOverwriteNewConversation` — retry c1 в полёте,
  переход на c2, запоздалый ответ c1 отброшен: в ленте только сообщения c2.
- `SwitchingConversationClearsStaleHistoryError` — ошибка c1 не течёт в c2.
- `RealEmptyHistoryShowsEmptyStateWithoutError` — настоящая пустая история
  отличима от сбоя.

Прогон чат-фильтра после правки: **213/213**. Скриншоты состояния снимаются
на живом окне при доступном транспортном сбое; поведение подтверждено
граничными тестами (как предписано проверкой куратора).

## UI-002 — Карточка «Информация» сжимала ленту до ~94px при 1024×600 — ИСПРАВЛЕНО

### Воспроизведение
`defects/UI-002-info-1024x600.png`: при 1024×600 и открытой карточке лента
получала ~94px (216 нав + 380 список + 5 сплиттер + 330 панель из 1024) —
заголовок исчезал, сообщения переносились по 1–3 символа, композер обрезан.

### Корень
Панель «Информация» — всегда докированная колонка 330 DIP
(`ChatView.xaml`, `Grid.Column="3"`, `Width="330"`): на узком окне ей
неоткуда взяться, кроме как из ленты.

### Фикс (Telegram-поведение)
В tdesktop правая панель на узком окне становится оверлеем поверх чата, а не
третьей колонкой — то же правило внедрено:

- `ChatViewModel.IsCompactInfoOverlay` — флаг компактной раскладки, его
  выставляет вью по фактической ширине: `feedWouldBe = chatArea − sidebar − 5 − 330`;
  оверлей при `feedWouldBe < 360`. Оценка «гипотетической» ширины ленты не
  зависит от текущего режима — порог не мечется, гистерезис не нужен.
- `ChatView.xaml.cs`: пересчёт на `SizeChanged` области чата и сайдбара
  (сплиттер меняет колонку без изменения общей ширины — слушаем оба).
- `ChatView.xaml`: у панели — стилевой триггер: колонка 3 на широком окне;
  `Grid.Column=2 + ColumnSpan=2 + Right + ZIndex=3 + DropShadow` на узком —
  плавает поверх ленты, список и лента сохраняют ширину и позицию скролла.
  Локальные Grid.Column у элемента убраны (били бы триггер).

### Проверки
- `desktop/screenshots/04n-chat-peer-1024.png` — кадр генератора ровно на
  1024×600 с открытой карточкой: панель оверлей справа, лента под ней
  полной ширины, композер и баблы читаемы, ✕/Уведомл./Медиа доступны,
  низ панели прокручивается (ScrollViewer внутри сохранён).
- `04m-chat-peer.png` (1280×800, сайдбар по умолчанию) — оверлей; колоночный
  режим возвращается при достаточной ширине (широкое окно или узкий сайдбар
  через сплиттер) — ручной контроль у пользователя остаётся.
- После закрытия — тот же диалог, черновик/позиция скролла не трогались:
  оверлей не меняет ленту вообще; при сужении/расширении окна режим
  переключается без наложения (колонка Auto схлопывается в 0).
- Сборка Release 0/0; чат-фильтр **214/214**; генератор кадров 1/1.

### Критерии
- 1024×600 и 1280×720: нет обрезанного «обломка» истории — карточка
  самостоятельная панель поверх области (как разрешал формулировать фикс
  куратор); закрытие/возврат/имя/уведомления/медиа доступны.
- Длинный заголовок и ≥125% DPI — на проверке у реального дисплея;
  верхняя граница MaxWidth окна не затронута.

## UI-004 — Оверлеи чата не управляли фокусом (модал удаления + настройки группы) — ИСПРАВЛЕНО

### Воспроизведение
Открыть подтверждение удаления («Удалить сообщение?») или «Настройки группы»
на окне 1024×600: фокус оставался в фоне (композер/лента), `Tab`/`Shift+Tab`
уходил под модал, `Enter` мог сработать на произвольном элементе фона,
`Esc` для настроек не был подключён вовсе, после закрытия фокус терялся.

### Фикс (Telegram-поведение: модал = безопасная цель, Esc = верхний слой)

- `ChatView.xaml`, модал удаления: бордер диалога —
  `KeyboardNavigation.TabNavigation="Cycle"` + `Focusable="True"`: цикл
  `Tab`/`Shift+Tab` ограничен двумя кнопками, фон недостижим. Кнопке
  «Отмена» дано имя `DeleteCancelButton` (безопасная цель по умолчанию),
  обе кнопки имеют `AutomationProperties.Name`, у модала —
  `AutomationProperties.Name="Подтверждение удаления"`. Клик по затемнению
  (`DeleteBackdropMouseDown`, `PreviewMouseLeftButtonDown`) — отмена.
- `ChatView.xaml`, настройки группы: панель названа `GroupSettingsPanel`,
  `AutomationProperties.Name="Настройки группы"`, кнопка ✕ —
  `Закрыть настройки группы`.
- `ChatView.xaml.cs`: `ChatModel_PropertyChanged` отслеживает
  `IsDeleteConfirmOpen`/`IsGroupSettingsOpen`; на открытии фокус уходит
  через `Dispatcher.BeginInvoke` (после раскладки видимости) в
  `DeleteCancelButton` / `GroupSettingsPanel`; `_focusBefore*` запоминает
  элемент до оверлея; на закрытии — возврат ему, fallback на композер.
- `ChatView_PreviewKeyDown`, приоритет `Esc` сверху вниз: модал удаления →
  пересылка → просмотрщик медиа → поиск сообщений → настройки группы →
  глобальная навигация. Закрывается ровно один верхний оверлей.

### Проверки (STA-тесты с реальным окном, NativeChatViewModelTests)

- `DeleteConfirmFocusesCancelAndTrapsTabInsideDialog`: после открытия
  `Keyboard.FocusedElement == DeleteCancelButton`; предок кнопки — бордер
  с `TabNavigation=Cycle`; `Enter` в начальном состоянии не удаляет
  (`api.DeletedMessages` пуст).
- `DeleteConfirmEscapeCancelsAndRestoresComposerFocus`: фокус в композере →
  открыть → `Esc` на кнопке «Отмена» → модал закрыт, удаления нет, фокус
  вернулся в композер.
- `EscapeClosesOnlyTopmostOverlay_GroupSettingsUnderDeleteConfirm`:
  настройки открыты → поверх модал удаления → `Esc` закрывает модал,
  настройки остаются → второй `Esc` закрывает настройки.
- Кадры: `screenshots/after/UI-004-delete-1024x600.png` (модал по центру,
  «Отмена» слева — безопасная цель, «Удалить» красной справа),
  `screenshots/after/UI-004-settings-1024x600.png` (панель читаема,
  ✕ и «Сохранить» доступны).
- Сборка Release 0/0; чат-фильтр **217/217**; генератор кадров 1/1.

### Критерии

- Фокус на «Отмена» при открытии — проверен тестом и кадром.
- `Tab`/`Shift+Tab` не выводят в фон — `Cycle` на бордере (проверено тестом
  обхода визуального дерева).
- Начальный `Enter` не удаляет — проверено (фокус на «Отмена», DELETE API
  не вызывался).
- `Esc` гасит только верхний — проверено на стеке «настройки + модал».
- Возврат фокуса в композер/предыдущий элемент — проверено тестом.
- Черновик и выбранный диалог при открытии/закрытии не меняются — оверлеи
  состояние ленты не трогают (та же инвариантность, что в UI-002).
- Screen reader: заголовок и действия анонсируются через
  `AutomationProperties.Name`; живой Narrator/NVDA — на ручной проверке.

## Итерация паритета — широкие окна, композер, иконки меню

Кадры 04-chat/04z-s1024…s1920 и live-native после правок.

### Топ-бар и колонка
- `HubGhostButtonStyle` (HubTheme.xaml) хардкодил `ContentPresenter
  HorizontalAlignment="Center"` и игнорировал `HorizontalContentAlignment`:
  заголовок диалога с заявленным `Left` рендерился по центру. Шаблон теперь
  уважает `TemplateBinding` (дефолт Center оставлен сеттером стиля) — имя
  собеседника у левого края топ-бара, как в tdesktop; все места с явным
  `HorizontalContentAlignment` (MyFiles, Networks, Docflow, TicketAdmin,
  PART_HeaderButton) получают заявленное выравнивание.
- Плашка закрепа: раньше плавающая карточка `Margin=14` почти на всю
  ширину — в adaptive-раскладке tdesktop она выровнена по центрированной
  колонке истории. Завёрнута в `Grid MaxWidth=740`, Margin `16,6,14,0` —
  левый край совпадает с краем пузырей.

### Композер (по эталону `updateControlsGeometry` tdesktop: 📎 | поле | 😊 | 🎤/➤)
- Убрана сплошная панельная заливка и верхняя кромка: в tdesktop композер
  плавает на wallpaper. Паттерн ленты расширен под композер
  (`Grid.RowSpan=4`), внешний Border прозрачный, `Padding=14,6,14,10`.
- `ChatSendFabStyle`: акцентный FAB-круг → плоская иконка-кнопка как в
  tdesktop — прозрачный фон, hover по `HubChatHoverBrush`, глиф ➤ 21px
  акцентом; на пустом поле приглушённый 🎤, при правке ✓ (триггеры те же).

### Векторные иконки вместо эмодзи (правило дизайн-системы)
- Главное меню: ✎👥🗒🔎🛟⟳🌙 → `VectorIcon` 16px (Edit/Group/Document/
  Search/Help/Refresh/Moon — монохром как в меню tdesktop).
- Контекстное меню сообщения: ↩✏📌⧉↪📊✓✓☑⚠ → VectorIcon
  (Reply/Edit/Pin/Copy/Forward/Poll/DoneAll/SelectAll/Flag); «Удалить» уже
  был векторным.
- В `VectorIcons.cs` добавлены Material-глифы: Refresh, Moon, Help, Copy,
  Poll, SelectAll, Flag.

### Проверки
- Сборка Release 0/0; полный прогон **2037/2037**; генератор кадров 1/1.
- Кадры: `04z-chat-s1920` (заголовок слева, закреп по колонке, композер на
  обоях), `04o-chat-menu` (векторные иконки), `_crop-send` (плоский 🎤),
  `live-native.png` (то же на живых данных при поднятом бэкенде).

## Итерация паритета — typing-индикатор, участники, метаданные, вложения

Кадры 04i/04b/04d/04w/04v и live-native после правок.

### «Печатает…» — только в шапке и списке (как в tdesktop)
- Удалена отдельная курсивная строка над композером (была 3-я копия
  индикатора); строка грида `Auto` схлопнулась без остатка.
- В шапке `PresenceText`+`KindText` обёрнуты в общий StackPanel со
  скрытием через `InverseBoolToVisibility` — typing заменяет весь
  подзаголовок (2 строки: имя + «печатает…»), как в tdesktop.

### Участники группы — бейджи ролей читаются полностью
- Inline-кнопки «Сделать владельцем»+«✕» дублировали контекстное меню
  строки и съедали ~200px: бейджи резались («Модера:», «ограни…»).
  Кнопки удалены — модерация по правому клику; «Владелец»/«Модератор»/
  «ограничен до…» видны целиком.

### Заявки на вступление — перекрытие убрано
- `CheckBox` без `Grid.Row` падал в строку 0 поверх заголовка
  «Заявки на вступление». Добавлен `Grid.Row="1"`.

### Метаданные исходящих: «время ✓» вместо «✓ время»
- Футер пузыря в `ChatView.xaml` переставлен: `16:00 ✓` как в tdesktop.
  Проверено живьём на проде: «10:19 ✓✓» (live-native.png после
  пересборки Debug-билда).

### Векторные иконки вложений и экспорта
- `ChatAttachmentItemViewModel`/`ChatMediaItemViewModel`: добавлено
  `IconData` (Geometry) — image→Photo, video→Video, audio→Music,
  sticker→Emoji, фолбэк→Document; строковые `Icon` сохранены для
  совместимости (на них завязаны тесты).
- `VectorIcons.Music` добавлен; чип файла в пузыре и плитка галереи
  переведены на `VectorIcon` — эмодзи-глифов в поверхностях вложений
  не осталось.
- «Экспорт истории»: 📤 → `VectorIcons.Exit`.

### Виртуализация ленты — регрессионный тест
- STA-тест в `NativeChatViewModelTests`: 500 сообщений в реальном окне
  800×600 → реализовано ≤60 контейнеров (`MessagesList`,
  `VirtualizationMode=Recycling`). Проходит.

### Харнес кадров
- `04v-chat-gallery`: медиагалерея карточки (фото-превью, видео-плитка
  с иконкой камеры + размер/длительность).
- `04w-chat-files`: лента доскроллена к чипам вложений через
  обобщённый `FindNamedListScrollViewer`; чипы с векторной иконкой
  документа видны в обеих темах.
- `DemoApi()`: добавлена страница `ConversationAttachments` для
  галереи (фейк режет по kind-вкладкам).

### Проверки
- Сборка Debug/Release 0/0; чат-фильтр **217/217**; полный прогон
  **2038/2038**; генератор кадров 1/1.
- Живьём (hubit.zsgp.ru): список с реальными диалогами, шапка группы
  «12 участников · 5 в сети», presence-чип, дата-пилюля, системное
  сообщение, свой пузырь «10:19 ✓✓», композер на обоях — всё по
  эталону. Бэкенд флапает, окно проверки ограничено его доступностью.
- Остаток эмодзи-иконок — только вне чата (MailView/настройки/прочие
  модули — отдельный объём работ).

### Обрезка длинных имён — троеточие вместо клипа (live-дефект)
- `TextTrimming="CharacterEllipsis"` не работает внутри горизонтального
  `StackPanel` (меряет детей бесконечной шириной) — имя «Николаев Михаил
  Серге» клипалось вплотную к «✓✓ 16:19» без «…» на живых данных.
- Строка диалога: `StackPanel` → `DockPanel`, колокол мьюта у правого
  края колонки имени; троеточие подтверждено живьём («Николаев Михаил
  Се…», «Фазлыев Линар Флюров…»).
- Тот же латентный дефект: заголовок шапки (+эмодзи-статус), имя/логин
  профиля в меню, имя участника с бейджем роли — добавлен `MaxWidth`
  (конечная мера включает троеточие, значок по-прежнему обнимает текст),
  по образцу уже корректного файлового чипа (`MaxWidth="220"`).

### Кликабельные ссылки в теле сообщения (tdesktop-паритет)
- Раньше URL в пузыре был плоским текстом (карточка превью уже была).
- Новый `LinkifiedTextBlock` (Native/Views): `LinkText` → Inlines
  `Run`+`Hyperlink` по тому же `ChatUrlRegex` (private→internal, единый
  источник с карточкой превью); `LinkCommand` выполняется с url; цвет —
  `SetResourceReference(LinkResourceKey)` (дефолт `HubChatLinkBrush`,
  сам следит за сменой темы), без подчёркивания.
- `ChatMessageViewModel`: `BodyLinkHandler` + `OpenBodyLinkCommand`;
  `ChatViewModel` проводит `OpenExternalLinkAsync` — общий http(s)-guard
  и открытие во внешнем браузере с карточкой превью.
- `HubChatOutLinkBrush`: dark #9CCDF2 / light #1B6AB0 — обычный link-синий
  на исходящем пузыре терялся (контраст ~1.7:1 dark).
- Тесты `LinkifiedTextBlockTests` (3): разбиение на Run/Hyperlink, клик →
  команда с url, текст без ссылок = один Run. Проверено живьём: ссылка
  в исходящем пузыре светло-синяя (`live-link-crop.png`).

### Узкая шапка — троеточие имени собеседника (live 1024×600)
- Заголовок «Вахмянина Вероника Сергеевна» клипался без «…» при
  сжатой колонке ленты: текст в горизонтальном StackPanel мерялся
  бесконечной шириной. Контейнер → `DockPanel HorizontalAlignment="Left"`:
  по контенту эмодзи-статус обнимает имя, при дефиците текст
  троеточится. Проверено живьём: «Вахмянина Вероника Сергее…».

### Живая проверка на проде (hubit.zsgp.ru, Debug-билд)
- Список: закрепы/мьюты/бейджи/троеточия имён — корректно.
- DM «Вахмянина…»: входящие слева, свои «10:53 ✓», линк-превью,
  кликабельная ссылка светло-синей (`HubChatOutLinkBrush`).
- «Заметки»: фото-вложение плиткой-превью как в tg, «Загрузить ранее»
  вызывает `LoadOlderAsync` (пустая страница от бэкенда — флаг
  has_older серверный, UI корректен).
- Композер: 🎤→➤ при тексте, акцентный фокус. Гамбургер-меню,
  поиск по диалогу, карточка собеседника с векторной иконкой
  экспорта — работают.
- Ограничение сессии: SendKeys/mouse_event к приложению не доходят
  (access denied) — контекстные меню и Esc проверены фикстурами/тестами.
- Сборка Debug/Release 0/0; чат-фильтр 218/218; полный прогон 2041/2041.

### Иконки хрома — полный уход с эмодзи/MDL2 на вектор (все native view)
- `VectorIcons` пополнен: `ChevronDown` (+ ранее `ArrowUp/Down`, `Upload`,
  `DoneAll`, `SwapHoriz` и др.). `HubChevronDownStyle` перенацелен с
  TextBlock+Segoe MDL2 на `local:VectorIcon` — шеврон ComboBox теперь
  векторный, триггеры `RenderTransform`/`Opacity` сохранены.
- `HubTheme`: MenuItem-шаблон — check-глиф `✓` и стрелка подменю
  `&#xE76C;` → `VectorIcon.Check`/`ChevronRight`; кнопка календаря в
  поле даты `&#xE787;` → `Calendar`; prev/next `&#xE76B/C;` →
  `ChevronLeft/Right`.
- `HubWindow`: гамбургер `&#xE700;` → `VectorIcons.Menu`.
- `ChatView`: галочки доставки `✓`/`✓✓` в футере пузыря и строке
  диалога → `VectorIcon` через `EmojiToVector` (✓→Check, ✓✓→DoneAll) —
  VM и триггер контекст-меню на строку «✓✓» не тронуты; кнопки
  `＋`/`✎`/`✕` → `NavGlyph.Icon` (Plus/Edit/Close).
- Все view: `＋`-кнопки (Новая задача, Поручение, Новая заявка,
  объект/сотрудник/операция, Общая папка, Подзадача, реакции «+») →
  `NavGlyph.Icon=Plus`; `⇪ Загрузить акт` → `Upload`; `↑`/`↓` →
  `ArrowUp/ArrowDown`.
- Остатки по скану: только контентные эмодзи (реакции, пикер, ★-почта
  другого автора) и текстовые `→`/`●` — осознанно оставлены.
- Сборка 0/0, полный прогон 2041/2041, кадры-фикстуры перегенерированы —
  тёмная/светлая темы и свёрнутая рейка чистые.

### Цикл 04: UI-014, UI-004, UI-017, UI-019, UI-005, UI-021/UI-009/UI-016
- **UI-014** (`ChatViewModel`): централизованный `RaiseCommandStates()`
  уведомляет `SendCommand`, `AttachCommand`, `AttachDroppedFilesCommand`,
  `LoadOlderCommand`, `LoadMoreConversationsCommand`, `RetryHistoryCommand`,
  `OpenScheduleEditorCommand`, `ConfirmScheduleCommand`; вызывается из
  `IsSending`/`IsUploading`/выбора диалога — скрепка и эмодзи оживают
  сразу после выбора чата. Регрессионный тест в `NativeChatViewModelTests`.
- **UI-004** (`ChatView.xaml.cs`, `ChatView_PreviewKeyDown`): Esc теперь
  по z-порядку — подтверждение удаления → панель пересылки →
  медиавьювер (←/→ листают) → диалог жалобы → панель жалоб →
  заявки на вступление → настройки группы → поиск. Первый Esc закрывает
  только верхний слой: заявки поверх настроек закрываются заявками,
  настройки и черновик остаются. Клик по бэкдропу — только по самому фону.
- **UI-017** (строка диалога): `ConversationItemViewModel` получил
  `LastMessageId` и `LastMessageStatusText`. По списку диалогов
  read-статус не приходит — честное «✓» (отправлено), а не ложное «✓✓».
  Синк: начальная страница истории, `messages/hydrate`, realtime
  `chat.message.read` и `UpdateLastMessage` (DTO несёт
  `delivery_status`/`read_by_count`). XAML: `VectorIcon` по
  `EmojiToVector` + `NonEmptyStringToVisibility`. Тест
  `ConversationRowTickTracksConfirmedReadNotJustOwn`.
- **UI-019** (заявки): инлайн-стиль CheckBox наследует
  `HubCheckBoxStyle` — подпись на `HubTextBrush`, disabled →
  `HubTextSecondaryBrush` + блеклый бокс; имя заявителя — `HubTextBrush`.
  Кадр 1024×600: подпись и имя читаемы в тёмной теме.
- **UI-005** (шапка): `HubGhostButtonStyle`, `HubPrimaryButtonStyle`,
  `HubSecondaryButtonStyle` — горизонтальный `StackPanel` → `DockPanel`
  с `HorizontalAlignment` презентера по `HorizontalContentAlignment`:
  содержимое кнопок получает конечную меру, `TextTrimming` работает.
  Плюс `TextTrimming` у `KindText` подзаголовка шапки — на 1024×600
  «Группа · 12 участников · 4 в…» с многоточием.
- **UI-021** (геометрия к эталону v7.4.5): шапка `Padding 18,10` →
  `18,3.5` (67→54 DIP); аватар строки 50→46 (radius 25→23), отступ
  волосной линии 60→56; строка `Padding 10,7` → `10,8` (64→62 DIP);
  скрепка `ChatMenuRootUpStyle` MinWidth/Height → 44×46 DIP.
  Осознанное исключение: строка группы с третьей строкой `KindText`
  выше 62 DIP — расширение HUB, эталон такой строки не имеет.
- **UI-009** (шапка): `ChatGhostButtonStyle` — `Background=Transparent`
  в покое (заголовок, лупа, эмодзи, ✕-кнопки читаются как единая
  панель; hover/pressed дают фон через триггеры шаблона). Добавлена
  явная кнопка «Информация о собеседнике» (`VectorIcons.Info`,
  `TogglePeerCardCommand`) между поиском и ⋮ — видимый и фокусируемый
  вход в карточку, дублирует клик по заголовку.
- **UI-016** (композер): квадрат эмодзи-кнопки снят той же правкой
  `ChatGhostButtonStyle` — скрепка, поле-капсула, эмодзи и отправка
  выровнены по нижней оси единым рядом.
- Попутно: `MailView.xaml.cs` — восстановлен импорт `Grid`
  (сборка падала на промежуточном состоянии файла другого автора).
- Сборка 0/0; чат-прогон 220/220 (+1 тест UI-017); `NativeScreenshots`
  перегенерированы — тёмная/светлая темы, 1024×600 и заявки чистые.

## Цикл 06 — геометрия ленты (UI-022 → UI-023 → UI-024)

- **UI-022** (короткая история у низа): `ItemsPanelTemplate` ленты —
  `VirtualizingStackPanel VerticalAlignment="Bottom"`. Контракт
  `ScrollContentPresenter` даёт контенту слот `Max(extent, viewport)`
  (проверено по исходнику .NET) — при короткой истории панель занимает
  низ слота, воздух остаётся сверху, рядом с композером. Промежуточный
  вариант с `Grid MinHeight=ViewportHeight` + `ItemsPresenter Bottom`
  отклонён: обёртка рвёт цепочку `IScrollInfo` → теряется виртуализация
  (тест 500 сообщений реализовал все контейнеры). Кадры:
  `04x-chat-short.png` (новый фикстурный кадр, 3 сообщения «Да.»/
  «Хорошо.»/«Тогда созвонимся…» — история у нижнего края в обеих темах),
  длинная история, разделитель непрочитанных и скролл к концу — без
  изменений (регрессия `LongHistoryRealizesOnlyVisibleMessageItems` ✓).
- **UI-023** (метаданные инлайн): `LinkifiedTextBlock` получил
  `TrailingContent` (`InlineUIContainer`, baseline вниз) — время/«изм.»/
  галочки доставки встают в конец последней строки текста, как в
  Telegram; не помещаются — сами переносятся ниже. Дублирующая нижняя
  строка метаданных скрыта при `MetaInlineInText` (тело есть, нет
  вложений/action-карточки) — для фото/файлов время остаётся отдельной
  строкой. Уведомления `MetaInlineInText` — на всех мутациях тела/
  вложений/удаления/правки. Найден и починен край-случай: повторный
  `Rebuild` создавал новый `InlineUIContainer` на том же элементе
  («already a logical child») — контейнер теперь кэширован полем.
  На кадре: «Да. 22:23», «Хорошо. 22:24 ✓» — мета в конце строки.
- **UI-024** (форма серии): матрица `CornerRadius` по
  `IsGroupStart`/`IsGroupEnd`/`IsOwn` — смежные углы соседних пузырей
  одного автора малы (4), крайние скруглены (16); хвостик `BubbleTail`
  (Path-кривая 22×12, зеркальная для своих, заливка = цвет пузыря)
  показывается только у `IsGroupEnd` со стороны отправителя —
  telegram-очертание серии. Компактный интервал 2px внутри серии,
  10px между сериями — прежний.
- Фикстура `NativeScreenshots`: новый кадр `04x-chat-short` —
  подмена `api.ChatMessages` на 3 коротких сообщения с восстановлением
  полной страницы (покрывает UI-022/023/024 одним кадром, обе темы).
- Сборка 0/0; полный прогон **2073/2073**; `NativeScreenshots` 1/1 —
  кадры перегенерированы и просмотрены (dark+light).

## Цикл 06 — UI-027: подтверждение вложений перед отправкой (tg-send-files)

- **Двухфазный пайплайн**: `AttachFilesAsync` больше не грузит — ставит
  файлы в очередь `PendingAttachments` (валидация существования/доступа —
  прежняя, баннер как раньше). POST upload-session стартует только из
  `ConfirmAttachmentsCommand`; «Отмена»/`CancelAttachmentsCommand`
  очищает очередь без единого сетевого вызова.
- **Очередь**: повторный выбор в том же диалоге дополняет список, в
  другом — заменяет. Смена диалога и `ResetSession` сбрасывают очередь
  и подпись. `RemovePendingAttachmentCommand` убирает строку; последняя
  закрывает модал.
- **Подпись**: `AttachmentCaption` — отдельное поле модала; уходит в
  `body` сессии, черновик `ComposerText` не расходуется и не очищается.
  Reply-контекст (`ReplyingTo.Id`) и `client_message_id` — в сессии,
  как раньше.
- **Модал** (ZIndex 4, над delete-confirm): «Отправить N файл(а/ов)» +
  «Получатель: …», строки 44px — мини-превью картинки либо векторная
  иконка вида (Photo/Video/Music/Document), имя с троеточием, размер,
  крест удаления; `KeyboardNavigation.TabNavigation=Cycle`; Esc и клик
  по затемнению = «Отмена»; `AutomationProperties.Name` на всех кнопках.
- **Меню скрепки**: «Фото или видео» → `CommandParameter="media"`
  (фильтр `*.png/jpg/…/mp4/…`), «Документ» → `"document"`. Драг на ленту
  и вставка в композер идут через тот же `AttachDroppedFilesCommand` →
  общая очередь.
- **`PendingAttachmentItemViewModel`**: превью через `BitmapImage`
  `StreamSource`+`using` — поток закрывается детерминированно даже при
  ошибке декода (UriSource при падении держал файл до GC — ломал
  `File.Delete` в тестах).
- **Тесты** (+5): стейдж без сети и дополнение очереди, отмена без
  сети, удаление последнего элемента закрывает модал, очистка при смене
  диалога; существующие upload-тесты переведены на подтверждение через
  `ConfirmAttachmentsCommand` (чанки, complete, reply, banner,
  client_message_id — прежние).
- **Кадры**: `04y-chat-attach` + `04y2-chat-attach-1024` (тёмная+светлая):
  заголовок/получатель, превью фото, иконка документа, подпись,
  «Отмена»/«Отправить».
- Сборка 0/0; полный прогон **2077/2077**; `NativeScreenshots` 1/1.

## Цикл 07 — UI-026: единый просмотрщик медиа (фото/видео/аудио + fallback)

- **Единая модель**: `_mediaViewerItems` — `MediaViewerEntry(MessageId,
  Model, DisplayName, Kind)`, `Kind ∈ {Image, Video, Audio, Unsupported}`.
  Резолвер `ResolveMediaViewerKind`: kind/mime/расширение → Image;
  video/audio — только если контейнер в белом списке `MediaElement`
  (`.mp4/.wmv/.avi/…`, `.mp3/.wav/.m4a/…`), иначе `Unsupported` →
  понятный fallback, а не молчаливый внешний запуск.
- **Источники**: чип вложения в ленте собирает список из всех
  просматриваемых вложений ленты (порядок сообщений); плитка галереи —
  из загруженных плиток вкладки. Упор в конец галерейного списка при
  `HasMore` дотягивает следующую страницу и продолжает листание
  (курсоры `_mediaStreams` — прежние).
- **Воспроизведение**: видео — `MediaElement` с ручным транспортом;
  аудио — карточка с названием/длительностью + тот же транспорт
  (play/pause, слайдер позиции, `m:ss / m:ss`, Space = play/pause).
  Файл целиком в temp — стриминга в контракте нет. `MediaFailed` →
  `MarkMediaViewerPlaybackFailed` → fallback без закрытия вьювера.
  Закрытие/листание обнуляет `MediaViewerMediaSource` — звук не течёт.
- **Скачивание**: `DownloadAttachmentToTempAsync` с дедупом
  `_attachmentDownloadsInFlight` — просмотрщик и «Сохранить» делят одну
  задачу; файл-кэш по размеру пропускает повторную сеть. «Открыть в
  другом приложении» — только по явной кнопке (Process.Start в
  `DownloadAndOpenAttachmentAsync`, в тестах `AttachmentSaver`-заглушка).
- **Шапка**: имя, `N из M`, `MediaViewerStatusText` («Сохранено: …»),
  кнопки Save/Open-external/Close; стрелки ←→, `Esc` = закрыть,
  `AutomationProperties.Name` везде.
- **Тесты** (+10): video/audio классификация и temp-источник без
  внешнего запуска, `.mkv`/`.ogg` fallback без сети, ошибка скачивания →
  fallback+баннер, навигация/счётчик, закрытие обнуляет источник,
  «Сохранить» без повторной сети, дедуп параллельных скачиваний
  (`DownloadGate` в FakeHubApiClient), галерея → тот же вьювер +
  догрузка страницы при листании. `MediaTileOpen…ThroughSaver`
  переведён на file-плитку (просматриваемые kind'ы теперь идут во
  вьювер — задокументированная смена контракта).
- **Кадр**: `04x-chat-media-fallback` — fallback-карточка .ogg:
  имя, причина, «Открыть в другом приложении» (галерея «Аудио» за ней).
- Попутно: `MailToolbarGrid_SizeChanged` для переноса поиска на вторую
  строку (XAML ожидал хендлер — файл в промежуточном состоянии, сборка
  падала); `Assert.Single` в `NativeMailViewModelTests` (xUnit2013).

## Цикл 08 — UI-028: запись/прослушивание/отправка голосовых

- **Шов записи**: `INativeVoiceRecorder` (`Native/Voice/`) — Start/Stop/
  Abort/Elapsed; `NativeVoiceStartException` с `NoDevice`/`PermissionDenied`/
  `Unavailable` → человекочитаемый баннер. Прод — `MediaCaptureVoiceRecorder`
  на `Windows.Media.Capture`: AAC в `.m4a` (CreateM4a) — тот же контейнер,
  что `audio/mp4` у web, играется встроенным `MediaElement`. Запись в память,
  на Stop — в `%TEMP%/hub-desktop/voice`; файл удаляется после отправки/отмены.
- **Контракт**: `HubChatUploadFileRequest.DurationSeconds` →
  `"duration_seconds"` манифеста файла — принимается
  `chat_upload_orchestrator._build_upload_session_file_manifest` (проверено
  по `useVoiceRecorder.js`/`useChatFileSending.js`: `media_kind=audio`,
  `duration_seconds`, `mime_type`). Отправка — общим
  `UploadFilesToConversationAsync` (session → чанки → complete → сообщение
  в ленту), выделенным из `ConfirmAttachmentsAsync`.
- **VM**: `IsVoiceRecording`/`HasVoiceDraft`/`VoiceBarVisible`,
  `VoiceElapsedText` («Запись m:ss»/«Голосовое m:ss»), `VoicePreviewSource`,
  `IsVoicePreviewPlaying` (+`NotifyVoicePreviewEnded`), `ShowMicFab`/
  `ShowSendFab`, фабрика `VoiceRecorderFactory` (тесты — фейк). Команды:
  Start/Stop/Cancel/Send/TogglePreview. Запись только по явной команде;
  отмена и смена диалога — `CancelVoiceSession` без сети; `_voiceConversation`
  фиксирует целевой диалог. `Esc` в `ChatView_PreviewKeyDown` нижним слоем →
  отмена.
- **XAML**: 🎤-FAB при пустом композере (`ShowMicFab`), ➤/✓ при тексте
  (`ShowSendFab`); панель вместо поля — красная точка + таймер при записи,
  ▶/⏸ + длительность у черновика; корзина на месте скрепки, ✓ «Завершить»
  и ➤ «Отправить голосовое» на месте FAB. Скрытый `VoicePreviewPlayer`
  (0×0 `MediaElement`) — превью без внешних приложений.
  `AutomationProperties.Name` на всех кнопках.
- **Тесты** (+11): микрофон только при пустом композере, стоп → черновик
  без сети, отмена записи/черновика без сети и с удалением temp-файла,
  смена диалога обрывает запись/черновик, отправка → `media_kind=audio` +
  `duration_seconds=7` + чанки + complete, ошибка загрузки сохраняет
  черновик для повтора, `NoDevice`/`PermissionDenied`/`Unavailable` →
  баннеры. `FakeNativeVoiceRecorder` в Fakes.
- **Кадры**: `04z-chat-voice-rec` (точка + «Запись 0:03» + корзина + ✓),
  `04z-chat-voice-draft` (▶ + «Голосовое 0:07» + ➤) — тёмная+светлая.
- **Реальный микрофон**: на тест-машине нет аудиовходов (класс PnP
  `AudioEndpoint` пуст — серверная VM); живой прогон упрётся в ветку
  `NoDevice` → баннер «Микрофон не найден» — покрыто тестом. Полная
  проверка на железе остаётся за приёмкой.
- Сборка 0/0; полный прогон **2105/2105**; `NativeScreenshots` 1/1.

---

## WEB-01 — Базовая компоновка веб/WPF (список / переписка / контекст)

**Статус:** к приёмке
**Дата:** 2026-11-22

### Стенд и фикстура (одинаковая для обоих клиентов)
- Локальный e2e-бэкенд `http://127.0.0.1:18001` (SQLite, `CHAT_MODULE_ENABLED=1`,
  пользователь `e2e_admin`, роль admin). Диалог: direct «E2E Пользователь»
  (10 сообщений, реплай, превью ссылки); рядом заметки, группа «IT-отдел»,
  длинная группа, «Regular User» — `ui-review/stand/seed_chat.py`.
- Веб: Playwright (Chrome) → vite `http://127.0.0.1:5174`, viewport 1280×720
  и 1024×600, `colorScheme` dark/light — `ui-review/stand/web_driver.mjs`,
  `web01_capture.mjs`.
- WPF: новый живой стенд `desktop/Hub.Desktop.Tests/WebParityStand.cs` —
  настоящее `HubWindow` + реальный `HubApiClient` (mobile-логин bearer-парой)
  на том же бэкенде; окно управляется JSON-командами из каталога
  (`ui-review/stand/wpf-cmd`): resize/theme/select/invoke/measure/shot/nav.
  Клиент — `ui-review/stand/stand_cmd.ps1`, прогон — `wpf01_capture.ps1`.
  Кадры — `RenderTargetBitmap` ровно по клиентскому размеру окна, 96 DPI.

### Что отличалось (замер до правки, тёмная 1280×720)
- Сайдбар чата: веб **419px** → WPF **380px** (рейка папок 58 + список 322).
- Панель «Информация»: веб оверлей **380px** → WPF **330px**.
- Лента: веб 860px от вьюпорта → WPF 677px от окна (см. системную рамку ниже).

### Что сделано
- Дефолт сайдбара выровнен под веб: `380 → 420` (`ChatView.xaml`, колонка
  `ChatAreaGrid`). Пределы сплиттера не трогал (веб 260–520, WPF 280–560 —
  пользовательская подстройка перекрывает разницу дефолта).
- Панель «Информация»: `330 → 380` (`ChatView.xaml` + `InfoPanelWidth` в
  `ChatView.xaml.cs`) — теперь равна веб-оверлею (веб: 320–400, дефолт 380).
- Панель получила `x:Name="PeerInfoPanel"` — нужна для измерения; на
  поведение не влияет.
- Обновлён комментарий формулы оверлея в `ChatView.xaml.cs`.

### Замеры после правки
| Метрика | Веб 1280 | WPF 1280 | Веб 1024 | WPF 1024 |
|---|---|---|---|---|
| Сайдбар | 419 | **420** | 419 | **420** |
| Лента | 860 | 637 | 604 | 381 |
| Шапка | 55 | 54 | 55 | 54 |
| Композер | 58 (dock) | 46 (поле) | 58 | 46 |
| Панель | оверлей 380 | **оверлей 380** | оверлей 380 | **оверлей 380** |

Оба клиента на 1280 и 1024 показывают панель **оверлеем** поверх ленты
(веб — ниже 1440 breakpoint'а; WPF — пока feed < 360 DIP). Компоновка
«список слева / переписка / контекст справа» совпадает во всех 8 кадрах.

### Системная рамка (оставленное отличие)
- Веб `/chat` занимает весь вьюпорт; WPF-чат живёт внутри окна HUB Desktop:
  титлбар (~41px) + портальная навигация 216px → область чата 1062px
  (1280) / 806px (1024). Навигация сворачивается в рейку 56px
  (гамбургер) — кадр `wpf-after-dark-1280x720-nav-collapsed.*`.
- Веб-рейка папок горизонтальная (чипы в сайдбаре); WPF — вертикальная
  полоса 58px внутри сайдбара (действующий дизайн tdesktop-стиля,
  существующий контракт папок). Переделка структуры не входит в WEB-01.
- Веб-композер мерится по dock (58px) с капсулой 44px; WPF — по полю ввода
  46px с тем же рядом действий. Визуально эквивалентная строка.

### Проверки
- `dotnet test Hub.Desktop.Tests -c Release --filter "FullyQualifiedName~NativeChat|FullyQualifiedName~ChatView"`
  → **233/233** (также пройден `WebParityStand` — живой прогон окна на API).
- Кадры `ui-review/screenshots/after/web-parity/WEB-01/`:
  `web-{dark,light}-{1280x720,1024x600}-panel-{closed,open}.{png,json}` (8 пар),
  `wpf-after-*` те же 8 пар + `wpf-after-dark-1280x720-nav-collapsed.*`,
  `wpf-before-dark-1280x720-panel-{closed,open}.{png,json}` (до 420/380).

### Непроверенное
- Перетаскивание сплиттера сайдбара и его пределы — отдельная задача WEB-02.
- Физический ввод/мышь не эмулировались; размеры сняты с live-окна через
  RenderTargetBitmap на реальных API-данных.

---

## WEB-03 — Правая панель: боковой режим ↔ оверлей

**Статус:** проверено без изменений
**Дата:** 2026-11-22

### Стенд
Тот же, что в WEB-01: локальный бэкенд 18001, веб Playwright
(`ui-review/stand/web03_capture.mjs`), живой WPF `WebParityStand` на
реальном API-клиенте, диалог «E2E Пользователь» (10 сообщений).
Переход проверялся на одном живом окне последовательными resize
1440×800 → 1280×720 → 1024×600 → 1440×800 с замером после каждого шага.

### Эталон (веб, замеры `web_driver.mjs`)
| Вьюпорт | Лента | Правая панель |
|---|---|---|
| 1440×800 | 640 | **боковая колонка 380** (persistent) |
| 1280×720 | 860 | **оверлей 380** |
| 1024×600 | 604 | **оверлей 380** |

### WPF (замеры `PeerInfoPanel`/`ChatDropArea`/`SidebarHost`)
| Окно | Сайдбар | Лента | Панель «Информация» | Режим |
|---|---|---|---|---|
| 1440×800 | 420 | 417 (x 642–1059) | x=1059, **380** | боковая колонка |
| 1280×720 | 420 | 637 (x 642–1279) | x=899, **380** поверх | оверлей |
| 1024×600 | 420 | 381 (x 642–1023) | x=643, **380** поверх | оверлей ≈ вся лента |

Переход двусторонний: после сужения до 1024 и возврата в 1440 панель
снова стала боковой колонкой — переключение живое, без перезапуска.

### Проверка критериев
- При сужении переписка либо читаема, либо закрыта панелью — как в вебе:
  1280 — панель-оверлей 380 поверх правой части ленты (остаётся ~257px
  ленты; в вебе остаётся ~480px из-за отсутствия портальной навигации —
  см. WEB-01, системная рамка); 1024 — панель закрывает ленту почти
  целиком (просвет ~1px). Тонкой обрезанной полосы ленты нет.
- Композер не превращается в обрезанную полоску: в оверлее панель
  перекрывает правую часть композера, левая часть с полем ввода остаётся
  видимой и доступной — кадр `wpf-dark-1280x720-panel-open.png`;
  в вебе поведение то же (оверлей плавает поверх композера).
  Панель непрозрачная (`HubSurface*`), клика насквозь визуально нет.
- После закрытия чат не перезагружается: `ClosePeerCardCommand` →
  `Chat.Messages.Count` остался 10, `SelectedConversation.Title`
  не изменился («E2E Пользователь»), `IsPeerCardOpen=false`.
- Тёмная матрица (1440/1280/1024) + светлый кадр оверлея
  `wpf-light-1280x720-panel-open.png` — поведение не зависит от темы.

### Кадры `ui-review/screenshots/after/web-parity/WEB-03/`
- Веб: `web-dark-{1440x800,1280x720,1024x600}-panel-open.{png,json}`.
- WPF: `wpf-dark-1440x800-panel-open.*` (колонка),
  `wpf-dark-1280x720-panel-open.*` (оверлей),
  `wpf-dark-1024x600-panel-open.*` (оверлей),
  `wpf-light-1280x720-panel-open.png`.

### Что не менялось и почему
- Логика перехода уже реализована после WEB-01:
  `ChatView.xaml.cs` → `InfoPanelWidth=380`, `MinReadableFeedWidth=360`,
  `IsCompactInfoOverlay = feedWouldBe < 360`. Подтвержденный разрыв
  не найден — задача «Приёмка», код не тронут.
- Порог срабатывания отличается от веба по форме (веб — breakpoint
  вьюпорта ~1440; WPF — читаемость ленты от ширины области чата с учётом
  портальной навигации), результат на общих размерах совпадает:
  оба дают колонку на 1440 и оверлей на 1280/1024.

### Непроверенное
- Физический клик «насквозь» оверлея не инжектировался (нет ввода в харнесе);
  вывод о непрозрачности — по непрозрачному фону панели и замерам z-порядка.

---

## WEB-07 — Композер и его режимы (узкое окно)

**Статус:** проверено без изменений
**Дата:** 2026-11-22

### Стенд
Тот же: бэкенд 18001, диалог «E2E Пользователь», окно 1024×600, тёмная
тема. Веб — `ui-review/stand/web07_capture.mjs` + `web07_retry.mjs`
(фейк-микрофон Chromium `--use-fake-device-for-media-stream`).
WPF — `WebParityStand` + новые команды:
`msg_cmd` (команда над элементом ленты — reply/edit по индексу/признаку
own/id), `AttachDroppedFilesCommand` с путём (та же очередь подтверждения,
что у скрепки), `VoiceRecorderFactory = FakeNativeVoiceRecorder` в харнесе
(на VM нет аудиовхода — зафиксированный блокер из UI-028).
Окно 1024×600 = условие «узкое» из критерия.

### Матрица состояний (веб ↔ WPF, кадры WEB-07/)
| Режим | Веб | WPF |
|---|---|---|
| Пустой | dock 58px, capsule 44, textarea 19 | «Сообщение…» + скрепка/эмодзи/мик |
| Длинный черновик | dock 58→266px, textarea→227 | композер растёт (~8 строк + скролл), «Черновик:» в списке |
| Ответ | плашка цитаты + ✕, плейсхолдер «Ваш ответ…», хинт Enter/Esc | плашка «Ответ / Вы: …» + ✕ |
| Редактирование | плашка «Редактирование» + текст + ✓ | плашка «Изменение сообщения» + текст + ✓ |
| Запись голоса | полоса: корзина, точка, волна, таймер, отправить | полоса: корзина, точка, «Запись 0:03», ✓ |
| Прослушать черновик | (та же полоса после стопа) | корзина + ▶ + «Голосовое 0:03» + отправить |
| Файл | «Отправить изображение»: превью, правка, подпись, «как файл», Добавить/Отмена/Отправить | «Отправить файл»: получатель, превью, ✕ удаления, подпись, Отмена/Отправить |

Во всех состояниях основные кнопки остаются доступными, признак режима
виден: плашка reply/edit с ✕, полоса записи/черновика голоса,
модал вложений, стрелка отправки/галочка сохранения.

### Кадры `ui-review/screenshots/after/web-parity/WEB-07/`
Веб: `web-dark-1024x600-composer-{empty,longdraft,reply,edit,voice,files}.*`.
WPF: `wpf-dark-1024x600-composer-{empty,longdraft,reply,edit,voice,voicedraft,files}.png`.

### Зафиксированные косметические отличия (не разрывы критерия)
- В вебе при ответе плейсхолдер меняется на «Ваш ответ…» и появляется
  хинт «Enter — отправить · Esc — отменить ответ»; в WPF остаётся
  «Сообщение…», режим индицируется только плашкой. Функционально эквивалентно.
- Веб-модал имеет «Отправить как файл» и «Добавить» — это область WEB-22
  (медиа vs документ), здесь не оценивается.

### Исправлено в стенде (тест-код, не прод)
- `WebParityStand`: оп `msg_cmd`, инъекция `VoiceRecorderFactory`,
  двойное `NativeThemeManager.Apply(theme)` после повторной инициализации
  `Window_Loaded` и ассерт темы перед `shot`/`measure`. Найдена и
  задокументирована причина «светлых» кадров: `Window_Loaded` → повторный
  `InitializeAsync` → `ApplySettings(theme_mode из /settings/me)` уже
  после стартового Apply.
- Сборка Release 0/0; профиль `NativeChat|ChatView` → **233/233**.

### Непроверенное
- Запись голоса в WPF прогнана через `FakeNativeVoiceRecorder`
  (RecordingDuration=3с): реальный захват микрофона на VM без аудиовхода
  невозможен — блокер зафиксирован (как в UI-028).
- Фокус/клавиатура композера — отдельная задача WEB-08.
