# Сводка агента A (UI/UX) — восстановлена из журнала сессии

Оригинальный отчёт `evidence/agent-A-uiux-report.md` утерян при инциденте (удаление
файлов ~23:00 2026-11-22). Ниже — восстановленная сводка из ответа субагента; все
позиции включены в ISSUES.md с указанием файлов/строк, названных субагентом.

## 28 находок: 27 Confirmed, 1 Suspected

### High (2)
1. Warehouse1C.jsx:2163–2216 — TableRow клик открывает карточку, на десктопе только
   мышью; мобильный рядок (:487) имеет role/tabIndex/Enter — асимметрия. → FE-0022
2. Warehouse1C.jsx:1976–1980 — кликабельная TableCell «сопоставление 1С↔HUB» без
   role/tabIndex/onKeyDown, альтернативной кнопки нет. → FE-0022

### Medium (21)
- Networks.jsx:2132, 2214, 2704, 2712, 2748, 3006 — 6 IconButton без aria-label.
- networks/EquipmentTab.jsx:249, 313, 320, 417, 513, 568 — 6 IconButton без aria-label
  (у части только Tooltip).
- networks/SocketsTab.jsx:198, 285, 381; InteractiveMapCanvas.jsx:409/414/419 — то же.
- hub/tasks/TaskCard.jsx:322, 335, 363 — Открыть/Редактировать/Скопировать без label
  («Удалить» :352 подписан).
- mail/MailTemplatesDialog.jsx:183, 190, 196; voice-video/VoiceLogViewer.jsx:229, 234;
  SharedFolder.jsx:231, 248 (публичная страница!); networks/BranchDialogs.jsx:146;
  passwords/PasswordFiltersPanel.jsx:39 + Passwords.jsx:900; Vcs.jsx:686; Mfu.jsx:990;
  UsersTab.jsx:321 — IconButton без доступного имени.
- Networks.jsx:2243; SocketsTab.jsx:351 — кликабельные TableRow без клавиатуры.
- ChatBubble.jsx:1820–1856 — кнопка выделения: outline:none, фокус невидим.
- layout/ToastHistoryList.jsx:70–86 — role="button" с outline:none без focus-visible.
- VoiceLogViewer.jsx:242 — «Загрузка…» text.secondary на тёмном #1a1b23 — нечитаемо.
- Mfu.jsx:1297–1298 — Drawer width:{xs:360} шире экранов <360px.

### Low (5)
- Networks.jsx:302–304 — equipmentLoading/socketsLoading/mapsLoading: мёртвые состояния.
- account/admin/HubDesktopDeploySection.jsx:422 — вечно disabled кнопка «Установлена».
- App.jsx:164–166 — английское «Loading...» вместо BrandedRouteLoader.
- Двойная система стилей: Tailwind (Login+чат, vite.config) vs MUI sx + переменные --chat-*.
- Противоречие: AGENTS.md требует dark theme, theme/index.js:31 — только mode:'light'.

### Suspected (1)
- GroupsAccess.jsx:198–207 — ToggleButton flex 50% + nowrap без overflow на xs:
  возможное вылезание подписи на 320–360px (нужен live-тест).

## Что осталось непроверенным (по словам агента)
- Всё, что требует рендера: контраст на живых данных, фактические перекрытия,
  порядок табуляции в открытых диалогах.
- Гиганты паттерн-поиском, не построчно: ChatContextPanel.jsx (162K),
  VoiceMeetingDrawer.jsx (3319 строк), ScanCenterPage.jsx, MainLayout.jsx;
  Login.jsx — состояния и a11y проверены, Tailwind-вёрстка построчно нет.
- Чистые области (не приоритизировать): loading/empty/error, disabled при отправке,
  мобильные альтернативы таблиц, z-index-стеки диалогов, href="#" якоря, кликабельные Chip.
