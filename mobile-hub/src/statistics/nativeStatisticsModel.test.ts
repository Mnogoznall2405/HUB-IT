import {
  buildPcCleaningPayload,
  filterPcBranches,
  filterRemainingPcs,
  filterStatisticsLocations,
  formatLastCleanedAt,
  formatStatisticsTimestamp,
  isSameRemainingPc,
  remainingPcKey,
  statisticsCoverageTone,
} from './nativeStatisticsModel';
import type { PcCleaningBranchStat, StatisticsLocationRow } from '../api/statisticsApi';

const branch = (overrides: Partial<PcCleaningBranchStat> = {}): PcCleaningBranchStat => ({
  branch: 'Центральный',
  total_pc: 10,
  cleaned_pc: 8,
  remaining_pc: 2,
  coverage_percent: 80,
  cleanings_total: 20,
  cleanings_period: 8,
  remaining_pcs: [],
  ...overrides,
});

describe('statisticsCoverageTone', () => {
  it('maps percent to success/warning/error thresholds like the web page', () => {
    expect(statisticsCoverageTone(100)).toBe('success');
    expect(statisticsCoverageTone(80)).toBe('success');
    expect(statisticsCoverageTone(79.9)).toBe('warning');
    expect(statisticsCoverageTone(50)).toBe('warning');
    expect(statisticsCoverageTone(49.9)).toBe('error');
    expect(statisticsCoverageTone(0)).toBe('error');
  });
});

describe('filters', () => {
  it('filters branches by name case-insensitively', () => {
    const rows = [branch(), branch({ branch: 'Филиал Юг' })];
    expect(filterPcBranches(rows, 'юг')).toHaveLength(1);
    expect(filterPcBranches(rows, '')).toHaveLength(2);
    expect(filterPcBranches(rows, 'не существует')).toHaveLength(0);
    expect(filterPcBranches(null, 'x')).toEqual([]);
  });

  it('filters location rows by branch or location', () => {
    const rows: StatisticsLocationRow[] = [
      { branch: 'Центральный', location: 'Серверная', operations: 3, last_timestamp: '', top_items: [] },
      { branch: 'Юг', location: 'Каб. 5', operations: 1, last_timestamp: '', top_items: [] },
    ];
    expect(filterStatisticsLocations(rows, 'сервер')).toHaveLength(1);
    expect(filterStatisticsLocations(rows, 'юг')).toHaveLength(1);
    expect(filterStatisticsLocations(rows, '  ')).toHaveLength(2);
  });

  it('filters remaining PCs by inv/serial/location/employee', () => {
    const rows = [
      { inv_no: 'INV-1', serial_no: 'SN-1', hw_serial_no: '', location: 'Каб. 1', model_name: 'OptiPlex', employee: 'Иванов', last_cleaned_at: '', equipment_id: null, manufacturer: '', current_description: '' },
      { inv_no: 'INV-2', serial_no: 'SN-2', hw_serial_no: '', location: 'Каб. 2', model_name: 'ThinkCentre', employee: 'Петрова', last_cleaned_at: '', equipment_id: null, manufacturer: '', current_description: '' },
    ];
    expect(filterRemainingPcs(rows, 'иванов')).toHaveLength(1);
    expect(filterRemainingPcs(rows, 'sn-2')).toHaveLength(1);
    expect(filterRemainingPcs(rows, 'think')).toHaveLength(1);
    expect(filterRemainingPcs(rows, '')).toHaveLength(2);
  });
});

describe('remaining PC identity', () => {
  const row = { inv_no: 'INV-1', serial_no: 'SN-1', hw_serial_no: '', location: '', model_name: '', employee: '', last_cleaned_at: '', equipment_id: null, manufacturer: '', current_description: '' };

  it('matches by inv_no first, then serial', () => {
    expect(isSameRemainingPc(row, { ...row, serial_no: 'OTHER' })).toBe(true);
    expect(isSameRemainingPc({ ...row, inv_no: '' }, { ...row, inv_no: '' })).toBe(true);
    expect(isSameRemainingPc(row, { ...row, inv_no: 'INV-2' })).toBe(false);
  });

  it('builds a stable key', () => {
    expect(remainingPcKey(row)).toBe('INV-1|SN-1|0');
  });
});

describe('buildPcCleaningPayload', () => {
  it('builds a backend payload with optional fields and db name', () => {
    const { payload, error } = buildPcCleaningPayload({
      inv_no: 'INV-9', serial_no: 'SN-9', hw_serial_no: 'HW-9',
      location: 'Каб. 9', model_name: 'OptiPlex 7090', employee: 'Сидоров',
      last_cleaned_at: '', equipment_id: 42, manufacturer: 'Dell', current_description: 'Описание',
    }, { branch: 'Центральный', databaseId: 'ITINVENT' });
    expect(error).toBeUndefined();
    expect(payload).toEqual({
      serial_number: 'SN-9',
      employee: 'Сидоров',
      branch: 'Центральный',
      location: 'Каб. 9',
      inv_no: 'INV-9',
      db_name: 'ITINVENT',
      hw_serial_no: 'HW-9',
      model_name: 'OptiPlex 7090',
      manufacturer: 'Dell',
      current_description: 'Описание',
      equipment_id: 42,
    });
  });

  it('rejects rows without a serial number', () => {
    const result = buildPcCleaningPayload({ inv_no: 'INV-1' } as never, { branch: 'X' });
    expect(result.payload).toBeUndefined();
    expect(result.error).toContain('серийного номера');
  });

  it('rejects rows without a branch', () => {
    const result = buildPcCleaningPayload({ serial_no: 'SN-1' } as never, {});
    expect(result.error).toBe('Не указан филиал');
  });
});

describe('formatting', () => {
  it('formats timestamps and last-cleaned dates', () => {
    expect(formatStatisticsTimestamp('')).toBe('—');
    expect(formatStatisticsTimestamp('not-a-date')).toBe('not-a-date');
    expect(formatLastCleanedAt('')).toBe('Не чистили');
    expect(formatLastCleanedAt('2026-01-01T10:00:00Z')).not.toBe('Не чистили');
  });
});
