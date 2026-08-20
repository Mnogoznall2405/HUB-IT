export const MAIL_ATTACHMENTS_EXPANDED_STORAGE_KEY = 'hubit.mail.attachmentsExpanded';

export function readMailAttachmentsExpandedPreference(fallback = true, storage) {
  const store = storage || (typeof sessionStorage === 'undefined' ? null : sessionStorage);
  if (!store?.getItem) return Boolean(fallback);
  try {
    const raw = store.getItem(MAIL_ATTACHMENTS_EXPANDED_STORAGE_KEY);
    if (raw === '1') return true;
    if (raw === '0') return false;
  } catch {
    return Boolean(fallback);
  }
  return Boolean(fallback);
}

export function writeMailAttachmentsExpandedPreference(expanded, storage) {
  const store = storage || (typeof sessionStorage === 'undefined' ? null : sessionStorage);
  if (!store?.setItem) return;
  try {
    store.setItem(MAIL_ATTACHMENTS_EXPANDED_STORAGE_KEY, expanded ? '1' : '0');
  } catch {
    // Ignore quota / private-mode failures.
  }
}
