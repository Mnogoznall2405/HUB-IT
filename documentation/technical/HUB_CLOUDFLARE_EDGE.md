# HUB-IT через Cloudflare: защищённая загрузка Desktop

Документ описывает включение Cloudflare только для публичного имени `hubit.zsgp.ru`, защиту каталога `/desktop-updates/` и сохранение реального IP пользователя для авторизации и rate limit. Изменения выполняются поэтапно; закрывать origin до полной проверки нельзя.

## Что уже подготовлено в репозитории

- Setup и manifest публикуются в отдельный IIS-каталог `C:\inetpub\wwwroot\hub-desktop-updates`, который не попадает под зеркалирование frontend.
- `scripts/desktop/publish-update.ps1` сначала размещает версионный каталог, затем атомарно заменяет `stable/latest.json`.
- `scripts/desktop/validate-release.ps1` и `publish-update.ps1` запрещают Setup больше 480 МиБ. Клиентский предел остаётся 500 МиБ.
- `scripts/iis/setup_desktop_update_feed.ps1` разрешает в каталоге обновлений только `GET` и `HEAD`, запрещает query string, отключает listing и выставляет отдельные cache-заголовки для manifest и Setup.
- Frontend принимает feed и Setup только с `https://hubit.zsgp.ru/desktop-updates/stable/`.
- Backend читает `CF-Connecting-IP` только когда адрес, видимый за доверенным IIS-прокси, входит в `AUTH_CLOUDFLARE_PROXY_CIDRS`. При пустом списке заголовок Cloudflare игнорируется.

## 1. DNS и TLS

1. Перенести внешнюю DNS-зону в Cloudflare без изменения значений записей.
2. Включить Proxy только для `hubit.zsgp.ru`. Остальные записи оставить DNS-only, если для них нет отдельного согласованного плана.
3. Не менять внутренний split-DNS: в офисе и VPN имя продолжает разрешаться в `10.103.0.217`.
4. До переключения проверить сертификат origin: он не просрочен и содержит `hubit.zsgp.ru` в SAN.
5. В Cloudflare выбрать SSL/TLS `Full (strict)`, включить WebSockets и не включать Argo для этого hostname.
6. Публичный HTTP перенаправлять на HTTPS на edge. После закрытия origin публичный TCP/80 на сервере не нужен.

`Full (strict)` требует валидный сертификат origin, соответствующий hostname. Официальная документация: <https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/>.

## 2. Cache Rules

Нельзя включать «Cache Everything» для всего сайта. HTML, API, авторизация, WebSocket и пользовательские файлы должны остаться вне общего кэша.

### `latest.json`

Выражение:

```text
(http.host eq "hubit.zsgp.ru"
 and http.request.method in {"GET" "HEAD"}
 and http.request.uri.path eq "/desktop-updates/stable/latest.json"
 and http.request.uri.query eq "")
```

Действие: сделать ответ eligible for cache и уважать заголовки origin. Скрипт IIS возвращает:

```text
Cache-Control: public, max-age=0, s-maxage=60, must-revalidate
```

Это даёт edge TTL 60 секунд и browser TTL 0. Не задавать для manifest Edge Cache TTL override в панели: минимальное значение такого override зависит от тарифа и на Free/Pro больше 60 секунд. `s-maxage=60` разделяет edge и browser TTL через Origin Cache Control.

### Версионный Setup

Выражение без regex, совместимое с обычными тарифами:

```text
(http.host eq "hubit.zsgp.ru"
 and http.request.method in {"GET" "HEAD"}
 and starts_with(http.request.uri.path, "/desktop-updates/stable/")
 and ends_with(http.request.uri.path, "-win-x64.exe")
 and http.request.uri.query eq "")
```

Действие: eligible for cache, respect origin. IIS возвращает `Cache-Control: public, max-age=31536000, immutable`. Имя Setup версионное, поэтому заменять файл по тому же URL запрещено.

EXE кэшируется Cloudflare по расширению; максимальный кэшируемый файл для Free, Pro и Business — 512 МБ. Предел выпуска 480 МиБ оставляет запас. Range работает из кэша, если origin отдаёт `Content-Length`: <https://developers.cloudflare.com/cache/concepts/default-cache-behavior/>.

### Явный bypass

Не делать остальные ответы eligible for cache. Дополнительно можно создать Cache Rule с более высоким приоритетом и действием Bypass для приватных маршрутов:

```text
(http.host eq "hubit.zsgp.ru"
 and (starts_with(http.request.uri.path, "/api/")
      or http.request.uri.path eq "/login"
      or http.request.uri.path eq "/about"
      or starts_with(http.request.uri.path, "/shared-files/")))
```

Так не будут кэшироваться API, авторизация, публичные ссылки на пользовательские файлы, WebSocket и VNC-трафик внутри API. Cloudflare по умолчанию не кэширует HTML и JSON; не добавлять для них отдельный `Cache Everything`. Статические assets frontend продолжают работать по стандартному поведению и могут оптимизироваться отдельным узким правилом.

## 3. WAF и rate limit каталога обновлений

Добавить Block-правило для методов:

```text
(http.host eq "hubit.zsgp.ru"
 and starts_with(http.request.uri.path, "/desktop-updates/")
 and not http.request.method in {"GET" "HEAD"})
```

Добавить Block-правило для query string:

```text
(http.host eq "hubit.zsgp.ru"
 and starts_with(http.request.uri.path, "/desktop-updates/")
 and http.request.uri.query ne "")
```

Начальный rate limit:

- scope: `hubit.zsgp.ru` и path starts with `/desktop-updates/`;
- характеристика: source IP;
- 60 запросов за 10 секунд;
- действие сначала Log/Simulate, если оно доступно тарифом;
- после просмотра событий — Block на 60 секунд;
- учитывать cached requests, иначе массовая загрузка из edge не попадёт в счётчик.

Параметры и доступные интервалы зависят от тарифа Cloudflare: <https://developers.cloudflare.com/waf/rate-limiting-rules/>.

## 4. Реальный IP и закрытие origin

### Backend

1. Получить актуальные IPv4/IPv6 ranges с <https://www.cloudflare.com/ips/>.
2. Записать их через запятую:

```dotenv
AUTH_TRUSTED_PROXY_CIDRS=127.0.0.1/32,::1/128
AUTH_CLOUDFLARE_PROXY_CIDRS=<официальные Cloudflare IPv4 и IPv6 CIDR>
```

Не использовать `0.0.0.0/0` или `::/0`. IIS должен перезаписывать входные `X-Forwarded-For` и `X-Real-IP` значением `REMOTE_ADDR`, как делает текущий `public/web.config`. Тогда backend видит цепочку `FastAPI <- IIS <- Cloudflare` и принимает `CF-Connecting-IP` только после проверки адреса edge.

Для внутренних прямых запросов `REMOTE_ADDR` остаётся адресом офисного/VPN-клиента; `CF-Connecting-IP` игнорируется. Это сохраняет сетевые зоны, ограничения административного входа и backend rate limits.

### Firewall origin

Только после успешной внешней регрессии:

- разрешить публичный TCP/443 с актуальных Cloudflare IPv4/IPv6 ranges;
- сохранить TCP/443 из корпоративных и VPN-подсетей;
- запретить остальные публичные источники;
- запретить публичный TCP/80;
- исключить Cloudflare ranges из site-wide IIS Dynamic IP Restrictions, чтобы IIS не заблокировал edge как одного клиента.

Прямой запрос к публичному IP origin с `Host: hubit.zsgp.ru` после этого не должен отдавать ни портал, ни Setup. Cloudflare рекомендует allowlist его диапазонов и блокировку остальных источников: <https://developers.cloudflare.com/fundamentals/security/protect-your-origin-server/>.

## 5. Порядок включения

1. Запустить `scripts/iis/setup_desktop_update_feed.ps1` от администратора и проверить каталог локально.
2. Настроить `Full (strict)`, WebSockets, Cache/WAF/rate-limit rules, но DNS ещё не проксировать.
3. Убедиться, что origin-сертификат валиден и актуальные Cloudflare CIDR готовы для firewall и `.env`.
4. Включить Proxy для `hubit.zsgp.ru`.
5. Провести полную регрессию из внешней сети.
6. Включить блокирующий rate limit после периода наблюдения.
7. Закрыть origin firewall только для Cloudflare + корпоративных/VPN-сетей.
8. Повторить регрессию и тест прямого IP.

## 6. Проверка

Минимальный набор команд с внешнего ПК:

```powershell
curl.exe -I https://hubit.zsgp.ru/desktop-updates/stable/latest.json
curl.exe -I https://hubit.zsgp.ru/desktop-updates/stable/latest.json
curl.exe -I https://hubit.zsgp.ru/desktop-updates/stable/0.1.12/HUB-Desktop-Setup-0.1.12-win-x64.exe
curl.exe -H "Range: bytes=0-1023" -o NUL -D - https://hubit.zsgp.ru/desktop-updates/stable/0.1.12/HUB-Desktop-Setup-0.1.12-win-x64.exe
curl.exe -I "https://hubit.zsgp.ru/desktop-updates/stable/latest.json?bypass=1"
curl.exe -X POST -I https://hubit.zsgp.ru/desktop-updates/stable/latest.json
```

Ожидания:

- у Setup после первого `MISS` появляется `CF-Cache-Status: HIT`;
- Range возвращает `206 Partial Content`;
- manifest обновляется на edge не позже 60 секунд;
- запрос с query string и POST получает 403/404;
- Setup скачивается полностью, SHA-256 совпадает с manifest;
- вход, 2FA, passkey, сохранение сессии, чат, WebSocket, VNC и уведомления работают;
- Desktop из внешней сети находит и устанавливает обновление;
- прямой публичный IP origin не отвечает приложением.

Отдельно контролировать Cloudflare Security Events/Cache Analytics и IIS/backend logs: 403, 429, 5xx, cache miss ratio, объём исходящего трафика origin и реальные client IP.

## 7. Откат

Если проблема появилась до закрытия origin — выключить Proxy у `hubit.zsgp.ru` и диагностировать правила.

Если origin уже закрыт:

1. временно вернуть публичный HTTPS-доступ к origin;
2. проверить прямой доступ по hostname;
3. только затем переключить DNS в DNS-only;
4. не менять URL feed и manifest — Desktop продолжит использовать тот же адрес.

Аварийное отключение только автообновлений: убрать `stable/latest.json`. Сам портал и уже установленный HUB Desktop продолжат работать.
