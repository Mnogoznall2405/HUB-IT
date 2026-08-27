import type { ComputerRecord } from '../api/computersApi';
import {
  computerDiskWarningCount,
  computerStatusLabel,
  formatComputerAge,
  formatComputerBytes,
  formatComputerTimestamp,
  mergeComputerPage,
} from './nativeComputersModel';

function computer(mac: string, overrides: Partial<ComputerRecord> = {}): ComputerRecord {
  return {
    mac_address: mac,
    hostname: mac,
    status: 'unknown',
    age_seconds: null,
    last_seen_at: '',
    current_user: '', user_login: '', user_full_name: '', branch_name: '', location_name: '', database_id: '', database_name: '',
    inventory_inv_no: '', inventory_model_name: '', assignment_source: '', is_unassigned: false, is_hidden: false, hidden_reason: '',
    ip_primary: '', ip_list: [], cpu_load_percent: null, ram_used_percent: null, uptime_seconds: null, last_reboot_at: '', cpu_model: '', ram_gb: null,
    system_serial: '', outlook_status: 'unknown',
    outlook_total_size_bytes: 0, outlook_archives_count: 0, has_hardware_changes: false, changes_count_30d: 0, last_change_at: '',
    network_devices: [], logical_disks: [], storage: [],
    ...overrides,
  };
}

it('merges paginated computers by stable MAC and keeps the newest value', () => {
  expect(mergeComputerPage([computer('AA', { hostname: 'old' })], [computer('AA', { hostname: 'new' }), computer('BB')]))
    .toEqual([computer('AA', { hostname: 'new' }), computer('BB')]);
});

it('formats native computer status and time values defensively', () => {
  expect(computerStatusLabel('stale')).toBe('Давно не было');
  expect(formatComputerAge(3_660)).toBe('1 ч назад');
  expect(formatComputerBytes(1_073_741_824)).toBe('1.0 ГБ');
  expect(formatComputerTimestamp('')).toBe('Нет данных');
});

it('detects unhealthy and critically full disks', () => {
  expect(computerDiskWarningCount(computer('AA', {
    logical_disks: [
      { name: 'C:', mountpoint: '', fstype: '', total_gb: 100, free_gb: 5, size_gb: null, health_status: 'ok', media_type: '', bus_type: '', serial_number: '', wear_out_percentage: null, temperature: null },
    ],
    storage: [
      { name: 'SSD', mountpoint: '', fstype: '', total_gb: null, free_gb: null, size_gb: 512, health_status: 'warning', media_type: '', bus_type: '', serial_number: '', wear_out_percentage: null, temperature: null },
    ],
  }))).toBe(2);
});
