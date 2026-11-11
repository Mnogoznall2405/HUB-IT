export const MOBILE_ATTACHMENT_HERO_ONLY_MAX = 2;
export const MOBILE_ATTACHMENT_COMPACT_FROM = 3;

export const shouldUseCompactAttachmentLayout = (count) => (
  Number(count || 0) >= MOBILE_ATTACHMENT_COMPACT_FROM
);

/** @deprecated use shouldUseCompactAttachmentLayout */
export const MOBILE_ATTACHMENT_HYBRID_FROM = MOBILE_ATTACHMENT_COMPACT_FROM;
/** @deprecated */
export const shouldUseHybridAttachmentLayout = shouldUseCompactAttachmentLayout;

export const buildAttachmentCountLabel = (count) => {
  const value = Number(count || 0);
  if (value === 1) return '1 вложение';
  if (value >= 2 && value <= 4) return `${value} вложения`;
  return `${value} вложений`;
};

export const buildAttachmentFilesLabel = (count) => {
  const value = Number(count || 0);
  if (value === 1) return '1 файл';
  if (value >= 2 && value <= 4) return `${value} файла`;
  return `${value} файлов`;
};

export const buildAttachmentSummaryLine = (count, totalSizeLabel = '') => {
  const parts = [buildAttachmentFilesLabel(count)];
  if (totalSizeLabel) parts.push(totalSizeLabel);
  return parts.join(', ');
};

export const getAttachmentExtensionBadge = (filename) => {
  const normalized = String(filename || '').trim();
  const match = normalized.match(/\.([a-z0-9]+)$/i);
  if (match) return String(match[1] || '').toUpperCase();
  return 'FILE';
};

/** @deprecated compact layout shows all attachments in one strip */
export const MOBILE_ATTACHMENT_STRIP_VISIBLE_MAX = 5;

/** @deprecated */
export const splitHybridAttachments = (attachments = []) => {
  const items = Array.isArray(attachments) ? attachments : [];
  return {
    heroAttachments: shouldUseCompactAttachmentLayout(items.length) ? [] : items,
    stripAttachments: shouldUseCompactAttachmentLayout(items.length) ? items : [],
    overflowCount: 0,
  };
};
