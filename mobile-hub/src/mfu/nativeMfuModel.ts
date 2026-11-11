import type { MfuDevice } from '../api/mfuApi';

export type MfuPingFilter = 'all' | 'online' | 'offline' | 'unknown';
export type MfuSnmpFilter = 'all' | 'low_toner' | 'no_data' | 'error';

function folded(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/ё/g, 'е');
}

export function minimumMfuSupplyPercent(device: MfuDevice): number | null {
  const values = device.snmp.supplies
    .map((supply) => supply.percent)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (values.length) return Math.min(...values);
  return typeof device.snmp.best_percent === 'number' && Number.isFinite(device.snmp.best_percent)
    ? device.snmp.best_percent
    : null;
}

export function filterMfuDevices(devices: MfuDevice[], options: {
  query?: string;
  branch?: string;
  ping?: MfuPingFilter;
  snmp?: MfuSnmpFilter;
} = {}): MfuDevice[] {
  const query = folded(options.query);
  const branch = String(options.branch || 'all');
  const ping = options.ping || 'all';
  const snmp = options.snmp || 'all';
  return devices.filter((device) => {
    if (branch !== 'all' && device.branch_name !== branch) return false;
    if (ping !== 'all' && device.ping.status !== ping) return false;
    if (snmp === 'low_toner') {
      const minimum = minimumMfuSupplyPercent(device);
      if (minimum === null || minimum >= 20) return false;
    } else if (snmp !== 'all' && device.snmp.status !== snmp) return false;
    if (!query) return true;
    return folded([
      device.inv_no,
      device.serial_no,
      device.hw_serial_no,
      device.type_name,
      device.model_name,
      device.manufacturer,
      device.ip_address,
      device.hostname,
      device.mac_address,
      device.employee_name,
      device.employee_dept,
      device.branch_name,
      device.location_name,
    ].join(' ')).includes(query);
  });
}

export function mfuSnmpStatusLabel(status: string): string {
  if (status === 'ok') return 'Данные получены';
  if (status === 'error') return 'Ошибка опроса SNMP';
  if (status === 'no_data') return 'Нет данных SNMP';
  return 'Состояние SNMP неизвестно';
}
