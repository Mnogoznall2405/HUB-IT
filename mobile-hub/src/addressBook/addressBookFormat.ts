export type AddressBookPhone = {
  kind?: string | null;
  value?: string | null;
  normalized?: string | null;
};

export type AddressBookEmail = {
  kind?: string | null;
  value?: string | null;
  normalized?: string | null;
};

export type AddressBookAbsence = {
  kind?: string | null;
  label?: string | null;
  starts_on?: string | null;
  returns_on?: string | null;
};

export type AddressBookEntry = {
  // Stable ZUP key present in snapshot/search payloads; used for favorites
  // and recents. Deliberately absent only for entries without a ZUP match.
  employee_code?: string | null;
  // Present on server-side dismissed-search rows (N5); never stored in the
  // local snapshot — dismissed employees are server-only.
  dismissal_date?: string | null;
  full_name?: string | null;
  department?: string | null;
  department_location?: string | null;
  office_address?: string | null;
  office_room?: string | null;
  workplace_number?: string | null;
  position?: string | null;
  age?: number | string | null;
  hire_date?: string | null;
  work_phones?: AddressBookPhone[];
  personal_phones?: AddressBookPhone[];
  work_emails?: AddressBookEmail[];
  personal_emails?: AddressBookEmail[];
  absence?: AddressBookAbsence | null;
};

export type PickedPhone = {
  value: string;
  digits: string;
  telHref: string;
  phone: AddressBookPhone;
};

export type PickedEmail = {
  value: string;
  email: AddressBookEmail;
};

export type AbsenceChipColor = 'error' | 'info' | 'warning' | 'default';

export const SEARCH_DEBOUNCE_MS = 300;
// N4: local filtering over the in-memory index needs a much shorter delay —
// the remote fallback search keeps the full SEARCH_DEBOUNCE_MS.
export const LOCAL_SEARCH_DEBOUNCE_MS = 110;
export const SEARCH_LIMIT = 50;

export function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

export function normalizePhoneDigits(value: unknown): string {
  const digits = normalizeText(value).replace(/\D+/g, '');
  if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`;
  if (digits.length === 10) return `7${digits}`;
  return digits;
}

export function escapeRegExp(value: unknown): string {
  return normalizeText(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeMailRecipient(value: unknown): string {
  const text = normalizeText(value);
  if (!text) return '';
  const match = text.match(/<([^>]+)>/);
  return String(match?.[1] || text).trim();
}

export function isValidEmailRecipient(value: unknown): boolean {
  return /^[^\s@]+@[^\s@]+$/.test(normalizeMailRecipient(value));
}

export function formatAge(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  const age = Number(value);
  if (!Number.isInteger(age) || age < 0 || age > 120) return '';

  const lastTwoDigits = age % 100;
  const lastDigit = age % 10;
  let unit = 'лет';
  if (lastTwoDigits < 11 || lastTwoDigits > 14) {
    if (lastDigit === 1) unit = 'год';
    if (lastDigit >= 2 && lastDigit <= 4) unit = 'года';
  }
  return `${age} ${unit}`;
}

export function formatDate(value: unknown): string {
  const text = normalizeText(value).slice(0, 10);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    parsed.getUTCFullYear() !== Number(year)
    || parsed.getUTCMonth() !== Number(month) - 1
    || parsed.getUTCDate() !== Number(day)
  ) return '';
  return `${day}.${month}.${year}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatDateTime(value: unknown): string {
  const text = normalizeText(value);
  if (!text) return 'нет данных';
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;
  return `${pad2(parsed.getDate())}.${pad2(parsed.getMonth() + 1)}.${parsed.getFullYear()} ${pad2(parsed.getHours())}:${pad2(parsed.getMinutes())}`;
}

function isMobileKind(kind: unknown): boolean {
  return /мобил|mobile|сотов/i.test(normalizeText(kind));
}

function pickFromPhones(phones: AddressBookPhone[] | null | undefined): PickedPhone | null {
  const items = Array.isArray(phones) ? phones : [];
  if (items.length === 0) return null;
  const mobile = items.find((phone) => isMobileKind(phone?.kind));
  const selected = mobile || items[0];
  const value = normalizeText(selected?.value);
  const digits = normalizeText(selected?.normalized) || normalizePhoneDigits(value);
  const telHref = digits ? `tel:+${digits}` : (value ? `tel:${value}` : '');
  return { value, digits, telHref, phone: selected };
}

export function pickPrimaryPhone(item: AddressBookEntry | null | undefined): PickedPhone | null {
  const work = pickFromPhones(item?.work_phones);
  if (work) return work;
  return pickFromPhones(item?.personal_phones);
}

export function pickQuickActionPhone(item: AddressBookEntry | null | undefined): PickedPhone | null {
  const personal = pickFromPhones(item?.personal_phones);
  if (personal) return personal;
  return pickFromPhones(item?.work_phones);
}

export function pickPrimaryEmail(item: AddressBookEntry | null | undefined): PickedEmail | null {
  const emails = Array.isArray(item?.work_emails) ? item.work_emails : [];
  if (emails.length === 0) return null;
  const value = normalizeText(emails[0]?.value);
  return value ? { value, email: emails[0] } : null;
}

function collectEmailValues(emails: AddressBookEmail[] | null | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  (Array.isArray(emails) ? emails : []).forEach((email) => {
    const value = normalizeText(email?.value).toLowerCase();
    if (!value || seen.has(value)) return;
    seen.add(value);
    result.push(value);
  });
  return result;
}

export function collectAddressBookChatLookup(item: AddressBookEntry | null | undefined): {
  fullName: string;
  emails: string[];
} {
  return {
    fullName: normalizeText(item?.full_name),
    emails: [
      ...collectEmailValues(item?.work_emails),
      ...collectEmailValues(item?.personal_emails),
    ],
  };
}

export function getEntryKey(item: AddressBookEntry | null | undefined, index = 0): string {
  return `${normalizeText(item?.full_name)}|${normalizeText(item?.department)}|${normalizeText(item?.position)}|${index}`;
}

export function getInitials(fullName: unknown): string {
  const parts = normalizeText(fullName).split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return '?';
}

export function buildEmployeeSubtitle(item: AddressBookEntry | null | undefined): string {
  const position = normalizeText(item?.position);
  const department = normalizeText(item?.department);
  if (position && department) return `${position} · ${department}`;
  return position || department || '';
}

export function buildWorkplaceLabel(item: AddressBookEntry | null | undefined): string {
  const officeRoom = normalizeText(item?.office_room);
  const workplaceNumber = normalizeText(item?.workplace_number);
  return [
    normalizeText(item?.office_address),
    officeRoom && officeRoom !== '0' ? `каб. ${officeRoom}` : '',
    workplaceNumber && workplaceNumber !== '0' ? `рм ${workplaceNumber}` : '',
  ].filter(Boolean).join(' · ');
}

function formatAbsenceDay(value: unknown): string {
  const text = normalizeText(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
  const parsed = new Date(`${text}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return '';
  return `${pad2(parsed.getDate())}.${pad2(parsed.getMonth() + 1)}`;
}

export function formatAbsenceLabel(absence: AddressBookAbsence | null | undefined): string {
  const label = normalizeText(absence?.label);
  if (!label) return '';
  const returns = formatAbsenceDay(absence?.returns_on);
  if (returns) return `${label} · выйдет ${returns}`;
  const starts = formatAbsenceDay(absence?.starts_on);
  if (starts) return `${label} · с ${starts}`;
  return label;
}

export function absenceChipColor(absence: AddressBookAbsence | null | undefined): AbsenceChipColor {
  const kind = normalizeText(absence?.kind).toLowerCase();
  if (kind === 'sick') return 'error';
  if (kind === 'trip') return 'info';
  if (kind === 'vacation') return 'warning';
  return 'default';
}

export function splitHighlightParts(value: unknown, query: unknown): Array<{ text: string; match: boolean }> {
  const text = normalizeText(value);
  const rawTerms = normalizeText(query).split(/\s+/).filter(Boolean);
  if (!text || rawTerms.length === 0) return text ? [{ text, match: false }] : [];

  // N4: no `new RegExp` per call — one lowercase pass with leftmost-first
  // term order, identical to the previous `(t1|t2|...)` split semantics.
  const lowered = text.toLowerCase();
  const terms = rawTerms.map((term) => term.toLowerCase());
  // A few chars change UTF-16 length under toLowerCase ('İ' → 'i̇'), which
  // would misalign match offsets — map normalized positions back then.
  let toSource: number[] | null = null;
  if (lowered.length !== text.length) {
    const map: number[] = [];
    for (let i = 0; i < text.length; i++) {
      const ch = text[i].toLowerCase();
      for (let k = 0; k < ch.length; k++) map.push(i);
    }
    if (map.length === lowered.length) toSource = map;
    else return [{ text, match: false }];
  }
  const parts: Array<{ text: string; match: boolean }> = [];
  let cursor = 0;
  let partStart = 0;
  while (cursor < lowered.length) {
    let matched = '';
    for (const term of terms) {
      if (term && lowered.startsWith(term, cursor)) { matched = term; break; }
    }
    if (!matched) { cursor += 1; continue; }
    const origStart = toSource ? toSource[cursor] : cursor;
    const origEnd = toSource ? toSource[cursor + matched.length - 1] + 1 : cursor + matched.length;
    if (origStart > partStart) parts.push({ text: text.slice(partStart, origStart), match: false });
    parts.push({ text: text.slice(origStart, origEnd), match: true });
    cursor += matched.length;
    partStart = origEnd;
  }
  if (partStart < text.length) parts.push({ text: text.slice(partStart), match: false });
  return parts;
}
