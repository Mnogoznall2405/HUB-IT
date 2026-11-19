import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import * as scanApi from '../../api/scanCenterApi';
import * as tokenStore from '../../auth/tokenStore';
import { NativeScanCenterScreen } from './NativeScanCenterScreen';

let mockPermissions = ['scan.read', 'scan.ack', 'scan.tasks'];
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
jest.mock('../../api/scanCenterApi', () => ({
  getScanDashboard: jest.fn(),
  listScanReviewItems: jest.fn(),
  listScanIncidents: jest.fn(),
  listScanAgents: jest.fn(),
  listScanHosts: jest.fn(),
  ackScanIncident: jest.fn(),
  bulkAckScanIncidents: jest.fn(),
}));

const dashboard: scanApi.ScanDashboard = {
  totals: { incidents_new: 2, analysis_incomplete: 1, agents_total: 3, agents_online: 2 },
  performance: { completed: 12, throughput_per_hour: 2, pending_oldest_age_sec: 0 },
  ingest_limits: {},
  expected_agent_version: '1.2.3',
  cached: false,
  degraded: false,
  cache_age_sec: 0,
  daily: [],
  by_severity: [],
  by_branch: [],
};

beforeEach(() => {
  mockPermissions = ['scan.read', 'scan.ack', 'scan.tasks'];
  mockOfflineMode = false;
  // mockReset (not clearAllMocks): unconsumed mockResolvedValueOnce queues must
  // not leak into the next test when a previous case aborts early.
  (scanApi.getScanDashboard as jest.Mock).mockReset().mockResolvedValue(dashboard);
  (scanApi.listScanReviewItems as jest.Mock).mockReset().mockImplementation(async ({ limit }: { limit?: number } = {}) => ({
    items: limit === 3 ? [{ id: 'job-1', hostname: 'HOST-1', agent_id: 'agent-1', branch: '', file_name: 'broken.pdf', source_kind: 'pdf', reason: 'ocr_timeout', created_at: 1 }] : [],
    total: 1,
    limit: limit || 50,
    offset: 0,
    has_more: false,
    next_offset: null,
  }));
  (scanApi.listScanIncidents as jest.Mock).mockReset().mockResolvedValue({
    items: [makeIncident('incident-1')],
    total: 1,
    limit: 50,
    offset: 0,
    has_more: false,
    next_offset: null,
  });
  (scanApi.listScanAgents as jest.Mock).mockReset().mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0, has_more: false, next_offset: null });
  (scanApi.listScanHosts as jest.Mock).mockReset().mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0, has_more: false, next_offset: null });
  (scanApi.ackScanIncident as jest.Mock).mockReset().mockResolvedValue({ success: true, incident: { id: 'incident-1', status: 'ack', changed: true } });
  (scanApi.bulkAckScanIncidents as jest.Mock).mockReset().mockResolvedValue({ success: true, acked_count: 0, total_matched: 0 });
});

function makeIncident(id: string, status = 'new') {
  return {
    id,
    hostname: 'HOST-1',
    branch: 'Тюмень',
    file_name: `${id === 'incident-1' ? 'secret' : id}.pdf`,
    file_ext: 'pdf',
    source_kind: 'pdf',
    status,
    severity: 'high',
    category: 'dsp',
    short_reason: 'Найден гриф',
    user: 'Иванов',
    created_at: 1,
  };
}

const emptyIncidentPage = { items: [], total: 0, limit: 50, offset: 0, has_more: false, next_offset: null };

it('loads the operational overview without exposing a web fallback', async () => {
  const view = await render(<NativeScanCenterScreen />);
  await waitFor(() => expect(view.getByText('Новые инциденты')).toBeTruthy());
  expect(scanApi.getScanDashboard).toHaveBeenCalledWith({ signal: expect.anything() });
  expect(view.getByText('broken.pdf')).toBeTruthy();
  expect(view.queryByTestId('native-scan-open-web')).toBeNull();
  await view.unmount();
});

it('loads incidents lazily and exposes acknowledge actions instead of the stub', async () => {
  const view = await render(<NativeScanCenterScreen />);
  await waitFor(() => expect(view.getByTestId('native-scan-tab-incidents')).toBeTruthy());
  fireEvent.press(view.getByTestId('native-scan-tab-incidents'));
  await waitFor(() => expect(view.getByText('secret.pdf')).toBeTruthy());
  expect(scanApi.listScanIncidents).toHaveBeenCalledWith(expect.objectContaining({ status: 'new', limit: 50, offset: 0, signal: expect.anything() }));
  expect(view.getByTestId('native-scan-incident-ack-incident-1')).toBeTruthy();
  expect(view.getByTestId('native-scan-select-incidents')).toBeTruthy();
  expect(view.queryByText('Действия для этого раздела пока недоступны на мобильном устройстве')).toBeNull();
  await view.unmount();
});

it('acks a single incident, drops it from the «Новые» list and resyncs', async () => {
  (scanApi.listScanIncidents as jest.Mock)
    .mockResolvedValueOnce({ items: [makeIncident('incident-1')], total: 1, limit: 50, offset: 0, has_more: false, next_offset: null })
    .mockResolvedValue(emptyIncidentPage);
  const view = await render(<NativeScanCenterScreen />);
  await fireEvent.press(await view.findByTestId('native-scan-tab-incidents'));
  const ackButton = await view.findByTestId('native-scan-incident-ack-incident-1');

  await fireEvent.press(ackButton);

  await waitFor(() => expect(scanApi.ackScanIncident).toHaveBeenCalledTimes(1));
  expect(scanApi.ackScanIncident).toHaveBeenCalledWith('incident-1');
  await waitFor(() => expect(view.queryByText('secret.pdf')).toBeNull());
  await waitFor(() => expect(scanApi.listScanIncidents).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(view.getByText('Нет совпадений')).toBeTruthy());
  await view.unmount();
});

it('sends only one ack request on a double tap', async () => {
  let resolveAck: ((value: unknown) => void) | undefined;
  (scanApi.ackScanIncident as jest.Mock).mockImplementation(
    () => new Promise((resolve) => { resolveAck = resolve; }),
  );
  const view = await render(<NativeScanCenterScreen />);
  await fireEvent.press(await view.findByTestId('native-scan-tab-incidents'));
  const ackButton = await view.findByTestId('native-scan-incident-ack-incident-1');

  await fireEvent.press(ackButton);
  // A rapid second tap while the POST is in flight must not issue another one.
  await fireEvent.press(ackButton);
  expect(scanApi.ackScanIncident).toHaveBeenCalledTimes(1);

  await act(async () => { resolveAck?.({ success: true, incident: { id: 'incident-1', status: 'ack', changed: true } }); });
  // The ack triggers a silent resync — let it land before the test ends.
  await waitFor(() => expect(scanApi.listScanIncidents).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(view.getByTestId('native-scan-incident-ack-incident-1')).toBeTruthy());
  await view.unmount();
});

it('bulk acks all selected new incidents in one request', async () => {
  (scanApi.listScanIncidents as jest.Mock)
    .mockResolvedValueOnce({ items: [makeIncident('incident-1'), makeIncident('incident-2')], total: 2, limit: 50, offset: 0, has_more: false, next_offset: null })
    .mockResolvedValue(emptyIncidentPage);
  (scanApi.bulkAckScanIncidents as jest.Mock).mockResolvedValue({ success: true, acked_count: 2, total_matched: 2 });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const view = await render(<NativeScanCenterScreen />);
  await fireEvent.press(await view.findByTestId('native-scan-tab-incidents'));
  await view.findByTestId('native-scan-incident-ack-incident-2');

  await fireEvent.press(view.getByTestId('native-scan-select-incidents'));
  await fireEvent.press(view.getByTestId('native-scan-incident-incident-1'));
  await fireEvent.press(view.getByTestId('native-scan-incident-incident-2'));
  await fireEvent.press(view.getByTestId('native-scan-bulk-ack'));

  expect(alert).toHaveBeenCalledWith('Подтвердить массовую отметку', expect.any(String), expect.any(Array));
  const buttons = alert.mock.calls.at(-1)![2] as Array<{ text?: string; onPress?: () => void }>;
  await act(async () => { buttons.find((button) => button.text === 'Отметить просмотренными')?.onPress?.(); });

  await waitFor(() => expect(scanApi.bulkAckScanIncidents).toHaveBeenCalledTimes(1));
  expect(scanApi.bulkAckScanIncidents).toHaveBeenCalledWith(['incident-1', 'incident-2']);
  await waitFor(() => expect(view.queryByTestId('native-scan-selection-bar')).toBeNull());
  await waitFor(() => expect(view.queryByText('incident-2.pdf')).toBeNull());
  await waitFor(() => expect(scanApi.listScanIncidents).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(view.getByText('Нет совпадений')).toBeTruthy());
  await view.unmount();
  alert.mockRestore();
});

it('reports a partial bulk result with counts', async () => {
  (scanApi.listScanIncidents as jest.Mock)
    .mockResolvedValueOnce({ items: [makeIncident('incident-1'), makeIncident('incident-2')], total: 2, limit: 50, offset: 0, has_more: false, next_offset: null })
    .mockResolvedValue(emptyIncidentPage);
  (scanApi.bulkAckScanIncidents as jest.Mock).mockResolvedValue({ success: true, acked_count: 1, total_matched: 2 });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const view = await render(<NativeScanCenterScreen />);
  await fireEvent.press(await view.findByTestId('native-scan-tab-incidents'));
  await fireEvent.press(view.getByTestId('native-scan-select-incidents'));
  await fireEvent.press(view.getByTestId('native-scan-incident-incident-1'));
  await fireEvent.press(view.getByTestId('native-scan-incident-incident-2'));
  await fireEvent.press(view.getByTestId('native-scan-bulk-ack'));

  const buttons = alert.mock.calls.at(-1)![2] as Array<{ text?: string; onPress?: () => void }>;
  await act(async () => { buttons.find((button) => button.text === 'Отметить просмотренными')?.onPress?.(); });

  await waitFor(() => expect(view.getByText(/Отмечено просмотренными 1 из 2 инцидентов/)).toBeTruthy());
  await waitFor(() => expect(scanApi.listScanIncidents).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(view.getByText('Нет совпадений')).toBeTruthy());
  await view.unmount();
  alert.mockRestore();
});

it('keeps the selection actionable after a failed bulk request', async () => {
  (scanApi.bulkAckScanIncidents as jest.Mock).mockRejectedValue(new Error('scan runtime unavailable'));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const view = await render(<NativeScanCenterScreen />);
  await fireEvent.press(await view.findByTestId('native-scan-tab-incidents'));
  await fireEvent.press(view.getByTestId('native-scan-select-incidents'));
  await fireEvent.press(view.getByTestId('native-scan-incident-incident-1'));
  await fireEvent.press(view.getByTestId('native-scan-bulk-ack'));

  const buttons = alert.mock.calls.at(-1)![2] as Array<{ text?: string; onPress?: () => void }>;
  await act(async () => { buttons.find((button) => button.text === 'Отметить просмотренными')?.onPress?.(); });

  await waitFor(() => expect(view.getByText(/scan runtime unavailable/)).toBeTruthy());
  await waitFor(() => expect(scanApi.listScanIncidents).toHaveBeenCalledTimes(2));
  expect(view.getByText('Выбрано: 1')).toBeTruthy();
  expect(view.getByTestId('native-scan-bulk-ack')).toBeTruthy();
  await view.unmount();
  alert.mockRestore();
});

it('hides acknowledge actions without scan.ack', async () => {
  mockPermissions = ['scan.read'];
  const view = await render(<NativeScanCenterScreen />);
  await fireEvent.press(await view.findByTestId('native-scan-tab-incidents'));
  await waitFor(() => expect(view.getByText('secret.pdf')).toBeTruthy());
  expect(view.queryByTestId('native-scan-incident-ack-incident-1')).toBeNull();
  expect(view.queryByTestId('native-scan-select-incidents')).toBeNull();
  expect(view.queryByText('Подтвердить')).toBeNull();
  await view.unmount();
});

it('hides acknowledge actions in offline mode', async () => {
  mockOfflineMode = true;
  const view = await render(<NativeScanCenterScreen />);
  await fireEvent.press(await view.findByTestId('native-scan-tab-incidents'));
  await waitFor(() => expect(view.getByText(/Автономный режим/)).toBeTruthy());
  expect(view.queryByTestId('native-scan-select-incidents')).toBeNull();
  expect(view.queryByText('Подтвердить')).toBeNull();
  expect(scanApi.listScanIncidents).not.toHaveBeenCalled();
  await view.unmount();
});

it('drops the ack result when the session changes mid-flight', async () => {
  let generation = 0;
  const generationSpy = jest.spyOn(tokenStore, 'getSessionGeneration').mockImplementation(() => generation);
  try {
    let resolveAck!: (value: unknown) => void;
    (scanApi.ackScanIncident as jest.Mock).mockImplementation(() => new Promise((resolve) => { resolveAck = resolve; }));
    const view = await render(<NativeScanCenterScreen />);
    await fireEvent.press(await view.findByTestId('native-scan-tab-incidents'));
    await fireEvent.press(await view.findByTestId('native-scan-incident-ack-incident-1'));
    await waitFor(() => expect(scanApi.ackScanIncident).toHaveBeenCalledTimes(1));

    generation += 1;
    await act(async () => {
      resolveAck({ success: true, incident: { id: 'incident-1', status: 'ack', changed: true } });
    });
    // A stale result is dropped: no list mutation, no resync. Wait for the busy
    // flag to clear so the ack continuation fully lands before the test ends.
    await waitFor(() => {
      expect(view.getByTestId('native-scan-incident-ack-incident-1').props.accessibilityState).toMatchObject({ busy: false });
    });
    expect(view.getByText('secret.pdf')).toBeTruthy();
    expect(scanApi.listScanIncidents).toHaveBeenCalledTimes(1);
    await view.unmount();
  } finally {
    generationSpy.mockRestore();
  }
});

it('offers an explicit retry when a lazy list request fails', async () => {
  (scanApi.listScanHosts as jest.Mock)
    .mockRejectedValueOnce(new Error('scan runtime unavailable'))
    .mockResolvedValueOnce({ items: [], total: 0, limit: 50, offset: 0, has_more: false, next_offset: null });
  const view = await render(<NativeScanCenterScreen />);
  await waitFor(() => expect(view.getByTestId('native-scan-tab-hosts')).toBeTruthy());

  fireEvent.press(view.getByTestId('native-scan-tab-hosts'));
  await waitFor(() => expect(view.getByTestId('native-scan-list-retry')).toBeTruthy());
  fireEvent.press(view.getByTestId('native-scan-list-retry'));

  await waitFor(() => expect(scanApi.listScanHosts).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(view.queryByTestId('native-scan-list-retry')).toBeNull());
  await view.unmount();
});

it('does not request Scan runtime without scan.read', async () => {
  mockPermissions = [];
  const view = await render(<NativeScanCenterScreen />);
  await waitFor(() => expect(view.getByText('Нет доступа')).toBeTruthy());
  expect(scanApi.getScanDashboard).not.toHaveBeenCalled();
  expect(scanApi.listScanIncidents).not.toHaveBeenCalled();
  await view.unmount();
});

it('distinguishes an empty filtered result and clears the actual API filter', async () => {
  (scanApi.listScanIncidents as jest.Mock).mockResolvedValue({ items: [], total: 0, has_more: false });
  const view = await render(<NativeScanCenterScreen />);
  await fireEvent.press(await view.findByTestId('native-scan-tab-incidents'));
  expect(await view.findByText('Нет совпадений')).toBeTruthy();
  await fireEvent.press(view.getByLabelText('Сбросить поиск и фильтры'));
  await waitFor(() => expect(scanApi.listScanIncidents).toHaveBeenLastCalledWith(expect.objectContaining({ status: '', q: '' })));
  expect(await view.findByText('В этом списке пока нет данных')).toBeTruthy();
  expect(view.getByLabelText('Обновить список')).toBeTruthy();
  await view.unmount();
});
