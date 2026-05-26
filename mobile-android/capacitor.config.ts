import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ru.zsgp.hubit',
  appName: 'HUB-IT',
  webDir: '../WEB-itinvent/frontend/dist',
  backgroundColor: '#0f1722',
  loggingBehavior: 'debug',
  server: {
    url: 'https://hubit.zsgp.ru',
    cleartext: false,
  },
  android: {
    path: 'android',
    backgroundColor: '#0f1722',
    allowMixedContent: false,
    webContentsDebuggingEnabled: true,
    minWebViewVersion: 99,
  },
};

export default config;
