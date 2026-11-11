// Human title for a meeting base name: "j<id>_2026-09-25_Планерка_Магадан" ->
// { title: "Планерка Магадан", date: "2026-09-25", dateLabel: "25 сентября 2026" }.

const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];
const WEEKDAYS_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

const isValidDate = (y, m, d) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

export function stripJobPrefix(base) {
  return String(base || '').replace(/^j[0-9a-f]{12}_/, '');
}

export function parseMeetingTitle(base) {
  let rest = stripJobPrefix(base);
  let date = null;
  const patterns = [
    [/(?:^|[_\s-])(20\d{2})[-._](\d{1,2})[-._](\d{1,2})(?=$|[_\s-])/, (m) => [m[1], m[2], m[3]]],
    [/(?:^|[_\s-])(\d{1,2})[-._](\d{1,2})[-._](20\d{2})(?=$|[_\s-])/, (m) => [m[3], m[2], m[1]]],
  ];
  for (const [re, pick] of patterns) {
    const m = re.exec(rest);
    if (!m) continue;
    const [y, mo, d] = pick(m).map(Number);
    if (!isValidDate(y, mo, d)) continue;
    date = iso(y, mo, d);
    rest = (rest.slice(0, m.index) + rest.slice(m.index + m[0].length)).trim();
    break;
  }
  const title = rest
    .replace(/[_]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-–—.]+|[\s\-–—.]+$/g, '')
    .trim();
  return {
    title: title || (date ? 'Встреча' : stripJobPrefix(base)),
    date,
    dateLabel: date ? formatMeetingDate(date) : '',
  };
}

export function formatMeetingDate(isoDate, { weekday = false } = {}) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || ''));
  if (!m) return '';
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const label = `${d} ${MONTHS[mo - 1]} ${y}`;
  if (!weekday) return label;
  const wd = WEEKDAYS_SHORT[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
  return `${wd}, ${label}`;
}
