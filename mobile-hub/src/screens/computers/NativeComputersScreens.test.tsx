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

it('loads a native paginated list and opens its internal MAC detail', async () => {
  params.mockReturnValue({ q: 'PC-01' });
  const view = await render(<NativeComputersScreen />);
  await waitFor(() => expect(view.getByText('PC-01')).toBeTruthy());
  expect(computersApi.searchComputers).toHaveBeenCalledWith(expect.objectContaining({ q: 'PC-01', scope: 'selected', limit: 50, offset: 0, signal: expect.anything() }));
  fireEvent.press(view.getByTestId(`native-computer-${computer.mac_address}`));
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/(shell)/computers/[macAddress]',
    params: { macAddress: computer.mac_address, scope: 'selected', q: computer.hostname },
  });
});

it('does not expose a Computers web fallback', async () => {
  const view = await render(<NativeComputersScreen />);
  await waitFor(() => expect(view.getByText('PC-01')).toBeTruthy());
  expect(view.queryByTestId('native-computers-open-web')).toBeNull();
});

it('does not expose all-database scope without computers.read_all', async () => {
  mockPermissions = ['computers.read'];
  const view = await render(<NativeComputersScreen />);
  await waitFor(() => expect(view.getByText('PC-01')).toBeTruthy());
  expect(view.queryByTestId('native-computers-scope-all')).toBeNull();
});

it('shows a retry instead of presenting a failed request as an empty list', async () => {
  (computersApi.searchComputers as jest.Mock)
    .mockRejectedValueOnce(new Error('inventory unavailable'))
    .mockResolvedValueOnce({ items: [], total: 0, limit: 50, offset: 0, has_more: false, next_offset: null });
  const view = await render(<NativeComputersScreen />);
  await waitFor(() => expect(view.getByTestId('native-computers-retry')).toBeTruthy());
  fireEvent.press(view.getByTestId('native-computers-retry'));
  await waitFor(() => expect(computersApi.searchComputers).toHaveBeenCalledTimes(2));
});

it('does not request inventory data without computers.read', async () => {
  mockPermissions = [];
  const view = await render(<NativeComputersScreen />);
  await waitFor(() => expect(view.getByText('Нет доступа')).toBeTruthy());
  expect(computersApi.searchComputers).not.toHaveBeenCalled();
});

it('loads a read-only detail without exposing hide or change-history actions', async () => {
  params.mockReturnValue({ macAddress: computer.mac_address, scope: 'all', q: computer.hostname });
  const view = await render(<NativeComputerDetailScreen />);
  await fireEvent.press(await view.findByRole('button', { name: 'Привязка и пользователь' }));
  await waitFor(() => expect(view.getByText('Dell OptiPlex')).toBeTruthy());
  expect(computersApi.getComputerDetail).toHaveBeenCalledWith(computer.mac_address, { scope: 'all', signal: expect.anything() });
  expect(view.queryByText('Скрыть компьютер')).toBeNull();
  expect(view.queryByText('История изменений')).toBeNull();
  expect(view.queryByTestId('native-computer-detail-open-web')).toBeNull();
});

it('refreshes the full loaded window without dropping the second page', async () => {
  jest.useFakeTimers();
  const initialState = AppState.currentState;
  AppState.currentState = 'active';
  try {
    const records = Array.from({ length: 100 }, (_, i) => ({ ...computer, mac_address: `mac-${i}`, hostname: `PC-${i}` }));
    const search = computersApi.searchComputers as jest.Mock;
    search.mockImplementation(async ({ limit, offset }) => ({ items: records.slice(offset, offset + limit), total: 100, has_more: offset + limit < 100 }));
    const view = await render(<NativeComputersScreen />);
    await waitFor(() => expect(view.getByTestId('native-computers-list').props.data).toHaveLength(50));
    await act(async () => { fireEvent(view.getByTestId('native-computers-list'), 'onEndReached'); });
    await waitFor(() => expect(view.getByTestId('native-computers-list').props.data).toHaveLength(100));
    records[60] = { ...records[60], status: 'offline' };
    await act(async () => { jest.advanceTimersByTime(60_000); });
    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0, limit: 100 }));
    expect(view.getByTestId('native-computers-list').props.data).toHaveLength(100);
    expect(view.getByTestId('native-computers-list').props.data[60].status).toBe('offline');
    await view.unmount();
  } finally { AppState.currentState = initialState; jest.useRealTimers(); }
});
