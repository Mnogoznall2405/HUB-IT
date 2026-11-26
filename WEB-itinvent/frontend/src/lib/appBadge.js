const MAX_APP_BADGE_VALUE = 999;

function normalizeBadgeValue(value) {
  const normalized = Math.trunc(Number(value || 0));
  if (!Number.isFinite(normalized) || normalized <= 0) return 0;
  return Math.min(normalized, MAX_APP_BADGE_VALUE);
}

async function postBadgeToServiceWorker(value) {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  // chrome-headless-shell (Playwright/Selenium) exposes navigator.setAppBadge
  // in the SW scope WITHOUT a BadgeService mojo binder — the call is a fatal
  // IPC that kills the whole renderer process, not a catchable JS error.
  // navigator.webdriver marks exactly those automation environments; the
  // page-scope badge call above stays safe and is kept.
  if (navigator.webdriver) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const target = registration?.active || registration?.waiting || navigator.serviceWorker.controller;
    target?.postMessage?.({
      type: 'itinvent:sync-app-badge',
      count: normalizeBadgeValue(value),
    });
  } catch {
    // Ignore SW sync failures; direct Badging API may still succeed.
  }
}

export async function syncAppBadge(value) {
  if (typeof navigator === 'undefined') return false;
  const nextValue = normalizeBadgeValue(value);
  let synced = false;
  try {
    if (nextValue > 0 && typeof navigator.setAppBadge === 'function') {
      await navigator.setAppBadge(nextValue);
      synced = true;
    } else if (nextValue === 0 && typeof navigator.clearAppBadge === 'function') {
      await navigator.clearAppBadge();
      synced = true;
    }
  } catch {
    synced = false;
  }
  await postBadgeToServiceWorker(nextValue);
  return synced;
}
