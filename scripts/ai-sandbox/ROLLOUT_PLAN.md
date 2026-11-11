# План завершения OpenCode и связи с файловым хранилищем

## Цель и границы

OpenCode исполняется на TMN-SRV-AI-01 (10.103.0.11). Постоянные пользовательские
файлы остаются в `\\10.103.0.229\hubit\users` через сервис «Мои файлы» HUB.
Контейнер получает копии только выбранных вложений через internal HTTPS API.
SMB credentials, общая SMB-папка и репозиторий HUB внутрь контейнера не попадают.
Результат возвращается вложением чата; сохранение в «Мои файлы» выполняется
явным действием пользователя через существующий endpoint.

Rollout разрешён пользователем. Доступ PostgreSQL настроен 2026-09-14 через
сохранённое административное подключение проекта; новые пароли не нужны.
Gateway, control и worker запущены. Приёмка: [LIVE_STATUS.md](LIVE_STATUS.md).

## 1. Подготовка кода (разрешена, начата)

- [x] Исправить runtime-тест для COPY из CPython build stage; сохранить проверку
  импорта gateway из точного разрешённого набора файлов. 13 runtime-тестов прошли.
- [x] Добавить offline preflight по ролям hub/worker/gateway без вывода значений
  конфигурации, подключения к БД и изменения окружения.
- [x] Исправить подготовку gateway env: добавить обязательный флаг gateway,
  сохранив выключенными execution flags HUB/worker; добавить gateway.env.example.
  Сам deployment script не запускался.
- [x] Реальные Linux-сборки sandbox и gateway завершены, базовые и итоговые
  образы закреплены manifest digest; CPython также закреплён digest.
- [x] Подготовлен allowlisted worker release с manifest SHA-256; проверен импорт
  worker/gateway из отдельного пакета. Используется gateway-requirements.lock.
- [x] Добавлен quota_root.py для kernel project quota на выделенном ext4 mount;
  worker вызывает ensure, который настраивает только новый пустой workspace.
  Marker fallback удалён из bootstrap. Реальные kernel/EDQUOT и запрет ioctl проверены.

## 2. Связь с «Моими файлами»

- [x] Подтверждены приём вложений чата и возврат результатов OpenCode.
- [x] Подтверждено действие сохранения результата/архива в «Мои файлы».
- [x] Добавлен выбор исходного файла из «Моих файлов» в OpenCode. Owner-scoped
  одноразовый download grant возвращает материализованный файл в ограниченный
  browser buffer (до 256 МиБ), после чего используется обычный черновик вложения.
  Прямого копирования SMB→Linux нет. Пользователь сам отправляет файл с заданием.
  Архивы запрещены существующим контрактом чата; смена диалога отменяет download.
- [ ] Проверить owner/RBAC, недоступный/удалённый файл, готовность обработки
  storage-v2, распаковку zstd через сервис, антивирус и текущий input limit 256 MiB.
  Изменение лимита не входит в этот план.
- [x] Проверить сохранение результата на SMB через штатный runtime и обратное
  скачивание с совпадением содержимого; исходное вложение сохранено.
- [ ] Отдельно проверить сохранность результата после удаления workspace.

## 3. Production rollout (разрешён пользователем, выполняется)

Точные цели, команды, новые systemd units, control PM2 entry и откат описаны в
[DEPLOYMENT.md](DEPLOYMENT.md). В ubuntu-vg создан рабочий том 20 ГБ,
4 ГБ оставлены резервом. Корневой LV не менялся.

Перед согласованием подготовить окончательные artifacts, конфигурационные
шаблоны, точные service units и результаты локальных проверок. Не запускать
старые `_build_start_gateway.py`/`_check_ai_vm_ready.py` как read-only диагностику:
они записывают файлы, запускают контейнеры либо удаляют каталоги.

Порядок операций:

1. Сохранить защищённые резервные копии изменяемых конфигураций, env, quota helper,
   unit files и текущих image pins. Снять состояние VM, дисков и процессов.
2. Подготовить выделенное файловое пространство Linux с project quota. Способ
   выбирается после проверки свободного места и доступных томов. Не менять
   корневую файловую систему и не форматировать том без отдельной точной цели.
3. Разместить проверенный worker release и gateway artifact на Linux под
   `hub-ai-sandbox`; создать service env вне workspaces с mode 0600 и каталогом 0700.
   Worker получает DB/control credentials; provider key получает только gateway.
4. На HUB разместить internal control ASGI на private IP:8443 с TLS; разрешить
   доступ только с Linux VM. Обеспечить DNS `hub-ai-control` и доверие сертификату
   на worker; не отключать TLS verification и не публиковать endpoint через IIS.
5. Настроить одинаковый transfer service token на HUB и worker. Задать gateway
   forced model и `AI_SANDBOX_ENABLED=1` в gateway env: `/health` не проверяет этот
   флаг, а реальные LLM-запросы с отсутствующим флагом отклоняются.
6. Запустить gateway, проверить отсутствие host-port и доступ через internal DNS.
   Подтвердить ACL egress и запрет прямого доступа sandbox к Internet/SMB/DB.
7. После health, TLS, quota, DB и transfer preflight установить READY и включить
   sandbox на HUB/worker. Включать только согласованный набор процессов; не
   использовать общий restart-backend без учёта связанного restart Scan.
8. Выполнить пилот под разрешённой учётной записью с `chat.ai.sandbox`.

Сверка модели с production выявила отсутствующие поля finalization при revision
20260912_0115. После backup применена миграция 20260914_0116; поля и индексы
проверены. Не повторять одноразовые repair-скрипты без preflight.

## 4. Приёмка и откат

Post-check: запуск после перезагрузки VM, сообщение и ответ LLM, файл из
хранилища, once/session permission, запрет чужого файла, отмена во время работы,
reconnect, доставка результата, сохранение в «Мои файлы», реальный отказ записи
за quota, отсутствие orphan containers и повторная finalization без дублей.
Проверить браузер и Desktop; native Android проверить отдельно на устройстве.

Rollback: отключить новые execution на HUB, перевести worker в cleanup-only,
дать завершиться finalization/cleanup и проверить отзыв grants и отсутствие
контейнеров. Gateway сохранять доступным до завершения нужных операций drain.
Восстановить предыдущие config/release/image pins после drain. Не удалять
таблицы, сообщения, результаты на SMB и workspace активных заданий. Retention
оставить включённым. Дисковые изменения откатывать только по отдельному плану
выбранного тома; rollback приложения не предполагает форматирование или удаление.

## Offline preflight

Из корня репозитория, на копиях соответствующих service env:

```powershell
python scripts/ai-sandbox/preflight.py --env-file .env --role hub
python scripts/ai-sandbox/preflight.py --env-file <worker-env-copy> --role worker
python scripts/ai-sandbox/preflight.py --env-file <gateway-env-copy> --role gateway
```

Exit 1 означает недостающую/некорректную конфигурацию; exit 0 подтверждает только
проверенные настройки. `runtime_verified` всегда false: TLS, SMB, DB, Podman,
systemd и фактические квоты этим скриптом не проверяются.
