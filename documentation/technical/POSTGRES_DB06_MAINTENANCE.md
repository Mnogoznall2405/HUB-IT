# Обслуживание TMN-SRV-DB-06 — 08.09.2026

Сервер: `10.103.0.10`, Ubuntu 24.04.4 LTS, PostgreSQL 16.15.
Проверка и обслуживание выполнены после [переноса базы](POSTGRES_DB06_MIGRATION.md).

## Обновления и инструменты

Выполнены `apt-get update`, симуляция upgrade и обычный `apt-get upgrade -y`.
Для текущей политики Ubuntu обновлений не оказалось: установлено 0 новых пакетов,
обновлено 0, удалено 0. Шесть пакетов остаются в phased rollout Ubuntu:
`base-files`, `motd-news-config`, `python-apt-common`, `python3-apt`,
`python3-distupgrade`, `ubuntu-release-upgrader-core`.

PostgreSQL 16.15, OpenSSL, CA certificates, curl, needrestart, sysstat и
unattended-upgrades уже установлены. Переход на другую основную версию Ubuntu
или PostgreSQL не выполнялся. Автоматические security updates и их APT timers
включены; существующая политика сохранена.
Справочник: [автоматические обновления Ubuntu](https://ubuntu.com/server/docs/how-to/software/automatic-updates/).

## Изменения

- Часовой пояс ОС изменён с `Etc/UTC` на `Asia/Yekaterinburg`, как у приложения
  и PostgreSQL. NTP оставлен включённым.
- В `/etc/default/sysstat` установлен `ENABLED="true"` вместо `false`.
  При этом systemd timers **уже собирали статистику до изменения**, что
  подтверждено существующими записями `sar`. Изменение согласует legacy-флаг
  с действующим режимом; это не устранение доказанного простоя сборщика.
- Создана свежая защищённая резервная копия БД, глобальных ролей, PostgreSQL
  config, APT config, sysstat config и списка пакетов.
- После отдельного явного разрешения пользователя DB-06 перезагружен для
  завершения ранее установленного обновления AppArmor и обновления процессов
  dbus / ModemManager / unattended-upgrades.
- До reboot процессы проекта остановлены; после запуска БД восстановлены
  штатным `scripts/pm2/restart-all.ps1 -SaveState`.

Параметры пулов и производительности PostgreSQL не изменялись. Нагрузочный тест
на 300 соединений в это обслуживание не входил; ускорение запросов не заявляется.

## Резервная копия и отмена настроек

Каталог DB-06: `/var/backups/hubit-db06-maintenance-20260908`, доступ 0700.
Свежий `hubit_chat.dump` занимает 842 575 006 байт; проверены чтение TOC и
SHA-256. Пробное восстановление именно этого снимка не выполнялось.
Глобальные роли сохранены в защищённый файл `globals.sql`; содержимое и
пароли не выводились. Конфигурация и перечень пакетов сохранены рядом.

Для отмены изменений настроек восстановить `/etc/default/sysstat` из
`sysstat.before` и вернуть timezone из `timezone.before`. Автоматически
восстанавливать БД из этого снимка нельзя: после снимка продолжаются новые записи.

## Проверка после reboot

Новый boot-id подтверждён; ядро `6.8.0-139-generic` соответствует установленному.
PostgreSQL запустился автоматически. `systemctl --failed` пуст;
`/var/run/reboot-required` отсутствует; needrestart больше не перечисляет
службы, требующие перезапуска. Sysstat и APT timers активны, `dpkg --audit` пуст.

Финальная проверка: `NTPSynchronized=yes`; SHA-256 резервной копии совпадает после
перезагрузки. Все 14 процессов PM2 online, счётчики перезапусков — 0. Web API,
Chat, Scan и Inventory отвечают HTTP 200; PostgreSQL realtime чата готов.
Подключение приложения к новой БД по TLS и read-only режим старой БД проверены.
Через IIS с проверкой сертификата `https://hubit.zsgp.ru/` отвечает HTTP 200,
а `/api/v1/auth/me` без авторизации — ожидаемый HTTP 401.

Ручные пользовательские сценарии браузера, Desktop и Android не проверялись.
