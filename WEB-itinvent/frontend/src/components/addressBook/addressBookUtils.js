export { hideScrollbarSx } from '../../lib/hideScrollbarSx';

export const normalizeText = (value) => String(value || '').trim();

export const normalizePhoneDigits = (value) => {
  const digits = normalizeText(value).replace(/\D+/g, '');
  if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`;
  if (digits.length === 10) return `7${digits}`;
  return digits;
};

export const escapeRegExp = (value) => normalizeText(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const formatDateTime = (value) => {
  const text = normalizeText(value);
  if (!text) return 'нет данных';
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;
  return parsed.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const isMobileKind = (kind) => /мобил|mobile|сотов/i.test(normalizeText(kind));

const pickFromPhones = (phones) => {
  const items = Array.isArray(phones) ? phones : [];
  if (items.length === 0) return null;
  const mobile = items.find((phone) => isMobileKind(phone?.kind));
  const selected = mobile || items[0];
  const value = normalizeText(selected?.value);
  const digits = normalizeText(selected?.normalized) || normalizePhoneDigits(value);
  const telHref = digits ? `tel:+${digits}` : (value ? `tel:${value}` : '');
  return { value, digits, telHref, phone: selected };
};

export const pickPrimaryPhone = (item) => {
  const work = pickFromPhones(item?.work_phones);
  if (work) return work;
  return pickFromPhones(item?.personal_phones);
};

/** Quick actions in list row: personal mobile → any personal → work fallback */
export const pickQuickActionPhone = (item) => {
  const personal = pickFromPhones(item?.personal_phones);
  if (personal) return personal;
  return pickFromPhones(item?.work_phones);
};

export const pickPrimaryEmail = (item) => {
  const emails = Array.isArray(item?.work_emails) ? item.work_emails : [];
  if (emails.length === 0) return null;
  const value = normalizeText(emails[0]?.value);
  return value ? { value, email: emails[0] } : null;
};

const collectEmailValues = (emails) => {
  const seen = new Set();
  const result = [];
  (Array.isArray(emails) ? emails : []).forEach((email) => {
    const value = normalizeText(email?.value).toLowerCase();
    if (!value || seen.has(value)) return;
    seen.add(value);
    result.push(value);
  });
  return result;
};

/** Lookup hints for matching address-book entry to HUB chat user */
export const collectAddressBookChatLookup = (item) => ({
  fullName: normalizeText(item?.full_name),
  emails: [
    ...collectEmailValues(item?.work_emails),
    ...collectEmailValues(item?.personal_emails),
  ],
});

export const getEntryKey = (item, index = 0) => (
  `${normalizeText(item?.full_name)}|${normalizeText(item?.department)}|${normalizeText(item?.position)}|${index}`
);

export const getInitials = (fullName) => {
  const parts = normalizeText(fullName).split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return '?';
};

export const buildEmployeeSubtitle = (item) => {
  const position = normalizeText(item?.position);
  const department = normalizeText(item?.department);
  if (position && department) return `${position} · ${department}`;
  return position || department || '';
};
