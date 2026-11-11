import apiClient from './client';

type UnknownRecord = Record<string, unknown>;

export type MfuConnectivityStatus = 'online' | 'offline' | 'unknown';

export type MfuSupply = {
  index: number;
  name: string;
  percent: number | null;
};

export type MfuTray = {
  name: string;
  media_name: string;
  percent: number | null;
  current_level: number | null;
  max_capacity: number | null;
};

export type MfuMaintenanceEvent = {
  timestamp: string;
  component_type: string;
  replacement_item: string;
  employee: string;
};

export type MfuDevice = {
  key: string;
  id: string;
  inv_no: string;
  serial_no: string;
  hw_serial_no: string;
  type_name: string;
  model_name: string;
  manufacturer: string;
  branch_name: string;
  location_name: string;
  status: string;
  ip_address: string;
  hostname: string;
  mac_address: string;
  employee_name: string;
  employee_dept: string;
  ping: {
    status: MfuConnectivityStatus;
    latency_ms: number | null;
    checked_at: string;
    last_online_at: string;
  };
  snmp: {
    status: string;
    checked_at: string;
    last_success_at: string;
    best_percent: number | null;
    page_total: number | null;
    page_checked_at: string;
    error: string;
    next_retry_at: string;
    supplies: MfuSupply[];
    trays: MfuTray[];
    device_info: {
      serial_number: string;
      device_model: string;
      sys_name: string;
      sys_descr: string;
      sys_location: string;
      uptime_seconds: number | null;
    };
  };
  maintenance: {
    total_operations: number;
    last_operation_at: string;
    recent: MfuMaintenanceEvent[];
  };
};

export type MfuDevicesPayload = {
  generated_at: string;
  database_id: string;
  totals: {
    devices: number;
    online: number;
    offline: number;
    unknown: number;
    snmp_ok: number;
    snmp_error: number;
    snmp_unknown: number;
  };
  devices: MfuDevice[];
  branches: string[];
  list_truncated: boolean;
  source_maybe_truncated: boolean;
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function text(value: unknown, max = 500): string {
  return String(value ?? '').trim().slice(0, max);
}

function finite(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : null;
}

function count(value: unknown, max = 10_000_000): number {
  const parsed = finite(value, 0, max);
  return parsed === null ? 0 : Math.floor(parsed);
}

function normalizePingStatus(value: unknown): MfuConnectivityStatus {
  const status = text(value, 20).toLowerCase();
  return status === 'online' || status === 'offline' ? status : 'unknown';
}

function normalizeSupply(value: unknown): MfuSupply | null {
  const source = record(value);
  const name = text(source.name, 300);
  if (!name) return null;
  return {
    index: count(source.index, 100_000),
    name,
    percent: finite(source.percent, 0, 100),
  };
}

function normalizeTray(value: unknown): MfuTray | null {
  const source = record(value);
  const name = text(source.name || source.description || source.index, 300);
  if (!name) return null;
  return {
    name,
    media_name: text(source.media_name, 200),
    percent: finite(source.percent, 0, 100),
    current_level: finite(source.current_level, 0, 10_000_000),
    max_capacity: finite(source.max_capacity, 0, 10_000_000),
  };
}

function normalizeMaintenanceEvent(value: unknown): MfuMaintenanceEvent | null {
  const source = record(value);
  const timestamp = text(source.timestamp, 64);
  const componentType = text(source.component_type, 120);
  const replacementItem = text(source.replacement_item, 500);
  if (!timestamp && !componentType && !replacementItem) return null;
  return {
    timestamp,
    component_type: componentType,
    replacement_item: replacementItem,
    employee: text(source.employee, 200),
  };
}

export function normalizeMfuDevice(value: unknown): MfuDevice | null {
  const source = record(value);
  const key = text(source.key, 255);
  if (!key) return null;
  const runtime = record(source.runtime);
  const pingSource = record(runtime.ping);
  const snmpSource = record(runtime.snmp);
  const deviceInfo = record(snmpSource.device_info);
  const maintenanceSource = record(source.maintenance);
  const supplies = (Array.isArray(snmpSource.supplies) ? snmpSource.supplies : [])
    .slice(0, 32).map(normalizeSupply).filter((item): item is MfuSupply => item !== null);
  const trays = (Array.isArray(snmpSource.trays) ? snmpSource.trays : [])
    .slice(0, 16).map(normalizeTray).filter((item): item is MfuTray => item !== null);
  const recent = (Array.isArray(maintenanceSource.recent) ? maintenanceSource.recent : [])
    .slice(0, 8).map(normalizeMaintenanceEvent).filter((item): item is MfuMaintenanceEvent => item !== null);
  return {
    key,
    id: text(source.id, 64),
    inv_no: text(source.inv_no, 200),
    serial_no: text(source.serial_no, 200),
    hw_serial_no: text(source.hw_serial_no, 200),
    type_name: text(source.type_name, 200),
    model_name: text(source.model_name, 500),
    manufacturer: text(source.manufacturer, 200),
    branch_name: text(source.branch_name, 200),
    location_name: text(source.location_name, 300),
    status: text(source.status, 100),
    ip_address: text(source.ip_address, 64),
    hostname: text(source.hostname, 255),
    mac_address: text(source.mac_address, 64),
    employee_name: text(source.employee_name, 200),
    employee_dept: text(source.employee_dept, 300),
    ping: {
      status: normalizePingStatus(pingSource.status),
      latency_ms: finite(pingSource.latency_ms, 0, 1_000_000),
      checked_at: text(pingSource.checked_at, 64),
      last_online_at: text(pingSource.last_online_at, 64),
    },
    snmp: {
      status: text(snmpSource.status, 32).toLowerCase() || 'unknown',
      checked_at: text(snmpSource.checked_at, 64),
      last_success_at: text(snmpSource.last_success_at, 64),
      best_percent: finite(snmpSource.best_percent, 0, 100),
      page_total: finite(snmpSource.page_total, 0, 10_000_000_000),
      page_checked_at: text(snmpSource.page_checked_at, 64),
      error: text(snmpSource.error, 200),
      next_retry_at: text(snmpSource.next_retry_at, 64),
      supplies,
      trays,
      device_info: {
        serial_number: text(deviceInfo.serial_number, 200),
        device_model: text(deviceInfo.device_model, 500),
        sys_name: text(deviceInfo.sys_name, 255),
        sys_descr: text(deviceInfo.sys_descr, 1000),
        sys_location: text(deviceInfo.sys_location, 300),
        uptime_seconds: finite(deviceInfo.uptime_seconds, 0, 10_000_000_000),
      },
    },
    maintenance: {
      total_operations: count(maintenanceSource.total_operations),
      last_operation_at: text(maintenanceSource.last_operation_at, 64),
      recent,
    },
  };
}

export function normalizeMfuDevicesPayload(payload: unknown, options: { deviceCap?: number; sourceLimit?: number } = {}): MfuDevicesPayload {
  const source = record(payload);
  const grouped = record(source.grouped);
  const deviceCap = Math.max(1, Math.min(1000, Math.floor(Number(options.deviceCap) || 750)));
  const sourceLimit = Math.max(1, Math.min(10_000, Math.floor(Number(options.sourceLimit) || 5000)));
  const byKey = new Map<string, MfuDevice>();
  let sawBeyondCap = false;
  for (const locationsValue of Object.values(grouped).slice(0, 250)) {
    const locations = record(locationsValue);
    for (const rows of Object.values(locations).slice(0, 1000)) {
      for (const row of (Array.isArray(rows) ? rows : []).slice(0, deviceCap + 1)) {
        const device = normalizeMfuDevice(row);
        if (!device || byKey.has(device.key)) continue;
        if (byKey.size >= deviceCap) {
          sawBeyondCap = true;
          continue;
        }
        byKey.set(device.key, device);
      }
    }
  }
  const totals = record(source.totals);
  const meta = record(source.meta);
  const legacyDebug = record(source.debug);
  const devices = [...byKey.values()];
  return {
    generated_at: text(source.generated_at, 64),
    database_id: text(source.db_id, 100),
    totals: {
      devices: count(totals.devices),
      online: count(totals.online),
      offline: count(totals.offline),
      unknown: count(totals.unknown),
      snmp_ok: count(totals.snmp_ok),
      snmp_error: count(totals.snmp_error),
      snmp_unknown: count(totals.snmp_unknown),
    },
    devices,
    branches: [...new Set(devices.map((device) => device.branch_name).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, 'ru')).slice(0, 250),
    list_truncated: sawBeyondCap || count(totals.devices) > devices.length,
    source_maybe_truncated: meta.source_maybe_truncated === true
      || count(meta.raw_rows_count, 100_000_000) >= sourceLimit
      || count(legacyDebug.raw_rows_count, 100_000_000) >= sourceLimit,
  };
}

export async function getMfuDevices(options: { signal?: AbortSignal } = {}): Promise<MfuDevicesPayload> {
  const sourceLimit = 5000;
  const response = await apiClient.get('/mfu/devices', {
    params: { period_days: 365, recent_limit: 8, limit: sourceLimit },
    signal: options.signal,
  });
  return normalizeMfuDevicesPayload(response.data, { sourceLimit });
}
