import * as SecureStore from 'expo-secure-store';
import { DEFAULT_NATIVE_MAIL_SWIPE_SETTINGS, type NativeMailSwipeSetting } from './nativeMailModel';

const STORAGE_KEY = 'hubit_mail_swipe_settings_v1';
const ALLOWED: NativeMailSwipeSetting[] = ['toggle-read', 'archive', 'delete', 'none'];

export type NativeMailSwipeSettings = {
  right: NativeMailSwipeSetting;
  left: NativeMailSwipeSetting;
};

export function normalizeNativeMailSwipeSettings(value: unknown): NativeMailSwipeSettings {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const pick = (entry: unknown, fallback: NativeMailSwipeSetting): NativeMailSwipeSetting => (
    ALLOWED.includes(entry as NativeMailSwipeSetting) ? entry as NativeMailSwipeSetting : fallback
  );
  return {
    right: pick(raw.right, DEFAULT_NATIVE_MAIL_SWIPE_SETTINGS.right),
    left: pick(raw.left, DEFAULT_NATIVE_MAIL_SWIPE_SETTINGS.left),
  };
}

function scopedKey(userId: number): string {
  return `${STORAGE_KEY}:${Math.max(0, Math.trunc(Number(userId) || 0))}`;
}

/** Swipe actions live on the device: the mail preferences API has no gesture fields. */
export async function readNativeMailSwipeSettings(userId: number): Promise<NativeMailSwipeSettings> {
  if (!userId) return { ...DEFAULT_NATIVE_MAIL_SWIPE_SETTINGS };
  try {
    const raw = await SecureStore.getItemAsync(scopedKey(userId));
    if (!raw) return { ...DEFAULT_NATIVE_MAIL_SWIPE_SETTINGS };
    return normalizeNativeMailSwipeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_NATIVE_MAIL_SWIPE_SETTINGS };
  }
}

export async function writeNativeMailSwipeSettings(userId: number, settings: NativeMailSwipeSettings): Promise<NativeMailSwipeSettings> {
  const normalized = normalizeNativeMailSwipeSettings(settings);
  if (!userId) return normalized;
  await SecureStore.setItemAsync(scopedKey(userId), JSON.stringify(normalized));
  return normalized;
}
