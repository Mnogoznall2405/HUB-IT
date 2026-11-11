import apiClient from './client';
import { API_V1_BASE } from './config';

export type StatisticsTab = 'pc' | 'mfu' | 'battery' | 'pc_components';

export type PcCleaningRemainingPc = {
  inv_no: string;
  serial_no: string;
  hw_serial_no: string;
  location: string;
  model_name: string;
  employee: string;
  last_cleaned_at: string;
  equipment_id: number | null;
  manufacturer: string;
  current_description: string;
};

export type PcCleaningBranchStat = {
  branch: string;
  total_pc: number;
  cleaned_pc: number;
  remaining_pc: number;
  coverage_percent: number;
  cleanings_total: number;
  cleanings_period: number;
  remaining_pcs: PcCleaningRemainingPc[];
};

export type PcCleaningStatistics = {
  period_days: number;
  start_date: string;
  end_date: string;
  totals: {
    total_pc: number;
    cleaned_pc: number;
    remaining_pc: number;
    coverage_percent: number;
    cleanings_total: number;
    cleanings_period: number;
  };
  branches: PcCleaningBranchStat[];
};

export type PcCleaningRemaining = {
  branch: string;
  period_days: number;
  start_date: string;
  end_date: string;
  total_pc: number;
  remaining_pc: number;
  remaining_pcs: PcCleaningRemainingPc[];
};

export type StatisticsLocationRow = {
  branch: string;
  location: string;
  operations: number;
  last_timestamp: string;
  top_items: Array<{ name: string; count: number }>;
};

export type MfuStatistics = {
  period_days: number;
  start_date: string;
  end_date: string;
  totals: { total_operations: number; unique_branches: number; unique_locations: number };
  by_type_period: Record<string, number>;
  by_item_period: Record<string, number>;
  by_branch_period: Record<string, number>;
  by_model_period: Array<{ model: string; count: number }>;
  by_location_period: StatisticsLocationRow[];
  recent_replacements: Array<{
    timestamp: string;
    branch: string;
    location: string;
    printer_model: string;
    component_type: string;
    replacement_item: string;
    inv_no?: string;
    serial_no?: string;
  }>;
};

export type BatteryStatistics = {
  period_days: number;
  start_date: string;
  end_date: string;
  totals: { total_operations: number; unique_branches: number; unique_locations: number };
  by_branch_period: Record<string, number>;
  by_model_period: Array<{ model: string; count: number }>;
  by_manufacturer_period: Record<string, number>;
  by_item_period: Record<string, number>;
  by_location_period: StatisticsLocationRow[];
  recent_replacements: Array<{
    timestamp: string;
    branch: string;
    location: string;
    model_name: string;
    manufacturer: string;
    replacement_item: string;
    inv_no?: string;
    serial_no?: string;
  }>;
};

export type PcComponentsStatistics = {
  period_days: number;
  start_date: string;
  end_date: string;
  totals: { total_operations: number; unique_branches: number; unique_locations: number };
  by_component_period: Record<string, number>;
  by_item_period: Record<string, number>;
  by_branch_period: Record<string, number>;
  by_model_period: Array<{ model: string; count: number }>;
  by_location_period: StatisticsLocationRow[];
  recent_replacements: Array<{
    timestamp: string;
    branch: string;
    location: string;
    model_name: string;
    manufacturer: string;
    component_name: string;
    replacement_item: string;
    inv_no?: string;
    serial_no?: string;
  }>;
};

export type StatisticsPayload =
  | { tab: 'pc'; data: PcCleaningStatistics }
  | { tab: 'mfu'; data: MfuStatistics }
  | { tab: 'battery'; data: BatteryStatistics }
  | { tab: 'pc_components'; data: PcComponentsStatistics };

export type PcCleaningRecordPayload = {
  serial_number: string;
  employee: string;
  branch: string;
  location: string;
  inv_no?: string;
  db_name?: string;
  hw_serial_no?: string;
  model_name?: string;
  manufacturer?: string;
  current_description?: string;
  equipment_id?: number;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asText(value: unknown): string {
  return String(value ?? '').trim();
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asCountMap(value: unknown): Record<string, number> {
  const row = asRecord(value);
  const result: Record<string, number> = {};
  for (const [key, count] of Object.entries(row)) {
    const normalized = asText(key) || 'Не указано';
    result[normalized] = asNumber(count);
  }
  return result;
}

function asModelList(value: unknown): Array<{ model: string; count: number }> {
  if (Array.isArray(value)) {
    return value.map((item) => {
      const row = asRecord(item);
      return { model: asText(row.model) || 'Не указано', count: asNumber(row.count) };
    }).filter((item) => item.model || item.count);
  }
  return Object.entries(asCountMap(value)).map(([model, count]) => ({ model, count }));
}

function asTopItems(value: unknown): Array<{ name: string; count: number }> {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = asRecord(item);
    return { name: asText(row.name) || '—', count: asNumber(row.count) };
  }).filter((item) => item.name || item.count);
}

function asLocationRows(value: unknown): StatisticsLocationRow[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = asRecord(item);
    return {
      branch: asText(row.branch) || 'Не указано',
      location: asText(row.location) || '—',
      operations: asNumber(row.operations),
      last_timestamp: asText(row.last_timestamp),
      top_items: asTopItems(row.top_items),
    };
  });
}

function asRemainingPc(value: unknown): PcCleaningRemainingPc {
  const row = asRecord(value);
  const equipmentId = asNumber(row.equipment_id, NaN);
  return {
    inv_no: asText(row.inv_no),
    serial_no: asText(row.serial_no),
    hw_serial_no: asText(row.hw_serial_no),
    location: asText(row.location),
    model_name: asText(row.model_name),
    employee: asText(row.employee),
    last_cleaned_at: asText(row.last_cleaned_at),
    equipment_id: Number.isFinite(equipmentId) && equipmentId > 0 ? equipmentId : null,
    manufacturer: asText(row.manufacturer),
    current_description: asText(row.current_description),
  };
}

function asRemainingList(value: unknown): PcCleaningRemainingPc[] {
  return Array.isArray(value) ? value.map(asRemainingPc) : [];
}

function periodWindow(source: Record<string, unknown>) {
  return {
    period_days: asNumber(source.period_days),
    start_date: asText(source.start_date),
    end_date: asText(source.end_date),
  };
}

function normalizePcCleaningStatistics(value: unknown): PcCleaningStatistics {
  const source = asRecord(value);
  const totals = asRecord(source.totals);
  return {
    ...periodWindow(source),
    totals: {
      total_pc: asNumber(totals.total_pc),
      cleaned_pc: asNumber(totals.cleaned_pc),
      remaining_pc: asNumber(totals.remaining_pc),
      coverage_percent: asNumber(totals.coverage_percent),
      cleanings_total: asNumber(totals.cleanings_total),
      cleanings_period: asNumber(totals.cleanings_period),
    },
    branches: Array.isArray(source.branches) ? source.branches.map((item) => {
      const row = asRecord(item);
      return {
        branch: asText(row.branch) || 'Не указано',
        total_pc: asNumber(row.total_pc),
        cleaned_pc: asNumber(row.cleaned_pc),
        remaining_pc: asNumber(row.remaining_pc),
        coverage_percent: asNumber(row.coverage_percent),
        cleanings_total: asNumber(row.cleanings_total),
        cleanings_period: asNumber(row.cleanings_period),
        remaining_pcs: asRemainingList(row.remaining_pcs),
      };
    }) : [],
  };
}

function normalizePcCleaningRemaining(value: unknown): PcCleaningRemaining {
  const source = asRecord(value);
  return {
    ...periodWindow(source),
    branch: asText(source.branch),
    total_pc: asNumber(source.total_pc),
    remaining_pc: asNumber(source.remaining_pc),
    remaining_pcs: asRemainingList(source.remaining_pcs),
  };
}

function normalizeSharedTotals(value: unknown) {
  const totals = asRecord(value);
  return {
    total_operations: asNumber(totals.total_operations),
    unique_branches: asNumber(totals.unique_branches),
    unique_locations: asNumber(totals.unique_locations),
  };
}

function normalizeMfuStatistics(value: unknown): MfuStatistics {
  const source = asRecord(value);
  return {
    ...periodWindow(source),
    totals: normalizeSharedTotals(source.totals),
    by_type_period: asCountMap(source.by_type_period),
    by_item_period: asCountMap(source.by_item_period),
    by_branch_period: asCountMap(source.by_branch_period),
    by_model_period: asModelList(source.by_model_period),
    by_location_period: asLocationRows(source.by_location_period),
    recent_replacements: Array.isArray(source.recent_replacements)
      ? source.recent_replacements.map((item) => {
        const row = asRecord(item);
        return {
          timestamp: asText(row.timestamp),
          branch: asText(row.branch),
          location: asText(row.location),
          printer_model: asText(row.printer_model),
          component_type: asText(row.component_type),
          replacement_item: asText(row.replacement_item),
          inv_no: asText(row.inv_no) || undefined,
          serial_no: asText(row.serial_no) || undefined,
        };
      })
      : [],
  };
}

function normalizeBatteryStatistics(value: unknown): BatteryStatistics {
  const source = asRecord(value);
  return {
    ...periodWindow(source),
    totals: normalizeSharedTotals(source.totals),
    by_branch_period: asCountMap(source.by_branch_period),
    by_model_period: asModelList(source.by_model_period),
    by_manufacturer_period: asCountMap(source.by_manufacturer_period),
    by_item_period: asCountMap(source.by_item_period),
    by_location_period: asLocationRows(source.by_location_period),
    recent_replacements: Array.isArray(source.recent_replacements)
      ? source.recent_replacements.map((item) => {
        const row = asRecord(item);
        return {
          timestamp: asText(row.timestamp),
          branch: asText(row.branch),
          location: asText(row.location),
          model_name: asText(row.model_name),
          manufacturer: asText(row.manufacturer),
          replacement_item: asText(row.replacement_item),
          inv_no: asText(row.inv_no) || undefined,
          serial_no: asText(row.serial_no) || undefined,
        };
      })
      : [],
  };
}

function normalizePcComponentsStatistics(value: unknown): PcComponentsStatistics {
  const source = asRecord(value);
  return {
    ...periodWindow(source),
    totals: normalizeSharedTotals(source.totals),
    by_component_period: asCountMap(source.by_component_period),
    by_item_period: asCountMap(source.by_item_period),
    by_branch_period: asCountMap(source.by_branch_period),
    by_model_period: asModelList(source.by_model_period),
    by_location_period: asLocationRows(source.by_location_period),
    recent_replacements: Array.isArray(source.recent_replacements)
      ? source.recent_replacements.map((item) => {
        const row = asRecord(item);
        return {
          timestamp: asText(row.timestamp),
          branch: asText(row.branch),
          location: asText(row.location),
          model_name: asText(row.model_name),
          manufacturer: asText(row.manufacturer),
          component_name: asText(row.component_name),
          replacement_item: asText(row.replacement_item),
          inv_no: asText(row.inv_no) || undefined,
          serial_no: asText(row.serial_no) || undefined,
        };
      })
      : [],
  };
}

function statisticsParams(periodDays: number, databaseId?: string) {
  const params: Record<string, unknown> = {
    period_days: Math.max(1, Math.min(3650, Math.trunc(periodDays) || 90)),
  };
  const dbName = asText(databaseId);
  if (dbName) params.db_name = dbName;
  return params;
}

export async function getPcCleaningStatistics(
  options: { periodDays: number; databaseId?: string; signal?: AbortSignal },
): Promise<PcCleaningStatistics> {
  const { data } = await apiClient.get('/json/works/cleaning/statistics', {
    params: statisticsParams(options.periodDays, options.databaseId),
    signal: options.signal,
  });
  return normalizePcCleaningStatistics(data);
}

export async function getPcCleaningRemaining(
  options: { periodDays: number; branch: string; databaseId?: string; signal?: AbortSignal },
): Promise<PcCleaningRemaining> {
  const { data } = await apiClient.get('/json/works/cleaning/statistics/remaining', {
    params: {
      ...statisticsParams(options.periodDays, options.databaseId),
      branch: asText(options.branch),
    },
    signal: options.signal,
  });
  return normalizePcCleaningRemaining(data);
}

export async function getMfuStatistics(
  options: { periodDays: number; databaseId?: string; signal?: AbortSignal },
): Promise<MfuStatistics> {
  const { data } = await apiClient.get('/json/works/mfu/statistics', {
    params: statisticsParams(options.periodDays, options.databaseId),
    signal: options.signal,
  });
  return normalizeMfuStatistics(data);
}

export async function getBatteryStatistics(
  options: { periodDays: number; databaseId?: string; signal?: AbortSignal },
): Promise<BatteryStatistics> {
  const { data } = await apiClient.get('/json/works/battery/statistics', {
    params: statisticsParams(options.periodDays, options.databaseId),
    signal: options.signal,
  });
  return normalizeBatteryStatistics(data);
}

export async function getPcComponentsStatistics(
  options: { periodDays: number; databaseId?: string; signal?: AbortSignal },
): Promise<PcComponentsStatistics> {
  const { data } = await apiClient.get('/json/works/pc-components/statistics', {
    params: statisticsParams(options.periodDays, options.databaseId),
    signal: options.signal,
  });
  return normalizePcComponentsStatistics(data);
}

export function fetchStatistics(
  tab: StatisticsTab,
  options: { periodDays: number; databaseId?: string; signal?: AbortSignal },
): Promise<StatisticsPayload> {
  if (tab === 'pc') return getPcCleaningStatistics(options).then((data) => ({ tab, data }));
  if (tab === 'mfu') return getMfuStatistics(options).then((data) => ({ tab, data }));
  if (tab === 'battery') return getBatteryStatistics(options).then((data) => ({ tab, data }));
  return getPcComponentsStatistics(options).then((data) => ({ tab, data }));
}

export async function addPcCleaningRecord(payload: PcCleaningRecordPayload): Promise<void> {
  await apiClient.post('/json/works/cleaning', payload);
}

export function statisticsExportUrl(tab: StatisticsTab, periodDays: number, databaseId?: string): string {
  const query = new URLSearchParams({
    tab,
    period_days: String(Math.max(1, Math.min(3650, Math.trunc(periodDays) || 90))),
  });
  const dbName = asText(databaseId);
  if (dbName) query.set('db_name', dbName);
  return `${API_V1_BASE}/json/works/statistics/export?${query}`;
}
