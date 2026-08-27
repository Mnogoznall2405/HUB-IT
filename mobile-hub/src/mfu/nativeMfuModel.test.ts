import type { MfuDevice } from '../api/mfuApi';
import { filterMfuDevices, minimumMfuSupplyPercent } from './nativeMfuModel';

const base = {
  key: 'main|1', id: '1', inv_no: 'P-1', serial_no: 'SN-1', hw_serial_no: '', type_name: 'МФУ', model_name: 'Canon MF443', manufacturer: 'Canon',
  branch_name: 'Офис', location_name: 'Кабинет', status: '', ip_address: '10.0.0.5', hostname: 'PRINTER-1', mac_address: '', employee_name: 'Иванов', employee_dept: 'ИТ',
  ping: { status: 'online' as const, latency_ms: 5, checked_at: '', last_online_at: '' },
  snmp: { status: 'ok', checked_at: '', last_success_at: '', best_percent: 70, page_total: 100, page_checked_at: '', error: '', next_retry_at: '', supplies: [], trays: [], device_info: { serial_number: '', device_model: '', sys_name: '', sys_descr: '', sys_location: '', uptime_seconds: null } },
  maintenance: { total_operations: 0, last_operation_at: '', recent: [] },
} satisfies MfuDevice;

it('filters by search, branch and connectivity without fuzzy business rules', () => {
  const offline = { ...base, key: 'main|2', model_name: 'Xerox C7020', branch_name: 'Склад', hostname: 'PRINTER-2', ping: { ...base.ping, status: 'offline' as const } };
  expect(filterMfuDevices([base, offline], { query: 'printer-1' })).toEqual([base]);
  expect(filterMfuDevices([base, offline], { branch: 'Склад', ping: 'offline' })).toEqual([offline]);
});

it('uses the lowest known supply percentage for the low-toner filter', () => {
  const low = { ...base, snmp: { ...base.snmp, supplies: [{ index: 1, name: 'Black', percent: 15 }, { index: 2, name: 'Cyan', percent: 80 }] } };
  expect(minimumMfuSupplyPercent(low)).toBe(15);
  expect(filterMfuDevices([base, low], { snmp: 'low_toner' })).toEqual([low]);
});
