import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as statisticsApi from '../../api/statisticsApi';
import * as databaseApi from '../../api/databaseApi';
import { NativeStatisticsScreen } from './NativeStatisticsScreen';

let mockPermissions = ['statistics.read', 'mfu.read', 'database.write'];
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
jest.mock('../../api/statisticsApi', () => ({
  fetchStatistics: jest.fn(),
  getPcCleaningRemaining: jest.fn(),
  addPcCleaningRecord: jest.fn(),
  statisticsExportUrl: jest.fn(() => 'https://hub.test/export.xlsx'),
}));
jest.mock('../../api/databaseApi', () => ({
  getCurrentDatabase: jest.fn(),
  listAvailableDatabases: jest.fn(),
  switchDatabase: jest.fn(),
}));
jest.mock('../../cache/nativeSnapshotCache', () => ({
  readNativeSnapshot: jest.fn(async () => null),
  writeNativeSnapshot: jest.fn(async () => true),
  readNativeCollectionSnapshot: jest.fn(async () => null),
  writeNativeCollectionSnapshot: jest.fn(async () => true),
  formatNativeSnapshotSavedAt: () => 'сегодня',
}));
jest.mock('../../files/authenticatedFileDownload', () => ({
  downloadAuthenticatedFile: jest.fn(async (_url: string, target: { uri: string }) => target),
}));
jest.mock('../../files/nativeAttachmentDownloads', () => ({
  shareNativeFile: jest.fn(async () => undefined),
}));
jest.mock('../../files/filePolicy', () => ({
  sanitizeNativeFileName: (name: string) => name,
}));
jest.mock('expo-file-system', () => {
  class MockFile {
    uri: string;
    constructor(...parts: unknown[]) { this.uri = parts.map(String).join('/'); }
    get exists() { return false; }
    delete() {}
  }
  return { File: MockFile, Paths: { cache: 'file:///cache' } };
});

const pcPayload: statisticsApi.StatisticsPayload = {
  tab: 'pc',
  data: {
    period_days: 90,
    start_date: '2026-06-14',
    end_date: '2026-09-12',
    totals: {
      total_pc: 20, cleaned_pc: 15, remaining_pc: 5,
      coverage_percent: 75, cleanings_total: 50, cleanings_period: 15,
    },
    branches: [
      {
        branch: 'Центральный', total_pc: 10, cleaned_pc: 8, remaining_pc: 2,
        coverage_percent: 80, cleanings_total: 25, cleanings_period: 8,
        remaining_pcs: [{
          inv_no: 'INV-1', serial_no: 'SN-1', hw_serial_no: '', location: 'Каб. 1',
          model_name: 'OptiPlex', employee: 'Иванов', last_cleaned_at: '',
          equipment_id: 1, manufacturer: '', current_description: '',
        }],
      },
      {
        branch: 'Юг', total_pc: 10, cleaned_pc: 7, remaining_pc: 3,
        coverage_percent: 70, cleanings_total: 25, cleanings_period: 7,
        remaining_pcs: [],
      },
    ],
  },
};

const mfuPayload: statisticsApi.StatisticsPayload = {
  tab: 'mfu',
  data: {
    period_days: 90, start_date: '2026-06-14', end_date: '2026-09-12',
    totals: { total_operations: 12, unique_branches: 2, unique_locations: 4 },
    by_type_period: { 'Картридж': 9 },
    by_item_period: { '057H': 9 },
    by_branch_period: { 'Центральный': 10, 'Юг': 2 },
    by_model_period: [{ model: 'Canon MF443', count: 8 }],
    by_location_period: [{
      branch: 'Центральный', location: 'Каб. 4', operations: 9,
      last_timestamp: '2026-09-10T10:00:00Z', top_items: [{ name: '057H', count: 9 }],
    }],
    recent_replacements: [{
      timestamp: '2026-09-10T10:00:00Z', branch: 'Центральный', location: 'Каб. 4',
      printer_model: 'Canon MF443', component_type: 'Картридж', replacement_item: '057H',
    }],
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPermissions = ['statistics.read', 'mfu.read', 'database.write'];
  mockOfflineMode = false;
  (databaseApi.listAvailableDatabases as jest.Mock).mockResolvedValue([
    { id: 'ITINVENT', name: 'Инвентарь' },
    { id: 'OBJ-ITINVENT', name: 'Объекты' },
  ]);
  (databaseApi.getCurrentDatabase as jest.Mock).mockResolvedValue({ id: 'ITINVENT', name: 'Инвентарь' });
  (statisticsApi.fetchStatistics as jest.Mock).mockImplementation(async (tab: string) => (
    tab === 'pc' ? pcPayload : tab === 'mfu' ? mfuPayload : { tab, data: { totals: {} } }
  ));
});

it('loads pc statistics for the current database and filters branches', async () => {
  const view = await render(<NativeStatisticsScreen />);
  await waitFor(() => expect(view.getByText('Центральный')).toBeTruthy());
  expect(statisticsApi.fetchStatistics).toHaveBeenCalledWith('pc', expect.objectContaining({
    periodDays: 90,
    databaseId: 'ITINVENT',
  }));
  expect(view.getByText('20')).toBeTruthy(); // ПК всего
  expect(view.getByText('75%')).toBeTruthy();

  await fireEvent.changeText(view.getByTestId('native-statistics-search'), 'юг');
  await waitFor(() => expect(view.queryByText('Центральный')).toBeNull());
  expect(view.getByText('Юг')).toBeTruthy();
  await view.unmount();
});

it('switches tabs and periods, reloading per selection', async () => {
  const view = await render(<NativeStatisticsScreen />);
  await waitFor(() => expect(view.getByText('Центральный')).toBeTruthy());

  await fireEvent.press(view.getByTestId('native-statistics-tab-mfu'));
  await waitFor(() => expect(view.getByText('Canon MF443')).toBeTruthy());
  expect(statisticsApi.fetchStatistics).toHaveBeenCalledWith('mfu', expect.objectContaining({ periodDays: 90 }));

  await fireEvent.press(view.getByTestId('native-statistics-period-30'));
  await waitFor(() => expect(statisticsApi.fetchStatistics).toHaveBeenCalledWith(
    'mfu', expect.objectContaining({ periodDays: 30 }),
  ));
  await view.unmount();
});

it('hides the mfu tab without mfu.read permission', async () => {
  mockPermissions = ['statistics.read'];
  const view = await render(<NativeStatisticsScreen />);
  await waitFor(() => expect(view.getByText('Центральный')).toBeTruthy());
  expect(view.queryByTestId('native-statistics-tab-mfu')).toBeNull();
  await view.unmount();
});

it('opens the remaining PCs sheet and marks a cleaning', async () => {
  (statisticsApi.getPcCleaningRemaining as jest.Mock).mockResolvedValue({
    branch: 'Центральный', period_days: 90, total_pc: 10, remaining_pc: 2,
    remaining_pcs: [
      {
        inv_no: 'INV-1', serial_no: 'SN-1', hw_serial_no: '', location: 'Каб. 1',
        model_name: 'OptiPlex', employee: 'Иванов', last_cleaned_at: '',
        equipment_id: 1, manufacturer: '', current_description: '',
      },
      {
        inv_no: 'INV-2', serial_no: 'SN-2', hw_serial_no: '', location: 'Каб. 2',
        model_name: 'ThinkCentre', employee: 'Петрова', last_cleaned_at: '2026-01-01T10:00:00Z',
        equipment_id: null, manufacturer: '', current_description: '',
      },
    ],
  });
  (statisticsApi.addPcCleaningRecord as jest.Mock).mockResolvedValue(undefined);

  const view = await render(<NativeStatisticsScreen />);
  await waitFor(() => expect(view.getByText('Центральный')).toBeTruthy());
  await fireEvent.press(view.getByTestId('native-statistics-branch-Центральный'));
  await waitFor(() => expect(view.getByText('INV-2 · SN-2')).toBeTruthy());

  await fireEvent.press(view.getByTestId('native-remaining-clean-0'));
  await waitFor(() => expect(view.getByTestId('native-remaining-confirm')).toBeTruthy());
  await fireEvent.press(view.getByTestId('native-remaining-confirm'));

  await waitFor(() => expect(statisticsApi.addPcCleaningRecord).toHaveBeenCalledWith(expect.objectContaining({
    serial_number: 'SN-1',
    branch: 'Центральный',
    db_name: 'ITINVENT',
    equipment_id: 1,
  })));
  await waitFor(() => expect(view.queryByText('INV-1 · SN-1')).toBeNull());
  await view.unmount();
});

it('switches database through the picker and reloads', async () => {
  (databaseApi.switchDatabase as jest.Mock).mockResolvedValue({ id: 'OBJ-ITINVENT', name: 'Объекты' });
  const view = await render(<NativeStatisticsScreen />);
  await waitFor(() => expect(view.getByText('Центральный')).toBeTruthy());

  await fireEvent.press(view.getByTestId('native-statistics-db'));
  await waitFor(() => expect(view.getByTestId('native-statistics-db-option-OBJ-ITINVENT')).toBeTruthy());
  await fireEvent.press(view.getByTestId('native-statistics-db-option-OBJ-ITINVENT'));

  await waitFor(() => expect(databaseApi.switchDatabase).toHaveBeenCalledWith('OBJ-ITINVENT'));
  await waitFor(() => expect(statisticsApi.fetchStatistics).toHaveBeenCalledWith(
    'pc', expect.objectContaining({ databaseId: 'OBJ-ITINVENT' }),
  ));
  await view.unmount();
});

it('shows the offline snapshot instead of calling the API', async () => {
  mockOfflineMode = true;
  const snapshots = require('../../cache/nativeSnapshotCache') as {
    readNativeCollectionSnapshot: jest.Mock;
    readNativeSnapshot: jest.Mock;
  };
  snapshots.readNativeSnapshot.mockResolvedValueOnce({ savedAt: Date.now(), data: {
    databases: [{ id: 'ITINVENT', name: 'Инвентарь' }],
    currentDatabase: { id: 'ITINVENT', name: 'Инвентарь' },
  } });
  jest.mocked(databaseApi.listAvailableDatabases).mockRejectedValue(new Error('Offline'));
  jest.mocked(databaseApi.getCurrentDatabase).mockRejectedValue(new Error('Offline'));
  snapshots.readNativeCollectionSnapshot.mockResolvedValue({
    savedAt: Date.now(),
    data: pcPayload.data,
  });

  const view = await render(<NativeStatisticsScreen />);
  await waitFor(() => expect(view.getByText('Центральный')).toBeTruthy());
  expect(statisticsApi.fetchStatistics).not.toHaveBeenCalled();
  expect(databaseApi.listAvailableDatabases).not.toHaveBeenCalled();
  expect(databaseApi.getCurrentDatabase).not.toHaveBeenCalled();
  expect(snapshots.readNativeSnapshot).toHaveBeenCalledWith('database-bootstrap', 7);
  expect(view.getByText(/данные из кэша/i)).toBeTruthy();
  await view.unmount();
});

it('explains a missing offline database without issuing network requests', async () => {
  mockOfflineMode = true;
  const view = await render(<NativeStatisticsScreen />);
  await waitFor(() => expect(view.getByText(/Нет подключения и сохранённой базы для статистики/)).toBeTruthy());
  expect(databaseApi.getCurrentDatabase).not.toHaveBeenCalled();
  expect(statisticsApi.fetchStatistics).not.toHaveBeenCalled();
});

it('retries database bootstrap after a transient failure and persists the selection', async () => {
  jest.mocked(databaseApi.getCurrentDatabase).mockReset();
  jest.mocked(databaseApi.getCurrentDatabase)
    .mockRejectedValueOnce(new Error('Temporary bootstrap failure'))
    .mockResolvedValueOnce({ id: 'ITINVENT', name: 'Инвентарь', locked: false });
  const view = await render(<NativeStatisticsScreen />);
  await waitFor(() => expect(view.getByTestId('native-statistics-retry')).toBeTruthy());
  await fireEvent.press(view.getByTestId('native-statistics-retry'));
  await waitFor(() => expect(view.getByText('Центральный')).toBeTruthy());
  const snapshots = require('../../cache/nativeSnapshotCache');
  expect(snapshots.writeNativeSnapshot).toHaveBeenCalledWith('database-bootstrap', 7, expect.objectContaining({
    currentDatabase: { id: 'ITINVENT', name: 'Инвентарь', locked: false },
  }));
});
