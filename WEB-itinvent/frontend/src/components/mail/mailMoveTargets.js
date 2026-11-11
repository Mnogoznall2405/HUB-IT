const HIDDEN_MOVE_KEYS = new Set([
  'outbox',
  'rss',
  'journal',
  'conversationhistory',
  'conversations',
  'syncissues',
  'conflicts',
  'localfailures',
  'serverfailures',
]);

const HIDDEN_MOVE_LABELS = new Set([
  'rss',
  'rss-каналы',
  'rss каналы',
  'rss feeds',
  'журнал бесед',
  'conversation history',
  'исходящие',
  'outbox',
  'конфликты',
  'conflicts',
  'локальные ошибки',
  'local failures',
  'ошибки синхронизации',
  'sync issues',
  'сбои сервера',
  'server failures',
]);

export function normalizeMailFolderLabel(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ');
}

export function isUsefulMailMoveTarget(option) {
  const id = String(option?.value || option?.id || '').trim().toLowerCase();
  const wellKnown = String(option?.well_known_key || '').trim().toLowerCase();
  const iconKey = String(option?.icon_key || '').trim().toLowerCase();
  const label = normalizeMailFolderLabel(option?.label || option?.name || '');
  if (HIDDEN_MOVE_KEYS.has(id) || HIDDEN_MOVE_KEYS.has(wellKnown) || HIDDEN_MOVE_KEYS.has(iconKey)) {
    return false;
  }
  if (label && HIDDEN_MOVE_LABELS.has(label)) {
    return false;
  }
  return true;
}

export function filterMailMoveTargets(targets, currentFolder = '') {
  const current = String(currentFolder || '').trim();
  return (Array.isArray(targets) ? targets : []).filter((option) => {
    const value = String(option?.value || option?.id || '').trim();
    if (!value || (current && value === current)) return false;
    return isUsefulMailMoveTarget(option);
  });
}

export function serializeMailMoveTargets(folderItems, currentFolder = '') {
  return filterMailMoveTargets(
    (Array.isArray(folderItems) ? folderItems : []).map((item) => ({
      value: String(item?.id || item?.value || ''),
      label: String(item?.label || item?.name || item?.id || item?.value || ''),
      icon_key: item?.icon_key,
      well_known_key: item?.well_known_key,
    })),
    currentFolder,
  );
}
