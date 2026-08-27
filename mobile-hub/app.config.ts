import type { ExpoConfig } from 'expo/config';

const { buildAndroidHttpsAppLinksConfig } = require('./android-app-links.cjs') as {
  buildAndroidHttpsAppLinksConfig: (value: string | undefined) => Partial<NonNullable<ExpoConfig['android']>>;
};

const googleServicesFile = String(process.env.EXPO_GOOGLE_SERVICES_FILE || '').trim();
const easProjectId = String(process.env.EXPO_EAS_PROJECT_ID || '').trim();
const androidHttpsAppLinks = buildAndroidHttpsAppLinksConfig(
  process.env.HUBIT_ANDROID_ENABLE_APP_LINKS,
);

const config: ExpoConfig = {
  name: 'HUB-IT',
  slug: 'mobile-hub',
  version: '1.1.17',
  orientation: 'portrait',
  scheme: 'hubit',
  userInterfaceStyle: 'automatic',
  icon: './assets/icon.png',
  android: {
    package: 'ru.zsgp.hubit.mobile',
    versionCode: 19,
    ...androidHttpsAppLinks,
    permissions: ['android.permission.REQUEST_INSTALL_PACKAGES'],
    blockedPermissions: [
      'android.permission.SYSTEM_ALERT_WINDOW',
    ],
    ...(googleServicesFile ? { googleServicesFile } : {}),
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#071d30',
    },
  },
  plugins: [
    'expo-router',
    './plugins/withHubitAndroidShortcuts',
    'expo-background-task',
    'expo-secure-store',
    [
      'expo-local-authentication',
      {
        faceIDPermission: 'Разрешить HUB-IT использовать биометрию для входа.',
      },
    ],
    'expo-asset',
    'expo-font',
    [
      'expo-camera',
      {
        cameraPermission: 'Разрешить HUB-IT использовать камеру для сканирования инвентарных QR-кодов.',
        recordAudioAndroid: false,
        barcodeScannerEnabled: true,
      },
    ],
    [
      'expo-audio',
      {
        microphonePermission: 'Разрешить HUB-IT записывать голосовые сообщения.',
        recordAudioAndroid: true,
        enableBackgroundRecording: false,
        enableBackgroundPlayback: false,
      },
    ],
    'expo-sharing',
    'expo-status-bar',
    [
      'expo-navigation-bar',
      {
        hidden: true,
        style: 'dark',
        enforceContrast: false,
      },
    ],
    [
      'expo-notifications',
      {
        defaultChannel: 'hubit_default',
      },
    ],
    [
      'expo-splash-screen',
      {
        image: './assets/splash.png',
        imageWidth: 220,
        resizeMode: 'contain',
        backgroundColor: '#f5f7fa',
      },
    ],
    [
      'expo-build-properties',
      {
        android: {
          compileSdkVersion: 36,
          targetSdkVersion: 36,
          usesCleartextTraffic: false,
          buildArchs: ['armeabi-v7a', 'arm64-v8a'],
          enableMinifyInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
          networkInspector: false,
        },
      },
    ],
    './plugins/withHubitAndroidSecurity',
  ],
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL || 'https://hubit.zsgp.ru/api/v1',
    webUrl: process.env.EXPO_PUBLIC_WEB_URL || 'https://hubit.zsgp.ru',
    ...(easProjectId ? { eas: { projectId: easProjectId } } : {}),
  },
};

export default config;
