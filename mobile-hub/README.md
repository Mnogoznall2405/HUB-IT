# HUB-IT Mobile (Expo, Android)

Native Android client for HUB-IT (`/api/v1`), built with Expo Router and React Native Paper.

## Requirements

- Node.js 18+
- Expo Go on Android or Android emulator
- Running HUB-IT backend (`WEB-itinvent/backend`, port `8001` dev)

## Setup

```powershell
cd mobile-hub
npm install
```

Create `.env` (optional):

```env
EXPO_PUBLIC_API_URL=https://hubit.zsgp.ru/api/v1
```

For local backend:

```env
EXPO_PUBLIC_API_URL=http://10.0.2.2:8001/api/v1
```

(`10.0.2.2` is host loopback from Android emulator.)

## Run

```powershell
npx expo start
```

**На телефоне (рекомендуется):** установите [Expo Go](https://play.google.com/store/apps/details?id=host.exp.exponent) на Android, отсканируйте QR из терминала (ПК и телефон в одной Wi‑Fi). Либо в терминале нажмите `a` для эмулятора Android.

**Рекомендуется Android (Expo Go):** `npm run start:android` или QR в терминале — полный нативный UI (drawer, чат, жесты).

### Android Emulator (Windows 10/11, не Server)

На **Windows Server 2019** `adb` часто не запускается — эмулятор Google здесь **не поддерживается**. Нужна рабочая станция Win10/11 с [Android Studio](https://developer.android.com/studio).

```powershell
# один раз (SDK, emulator, AVD HubIT_Pixel_API34)
cd mobile-hub
.\scripts\setup-android-emulator.ps1

# каждый запуск
.\scripts\start-emulator-and-expo.ps1
```

Или вручную: Android Studio → Device Manager → Create Virtual Device → запустить → `npx expo start --android`.

## Сборка APK

На **Windows Server без Java** удобнее **облачная сборка EAS** (Expo). Локально нужны JDK 17 + Android SDK.

### EAS (рекомендуется) — готовый APK

```powershell
cd mobile-hub
npm run assets:icons
npx eas-cli login
npm run build:apk
```

Профиль `preview` в `eas.json` собирает **APK** (не AAB), API: `https://hubit.zsgp.ru/api/v1`.

Скачать артефакт: `npx eas-cli build:list` → ссылка на `.apk`.

Для CI задайте [EXPO_TOKEN](https://docs.expo.dev/accounts/programmatic-access/) и:

```powershell
$env:EXPO_TOKEN = "ваш_токен"
npm run build:apk
```

### Локально (Windows 10/11 + JDK)

```powershell
npm run build:apk:local
```

Результат: `mobile-hub/dist/hubit-mobile-debug.apk` (debug, для внутреннего теста).

Release-подпись: настройте keystore в EAS (`eas credentials`) или Android Studio.

**Web в Chrome** — только для быстрой проверки; возможны ограничения RNGH/SecureStore. API через прокси Metro (`/api/v1` → hubit). После правок: `npm run start:clear`.

**Телефон:** запросы на `https://hubit.zsgp.ru/api/v1` из `.env`, CORS не мешает.

Auth uses `X-Auth-Client: mobile` and SecureStore for JWT.

## Features (v1)

- Login + 2FA (TOTP / backup)
- Chat: conversations, messages, WebSocket, attachments, reactions, forward, search, AI bots
- Settings: profile, avatar, password, logout, FCM token registration

See [MOBILE_HUB_CHECKLIST.md](../documentation/technical/MOBILE_HUB_CHECKLIST.md).
