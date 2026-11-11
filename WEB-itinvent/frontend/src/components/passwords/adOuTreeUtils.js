export const DEFAULT_PASSWORD_EXPIRY_OU_LABEL = 'Users standart';

export function normalizeOuLabel(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function isDefaultPasswordExpiryOu(label) {
  return normalizeOuLabel(label) === normalizeOuLabel(DEFAULT_PASSWORD_EXPIRY_OU_LABEL);
}

export function findDefaultPasswordExpiryOu(items = []) {
  return (Array.isArray(items) ? items : []).find((item) => isDefaultPasswordExpiryOu(item?.label)) || null;
}
