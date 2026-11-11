import {
  clearNativeOfflineCoverage,
  readNativeOfflineCoverage,
  recordNativeOfflineCoverageFailure,
  recordNativeOfflineCoverageSuccess,
} from './nativeOfflineCoverage';

const mockSnapshots = new Map<string, string>();
let mockWriteAllowed = true;

jest.mock('../cache/nativeSnapshotStorage', () => ({
  readEncryptedNativeSnapshot: jest.fn(async (scope: string, userId: number) => (
    mockSnapshots.get(`${scope}:${userId}`) || null
  )),
  writeEncryptedNativeSnapshot: jest.fn(async (scope: string, userId: number, value: string) => {
    if (!mockWriteAllowed) return false;
    mockSnapshots.set(`${scope}:${userId}`, value);
    return true;
  }),
  deleteEncryptedNativeSnapshot: jest.fn(async (scope: string, userId: number) => {
    mockSnapshots.delete(`${scope}:${userId}`);
  }),
}));

const COMPLETE_AT = '2026-09-04T08:00:00.000Z';
const FAILED_AT = '2026-09-04T09:00:00.000Z';

beforeEach(() => {
  mockSnapshots.clear();
  mockWriteAllowed = true;
});

it('stores coverage separately for each user', async () => {
  await expect(recordNativeOfflineCoverageSuccess(7, 'address-book', {
    status: 'complete', loaded: 2_692, total: 2_692, unit: 'people', savedAt: COMPLETE_AT,
  })).resolves.toBe(true);
  await expect(recordNativeOfflineCoverageSuccess(8, 'address-book', {
    status: 'partial', loaded: 100, total: 2_692, unit: 'people', savedAt: COMPLETE_AT,
  })).resolves.toBe(true);

  await expect(readNativeOfflineCoverage(7)).resolves.toEqual(expect.objectContaining({
    userId: 7,
    entries: {
      'address-book': expect.objectContaining({
        status: 'complete', availableStatus: 'complete', loaded: 2_692, total: 2_692,
        unit: 'people', revision: 1, savedAt: COMPLETE_AT, errorCode: null,
      }),
    },
  }));
  expect((await readNativeOfflineCoverage(8))?.entries['address-book']?.status).toBe('partial');
});

it('increments the available revision and clears an earlier error after success', async () => {
  await recordNativeOfflineCoverageSuccess(7, 'mail', {
    status: 'partial', loaded: 50, total: 80, unit: 'messages', savedAt: COMPLETE_AT,
  });
  await recordNativeOfflineCoverageFailure(7, 'mail', {
    errorCode: 'network_timeout', errorMessage: 'Сеть недоступна', lastAttemptAt: FAILED_AT,
  });
  await recordNativeOfflineCoverageSuccess(7, 'mail', {
    status: 'complete', loaded: 80, total: 80, unit: 'messages', savedAt: FAILED_AT,
  });

  expect((await readNativeOfflineCoverage(7))?.entries.mail).toEqual(expect.objectContaining({
    status: 'complete', availableStatus: 'complete', loaded: 80, total: 80,
    revision: 2, errorCode: null, errorMessage: null,
  }));
});

it('keeps the last available revision and metrics when a refresh fails', async () => {
  await recordNativeOfflineCoverageSuccess(7, 'inventory', {
    status: 'complete', loaded: 2_138, total: 2_138, unit: 'equipment', savedAt: COMPLETE_AT,
  });
  await expect(recordNativeOfflineCoverageFailure(7, 'inventory', {
    errorCode: 'http timeout',
    errorMessage: 'Bearer super-secret token=abc123 https://internal.example/api\nrequest failed',
    lastAttemptAt: FAILED_AT,
  })).resolves.toBe(true);

  expect((await readNativeOfflineCoverage(7))?.entries.inventory).toEqual({
    moduleId: 'inventory',
    status: 'failed',
    availableStatus: 'complete',
    loaded: 2_138,
    total: 2_138,
    unit: 'equipment',
    revision: 1,
    savedAt: COMPLETE_AT,
    lastAttemptAt: FAILED_AT,
    errorCode: 'HTTP_TIMEOUT',
    errorMessage: '[redacted] token=[redacted] [endpoint] request failed',
  });
});

it('records a failure without pretending that an available revision exists', async () => {
  await recordNativeOfflineCoverageFailure(7, 'tasks', {
    errorCode: '', errorMessage: '', lastAttemptAt: FAILED_AT, unit: 'tasks',
  });

  expect((await readNativeOfflineCoverage(7))?.entries.tasks).toEqual(expect.objectContaining({
    status: 'failed', availableStatus: null, loaded: 0, total: null, unit: 'tasks',
    revision: 0, savedAt: null, errorCode: 'OFFLINE_SYNC_FAILED',
    errorMessage: 'Не удалось обновить автономные данные',
  }));
});

it('does not replace the last stored manifest when an atomic write is rejected', async () => {
  await recordNativeOfflineCoverageSuccess(7, 'chat', {
    status: 'partial', loaded: 40, total: 100, unit: 'messages', savedAt: COMPLETE_AT,
  });
  mockWriteAllowed = false;

  await expect(recordNativeOfflineCoverageSuccess(7, 'chat', {
    status: 'complete', loaded: 100, total: 100, unit: 'messages', savedAt: FAILED_AT,
  })).resolves.toBe(false);

  expect((await readNativeOfflineCoverage(7))?.entries.chat).toEqual(expect.objectContaining({
    status: 'partial', loaded: 40, total: 100, revision: 1, savedAt: COMPLETE_AT,
  }));
});

it('serializes concurrent module updates so neither entry is lost', async () => {
  await Promise.all([
    recordNativeOfflineCoverageSuccess(7, 'chat', {
      status: 'complete', loaded: 10, total: 10, unit: 'messages', savedAt: COMPLETE_AT,
    }),
    recordNativeOfflineCoverageSuccess(7, 'mail', {
      status: 'partial', loaded: 50, total: 100, unit: 'messages', savedAt: COMPLETE_AT,
    }),
  ]);

  expect(Object.keys((await readNativeOfflineCoverage(7))?.entries || {}).sort()).toEqual(['chat', 'mail']);
});

it('clears only the requested user and rejects unsafe module ids', async () => {
  await recordNativeOfflineCoverageSuccess(7, 'chat', {
    status: 'complete', loaded: 1, total: 1, unit: 'messages', savedAt: COMPLETE_AT,
  });
  await recordNativeOfflineCoverageSuccess(8, 'chat', {
    status: 'complete', loaded: 1, total: 1, unit: 'messages', savedAt: COMPLETE_AT,
  });

  await expect(recordNativeOfflineCoverageSuccess(7, '../chat', {
    status: 'complete', loaded: 1, total: 1, unit: 'messages', savedAt: COMPLETE_AT,
  })).resolves.toBe(false);
  await clearNativeOfflineCoverage(7);

  await expect(readNativeOfflineCoverage(7)).resolves.toBeNull();
  expect(await readNativeOfflineCoverage(8)).not.toBeNull();
});
