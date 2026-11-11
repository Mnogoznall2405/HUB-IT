// vCard 3.0 export for address-book entries.
// Built strictly from fields already present in the API response — no extra
// requests and no fields beyond what the caller was allowed to see.

const normalize = (value) => String(value || '').trim();

// vCard 3.0 (RFC 2426): escape backslash, semicolon, comma and newlines.
export const escapeVCardValue = (value) => (
  normalize(value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
);

const collectPhones = (item) => {
  const groups = [
    { type: 'WORK', list: item?.work_phones },
    { type: 'CELL', list: item?.personal_phones },
  ];
  const seen = new Set();
  const result = [];
  groups.forEach(({ type, list }) => {
    (Array.isArray(list) ? list : []).forEach((phone) => {
      const value = normalize(phone?.value);
      if (!value || seen.has(value.toLowerCase())) return;
      seen.add(value.toLowerCase());
      result.push(`TEL;TYPE=${type}:${escapeVCardValue(value)}`);
    });
  });
  return result;
};

const collectEmails = (item) => {
  const groups = [
    { type: 'WORK', list: item?.work_emails },
    { type: 'INTERNET', list: item?.personal_emails },
  ];
  const seen = new Set();
  const result = [];
  groups.forEach(({ type, list }) => {
    (Array.isArray(list) ? list : []).forEach((email) => {
      const value = normalize(email?.value);
      if (!value || seen.has(value.toLowerCase())) return;
      seen.add(value.toLowerCase());
      result.push(`EMAIL;TYPE=${type}:${escapeVCardValue(value)}`);
    });
  });
  return result;
};

// RFC 2426 §2.6: content lines SHOULD NOT exceed 75 octets; longer lines are
// folded with CRLF + single space. Octets matter — Cyrillic is multi-byte.
const VCARD_LINE_OCTETS = 75;
const utf8 = new TextEncoder();
const utf8Decode = new TextDecoder();

export const foldVCardLine = (line) => {
  const bytes = utf8.encode(line);
  if (bytes.length <= VCARD_LINE_OCTETS) return line;
  const parts = [];
  let start = 0;
  while (start < bytes.length) {
    // Continuation lines spend one octet on the leading space.
    const budget = parts.length === 0 ? VCARD_LINE_OCTETS : VCARD_LINE_OCTETS - 1;
    let end = Math.min(start + budget, bytes.length);
    // Never split inside a UTF-8 multi-byte sequence (0x80..0xBF tails).
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) {
      end -= 1;
    }
    parts.push(utf8Decode.decode(bytes.subarray(start, end)));
    start = end;
  }
  return parts.join('\r\n ');
};

export const buildVCard = (item) => {
  if (!item || typeof item !== 'object') return '';
  const fullName = normalize(item.full_name);
  if (!fullName) return '';
  const nameParts = fullName.split(/\s+/);

  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${escapeVCardValue(fullName)}`,
    // N:Family;Given;Middle;Prefix;Suffix
    `N:${escapeVCardValue(nameParts[0] || '')};${escapeVCardValue(nameParts[1] || '')};${escapeVCardValue(nameParts.slice(2).join(' '))};;`,
    `TITLE:${escapeVCardValue(item.position)}`,
    `ORG:${escapeVCardValue(item.department)}`,
    ...collectPhones(item),
    ...collectEmails(item),
  ];
  if (normalize(item.office_address)) {
    lines.push(`ADR;TYPE=WORK:;;${escapeVCardValue(item.office_address)};;;;`);
  }
  lines.push('END:VCARD');
  // RFC 2426 mandates CRLF line separators and 75-octet folding.
  return `${lines.map(foldVCardLine).join('\r\n')}\r\n`;
};

const sanitizeFileName = (value) => {
  const cleaned = normalize(value).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ');
  return cleaned || 'contact';
};

export const downloadVCard = (item) => {
  const content = buildVCard(item);
  if (!content) return false;
  const blob = new Blob([content], { type: 'text/vcard;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${sanitizeFileName(item?.full_name)}.vcf`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
  return true;
};
