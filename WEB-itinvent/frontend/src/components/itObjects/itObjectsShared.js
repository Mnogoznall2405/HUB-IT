export const SECTION_LABELS = {
  passwords: 'Пароли',
  computers: 'Компьютеры',
  inventory: 'Инвентарь',
};

export const SECTION_KEYS = Object.keys(SECTION_LABELS);

export const LEVEL_LABELS = {
  view: 'Просмотр',
  manage: 'Управление',
};

export const getItObjectsErrorMessage = (error, fallback) => {
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  return error?.message || fallback;
};

export const isItObjectsRequestCancelled = (error) => (
  error?.code === 'ERR_CANCELED'
  || error?.name === 'CanceledError'
  || error?.name === 'AbortError'
);

export const userOptionLabel = (option) => {
  if (!option) return '';
  const name = option.full_name || option.username || '';
  return option.job_title ? `${name} · ${option.job_title}` : name;
};
