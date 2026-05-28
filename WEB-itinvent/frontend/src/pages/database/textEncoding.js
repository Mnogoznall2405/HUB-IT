const CP1251_DECODE_CHARS = [
  '\u0402', '\u0403', '\u201A', '\u0453', '\u201E', '\u2026', '\u2020', '\u2021',
  '\u20AC', '\u2030', '\u0409', '\u2039', '\u040A', '\u040C', '\u040B', '\u040F',
  '\u0452', '\u2018', '\u2019', '\u201C', '\u201D', '\u2022', '\u2013', '\u2014',
  '', '\u2122', '\u0459', '\u203A', '\u045A', '\u045C', '\u045B', '\u045F',
  '\u00A0', '\u040E', '\u045E', '\u0408', '\u00A4', '\u0490', '\u00A6', '\u00A7',
  '\u0401', '\u00A9', '\u0404', '\u00AB', '\u00AC', '\u00AD', '\u00AE', '\u0407',
  '\u00B0', '\u00B1', '\u0406', '\u0456', '\u0491', '\u00B5', '\u00B6', '\u00B7',
  '\u0451', '\u2116', '\u0454', '\u00BB', '\u0458', '\u0405', '\u0455', '\u0457',
];

const CP1251_ENCODE_MAP = new Map();
CP1251_DECODE_CHARS.forEach((char, index) => {
  if (char) CP1251_ENCODE_MAP.set(char, 0x80 + index);
});

for (let code = 0x0410; code <= 0x044F; code += 1) {
  CP1251_ENCODE_MAP.set(String.fromCharCode(code), 0xC0 + (code - 0x0410));
}

const looksLikeUtf8Mojibake = (value) => (
  /(?:\u0420[\u0400-\u045F\u00A0-\u00BF]|\u0421[\u0400-\u045F\u2018-\u203A]|\u0432[\u0400-\u045F\u2018-\u203A]|\u00D0.|\u00D1.)/.test(String(value || ''))
);

export const normalizeDatabaseText = (value) => {
  const raw = String(value ?? '');
  if (!raw || !looksLikeUtf8Mojibake(raw) || typeof TextDecoder === 'undefined') return raw;

  try {
    const bytes = [];
    for (const char of raw) {
      const code = char.charCodeAt(0);
      if (code <= 0x7F) {
        bytes.push(code);
        continue;
      }
      const mapped = CP1251_ENCODE_MAP.get(char);
      if (typeof mapped !== 'number') return raw;
      bytes.push(mapped);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return raw;
  }
};

const normalizeRecordTexts = (record) => {
  if (!record || typeof record !== 'object') return record;
  const normalized = { ...record };
  Object.entries(normalized).forEach(([key, value]) => {
    if (typeof value === 'string') {
      normalized[key] = normalizeDatabaseText(value);
    }
  });
  return normalized;
};

export const normalizeGroupedDatabaseData = (grouped) => {
  const result = {};
  Object.entries(grouped || {}).forEach(([branchName, locations]) => {
    const normalizedBranchName = normalizeDatabaseText(branchName);
    const nextLocations = {};
    Object.entries(locations || {}).forEach(([locationName, items]) => {
      const normalizedLocationName = normalizeDatabaseText(locationName);
      nextLocations[normalizedLocationName] = (items || []).map(normalizeRecordTexts);
    });
    result[normalizedBranchName] = nextLocations;
  });
  return result;
};
