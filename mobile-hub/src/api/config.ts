import Constants from 'expo-constants';
import { Platform } from 'react-native';

function trimTrailingSlash(url: string): string {
  return url.replace(/\/$/, '');
}

/** Web on localhost: same-origin /api/v1 via Metro proxy (avoids CORS). */
function webDevApiBase(): string | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const host = window.location.hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') return null;
  return `${window.location.origin}/api/v1`;
}

export const API_V1_BASE = trimTrailingSlash(
  webDevApiBase() ||
    process.env.EXPO_PUBLIC_API_URL ||
    (Constants.expoConfig?.extra?.apiUrl as string | undefined) ||
    'https://hubit.zsgp.ru/api/v1',
);

export const MOBILE_AUTH_HEADER = 'X-Auth-Client';
export const MOBILE_AUTH_VALUE = 'mobile';
