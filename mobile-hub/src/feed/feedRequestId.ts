import * as Crypto from 'expo-crypto';

export function createFeedClientRequestId(): string {
  const nativeId = typeof Crypto.randomUUID === 'function' ? Crypto.randomUUID() : '';
  if (typeof nativeId === 'string' && nativeId.trim()) return nativeId;
  return `feed-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
