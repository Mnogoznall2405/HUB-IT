# Cycle 9 — evidence

- probe_*.mjs — прямые playwright-пробники против локального стека
  (E2E_LOCAL=1, frontend 5174 / backend 18001).
- probe-zoom-results.json — замеры переполнений при zoom 0.8/1/1.5:
  dashboard, chat, scan-center, my-files.
- shots/zoom-*.png — скриншоты scan-center при 80/150% (переполнение FE-0011).
- shots/about-1920.png, about-375.png — страница /about (онбординг e2e_fresh).
- shots/login-missing.png — «/login→/about»: фактически /about с баннером
  «Загрузка временно недоступна» при живой сессии e2e_fresh (артефакт среды,
  не дефект продукта — см. AUDIT_PROGRESS цикл 9).
- apply_issues.mjs / patch_and_md.mjs — скрипты добавления записей FE-0077+
  и пересчёта счётчиков (детерминированно повторяемы).
- Выводы 6 explore-агентов — в журнале сессии; перепроверены по file:line
  перед включением в реестр.
