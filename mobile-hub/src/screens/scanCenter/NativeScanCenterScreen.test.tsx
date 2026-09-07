import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as scanApi from '../../api/scanCenterApi';
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
  jest.clearAllMocks();
  mockPermissions = ['scan.read', 'scan.ack', 'scan.tasks'];
  mockOfflineMode = false;
  (scanApi.getScanDashboard as jest.Mock).mockResolvedValue(dashboard);
  (scanApi.listScanReviewItems as jest.Mock).mockImplementation(async ({ limit }: { limit?: number } = {}) => ({
    items: limit === 3 ? [{ id: 'job-1', hostname: 'HOST-1', agent_id: 'agent-1', branch: '', file_name: 'broken.pdf', source_kind: 'pdf', reason: 'ocr_timeout', created_at: 1 }] : [],
    total: 1,
    limit: limit || 50,
    offset: 0,
    has_more: false,
    next_offset: null,
  }));
  (scanApi.listScanIncidents as jest.Mock).mockResolvedValue({
    items: [{ id: 'incident-1', hostname: 'HOST-1', branch: 'Тюмень', file_name: 'secret.pdf', file_ext: 'pdf', source_kind: 'pdf', status: 'new', severity: 'high', category: 'dsp', short_reason: 'Найден гриф', user: 'Иванов', created_at: 1 }],
    total: 1,
    limit: 50,
    offset: 0,
    has_more: false,
    next_offset: null,
  });
  (scanApi.listScanAgents as jest.Mock).mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0, has_more: false, next_offset: null });
  (scanApi.listScanHosts as jest.Mock).mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0, has_more: false, next_offset: null });
});

it('loads the operational overview without exposing a web fallback', async () => {
  const view = await render(<NativeScanCenterScreen />);
  await waitFor(() => expect(view.getByText('Новые инциденты')).toBeTruthy());
  expect(scanApi.getScanDashboard).toHaveBeenCalledWith({ signal: expect.anything() });
  expect(view.getByText('broken.pdf')).toBeTruthy();
  expect(view.queryByTestId('native-scan-open-web')).toBeNull();
});

it('loads incidents lazily and does not expose native ACK', async () => {
  const view = await render(<NativeScanCenterScreen />);
  await waitFor(() => expect(view.getByTestId('native-scan-tab-incidents')).toBeTruthy());
  fireEvent.press(view.getByTestId('native-scan-tab-incidents'));
  await waitFor(() => expect(view.getByText('secret.pdf')).toBeTruthy());
  expect(scanApi.listScanIncidents).toHaveBeenCalledWith(expect.objectContaining({ status: 'new', limit: 50, offset: 0, signal: expect.anything() }));
  expect(view.queryByText('Подтвердить')).toBeNull();
  expect(view.getByText('Действия для этого раздела пока недоступны на мобильном устройстве')).toBeTruthy();
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
});

it('does not request Scan runtime without scan.read', async () => {
  mockPermissions = [];
  const view = await render(<NativeScanCenterScreen />);
  await waitFor(() => expect(view.getByText('Нет доступа')).toBeTruthy());
  expect(scanApi.getScanDashboard).not.toHaveBeenCalled();
  expect(scanApi.listScanIncidents).not.toHaveBeenCalled();
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
});
