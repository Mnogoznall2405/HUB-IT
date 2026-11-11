import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as computersApi from '../../api/computersApi';
import type { ComputerRecord } from '../../api/computersApi';
import { NativeComputerDetailScreen } from './NativeComputerDetailScreen';
import { NativeComputersScreen } from './NativeComputersScreen';

let mockPermissions = ['computers.read', 'computers.read_all'];
let mockOfflineMode = false;

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    offlineMode: mockOfflineMode,
    hasPermission: (permission: string) => mockPermissions.includes(permission),
  }),
}));
jest.mock('../../preferences/PreferencesContext', () => ({
  usePreferences: () => ({ preferences: { theme_mode: 'system' } }),
}));
jest.mock('../../api/computersApi', () => ({
  searchComputers: jest.fn(),
  getComputersSummary: jest.fn(),
  getComputerDetail: jest.fn(),
}));

const params = useLocalSearchParams as jest.Mock;

const computer: ComputerRecord = {
  mac_address: 'AA:BB:CC:DD:EE:FF',
  hostname: 'PC-01',
  status: 'online',
  age_seconds: 30,
  last_seen_at: 1_777_000_000,
  current_user: 'ivanov',
  user_login: 'ivanov',
  user_full_name: 'Иванов Иван',
  branch_name: 'Тюмень',
  location_name: 'Кабинет 10',
  database_id: 'ITINVENT',
  database_name: 'Основная',
  inventory_inv_no: 'INV-1',
  inventory_model_name: 'Dell OptiPlex',
  assignment_source: 'sql',
  is_unassigned: false,
  is_hidden: false,
  hidden_reason: '',
  ip_primary: '10.1.1.7',
  ip_list: ['10.1.1.7'],
  cpu_load_percent: 12,
  ram_used_percent: 45,
  uptime_seconds: 90_000,
  last_reboot_at: 1_776_900_000,
  cpu_model: 'Intel Core i5',
  ram_gb: 16,
  system_serial: 'SER-1',
  outlook_status: 'ok',
  outlook_total_size_bytes: 1024,
  outlook_archives_count: 1,
  has_hardware_changes: false,
  changes_count_30d: 0,
  last_change_at: '',
  network_devices: [{ name: 'Ethernet', description: '', device_type: 'ethernet', enabled: true, connection_status: 'connected', mac_address: 'AA:BB', link_speed: '1 Gbps', ipv4: ['10.1.1.7'] }],
  logical_disks: [{ name: 'C:', mountpoint: 'C:', fstype: 'NTFS', total_gb: 500, free_gb: 200, size_gb: null, health_status: 'ok', media_type: 'SSD', bus_type: 'NVMe', serial_number: 'DISK-1', wear_out_percentage: null, temperature: null }],
  storage: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPermissions = ['computers.read', 'computers.read_all'];
  mockOfflineMode = false;
  params.mockReturnValue({});
  (computersApi.searchComputers as jest.Mock).mockResolvedValue({ items: [computer], total: 1, limit: 50, offset: 0, has_more: false, next_offset: null });
  (computersApi.getComputersSummary as jest.Mock).mockResolvedValue({ total: 1, unassigned: 0, statuses: { online: 1 }, branches: { Тюмень: 1 }, outlook: { ok: 1 } });
  (computersApi.getComputerDetail as jest.Mock).mockResolvedValue(computer);
});

it("clears the prior computer when MAC changes offline", async () => {
  params.mockReturnValue({ macAddress: computer.mac_address });
  const v = await render(<NativeComputerDetailScreen />);
  await waitFor(() => expect(v.getAllByText(computer.hostname)).toBeTruthy());
  mockOfflineMode = true;
  params.mockReturnValue({ macAddress: "BB:BB:CC:DD:EE:FF" });
  await v.rerender(<NativeComputerDetailScreen />);
  expect(v.queryAllByText(computer.hostname)).toHaveLength(0);
  expect(computersApi.getComputerDetail).toHaveBeenCalledTimes(1);
  await v.unmount();
});

it('keeps the loaded same-MAC card when connectivity is lost',async()=>{
 params.mockReturnValue({macAddress:computer.mac_address});
 const v=await render(<NativeComputerDetailScreen/>);
 await waitFor(()=>expect(v.getAllByText(computer.hostname).length).toBeGreaterThan(0));
 mockOfflineMode=true;
 await v.rerender(<NativeComputerDetailScreen/>);
 expect(v.getAllByText(computer.hostname).length).toBeGreaterThan(0);
 expect(computersApi.getComputerDetail).toHaveBeenCalledTimes(1);
 await v.unmount();
});
