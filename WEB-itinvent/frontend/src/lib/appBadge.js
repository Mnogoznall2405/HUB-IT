const MAX_APP_BADGE_VALUE = 999;

function normalizeBadgeValue(value) {
  const normalized = Math.trunc(Number(value || 0));
  if (!Number.isFinite(normalized) || normalized <= 0) return 0;
  return Math.min(normalized, MAX_APP_BADGE_VALUE);
}

export async function syncAppBadge(value) {
  if (typeof navigator === 'undefined') return false;
  const nextValue = normalizeBadgeValue(value);
  try {
    if (nextValue > 0 && typeof navigator.setAppBadge === 'function') {
      await navigator.setAppBadge(nextValue);
      return true;
    }
    if (nextValue === 0 && typeof navigator.clearAppBadge === 'function') {
      await navigator.clearAppBadge();
      return true;
    }
  } catch {
    return false;
  }
  return false;
}
