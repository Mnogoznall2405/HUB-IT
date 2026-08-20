export function ruPlural(count, one, few, many) {
  const numeric = Math.abs(Number(count) || 0);
  const mod10 = numeric % 10;
  const mod100 = numeric % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function formatRuCount(count, one, few, many) {
  const numeric = Number(count) || 0;
  return `${numeric} ${ruPlural(numeric, one, few, many)}`;
}
