import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as mfuApi from '../../api/mfuApi';
import { NativeMfuScreen } from './NativeMfuScreen';

let mockPermissions = ['mfu.read', 'database.write'];
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
jest.mock('../../api/mfuApi', () => ({ getMfuDevices: jest.fn() }));

const device: mfuApi.MfuDevice = {
  key: 'main|17',
  id: '17',
  inv_no: 'P-17',
  serial_no: 'SN-17',
  hw_serial_no: '',
  type_name: 'МФУ',
  model_name: 'Canon MF443',
  manufacturer: 'Canon',
  branch_name: 'Главный офис',
  location_name: 'Кабинет 17',
  status: 'В эксплуатации',
  ip_address: '10.20.30.40',
  hostname: 'PRINTER-17',
  mac_address: '00:11:22:33:44:55',
  employee_name: 'Иванов Иван',
  employee_dept: 'ИТ',
  ping: { status: 'online', latency_ms: 12, checked_at: '2026-08-24T10:00:00Z', last_online_at: '2026-08-24T10:00:00Z' },
  snmp: {
    status: 'ok',
    checked_at: '2026-08-24T10:00:00Z',
    last_success_at: '2026-08-24T10:00:00Z',
    best_percent: 17,
    page_total: 1500,
    page_checked_at: '2026-08-24T10:00:00Z',
    error: '',
    next_retry_at: '',
    supplies: [{ index: 1, name: 'Black toner', percent: 17 }],
    trays: [],
    device_info: { serial_number: 'SN-17', device_model: 'Canon MF443', sys_name: 'PRINTER-17', sys_descr: '', sys_location: '', uptime_seconds: null },
  },
  maintenance: { total_operations: 1, last_operation_at: '2026-08-20T10:00:00Z', recent: [{ timestamp: '2026-08-20T10:00:00Z', component_type: 'Картридж', replacement_item: '057H', employee: 'Петров' }] },
};

const payload: mfuApi.MfuDevicesPayload = {
  generated_at: '2026-08-24T10:00:00Z',
  database_id: 'main',
  totals: { devices: 1, online: 1, offline: 0, unknown: 0, snmp_ok: 1, snmp_error: 0, snmp_unknown: 0 },
  devices: [device],
  branches: ['Главный офис'],
  list_truncated: false,
  source_maybe_truncated: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPermissions = ['mfu.read', 'database.write'];
  mockOfflineMode = false;
  (mfuApi.getMfuDevices as jest.Mock).mockResolvedValue(payload);
});

it('loads one bounded snapshot and filters it locally by IP', async () => {
  const view = await render(<NativeMfuScreen />);
  await waitFor(() => expect(view.getByText('Canon MF443')).toBeTruthy());
  expect(mfuApi.getMfuDevices).toHaveBeenCalledWith({ signal: expect.anything() });
  expect(mfuApi.getMfuDevices).toHaveBeenCalledTimes(1);

  await fireEvent.changeText(view.getByTestId('native-mfu-search'), '10.20.30.40');
  expect(view.getByText('Canon MF443')).toBeTruthy();
  await fireEvent.changeText(view.getByTestId('native-mfu-search'), '10.99.99.99');
  await waitFor(() => expect(view.queryByText('Canon MF443')).toBeNull());
  await view.unmount();
});

it('opens read-only snapshot details without a monthly request or web fallback', async () => {
  const view = await render(<NativeMfuScreen />);
  await waitFor(() => expect(view.getByText('Canon MF443')).toBeTruthy());
  await fireEvent.press(view.getByText('Canon MF443'));

  expect(view.getByText('Black toner')).toBeTruthy();
  expect(view.getByText('1500')).toBeTruthy();
  expect(view.queryByTestId('native-mfu-refresh-monthly')).toBeNull();
  expect(view.queryByTestId('native-mfu-detail-open-web')).toBeNull();
  await view.unmount();
});

it('does not load MFU data without permission or while offline', async () => {
  mockPermissions = [];
  const denied = await render(<NativeMfuScreen />);
  await waitFor(() => expect(denied.getByText('Нет доступа')).toBeTruthy());
  expect(mfuApi.getMfuDevices).not.toHaveBeenCalled();
  await denied.unmount();

  jest.clearAllMocks();
  mockPermissions = ['mfu.read'];
  mockOfflineMode = true;
  const offline = await render(<NativeMfuScreen />);
  await waitFor(() => expect(offline.getByText(/Требуется сеть/)).toBeTruthy());
  expect(mfuApi.getMfuDevices).not.toHaveBeenCalled();
  await offline.unmount();
});
