import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import {
  DEFAULT_PREFERENCES,
  normalizePreferencePayload,
  type UserPreferences,
} from './preferenceNormalizers';

// Shared entry keeps the last signed-in user's theme for the pre-auth screens;
// signed-in reads are scoped per user so a different account never inherits
// another user's navigation layout or dashboard composition.
const CACHE_KEY = 'hubit_user_preferences_cache';
const scopedCacheKey = (userId: number) => `${CACHE_KEY}_u${Math.trunc(userId)}`;

export async function readPendingPreferences(userId: number): Promise<Partial<UserPreferences>> {
  try {
    const raw = await readRaw(`${scopedCacheKey(userId)}_pending`);
    const value = raw ? JSON.parse(raw) : {};
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

export async function writePendingPreferences(userId: number, patch: Partial<UserPreferences>): Promise<void> {
  await writeRaw(`${scopedCacheKey(userId)}_pending`, JSON.stringify(patch));
}

type CachedPreferencesEnvelope = {
  user_id?: unknown;
  preferences?: unknown;
};

async function readRaw(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(key);
}

async function writeRaw(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

function parseEnvelope(raw: string | null): { userId: number | null; preferences: UserPreferences } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CachedPreferencesEnvelope;
    if (!parsed || typeof parsed !== 'object') return null;
    // Envelope entries wrap the payload; legacy entries stored it directly.
    const payload = 'preferences' in parsed ? parsed.preferences : parsed;
    const owner = Number(parsed.user_id || 0);
    return {
      userId: Number.isInteger(owner) && owner > 0 ? owner : null,
      preferences: normalizePreferencePayload(payload as Partial<UserPreferences>),
    };
  } catch {
    return null;
  }
}

export async function readCachedPreferences(userId?: number): Promise<UserPreferences> {
  const owner = Number(userId || 0);
  if (Number.isInteger(owner) && owner > 0) {
    const scoped = parseEnvelope(await readRaw(scopedCacheKey(owner)));
    if (scoped) return scoped.preferences;
    // Migration: fall back to the shared cache only when it belongs to this
    // user or was written before per-user scoping (no owner recorded).
    const shared = parseEnvelope(await readRaw(CACHE_KEY));
    if (shared && (shared.userId === null || shared.userId === owner)) return shared.preferences;
    return { ...DEFAULT_PREFERENCES };
  }
  const shared = parseEnvelope(await readRaw(CACHE_KEY));
  return shared?.preferences || { ...DEFAULT_PREFERENCES };
}

export async function cachePreferences(value: UserPreferences, userId?: number | null): Promise<void> {
  const owner = Number(userId || 0);
  const envelope = JSON.stringify({
    user_id: Number.isInteger(owner) && owner > 0 ? owner : null,
    preferences: value,
  });
  const writes = [writeRaw(CACHE_KEY, envelope)];
  if (owner > 0) writes.push(writeRaw(scopedCacheKey(owner), envelope));
  try {
    await Promise.all(writes);
  } catch {
    // Cache is best-effort.
  }
}
