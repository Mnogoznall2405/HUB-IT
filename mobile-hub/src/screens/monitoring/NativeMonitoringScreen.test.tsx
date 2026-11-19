import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Appearance } from 'react-native';
import { MONITORING_REFRESH_MS } from '../../monitoring/monitoringModel';
import * as monitoringApi from '../../api/monitoringApi';
import { getFluentTokens, resolveFluentScheme } from '../../theme/fluentTokens';
import { NativeMonitoringDetail } from './NativeMonitoringDetail';
import { NativeMonitoringScreen } from './NativeMonitoringScreen';

const tokens = getFluentTokens(resolveFluentScheme('system', Appearance.getColorScheme() || 'light'));

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
  getMonitoringEvents: jest.fn(),
  probeMonitoringTarget: jest.fn(),
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
  api.getMonitoringEvents.mockResolvedValue([]);
  api.probeMonitoringTarget.mockResolvedValue(detail());
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

  it('lists the events feed with severity states and target names', async () => {
    api.getMonitoringEvents.mockResolvedValue([
      { id: 'e1', target_id: 'down', kind: 'unreachable', title: 'Устройство недоступно', severity: 'critical', opened_at: recent() },
      { id: 'e2', target_id: 'ok', kind: 'link', title: 'Линк на порту восстановлен', severity: 'warning', opened_at: recent(), closed_at: recent() },
    ]);
    const screen = await render(<NativeMonitoringScreen />);
    await screen.findByTestId('native-monitoring-target-ok');

    await fireEvent.press(screen.getByTestId('native-monitoring-section-events'));

    const open = await screen.findByTestId('native-monitoring-feed-event-e1');
    expect(open).toHaveTextContent(/Устройство недоступно/);
    expect(open).toHaveTextContent(/Москва/);
    expect(open).toHaveTextContent(/Открыто/);
    expect(screen.getByTestId('native-monitoring-feed-event-e2')).toHaveTextContent(/Завершено/);
    // Severity mapping: an open critical event uses the error tone, a finished one the success tone.
    expect(screen.getByTestId('native-monitoring-feed-status-e1')).toHaveStyle({ color: tokens.error });
    expect(screen.getByTestId('native-monitoring-feed-status-e2')).toHaveStyle({ color: tokens.success });
    expect(api.getMonitoringEvents).toHaveBeenCalledWith(expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('shows an inline error instead of crashing when the events feed fails', async () => {
    api.getMonitoringEvents.mockRejectedValue(new Error('Лента событий недоступна'));
    const screen = await render(<NativeMonitoringScreen />);
    await screen.findByTestId('native-monitoring-target-ok');

    await fireEvent.press(screen.getByTestId('native-monitoring-section-events'));

    expect(await screen.findByText('Лента событий недоступна')).toBeTruthy();
  });

  it('hides the probe action without the monitoring.manage permission', async () => {
    const screen = await render(<NativeMonitoringScreen />);
    await fireEvent.press(await screen.findByTestId('native-monitoring-target-down'));
    await screen.findByTestId('native-monitoring-detail-status');

    expect(screen.queryByTestId('native-monitoring-probe')).toBeNull();
    expect(api.probeMonitoringTarget).not.toHaveBeenCalled();
  });

  it('probes the selected target and reports the collected status with latency', async () => {
    mockPermissions = ['monitoring.read', 'monitoring.manage'];
    api.probeMonitoringTarget.mockResolvedValue({
      ...detail(),
      current: { checked_at: recent(), status: 'online', snmp_status: 'ok', ping: { status: 'online', latency_ms: 12 } },
    });
    const screen = await render(<NativeMonitoringScreen />);
    await fireEvent.press(await screen.findByTestId('native-monitoring-target-down'));
    await screen.findByTestId('native-monitoring-detail-status');

    await fireEvent.press(await screen.findByTestId('native-monitoring-probe'));

    await waitFor(() => expect(api.probeMonitoringTarget).toHaveBeenCalledWith('down'));
    const result = await screen.findByTestId('native-monitoring-probe-result');
    expect(result).toHaveTextContent(/В сети/);
    expect(result).toHaveTextContent(/12 мс/);
    // The collected snapshot replaces the stale detail, like on the web.
    await waitFor(() => expect(screen.getByTestId('native-monitoring-detail-status')).toHaveTextContent(/В сети/));
  });

  it('sends a single request when the probe button is tapped twice', async () => {
    mockPermissions = ['monitoring.read', 'monitoring.manage'];
    let release: (value: monitoringApi.MonitoringTargetDetail) => void = () => {};
    api.probeMonitoringTarget.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const screen = await render(<NativeMonitoringScreen />);
    await fireEvent.press(await screen.findByTestId('native-monitoring-target-down'));
    await screen.findByTestId('native-monitoring-detail-status');

    const button = await screen.findByTestId('native-monitoring-probe');
    await fireEvent.press(button);
    await fireEvent.press(button);
    expect(api.probeMonitoringTarget).toHaveBeenCalledTimes(1);
    await act(async () => { release(detail()); });
  });

  it('keeps the probe disabled in offline mode', async () => {
    const view = await render(
      <NativeMonitoringDetail target={targets()[0]} tokens={tokens} canManage offline />,
    );
    const button = await view.findByTestId('native-monitoring-probe');
    expect(button.props.accessibilityState?.disabled).toBe(true);
    await fireEvent.press(button);
    expect(api.probeMonitoringTarget).not.toHaveBeenCalled();
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
