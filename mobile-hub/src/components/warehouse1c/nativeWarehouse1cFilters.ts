export type Warehouse1cMovementPeriod = 'all' | '30' | '90' | '365';

export const WAREHOUSE_1C_PERIOD_OPTIONS: { value: Warehouse1cMovementPeriod; label: string }[] = [
  { value: 'all', label: 'Весь период' },
  { value: '30', label: '30 дней' },
  { value: '90', label: '90 дней' },
  { value: '365', label: 'Год' },
];

export function movementPeriodDates(period: Warehouse1cMovementPeriod): { dateFrom: string; dateTo: string } {
  if (period === 'all') return { dateFrom: '', dateTo: '' };
  const days = Math.max(1, Number(period) || 30);
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  return { dateFrom: iso(from), dateTo: iso(to) };
}
