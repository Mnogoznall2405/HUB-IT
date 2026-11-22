# Сводка агента C (performance) — восстановлена из журнала сессии

Оригинал `evidence/agent-C-perf-report.md` утерян при инциденте. Восстановлено из
ответа субагента; позиции включены в ISSUES.md.

## Находки

### Высокая
- **EquipmentTab.jsx:351–433 + Networks.jsx:871** — мобильная вкладка «Оборудование»
  рендерит все порты (лимит 10 000) карточками без виртуализации; desktop
  виртуализируется. → FE-0023

### Средние
- SocketsTab.jsx:220–229 — то же для розеток на мобильном.
- InteractiveMapCanvas.jsx:530–544, 55–105 — setDraggedPoint на каждый pointermove без
  троттлинга → пересчёт кластеризации всех точек + полный ре-рендер карты.
- Networks.jsx:2055–2074 — глобальный keydown-листенер снимается/ставится на каждый
  рендер (deps: незамемоизированные cancelEditPort/savePortEdit + displayedPorts).
- Networks.jsx:138–311 — ~80 useState в одном компоненте (3300 строк): любой ввод
  перерисовывает всю страницу с картой.
- MyFiles.jsx:1332–1337 — bulk download качает все выбранные файлы параллельно,
  без очереди/лимита.
- Warehouse1C.jsx:903/923, 1922/1970, 2121/2162 — списки 200–1000 строк
  (остатки/движения/уволенные) без виртуализации и memo.

### Низкие
- Login.jsx:3, PasswordUnlockDialog.jsx:2 — пакет qrcode статически в чанке
  Login/Passwords (нужен только для TOTP-QR).
- SharedFile.jsx:576–579 — ежесекундный setNowMs безусловно (нужен только для отсчёта
  срока ссылки).
- Statistics.jsx:290–296 — переключение вкладки/периода = повторный fetch без swrCache.
- FeedCommentsPanel.jsx:130–138 — опрос 15 с: K+1 запрос при K раскрытых ветках комментариев.
- framer-motion (dist-чанк 40 КБ gz) в /chat и /mail; Monitoring.jsx:20 — recharts 89 КБ gz
  грузится на /monitoring до выбора устройства.
- Excalidraw-канвас ≈1,25 МБ gzip при первом открытии (lazy — нарушений нет).

## Что работает хорошо (проверено агентом C)
- Все 38 маршрутов lazy + guard-скрипт check-startup-bundle.mjs; startup ≈223 КБ gz,
  без тяжёлых либ в старте.
- xlsx/pdfjs/excalidraw/xyflow/elkjs/livekit/lottie/html5-qrcode/emoji-picker — dynamic import.
- swrCache с dedupe; Chat — окно рендера ≤240 сообщений; Database — своя виртуализация.
- Polling адекватный (≥3 с, visibility-gated); утечек слушателей/WebSocket не найдено
  (retain/release + heartbeat + backoff).

## Не проверено (по словам агента)
- Реальные объёмы портов/розеток/точек на production-филиалах; фактический вес qrcode
  в Login-чанке; память при многочасовой сессии (heap); влияние framer-motion/recharts
  на LCP/TBT на медленных сетях; live-замеры не выполнялись (прод-ограничение).
