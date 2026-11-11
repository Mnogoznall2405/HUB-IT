/** Word form for a Russian count: one, few, many (fractions use few). */
export function russianPlural(count: number, forms: readonly [string, string, string]): string {
  const value = Math.abs(count);
  if (!Number.isFinite(value)) return forms[2];
  if (!Number.isInteger(value)) return forms[1];
  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return forms[2];
  const last = value % 10;
  return last === 1 ? forms[0] : last >= 2 && last <= 4 ? forms[1] : forms[2];
}
