import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { MONITORING_REFRESH_MS } from '../../monitoring/monitoringModel';
import * as monitoringApi from '../../api/monitoringApi';
import { NativeMonitoringScreen } from './NativeMonitoringScreen';

let mockPermissions = ['monitoring.read'];
let mockOfflineMode = false;

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    offlineMode: mockOfflineMode,
    user: { id: 7 },
    hasPermission: (permission: string) => mockPermissions.includes(permission),
  }),
}));
jest.mock('../../preferences/PreferencesContext', () => ({
  usePreferences: () => ({ preferences: { theme_mode: 'system' } }),
}));
jest.mock('../../api/monitoringApi', () => ({
  fetchMonitoringOverview: jest.fn(),
  fetchMonitoringTarget: jest.fn(),
  fetchMonitoringHistory: jest.fn(),
  fetchMonitoringLatency: jest.fn(),
}));

const api = monitoringApi as jest.Mocked<typeof monitoringApi>;
const recent = () => new Date(Date.now() - 20_000).toISOString();

const targets = (): monitoringApi.MonitoringTarget[] => [
  {
    id: 'ok', name: 'SPB_MikroTik-1', address: '10.0.0.2', enabled: true,
    current: { checked_at: recent(), status: 'online', snmp_status: 'ok' },
    summary: { interface_id: 'i1', name: 'ether1', checked_at: recent(), rx_bps: 2_500_000, tx_bps: 500_000, points: [] },
  },
  {
    id: 'down', name: 'MSK_MikroTik-1', address: '10.0.0.3', enabled: true,
    current: { checked_at: recent(), status: 'offline' },
  },
];

const detail = (): monitoringApi.MonitoringTargetDetail => ({
  ...targets()[1],
  interfaces: [{ id: 'i1', name: 'ether1', settings: { role: 'wan' }, current: { checked_at: recent(), oper: 1, rx_bps: 1000, tx_bps: 2000 } }],
  events: [{ id: 'e1', target_id: 'down', kind: 'unreachable', title: 'Устройство недоступно', severity: 'critical', opened_at: recent() }],
});

beforeEach(() => {
  mockPermissions = ['monitoring.read'];
  mockOfflineMode = false;
  jest.clearAllMocks();
  api.fetchMonitoringOverview.mockResolvedValue({ targets: targets(), worker: { enabled: true, heartbeat_at: recent() }, checked_at: recent() });
  api.fetchMonitoringTarget.mockResolvedValue(detail());
  api.fetchMonitoringHistory.mockResolvedValue({ points: [{ at: recent(), rx_bps: 4_000_000, cpu_pct: 20 }] });
  api.fetchMonitoringLatency.mockResolvedValue({ points: [{ at: recent(), latency_ms: 12 }] });
});

describe('NativeMonitoringScreen', () => {
  it('lets a slow overview response finish instead of cancelling it on every poll tick', async () => {
    jest.useFakeTimers();
    try {
      let release: (value: monitoringApi.MonitoringOverview) => void = () => {};
      api.fetchMonitoringOverview.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
      const screen = await render(<NativeMonitoringScreen />);
      await act(async () => {});
      expect(api.fetchMonitoringOverview).toHaveBeenCalledTimes(1);
      await act(async () => { jest.advanceTimersByTime(MONITORING_REFRESH_MS * 3); });
      expect(api.fetchMonitoringOverview).toHaveBeenCalledTimes(1);

      await act(async () => {
        release({ targets: targets(), worker: { enabled: true, heartbeat_at: recent() }, checked_at: recent() });
      });
      expect(screen.getByTestId('native-monitoring-target-ok')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('lists devices with live status and narrows to problems only', async () => {
    const screen = await render(<NativeMonitoringScreen />);
    expect(await screen.findByTestId('native-monitoring-target-ok')).toHaveTextContent(/В сети/);
    expect(screen.getByTestId('native-monitoring-target-down')).toHaveTextContent(/Нет связи/);
    expect(screen.getByTestId('native-monitoring-target-ok')).toHaveTextContent(/2,5 Мбит\/с/);

    await fireEvent.press(screen.getByTestId('native-monitoring-filter-issues'));
    expect(screen.queryByTestId('native-monitoring-target-ok')).toBeNull();
    expect(screen.getByTestId('native-monitoring-target-down')).toBeTruthy();
  });

  it('opens a device with its state, charts and events, and returns to the list', async () => {
    const screen = await render(<NativeMonitoringScreen />);
    await fireEvent.press(await screen.findByTestId('native-monitoring-target-down'));

    expect(await screen.findByTestId('native-monitoring-detail-status')).toHaveTextContent(/Нет связи/);
    await waitFor(() => expect(api.fetchMonitoringLatency).toHaveBeenCalledWith('down', expect.objectContaining({ hours: 24 })));
    await waitFor(() => expect(screen.getByTestId('native-monitoring-chart-latency')).toHaveTextContent(/12 мс/));
    expect(api.fetchMonitoringHistory).toHaveBeenCalledWith('down', expect.objectContaining({ interfaceId: 'i1', hours: 24 }));

    await fireEvent.press(screen.getByTestId('native-monitoring-period-168'));
    await waitFor(() => expect(api.fetchMonitoringHistory).toHaveBeenCalledWith('down', expect.objectContaining({ hours: 168 })));

    await fireEvent.press(screen.getByTestId('native-monitoring-tab-events'));
    expect(screen.getByTestId('native-monitoring-event-e1')).toHaveTextContent(/Устройство недоступно/);

    await fireEvent.press(screen.getByTestId('account-header-back'));
    expect(await screen.findByTestId('native-monitoring-target-ok')).toBeTruthy();
  });

  it('warns when the collector heartbeat is stale', async () => {
    api.fetchMonitoringOverview.mockResolvedValue({
      targets: targets(), worker: { enabled: true, heartbeat_at: new Date(Date.now() - 600_000).toISOString() },
    });
    const screen = await render(<NativeMonitoringScreen />);
    expect(await screen.findByTestId('native-monitoring-worker-stale')).toBeTruthy();
  });

  it('does not request data without the monitoring permission or while offline', async () => {
    mockPermissions = [];
    const denied = await render(<NativeMonitoringScreen />);
    expect(await denied.findByText('Нет доступа к разделу «Мониторинг».')).toBeTruthy();
    denied.unmount();

    mockPermissions = ['monitoring.read'];
    mockOfflineMode = true;
    const offline = await render(<NativeMonitoringScreen />);
    expect(await offline.findByText(/Автономный режим/)).toBeTruthy();
    expect(api.fetchMonitoringOverview).not.toHaveBeenCalled();
  });
});
