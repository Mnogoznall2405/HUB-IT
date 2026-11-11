import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as mfuApi from '../../api/mfuApi';
import type { MfuDevice } from '../../api/mfuApi';
import { NativeMfuScreen } from './NativeMfuScreen';

const mockMfuCardRender = jest.fn();

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    offlineMode: false,
    hasPermission: () => true,
  }),
}));

jest.mock('../../preferences/PreferencesContext', () => ({
  usePreferences: () => ({ preferences: { theme_mode: 'dark' } }),
}));

jest.mock('../../api/mfuApi', () => ({
  getMfuDevices: jest.fn(),
}));

jest.mock('../../components/mfu/NativeMfuDeviceCard', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    NativeMfuDeviceCard: React.memo(({ device }: { device: MfuDevice }) => {
      mockMfuCardRender(device.key);
      return React.createElement(Text, null, device.model_name);
    }),
  };
});

const devices = Array.from({ length: 30 }, (_, index): MfuDevice => ({
  key: `main|${index}`,
  id: String(index),
  inv_no: `P-${index}`,
  serial_no: `SN-${index}`,
  hw_serial_no: '',
  type_name: 'МФУ',
  model_name: `Canon ${String(index).padStart(2, '0')}`,
  manufacturer: 'Canon',
  branch_name: 'Главный офис',
  location_name: `Кабинет ${index}`,
  status: 'В эксплуатации',
  ip_address: `10.20.30.${index + 1}`,
  hostname: `PRINTER-${index}`,
  mac_address: `00:11:22:33:44:${String(index).padStart(2, '0')}`,
  employee_name: '',
  employee_dept: '',
  ping: {
    status: 'online',
    latency_ms: 12,
    checked_at: '2026-09-02T10:00:00Z',
    last_online_at: '2026-09-02T10:00:00Z',
  },
  snmp: {
    status: 'ok',
    checked_at: '2026-09-02T10:00:00Z',
    last_success_at: '2026-09-02T10:00:00Z',
    best_percent: 80,
    page_total: 1000,
    page_checked_at: '2026-09-02T10:00:00Z',
    error: '',
    next_retry_at: '',
    supplies: [],
    trays: [],
    device_info: {
      serial_number: '',
      device_model: '',
      sys_name: '',
      sys_descr: '',
      sys_location: '',
      uptime_seconds: null,
    },
  },
  maintenance: {
    total_operations: 0,
    last_operation_at: '',
    recent: [],
  },
}));

const mockedApi = mfuApi as jest.Mocked<typeof mfuApi>;

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.getMfuDevices.mockResolvedValue({
    generated_at: '2026-09-02T10:00:00Z',
    database_id: 'main',
    totals: {
      devices: devices.length,
      online: devices.length,
      offline: 0,
      unknown: 0,
      snmp_ok: devices.length,
      snmp_error: 0,
      snmp_unknown: 0,
    },
    devices,
    branches: ['Главный офис'],
    list_truncated: false,
    source_maybe_truncated: false,
  });
});

it('does not rerender mounted MFU cards for local search or refresh spinner', async () => {
  const view = await render(<NativeMfuScreen />);
  await waitFor(() => expect(view.getByText('Canon 09')).toBeTruthy());
  mockMfuCardRender.mockClear();

  await fireEvent.changeText(view.getByTestId('native-mfu-search'), 'canon');
  const localSearchRenders = mockMfuCardRender.mock.calls.length;
  mockMfuCardRender.mockClear();

  mockedApi.getMfuDevices.mockReturnValueOnce(new Promise(() => undefined));
  await act(async () => {
    view.getByTestId('native-mfu-list').props.onRefresh();
  });
  const refreshSpinnerRenders = mockMfuCardRender.mock.calls.length;

  expect({ localSearchRenders, refreshSpinnerRenders }).toEqual({
    localSearchRenders: 0,
    refreshSpinnerRenders: 0,
  });
});
