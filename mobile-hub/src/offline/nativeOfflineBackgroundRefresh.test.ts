import { prepareNativeOfflineData } from './nativeOfflinePreparation';
import { readNativeOfflineCoverage } from './nativeOfflineCoverage';
import {
  NATIVE_OFFLINE_BACKGROUND_REFRESH_INTERVAL_MS,
  refreshStaleNativeOfflineData,
} from './nativeOfflineBackgroundRefresh';

jest.mock('./nativeOfflinePreparation', () => ({
  prepareNativeOfflineData: jest.fn(async () => ({ preparedModules: [], failedModules: [] })),
}));
jest.mock('./nativeOfflineCoverage', () => ({
  readNativeOfflineCoverage: jest.fn(async () => null),
}));

const mockPrepare = jest.mocked(prepareNativeOfflineData);
const mockReadCoverage = jest.mocked(readNativeOfflineCoverage);

beforeEach(() => {
  jest.clearAllMocks();
  mockReadCoverage.mockResolvedValue(null);
});

it('refreshes every permitted non-core native module when coverage is missing', async () => {
  await refreshStaleNativeOfflineData({
    userId: 17,
    isAdmin: false,
    permissions: ['dashboard.read', 'tasks.read', 'mail.access', 'docflow.read', 'my_files.read', 'company_structure.read'],
  });

  expect(mockPrepare).toHaveBeenCalledWith(expect.objectContaining({
    dashboard: true,
    feed: true,
    tasks: true,
    mail: true,
    docflow: true,
    myFiles: true,
    companyStructure: true,
    chat: false,
    notifications: false,
    addressBook: false,
    database: false,
  }));
});

it('skips fresh complete modules and refreshes a stale one', async () => {
  const now = Date.now();
  mockReadCoverage.mockResolvedValue({
    version: 1,
    userId: 17,
    updatedAt: new Date(now).toISOString(),
    entries: {
      dashboard: {
        moduleId: 'dashboard', status: 'complete', availableStatus: 'complete', loaded: 1, total: 1,
        unit: 'экран', revision: 1, savedAt: new Date(now).toISOString(), lastAttemptAt: new Date(now).toISOString(),
        errorCode: null, errorMessage: null,
      },
      feed: {
        moduleId: 'feed', status: 'complete', availableStatus: 'complete', loaded: 10, total: 10,
        unit: 'публикаций', revision: 1,
        savedAt: new Date(now - NATIVE_OFFLINE_BACKGROUND_REFRESH_INTERVAL_MS - 1).toISOString(),
        lastAttemptAt: new Date(now).toISOString(), errorCode: null, errorMessage: null,
      },
    },
  });

  await refreshStaleNativeOfflineData({ userId: 17, isAdmin: false, permissions: ['dashboard.read'] });

  expect(mockPrepare).toHaveBeenCalledWith(expect.objectContaining({ dashboard: false, feed: true }));
});

it('does nothing without due permitted modules', async () => {
  await expect(refreshStaleNativeOfflineData({ userId: 17, isAdmin: false, permissions: [] }))
    .resolves.toEqual({ preparedModules: [], failedModules: [] });
  expect(mockPrepare).not.toHaveBeenCalled();
});
