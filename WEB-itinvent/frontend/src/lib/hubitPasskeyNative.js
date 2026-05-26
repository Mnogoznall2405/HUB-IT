import { isCapacitorNativeRuntime } from './useWebAuthnAvailability';

let nativeAvailabilityCache = null;
let nativeAvailabilityPromise = null;

export function getHubitPasskeyPlugin() {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.Capacitor?.Plugins?.HubitPasskey ?? null;
}

export async function isHubitPasskeyNativeAvailable() {
  if (!isCapacitorNativeRuntime()) {
    return false;
  }
  if (nativeAvailabilityCache !== null) {
    return nativeAvailabilityCache;
  }
  if (!nativeAvailabilityPromise) {
    nativeAvailabilityPromise = (async () => {
      const plugin = getHubitPasskeyPlugin();
      if (!plugin || typeof plugin.isAvailable !== 'function') {
        return false;
      }
      try {
        const result = await plugin.isAvailable();
        return Boolean(result?.available);
      } catch {
        return false;
      }
    })();
  }
  nativeAvailabilityCache = await nativeAvailabilityPromise;
  return nativeAvailabilityCache;
}

export function resetHubitPasskeyNativeCache() {
  nativeAvailabilityCache = null;
  nativeAvailabilityPromise = null;
}

export async function nativeGetPasskeyAssertion(publicKeyOptions) {
  const plugin = getHubitPasskeyPlugin();
  if (!plugin || typeof plugin.getAssertion !== 'function') {
    throw new Error('PasskeyUnavailable');
  }
  const result = await plugin.getAssertion({
    requestJson: JSON.stringify(publicKeyOptions),
  });
  return result?.credential ?? null;
}

export async function nativeCreatePasskey(publicKeyOptions) {
  const plugin = getHubitPasskeyPlugin();
  if (!plugin || typeof plugin.createCredential !== 'function') {
    throw new Error('PasskeyUnavailable');
  }
  const result = await plugin.createCredential({
    requestJson: JSON.stringify(publicKeyOptions),
  });
  return result?.credential ?? null;
}
