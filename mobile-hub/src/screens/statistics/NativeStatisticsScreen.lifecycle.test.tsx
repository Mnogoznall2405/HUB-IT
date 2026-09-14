import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as statisticsApi from '../../api/statisticsApi';
import * as databaseApi from '../../api/databaseApi';
import { NativeStatisticsScreen } from './NativeStatisticsScreen';

let mockPermissions = ['statistics.read', 'mfu.read', 'database.write'];
let mockOfflineMode = false;
let mockUserId = 7;

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    offlineMode: mockOfflineMode,
    user: { id: mockUserId },
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
  mockUserId = 7;
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


function deferredSnapshot() {
 let resolve!: (value: unknown) => void;
 const promise = new Promise(done => { resolve = done; });
 return { promise, resolve };
}
function savedBranch(branch: string) {
 return { savedAt: Date.now(), data: { ...pcPayload.data, branches: [{ ...(pcPayload.data as statisticsApi.PcCleaningStatistics).branches[0], branch }] } };
}
function configureOfflineBootstrap() {
 const snapshots = require('../../cache/nativeSnapshotCache');
 snapshots.readNativeSnapshot.mockResolvedValue({ savedAt: Date.now(), data: {
  databases: [{ id: 'ITINVENT', name: 'Inventory' }], currentDatabase: { id: 'ITINVENT', name: 'Inventory' },
 } });
 return snapshots;
}
it('ignores the previous user delayed snapshot after the account changes',async()=>{
 mockOfflineMode=true;
 const snapshots=configureOfflineBootstrap();
 const pending=deferredSnapshot();
 snapshots.readNativeCollectionSnapshot.mockImplementation((_domain: string,userId: number)=>userId===7?pending.promise:Promise.resolve(savedBranch('User B')));
 const v=await render(<NativeStatisticsScreen/>);
 await waitFor(()=>expect(snapshots.readNativeCollectionSnapshot).toHaveBeenCalled());
 mockUserId=8;
 await v.rerender(<NativeStatisticsScreen/>);
 await waitFor(()=>expect(v.getByText('User B')).toBeTruthy());
 await act(async()=>pending.resolve(savedBranch('User A')));
 expect(v.queryByText('User A')).toBeNull();
 expect(v.getByText('User B')).toBeTruthy();
 await v.unmount();
});
it('ignores a delayed offline snapshot after reconnect loads current data',async()=>{
 mockOfflineMode=true;
 const snapshots=configureOfflineBootstrap();
 const pending=deferredSnapshot();
 snapshots.readNativeCollectionSnapshot.mockReturnValue(pending.promise);
 const v=await render(<NativeStatisticsScreen/>);
 await waitFor(()=>expect(snapshots.readNativeCollectionSnapshot).toHaveBeenCalled());
 mockOfflineMode=false;
 (statisticsApi.fetchStatistics as jest.Mock).mockResolvedValue({tab:'pc',data:savedBranch('Current online').data});
 await v.rerender(<NativeStatisticsScreen/>);
 await waitFor(()=>expect(v.getByText('Current online')).toBeTruthy());
 await act(async()=>pending.resolve(savedBranch('Old offline')));
 expect(v.queryByText('Old offline')).toBeNull();
 expect(v.getByText('Current online')).toBeTruthy();
 await v.unmount();
});
