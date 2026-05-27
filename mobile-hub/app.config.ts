import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'HUB-IT',
  slug: 'mobile-hub',
  version: '1.0.0',
  orientation: 'portrait',
  scheme: 'hubit',
  userInterfaceStyle: 'light',
  icon: './assets/icon.png',
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#f5f7fa',
  },
  android: {
    package: 'ru.zsgp.hubit.mobile',
    versionCode: 1,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#1976d2',
    },
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-asset',
    'expo-font',
    [
      'expo-build-properties',
      {
        android: {
          kotlinVersion: '1.9.25',
          compileSdkVersion: 35,
          targetSdkVersion: 34,
        },
      },
    ],
  ],
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL || 'https://hubit.zsgp.ru/api/v1',
  },
};

export default config;
