import { useEffect, useState } from 'react';

import { isHubitPasskeyNativeAvailable } from './hubitPasskeyNative';
import { isNativeShellRuntime } from './platform';

export const WEBAUTHN_READY_EVENT = 'hubit:webauthn-ready';

const CAPACITOR_POLL_INTERVAL_MS = 100;
const CAPACITOR_POLL_TIMEOUT_MS = 8000;
const WEB_POLL_INTERVAL_MS = 50;
const WEB_POLL_TIMEOUT_MS = 500;

export function isCapacitorNativeRuntime() {
  if (typeof window === 'undefined') {
    return false;
  }
  const capacitor = window.Capacitor;
  if (!capacitor) {
    return false;
  }
  if (typeof capacitor.isNativePlatform === 'function') {
    return Boolean(capacitor.isNativePlatform());
  }
  const platform = String(capacitor.getPlatform?.() || capacitor.platform || '').trim().toLowerCase();
  return platform === 'android' || platform === 'ios';
}

function usesNativeShellPolling() {
  return isNativeShellRuntime() || isCapacitorNativeRuntime();
}

export function isWebAuthnApiAvailable() {
  if (typeof window === 'undefined') {
    return false;
  }
  return Boolean(window.PublicKeyCredential && navigator.credentials);
}

export function useWebAuthnAvailability() {
  const [webApiReady, setWebApiReady] = useState(() => isWebAuthnApiAvailable());
  const [nativeReady, setNativeReady] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let intervalId = null;
    let timeoutId = null;

    const markWebReady = () => {
      if (cancelled || !isWebAuthnApiAvailable()) {
        return;
      }
      setWebApiReady(true);
      setTimedOut(false);
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };

    const markNativeReady = async () => {
      if (cancelled) {
        return;
      }
      const available = await isHubitPasskeyNativeAvailable();
      if (!available) {
        return;
      }
      setNativeReady(true);
      setTimedOut(false);
    };

    if (isWebAuthnApiAvailable()) {
      setWebApiReady(true);
    }

    markNativeReady();

    const onNativeReady = () => {
      markWebReady();
      markNativeReady();
    };

    window.addEventListener(WEBAUTHN_READY_EVENT, onNativeReady);

    const pollIntervalMs = usesNativeShellPolling() ? CAPACITOR_POLL_INTERVAL_MS : WEB_POLL_INTERVAL_MS;
    const pollTimeoutMs = usesNativeShellPolling() ? CAPACITOR_POLL_TIMEOUT_MS : WEB_POLL_TIMEOUT_MS;

    intervalId = window.setInterval(() => {
      markWebReady();
      markNativeReady();
    }, pollIntervalMs);

    timeoutId = window.setTimeout(() => {
      if (cancelled || isWebAuthnApiAvailable()) {
        return;
      }
      isHubitPasskeyNativeAvailable().then((nativeAvailable) => {
        if (!cancelled && !nativeAvailable) {
          setTimedOut(true);
        }
      });
    }, pollTimeoutMs);

    return () => {
      cancelled = true;
      window.removeEventListener(WEBAUTHN_READY_EVENT, onNativeReady);
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

  const webAuthnReady = webApiReady || nativeReady;

  return {
    webAuthnReady,
    webAuthnWebApiReady: webApiReady,
    webAuthnNativeReady: nativeReady,
    webAuthnTimedOut: timedOut && !nativeReady,
  };
}

export async function waitForWebAuthnApi({ delayMs = 500, maxWaitMs = 2500 } = {}) {
  if (isWebAuthnApiAvailable()) {
    return true;
  }
  if (await isHubitPasskeyNativeAvailable()) {
    return true;
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < maxWaitMs) {
    await new Promise((resolve) => {
      window.setTimeout(resolve, Math.min(delayMs, 250));
    });
    if (isWebAuthnApiAvailable()) {
      return true;
    }
    if (await isHubitPasskeyNativeAvailable()) {
      return true;
    }
  }

  return isWebAuthnApiAvailable() || await isHubitPasskeyNativeAvailable();
}
