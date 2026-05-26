import { useEffect, useState } from 'react';

export const WEBAUTHN_READY_EVENT = 'hubit:webauthn-ready';

const WEB_POLL_INTERVAL_MS = 50;
const WEB_POLL_TIMEOUT_MS = 500;

export function isCapacitorNativeRuntime() {
  return false;
}

export function isWebAuthnApiAvailable() {
  if (typeof window === 'undefined') {
    return false;
  }
  return Boolean(window.PublicKeyCredential && navigator.credentials);
}

export function useWebAuthnAvailability() {
  const [webApiReady, setWebApiReady] = useState(() => isWebAuthnApiAvailable());
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

    if (isWebAuthnApiAvailable()) {
      setWebApiReady(true);
    }

    const onWebAuthnReady = () => {
      markWebReady();
    };

    window.addEventListener(WEBAUTHN_READY_EVENT, onWebAuthnReady);

    intervalId = window.setInterval(markWebReady, WEB_POLL_INTERVAL_MS);

    timeoutId = window.setTimeout(() => {
      if (!cancelled && !isWebAuthnApiAvailable()) {
        setTimedOut(true);
      }
    }, WEB_POLL_TIMEOUT_MS);

    return () => {
      cancelled = true;
      window.removeEventListener(WEBAUTHN_READY_EVENT, onWebAuthnReady);
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

  return {
    webAuthnReady: webApiReady,
    webAuthnWebApiReady: webApiReady,
    webAuthnNativeReady: false,
    webAuthnTimedOut: timedOut && !webApiReady,
  };
}

export async function waitForWebAuthnApi({ delayMs = 500, maxWaitMs = 2500 } = {}) {
  if (isWebAuthnApiAvailable()) {
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
  }

  return isWebAuthnApiAvailable();
}
