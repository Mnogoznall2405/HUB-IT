export const normalizeDbId = (value) => String(value ?? '').trim();

export const toNumberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export const toIdOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  return String(value).trim();
};

export const normalizeText = (value) => String(value ?? '').trim().toLowerCase();

export const readFirst = (data, keys, fallback = '') => {
  for (const key of keys) {
    const value = data?.[key];
    if (value !== undefined && value !== null) return value;
  }
  return fallback;
};

export const readQty = (item, fallback = 1) => {
  const raw = readFirst(item, ['QTY', 'qty'], fallback);
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};
