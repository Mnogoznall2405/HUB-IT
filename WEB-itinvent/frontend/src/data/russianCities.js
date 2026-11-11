/** @deprecated Use ticketsAPI.searchSettlements — kept for tests/compat helpers. */

export const normalizeCitySearch = (value) => (
  String(value || '')
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
);

export const settlementOptionLabel = (option) => {
  if (!option) return '';
  if (typeof option === 'string') return option;
  return option.name || '';
};

export const settlementOptionSecondary = (option) => {
  if (!option || typeof option === 'string') return '';
  return [option.type_label, option.region].filter(Boolean).join(' · ');
};

/** Полная строка для поля маршрута: «Эльбан, рабочий посёлок, Хабаровский край». */
export const formatSettlementRoute = (option) => {
  if (!option) return '';
  if (typeof option === 'string') return option.trim();
  const name = String(option.name || '').trim();
  if (!name) return '';
  const details = [option.type_label, option.region]
    .map((part) => String(part || '').trim())
    .filter(Boolean);
  return details.length ? `${name}, ${details.join(', ')}` : name;
};

export default {
  normalizeCitySearch,
  settlementOptionLabel,
  settlementOptionSecondary,
  formatSettlementRoute,
};
