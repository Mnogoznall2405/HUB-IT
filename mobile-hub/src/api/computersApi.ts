import apiClient from './client';

type UnknownRecord = Record<string, unknown>;

export type ComputerScope = 'selected' | 'all';
export type ComputerStatus = 'online' | 'stale' | 'offline' | 'unknown';
export type ComputerOutlookStatus = 'ok' | 'warning' | 'critical' | 'unknown';

export type ComputerDisk = {
  name: string;
  mountpoint: string;
  fstype: string;
  total_gb: number | null;
  free_gb: number | null;
  size_gb: number | null;
  health_status: string;
  media_type: string;
  bus_type: string;
  serial_number: string;
  wear_out_percentage: number | null;
  temperature: number | null;
};

export type ComputerNetworkDevice = {
  name: string;
  description: string;
  device_type: string;
  enabled: boolean | null;
  connection_status: string;
  mac_address: string;
  link_speed: string;
  ipv4: string[];
};

export type ComputerRecord = {
  mac_address: string;
  hostname: string;
  status: ComputerStatus;
  age_seconds: number | null;
  last_seen_at: string | number;
  current_user: string;
  user_login: string;
  user_full_name: string;
  branch_name: string;
  location_name: string;
  database_id: string;
  database_name: string;
  inventory_inv_no: string;
  inventory_model_name: string;
  assignment_source: string;
  is_unassigned: boolean;
  is_hidden: boolean;
  hidden_reason: string;
  ip_primary: string;
  ip_list: string[];
  cpu_load_percent: number | null;
  ram_used_percent: number | null;
  uptime_seconds: number | null;
  last_reboot_at: string | number;
  cpu_model: string;
  ram_gb: number | null;
  system_serial: string;
  outlook_status: ComputerOutlookStatus;
  outlook_total_size_bytes: number;
  outlook_archives_count: number;
  has_hardware_changes: boolean;
  changes_count_30d: number;
  last_change_at: string | number;
  network_devices: ComputerNetworkDevice[];
  logical_disks: ComputerDisk[];
  storage: ComputerDisk[];
};

export type ComputersSummary = {
  total: number;
  unassigned: number;
  statuses: Record<string, number>;
  branches: Record<string, number>;
  outlook: Record<string, number>;
};

export type ComputersPage = {
  items: ComputerRecord[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
  next_offset: number | null;
};

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function asString(value: unknown): string {
  return String(value ?? '').trim();
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes'].includes(asString(value).toLowerCase());
}

function asNullableBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined || value === '') return null;
  return asBoolean(value);
}

function asTimestamp(value: unknown): string | number {
  return typeof value === 'number' && Number.isFinite(value) ? value : asString(value);
}

function asStringArray(value: unknown): string[] {
  return (Array.isArray(value) ? value : []).map(asString).filter(Boolean);
}

function numericRecord(value: unknown): Record<string, number> {
  return Object.fromEntries(Object.entries(asRecord(value)).map(([key, item]) => [key, Math.max(0, asNumber(item))]));
}

function normalizeStatus(value: unknown): ComputerStatus {
  const status = asString(value).toLowerCase();
  return ['online', 'stale', 'offline'].includes(status) ? status as ComputerStatus : 'unknown';
}

function normalizeOutlookStatus(value: unknown): ComputerOutlookStatus {
  const status = asString(value).toLowerCase();
  return ['ok', 'warning', 'critical'].includes(status) ? status as ComputerOutlookStatus : 'unknown';
}

function normalizeDisk(value: unknown): ComputerDisk | null {
  const source = asRecord(value);
  if (!Object.keys(source).length) return null;
  return {
    name: asString(source.display_name || source.name || source.model || source.device),
    mountpoint: asString(source.mountpoint || source.device),
    fstype: asString(source.fstype),
    total_gb: asNullableNumber(source.total_gb),
    free_gb: asNullableNumber(source.free_gb),
    size_gb: asNullableNumber(source.size_gb),
    health_status: asString(source.health_status),
    media_type: asString(source.media_type),
    bus_type: asString(source.bus_type),
    serial_number: asString(source.serial_number),
    wear_out_percentage: asNullableNumber(source.wear_out_percentage),
    temperature: asNullableNumber(source.temperature),
  };
}

function normalizeNetworkDevice(value: unknown): ComputerNetworkDevice | null {
  const source = asRecord(value);
  const name = asString(source.name || source.description);
  if (!name) return null;
  return {
    name,
    description: asString(source.description),
    device_type: asString(source.device_type),
    enabled: asNullableBoolean(source.enabled),
    connection_status: asString(source.connection_status),
    mac_address: asString(source.mac_address),
    link_speed: asString(source.link_speed),
    ipv4: asStringArray(source.ipv4),
  };
}

export function normalizeComputerRecord(value: unknown): ComputerRecord | null {
  const source = asRecord(value);
  const macAddress = asString(source.mac_address || source.mac);
  const hostname = asString(source.hostname || source.host_name);
  if (!macAddress && !hostname) return null;
  const health = asRecord(source.health);
  const network = asRecord(source.network);
  const outlook = asRecord(source.outlook);
  return {
    mac_address: macAddress,
    hostname: hostname || macAddress || 'Неизвестный ПК',
    status: normalizeStatus(source.status),
    age_seconds: asNullableNumber(source.age_seconds),
    last_seen_at: asTimestamp(source.last_seen_at || source.timestamp),
    current_user: asString(source.current_user),
    user_login: asString(source.user_login || source.current_user),
    user_full_name: asString(source.user_full_name),
    branch_name: asString(source.branch_name) || 'Без привязки',
    location_name: asString(source.location_name),
    database_id: asString(source.database_id),
    database_name: asString(source.database_name || source.database_id),
    inventory_inv_no: asString(source.inventory_inv_no),
    inventory_model_name: asString(source.inventory_model_name),
    assignment_source: asString(source.assignment_source || source.branch_source),
    is_unassigned: asBoolean(source.is_unassigned),
    is_hidden: asBoolean(source.is_hidden) || Boolean(asString(source.hidden_at)),
    hidden_reason: asString(source.hidden_reason),
    ip_primary: asString(source.ip_primary) || asStringArray(source.ip_list)[0] || '',
    ip_list: asStringArray(source.ip_list),
    cpu_load_percent: asNullableNumber(source.cpu_load_percent ?? health.cpu_load_percent),
    ram_used_percent: asNullableNumber(source.ram_used_percent ?? health.ram_used_percent),
    uptime_seconds: asNullableNumber(source.uptime_seconds ?? health.uptime_seconds),
    last_reboot_at: asTimestamp(source.last_reboot_at || health.last_reboot_at || health.boot_time),
    cpu_model: asString(source.cpu_model),
    ram_gb: asNullableNumber(source.ram_gb),
    system_serial: asString(source.system_serial),
    outlook_status: normalizeOutlookStatus(source.outlook_status || outlook.status),
    outlook_total_size_bytes: Math.max(0, asNumber(source.outlook_total_size_bytes || outlook.total_outlook_size_bytes)),
    outlook_archives_count: Math.max(0, asNumber(source.outlook_archives_count || (Array.isArray(outlook.archives) ? outlook.archives.length : 0))),
    has_hardware_changes: asBoolean(source.has_hardware_changes),
    changes_count_30d: Math.max(0, asNumber(source.changes_count_30d)),
    last_change_at: asTimestamp(source.last_change_at),
    network_devices: (Array.isArray(network.devices) ? network.devices : []).map(normalizeNetworkDevice).filter((item): item is ComputerNetworkDevice => item !== null),
    logical_disks: (Array.isArray(source.logical_disks) ? source.logical_disks : []).map(normalizeDisk).filter((item): item is ComputerDisk => item !== null),
    storage: (Array.isArray(source.storage) ? source.storage : []).map(normalizeDisk).filter((item): item is ComputerDisk => item !== null),
  };
}

function normalizePage(value: unknown, fallback: { limit: number; offset: number }): ComputersPage {
  const source = asRecord(value);
  const items = (Array.isArray(source.items) ? source.items : [])
    .map(normalizeComputerRecord)
    .filter((item): item is ComputerRecord => item !== null);
  const limit = Math.max(1, source.limit === undefined ? fallback.limit : asNumber(source.limit) || fallback.limit);
  const offset = Math.max(0, source.offset === undefined ? fallback.offset : asNumber(source.offset));
  const total = Math.max(items.length, asNumber(source.total));
  const rawNext = source.next_offset;
  const nextOffset = rawNext === null || rawNext === undefined || rawNext === '' ? null : Math.max(0, asNumber(rawNext));
  const hasMore = typeof source.has_more === 'boolean' ? source.has_more : offset + items.length < total;
  return { items, total, limit, offset, has_more: hasMore && items.length > 0, next_offset: nextOffset ?? (hasMore ? offset + items.length : null) };
}

function compactParams(values: UnknownRecord): UnknownRecord {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== ''));
}

function buildFilterParams(options: {
  scope?: ComputerScope;
  q?: string;
  status?: ComputerStatus | '';
  outlookStatus?: ComputerOutlookStatus | '';
  branch?: string;
  changedOnly?: boolean;
  hiddenOnly?: boolean;
  hideVm172?: boolean;
}): UnknownRecord {
  return compactParams({
    scope: options.scope === 'all' ? 'all' : 'selected',
    q: asString(options.q).slice(0, 200) || undefined,
    search_fields: 'identity,user,profiles,outlook,network,location,database',
    status: options.status || undefined,
    outlook_status: options.outlookStatus || undefined,
    branch: asString(options.branch) || undefined,
    changed_only: options.changedOnly ? true : undefined,
    hidden_only: options.hiddenOnly ? true : undefined,
    hide_vm_172: options.hideVm172 === false ? undefined : true,
  });
}

export async function searchComputers(options: {
  scope?: ComputerScope;
  q?: string;
  status?: ComputerStatus | '';
  outlookStatus?: ComputerOutlookStatus | '';
  branch?: string;
  changedOnly?: boolean;
  hiddenOnly?: boolean;
  hideVm172?: boolean;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
} = {}): Promise<ComputersPage> {
  const limit = Math.max(1, Math.min(500, Number(options.limit) || 50));
  const offset = Math.max(0, Number(options.offset) || 0);
  const response = await apiClient.get('/inventory/computers/search', {
    params: {
      ...buildFilterParams(options),
      sort_by: 'hostname',
      sort_dir: 'asc',
      limit,
      offset,
      include_summary: false,
      mobile_safe: true,
    },
    signal: options.signal,
  });
  return normalizePage(response.data, { limit, offset });
}

export async function getComputersSummary(options: {
  scope?: ComputerScope;
  q?: string;
  status?: ComputerStatus | '';
  outlookStatus?: ComputerOutlookStatus | '';
  branch?: string;
  changedOnly?: boolean;
  hiddenOnly?: boolean;
  hideVm172?: boolean;
  signal?: AbortSignal;
} = {}): Promise<ComputersSummary> {
  const response = await apiClient.get('/inventory/computers/summary', {
    params: buildFilterParams(options),
    signal: options.signal,
  });
  const source = asRecord(response.data);
  return {
    total: Math.max(0, asNumber(source.total)),
    unassigned: Math.max(0, asNumber(source.unassigned)),
    statuses: numericRecord(source.statuses),
    branches: numericRecord(source.branches),
    outlook: numericRecord(source.outlook),
  };
}

export async function getComputerDetail(macAddress: string, options: { scope?: ComputerScope; signal?: AbortSignal } = {}): Promise<ComputerRecord> {
  const normalizedMac = asString(macAddress);
  if (!normalizedMac) throw new Error('Не указан MAC-адрес компьютера.');
  const response = await apiClient.get(`/inventory/computers/${encodeURIComponent(normalizedMac)}`, {
    params: { scope: options.scope === 'all' ? 'all' : 'selected', mobile_safe: true },
    signal: options.signal,
  });
  const item = normalizeComputerRecord(response.data);
  if (!item) throw new Error('Сервер вернул неполную карточку компьютера.');
  return item;
}
