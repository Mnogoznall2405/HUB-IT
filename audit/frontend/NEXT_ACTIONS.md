# Следующие шаги аудита

Обновлено: 2026-11-22, ~23:15.

## Незакрытые вопросы (требуют действий/решений)

1. **FE-0004 (High): механизм анонимного редиректа `/shared-folders/:invalid` → /login.**
   Воспроизвести в режиме инкогнито (владельцу): открыть
   `https://hubit.zsgp.ru/shared-folders/definitely-invalid-token-xyz` в приватном окне
   и посмотреть, появится ли экран входа. Сеть/консоль при этом снять. Это закроет
   оставшуюся часть причины.
2. **Инцидент с удалением файлов `audit/frontend/`** (~23:00): выяснить источник
   (параллельно шла несанкционированная сборка Desktop и touch
   `useMailMessageFileActions.test.js`; ответ агента E ожидается). Отчёты
   восстановлены; при повторении — сохранить копию отчётов вне репо.
3. **FE-0015: политику UA-пиннинга сессии** подтвердить по backend (AUTH_SECURITY_STACK/
   deps) — ожидаемо осознанная защита, но UX-потерю вводимых данных при смене UA стоит
   зафиксировать.
4. **FE-0056: причина 400 при удалении/перемещении черновика** — backend
   (`mail_message_actions.py:303-313` `_message_item` не находит черновик).

## Непроверенные области (по убыванию ценности)

1. Zoom 80/125/150% на ключевых страницах (dashboard, database, mail, scan-center).
2. /about (онбординг) — достигается только свежей учёткой без completed_at.
3. /dlp, /file-egress, /groups-access, /kb/manage — нужна учётка с правами admin/kb.write.
4. /my-files/edit/:fileId (ONLYOFFICE-редактор) + вкладки MyFiles (Недавние/Избранное/
   Доступно мне) — только беглый осмотр.
5. Мобильная вёрстка остальных страниц (375×812, viewport-only — без смены UA!).
6. Heap/многочасовая сессия (утечки), холодный кэш, network throttling.
7. Lighthouse (a11y/best-practices) на login/dashboard.
8. Playwright e2e точечно: `npx playwright test e2e/<file>.spec.js` с `E2E_LOCAL=1`.
9. Пограничные данные: длинные названия, спецсимволы в формах создания (мутации —
   только тестовые данные).

## Гипотезы, ожидающие подтверждения

- FE-0016 (транзиентные 401 при rapid-switch) — включить console capture с URL на 5–10 минут обычной работы.
- FE-0050/0051 (агент D) — живой прогон dev-режима/инвалидации кэша.
- PWA «Banner not shown» — проверить `serviceWorkerPush*`/AppPushBootstrap.
- Несвежий список задач после создания (назначение на дублирующую учётку?).
- Дубль bootstrap в /mail (два GET mail/bootstrap с разными параметрами — легитимно?).

## По итогам фиксов (когда начнут исправлять)

- FE-0006: регресс-тест на реальные public URL (`client.test.js` уже есть каркас).
- FE-0053/0009/0044: a11y-прогон (axe/Lighthouse) после правки.
- FE-0023: замер рендера мобильной вкладки «Оборудование» до/после виртуализации.

## Цикл 9 — обновление приоритетов (поверх списков ниже)

### Закрыто в цикле 9
- Zoom 80/150% — выполнено на dashboard/chat/scan-center/my-files (локальный стек);
  подтверждён FE-0011 на всех масштабах. Остаются: mail, database, tasks.
- /about — проверен визуально (1920/375) через e2e_fresh.
- ONLYOFFICE-редактор — статический аудит завершён (FE-0106…FE-0122); runtime с
  живым Document Server всё ещё не проверен (локальный стек без OO-контейнера).
- Дубль /mail/bootstrap — объяснён и оформлен (FE-0098).
- PWA «Banner not shown» — опровергнуто.

### Гипотезы, ожидающие рантайм-подтверждения (приоритет)
1. FE-0082: воспроизвести межвкладочную гонку — 3+ вкладки, будить одновременно
   (CDP/две машины); ожидание: family revoke → общий logout.
2. FE-0110: убить renderer DocSpace-iframe во время редактирования → закрыть.
3. FE-0111: restore версии при открытом редакторе → проверить перезапись.
4. FE-0099: клик по ссылке без target в реальном письме → куда уйдёт навигация.
5. FE-0077: e2e-прогон offline-send→reconnect на живом чате локального стека.
6. FE-0125/0131/0133/0134/0097 — точечные Suspected по коду.

### Следующие области
- Mail: прогон реальной папки/черновиков на локальном стеке (mailbox seed есть?).
- Heap/многочасовая сессия, холодный кэш, network throttling — всё ещё не тронуто.
- /dlp, /file-egress, /groups-access, /kb/manage — нужны права admin/kb.write.
- Zoom 80/150% для mail/database/tasks; 125% добить.
- ONLYOFFICE-runtime: поднять mock Document Server или проверить против dev-OO.
- FE-0136: решение владельца — обновить ожидание e2e-спеки (operator↔/admin).


## Цикл 10 — приоритеты после верификации

### Runtime-подтверждено в цикле 10
- FE-0078: resend-сообщение невидимо у отправителя до reload (e2e FAIL :202).
- FE-0083: 3 параллельных refresh → family revoke → logout всех вкладок.
- FE-0011: overflow scan-center при 80/100/150% (runtime-замер).

### Осталось проверить (глубина цикла 11)
1. ONLYOFFICE-runtime: mock/dev Document Server — FE-0110 (close-hang),
   FE-0111 (restore-while-editing), живой ?compare=.
2. Долгая сессия N вкладок: silent-refresh штурм + heap-метрики.
3. Heap/утечки: 50+ переключений страниц, JS heap timeline (CDP).
4. Медленная сеть/offline-восстановление: очереди запросов, дедуп ack.
5. Zoom 80–200% для mail/database/tasks.
6. Холодный запуск + SW update-цикл + устаревший app-shell (гипотеза FE-0004).
7. Ответы 401/403/429/500 и таймауты — матрица поведения UI.
8. FE-0124: рантайм-проба смены библиотеки MyFiles с выделением.

## Цикл 11 — завершён (322 записи). Приоритеты цикла 12

### Runtime-подтверждено
- FE-0252: /database +400px при zoom 200%.
- FE-0253: heap 85→85→143MB за 3 раунда ×8 маршрутов (Suspected).
- FE-0155: validateDOMNesting вживую на /networks.

### Осталось проверить
1. MyFiles deep (агент дважды умер на rate-limit): upload-сессии, share-
   диалоги, версии — дочитать.
2. ONLYOFFICE-runtime с живым Document Server (FE-0110/0111).
3. Heap-тренд: 10+ раундов маршрутов с принудительным GC (FE-0253).
4. Долгая сессия N вкладок: silent-refresh штурм (FE-0083 связано).
5. Матрица 401/403/429/timeout (500 проверена — деградация OK).
6. FE-0124/FE-0246-недочитанные: ChatComposer/MessageList merge-дедуп.
7. Проверка на HTTP-развёртывании: FE-0305 (crypto.randomUUID),
   FE-0211 (storage-крэши) — оба критичны именно на HTTP.

## Цикл 12 — итог перепроверки (2026-11-23)

- Проверены все 322 записи; вердикты: confirmed 290, not-a-defect 17,
  unverifiable 10, wrong-evidence 4, fixed-externally 1.
- Текущий реестр: Confirmed 254, Suspected 50, Rejected 17,
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
7. 50 Suspected: приоритетно FE-0110 (ONLYOFFICE close-hang), FE-0051,
   FE-0075/FE-0076 (security-edge), FE-0182, FE-0253 (heap).

## Цикл 13 — итог и очередь (2026-11-23)

- 323 записи: Confirmed 269, Suspected 12, Fixed-externally 2, Rejected 40.
- Новый дефект: FE-0325 (PWA offline cold reload >65 c).
- FE-0078 закрыт live E2E; FE-0197/0198/0083 подтверждены live.
- Оставшиеся Suspected: FE-0004, FE-0051, FE-0076, FE-0110, FE-0115,
  FE-0161, FE-0194, FE-0253, FE-0265, FE-0300, FE-0323, FE-0324.

### Приоритет следующего цикла
1. FE-0325: исправить offline recovery (status=0, navigator.onLine, таймаут) и
   добавить E2E offline cold reload; проверить PWA/Desktop.
2. FE-0110/FE-0112/FE-0113/FE-0119: реальный ONLYOFFICE Document Server.
3. FE-0215/FE-0216: реальный mailbox + inline-изображения (autosave/restore).
4. FE-0230: реальный WebView2 с поздним bridgeReady.
5. FE-0098/FE-0161/FE-0300/FE-0324: искусственные большие объёмы на стенде.
6. FE-0259/FE-0260/FE-0261: 1C/SQL-данные construction.
7. 429/500 UI и полный multi-tab UI-сценарий refresh.

## Цикл 14 — очередь (2026-11-23)

- Осталось Suspected 11: FE-0004, FE-0051, FE-0076, FE-0110, FE-0115,
  FE-0161, FE-0194, FE-0265, FE-0300, FE-0323, FE-0324.

### Блокировано средой
1. FE-0215 — реальный mailbox/IMAP + inline-изображения.
2. FE-0230 — реальный WebView2 с поздним bridgeReady.
3. FE-0232/FE-0239 — подготовленные users/departments fixtures и разрешённые мутации.
4. FE-0259 — настроенный construction object/direction + 1C/SQL.
5. FE-0022 — Warehouse1C balances/movements из 1C/SQL.
6. FE-0161/FE-0300/FE-0324 — production-объёмы данных.

### Приоритет
- Закрыть FE-0215 и FE-0259 на стенде с mail/1C-моками.
- Довести функциональные сценарии до 30+/36 маршрутов.
- Повторить PWA-тест на устаревшем app-shell и с истёкшей сессией.

## Цикл 15 — очередь (2026-11-23)

- Static-only High: FE-0215 (mailbox), FE-0230 (WebView2), FE-0232/FE-0239
  (fixtures + mutations), FE-0259 (construction object/1C).
- FE-0325: stale SW activation/prompt, expired session offline.
- 11 Suspected: FE-0004, FE-0051, FE-0076, FE-0110, FE-0115, FE-0161,
  FE-0194, FE-0265, FE-0300, FE-0323, FE-0324.
- Довести E2E создания записей (не только диалоги) для ключевых маршрутов.

## Цикл 16 — очередь (2026-11-23)

- FE-0215: локальный IMAP/SMTP fixture + MAIL_MODULE_ENABLED=1, autosave и
  inline-вложения на реальном backend.
- FE-0230: Windows Desktop/WebView2 host, поздний desktop.hostReady.
- FE-0232/FE-0239: синтетические пользователи/отделы/делегаты, разрешённые
  мутации в одноразовой БД.
- FE-0259: Construction object/direction + 1С-креды, F5/close/unmount.
- E2E-создание записей: /tickets, /vcs, /passwords, /docflow (сейчас диалоги).
- Public shares: реальные токены, скачивание, expiry/отзыв.
- PWA: активация waiting-worker, offline с истёкшей сессией (FE-0325/0084/0085).
- 11 Suspected: FE-0004, FE-0051, FE-0076, FE-0110, FE-0115, FE-0161,
  FE-0194, FE-0265, FE-0300, FE-0323, FE-0324.
