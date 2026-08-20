export function pluralizeRu(count, one, few, many) {
  const numeric = Math.abs(Number(count));
  const value = Number.isFinite(numeric) ? Math.floor(numeric) : 0;
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function formatRuRecipientCount(count) {
  const numeric = Math.max(0, Math.floor(Number(count) || 0));
  return `${numeric} ${pluralizeRu(numeric, 'получатель', 'получателя', 'получателей')}`;
}

export function formatRuLetterCount(count) {
  const numeric = Math.max(0, Math.floor(Number(count) || 0));
  return `${numeric} ${pluralizeRu(numeric, 'письмо', 'письма', 'писем')}`;
}

export function formatRuThreadCount(count) {
  const numeric = Math.max(0, Math.floor(Number(count) || 0));
  return `${numeric} ${pluralizeRu(numeric, 'цепочка', 'цепочки', 'цепочек')}`;
}

export function formatMailFolderCountCaption({ total = 0, viewMode = 'messages', hasActiveFilters = false } = {}) {
  const numeric = Math.max(0, Math.floor(Number(total) || 0));
  if (hasActiveFilters) return `найдено ${numeric}`;
  if (viewMode === 'conversations') return formatRuThreadCount(numeric);
  return formatRuLetterCount(numeric);
}
