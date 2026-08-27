import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import {
  DEFAULT_PREFERENCES,
  normalizePreferencePayload,
  type UserPreferences,
} from './preferenceNormalizers';

const CACHE_KEY = 'hubit_user_preferences_cache';

async function readRaw(): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      return globalThis.localStorage?.getItem(CACHE_KEY) ?? null;
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(CACHE_KEY);
}

async function writeRaw(value: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(CACHE_KEY, value);
    return;
  }
  await SecureStore.setItemAsync(CACHE_KEY, value);
}

export async function readCachedPreferences(): Promise<UserPreferences> {
  try {
    const raw = await readRaw();
    if (!raw) return { ...DEFAULT_PREFERENCES };
    return normalizePreferencePayload(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export async function cachePreferences(value: UserPreferences): Promise<void> {
  try {
    await writeRaw(JSON.stringify(value));
  } catch {
    // Cache is best-effort.
  }
}
