import { stashChatComposePrefill } from './chatComposePrefill';
import { stashMailComposePrefill } from './mailComposePrefill';
import { isPhoneDeepLinkReady, normalizePhoneDigits } from './messengerLinks';

const normalizeText = (value) => String(value || '').trim();

const formatShareExpiresAt = (expiresAt) => {
  const parsed = new Date(expiresAt);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const buildMyFilesShareMessage = ({
  fileName = '',
  url = '',
  expiresAt = null,
} = {}) => {
  const safeName = normalizeText(fileName) || 'файл';
  const safeUrl = normalizeText(url);
  const lines = [
    `Делюсь с вами файлом ${safeName}.`,
    '',
    'Ссылка для скачивания:',
    safeUrl,
  ];
  const expiresLabel = formatShareExpiresAt(expiresAt);
  if (expiresLabel) {
    lines.push('', `Ссылка действует до ${expiresLabel}.`);
  }
  return lines.join('\n');
};

export const buildMyFilesShareMailSubject = (fileName = '') => {
  const safeName = normalizeText(fileName) || 'файл';
  return `Файл для вас: ${safeName}`;
};

export const openMailCompose = ({
  navigate,
  fileName = '',
  url = '',
  expiresAt = null,
}) => {
  if (typeof navigate !== 'function') return;
  stashMailComposePrefill({
    to: [],
    subject: buildMyFilesShareMailSubject(fileName),
    bodyPlain: buildMyFilesShareMessage({ fileName, url, expiresAt }),
  });
  navigate('/mail?folder=inbox&compose=prefill');
};

export const openCorporateChat = ({
  navigate,
  peerUserId = 0,
  fileName = '',
  url = '',
  expiresAt = null,
}) => {
  if (typeof navigate !== 'function') return;
  const normalizedPeerId = Number(peerUserId || 0);
  if (!Number.isFinite(normalizedPeerId) || normalizedPeerId <= 0) return;
  stashChatComposePrefill({
    peerUserId: normalizedPeerId,
    bodyText: buildMyFilesShareMessage({ fileName, url, expiresAt }),
  });
  navigate('/chat?compose=prefill');
};

export const formatChatDirectoryUserLabel = (user) => {
  if (!user || typeof user !== 'object') return '';
  const fullName = normalizeText(user.full_name);
  const username = normalizeText(user.username);
  if (fullName && username) return `${fullName} · @${username}`;
  return fullName || username || 'Без имени';
};

/** @deprecated use openMailCompose */
export const openHubMailCompose = openMailCompose;

const pushPhoneOption = (bucket, seen, phone, scopeLabel) => {
  const rawValue = normalizeText(phone?.value);
  const digits = normalizePhoneDigits(phone?.normalized || rawValue);
  if (!isPhoneDeepLinkReady(digits) || seen.has(digits)) return;
  seen.add(digits);
  const kind = normalizeText(phone?.kind);
  const scopeTitles = { work: 'Рабочий', personal: 'Личный' };
  const labelParts = [
    scopeTitles[scopeLabel] || scopeLabel,
    kind,
    rawValue || `+${digits}`,
  ].filter(Boolean);
  bucket.push({
    id: `${scopeLabel}:${digits}:${kind}`,
    digits,
    label: labelParts.join(' · '),
  });
};

export const listAddressBookPhones = (item) => {
  if (!item || typeof item !== 'object') return [];
  const bucket = [];
  const seen = new Set();
  (Array.isArray(item.work_phones) ? item.work_phones : []).forEach((phone) => {
    pushPhoneOption(bucket, seen, phone, 'work');
  });
  (Array.isArray(item.personal_phones) ? item.personal_phones : []).forEach((phone) => {
    pushPhoneOption(bucket, seen, phone, 'personal');
  });
  return bucket;
};

export const pickAddressBookPhone = (item) => {
  const phones = listAddressBookPhones(item);
  return phones[0]?.digits || '';
};


export const formatAddressBookOptionLabel = (item) => {
  if (!item || typeof item !== 'object') return '';
  const name = normalizeText(item.full_name) || 'Без имени';
  const department = normalizeText(item.department);
  return department ? `${name} · ${department}` : name;
};
