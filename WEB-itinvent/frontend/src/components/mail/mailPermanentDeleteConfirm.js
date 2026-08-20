export function buildMailPermanentDeleteConfirmMessage({ count = 1 } = {}) {
  const n = Math.max(1, Number(count) || 1);
  if (n > 1) {
    return `Удалить выбранные письма навсегда (${n})? Это действие нельзя отменить.`;
  }
  return 'Удалить это письмо навсегда? Это действие нельзя отменить.';
}

export function confirmMailPermanentDelete({ count = 1 } = {}) {
  if (typeof window === 'undefined' || typeof window.confirm !== 'function') {
    return false;
  }
  return Boolean(window.confirm(buildMailPermanentDeleteConfirmMessage({ count })));
}
