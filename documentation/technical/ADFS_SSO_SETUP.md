# AD FS SSO для HUB-IT (sso.zsgp.ru)

HUB-IT сервер не в домене, поэтому Kerberos-проверку выполняет AD FS.
Используется стандартный OIDC authorization code flow + PKCE: браузер/WebView2
идёт на `https://sso.zsgp.ru/adfs/oauth2/authorize`, доменные пользователи
проходят Windows Integrated Authentication без ввода пароля, backend обменивает
`code` на `id_token` и проверяет его подпись по JWKS AD FS.

## 1. Регистрация приложения в AD FS (Windows Server 2019+)

AD FS Management → **Application Groups** → **Add Application Group**:

1. Шаблон: **Server application accessing a web API** → Next.
2. Server application:
   - Name: `HUB-IT`
   - Client Identifier: сгенерированный GUID → это `ADFS_CLIENT_ID`
   - Redirect URI: `https://hubit.zsgp.ru/api/v1/auth/sso/callback`
   - → **Generate a shared secret** → это `ADFS_CLIENT_SECRET`
3. Web API: Identifier = тот же Client Identifier → Next.
4. Access Control Policy: **Permit everyone** (или конкретная группа HUB-IT).
5. Issuance transform rules (на шаге Web API → Edit Rule Issuance):
   - **Send LDAP Attributes as Claims**: LDAP Attribute `SAM-Account-Name` →
     Outgoing Claim Type `upn`.
   - Или Transform rule: Incoming `Windows account name` → Outgoing
     `winaccountname` — backend принимает оба варианта.

## 2. Конфигурация backend `.env`

```env
WINDOWS_SSO_ENABLED=1
WINDOWS_SSO_DOMAIN=ZSGP
ADFS_BASE_URL=https://sso.zsgp.ru
ADFS_CLIENT_ID=<Client Identifier из п.2>
ADFS_CLIENT_SECRET=<секрет из п.2>
ADFS_REDIRECT_URI=https://hubit.zsgp.ru/api/v1/auth/sso/callback
ADFS_SCOPE=openid
# если сертификат AD FS от внутреннего CA — путь к PEM с корнем:
ADFS_CA_BUNDLE=
```

Рестарт backend. Проверка доступности из .env-конфига: `GET /api/v1/auth/login-mode`
для internal-клиента должен вернуть `"windows_sso_enabled": true`.

## 3. Desktop

`desktop/Hub.Desktop/appsettings.json`:

```json
"Adfs": { "Authority": "https://sso.zsgp.ru" }
```

`NavigationPolicy` разрешает навигацию в окне WebView2 только на этот origin и
только под `/adfs/` (authorize/WIA). Мост desktop bridge AD FS-страницам не
доверяется.

## 4. Если вместо silent-входа появляется форма AD FS

WIA включается политикой аутентификации AD FS:

```powershell
Set-AdfsGlobalAuthenticationPolicy -PrimaryIntranetAuthenticationProvider `
    WindowsAuthentication, FormsAuthentication
```

Браузер/WebView2 должны считать `sso.zsgp.ru` зоной Local Intranet (обычно
через групповую политику: Site to Zone Assignment List → `https://sso.zsgp.ru`
= 1).

## 5. Что проверить при отладке

- `https://sso.zsgp.ru/adfs/.well-known/openid-configuration` — issuer и jwks_uri.
- `GET /api/v1/auth/sso/begin` → 302 на `sso.zsgp.ru/adfs/oauth2/authorize?...`.
- В логе backend строки `Windows SSO ...` с reason — verify/denied/not_provisioned/inactive.
- `?sso_error=` коды на странице логина: `denied`, `verify`, `not_provisioned`,
  `inactive`, `unavailable` (внешняя сеть).

Логин маппится: `winaccountname` (`ZSGP\ivanov`) → `upn` (`ivanov@zsgp.ru`) →
`unique_name` → `name`; username приводится к lowercase и должен совпадать с
`users.username` (LDAP-синхронизация уже пишет `sAMAccountName`).
