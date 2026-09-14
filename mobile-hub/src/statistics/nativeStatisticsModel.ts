import type {
  PcCleaningBranchStat,
  PcCleaningRecordPayload,
  PcCleaningRemainingPc,
  StatisticsLocationRow,
  StatisticsTab,
} from '../api/statisticsApi';

export const STATISTICS_PERIOD_OPTIONS = [
  { value: 30, label: '30 дней' },
  { value: 90, label: '90 дней' },
  { value: 180, label: '180 дней' },
  { value: 365, label: '365 дней' },
] as const;

export const STATISTICS_TAB_OPTIONS: Array<{ value: StatisticsTab; label: string; title: string }> = [
  { value: 'pc', label: 'Чистка ПК', title: 'Статистика чистки ПК' },
  { value: 'mfu', label: 'МФУ', title: 'Статистика обслуживания МФУ' },
  { value: 'battery', label: 'Батареи', title: 'Статистика замены батарей ИБП' },
  { value: 'pc_components', label: 'Комплектующие', title: 'Статистика комплектующих ПК' },
];

export function statisticsTabTitle(tab: StatisticsTab): string {
  return STATISTICS_TAB_OPTIONS.find((option) => option.value === tab)?.title || 'Статистика';
}

/** Relative label for a timestamp: today → time, recent → days/weeks, else date. */
export function formatStatisticsTimestamp(value: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const diffDays = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (diffDays <= 0) return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Вчера';
  if (diffDays < 7) return `${diffDays} дн. назад`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} нед. назад`;
  return date.toLocaleDateString('ru-RU');
}

export function formatStatisticsFullTimestamp(value: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ru-RU');
}

export function formatLastCleanedAt(value: string): string {
  if (!value) return 'Не чистили';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ru-RU');
}

export type StatisticsCoverageTone = 'success' | 'warning' | 'error';

export function statisticsCoverageTone(percent: number): StatisticsCoverageTone {
  if (percent >= 80) return 'success';
  if (percent >= 50) return 'warning';
  return 'error';
}

export function filterPcBranches(
  branches: PcCleaningBranchStat[] | null | undefined,
  query: string,
): PcCleaningBranchStat[] {
  const list = Array.isArray(branches) ? branches : [];
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return list;
  return list.filter((row) => String(row.branch || '').toLowerCase().includes(needle));
}

export function filterStatisticsLocations(
  rows: StatisticsLocationRow[] | null | undefined,
  query: string,
): StatisticsLocationRow[] {
  const list = Array.isArray(rows) ? rows : [];
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return list;
  return list.filter((row) => (
    String(row.branch || '').toLowerCase().includes(needle)
    || String(row.location || '').toLowerCase().includes(needle)
  ));
}

export function filterRemainingPcs(
  items: PcCleaningRemainingPc[] | null | undefined,
  query: string,
): PcCleaningRemainingPc[] {
  const list = Array.isArray(items) ? items : [];
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return list;
  return list.filter((row) => [
    row.inv_no,
    row.serial_no,
    row.hw_serial_no,
    row.location,
    row.model_name,
    row.employee,
  ].join(' ').toLowerCase().includes(needle));
}

export function remainingPcKey(row: PcCleaningRemainingPc, index = 0): string {
  return `${String(row?.inv_no || '').trim()}|${String(row?.serial_no || row?.hw_serial_no || '').trim()}|${index}`;
}

export function isSameRemainingPc(
  left: PcCleaningRemainingPc | null | undefined,
  right: PcCleaningRemainingPc | null | undefined,
): boolean {
  const leftInv = String(left?.inv_no || '').trim();
  const rightInv = String(right?.inv_no || '').trim();
  if (leftInv && rightInv) return leftInv === rightInv;
  return String(left?.serial_no || left?.hw_serial_no || '').trim()
    === String(right?.serial_no || right?.hw_serial_no || '').trim();
}

export function buildPcCleaningPayload(
  row: PcCleaningRemainingPc | null | undefined,
  options: { branch?: string; databaseId?: string } = {},
): { payload?: PcCleaningRecordPayload; error?: string } {
  const serialNumber = String(row?.serial_no || row?.hw_serial_no || '').trim();
  const branch = String(options.branch || '').trim();
  const location = String(row?.location || '').trim() || 'Не указано';
  if (!serialNumber) return { error: 'У ПК нет серийного номера — чистку поставить нельзя' };
  if (!branch) return { error: 'Не указан филиал' };

  const payload: PcCleaningRecordPayload = {
    serial_number: serialNumber,
    employee: String(row?.employee || '').trim() || 'Не указан',
    branch,
    location,
    inv_no: String(row?.inv_no || '').trim() || undefined,
    db_name: String(options.databaseId || '').trim() || undefined,
    hw_serial_no: String(row?.hw_serial_no || '').trim() || undefined,
    model_name: String(row?.model_name || '').trim() || undefined,
    manufacturer: String(row?.manufacturer || '').trim() || undefined,
    current_description: String(row?.current_description || '').trim() || undefined,
  };
  if (row?.equipment_id && row.equipment_id > 0) payload.equipment_id = row.equipment_id;
  return { payload };
}
