import {
  findNativeEquipmentCatalogItem,
  invalidateNativeEquipmentCatalogCache,
  readNativeEquipmentCatalogSnapshot,
  writeNativeEquipmentCatalogSnapshot,
} from './nativeEquipmentCatalogSnapshot';
import {
  readNativeSnapshot,
  writeNativeSnapshot,
} from './nativeSnapshotCache';
import type { EquipmentRecord } from '../api/databaseApi';

const mockSnapshots = new Map<string, unknown>();
const mockSavedAts = new Map<string, number>();
let mockBeforeSnapshotWrite: ((scope: string, data: unknown) => void) | null = null;
let mockSessionGeneration = 1;

function mockReadNativeSnapshotDefault(
  scope: string,
  userId: number,
  maxAgeMs = Number.MAX_SAFE_INTEGER,
): Promise<{ savedAt: number; data: unknown } | null> {
  const data = mockSnapshots.get(`${userId}:${scope}`);
  if (data === undefined) return Promise.resolve(null);
  const savedAt = mockSavedAts.get(`${userId}:${scope}`) ?? 1;
  if (maxAgeMs < Number.MAX_SAFE_INTEGER && Date.now() - savedAt > maxAgeMs) {
    return Promise.resolve(null);
  }
  return Promise.resolve({ savedAt, data });
}

jest.mock('../auth/tokenStore', () => ({
  getSessionGeneration: () => mockSessionGeneration,
}));

jest.mock('./nativeSnapshotCache', () => {
  const listeners: Array<(userId: number) => void> = [];
  return {
    readNativeSnapshot: jest.fn((scope: string, userId: number, maxAgeMs?: number) => (
      mockReadNativeSnapshotDefault(scope, userId, maxAgeMs)
    )),
    writeNativeSnapshot: jest.fn(async (scope: string, userId: number, data: unknown) => {
      const bytes = new TextEncoder().encode(JSON.stringify({
        version: 1,
        userId,
        savedAt: 1,
        data,
      })).byteLength;
      if (bytes > 2 * 1024 * 1024) return false;
      mockSnapshots.set(`${userId}:${scope}`, data);
      mockSavedAts.set(`${userId}:${scope}`, Date.now());
      mockBeforeSnapshotWrite?.(scope, data);
      return true;
    }),
    addNativeSnapshotClearListener: jest.fn((listener: (userId: number) => void) => {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      };
    }),
    getClearListeners: () => listeners,
  };
});

jest.mock('./nativeSnapshotStorage', () => ({
  MAX_NATIVE_SNAPSHOT_BYTES: 2 * 1024 * 1024,
  deleteEncryptedNativeSnapshot: jest.fn(async (scope: string, userId: number) => {
    mockSnapshots.delete(`${userId}:${scope}`);
    mockSavedAts.delete(`${userId}:${scope}`);
  }),
}));

function equipment(count: number, descriptionLength = 64): EquipmentRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    inv_no: `INV-${String(index).padStart(6, '0')}`,
    serial_no: '',
    hw_serial_no: '',
    part_no: '',
    model_name: `Model ${index}`,
    type_name: 'Компьютер',
    vendor_name: '',
    status_name: '',
    employee_name: '',
    employee_dept: '',
    employee_email: '',
    branch_name: '',
    location_name: '',
    ip_address: '',
    mac_address: '',
    network_name: '',
    domain_name: '',
    description: 'x'.repeat(descriptionLength),
    hub_db_id: '',
    hub_db_name: '',
    raw: {},
  }));
}

const mockReadSnapshot = jest.mocked(readNativeSnapshot);
const mockWriteSnapshot = jest.mocked(writeNativeSnapshot);

function countScopeReads(shard: boolean): number {
  return mockReadSnapshot.mock.calls.filter(
    ([scope]) => String(scope).includes('database-catalog-shard-') === shard
      && String(scope).includes('database-catalog'),
  ).length;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSnapshots.clear();
  mockSavedAts.clear();
  mockBeforeSnapshotWrite = null;
  mockSessionGeneration = 1;
  invalidateNativeEquipmentCatalogCache();
  mockReadSnapshot.mockImplementation((scope: string, userId: number, maxAgeMs?: number) => (
    mockReadNativeSnapshotDefault(scope, userId, maxAgeMs)
  ));
  mockWriteSnapshot.mockImplementation(async (scope: string, userId: number, data: unknown) => {
    const bytes = new TextEncoder().encode(JSON.stringify({
      version: 1,
      userId,
      savedAt: 1,
      data,
    })).byteLength;
    if (bytes > 2 * 1024 * 1024) return false;
    mockSnapshots.set(`${userId}:${scope}`, data);
    mockSavedAts.set(`${userId}:${scope}`, Date.now());
    mockBeforeSnapshotWrite?.(scope, data);
    return true;
  });
});

it('persists and restores a complete equipment catalog larger than one snapshot', async () => {
  const items = equipment(5_000, 512);

  await expect(writeNativeEquipmentCatalogSnapshot(17, 'ITINVENT', items, items.length)).resolves.toBe(true);
  await expect(readNativeEquipmentCatalogSnapshot(17, 'ITINVENT')).resolves.toEqual(
    expect.objectContaining({
      data: expect.objectContaining({ databaseId: 'ITINVENT', total: items.length, equipment: items }),
    }),
  );
});

it('keeps the previous complete catalog if a replacement item cannot be stored', async () => {
  const previous = equipment(3);
  await expect(writeNativeEquipmentCatalogSnapshot(17, 'ITINVENT', previous, previous.length)).resolves.toBe(true);

  const oversized = equipment(1, 2_200_000);
  await expect(writeNativeEquipmentCatalogSnapshot(17, 'ITINVENT', oversized, oversized.length)).resolves.toBe(false);
  await expect(readNativeEquipmentCatalogSnapshot(17, 'ITINVENT')).resolves.toEqual(
    expect.objectContaining({ data: expect.objectContaining({ equipment: previous }) }),
  );
});

it('yields to the UI before writing the first shard of a large catalog', async () => {
  const items = equipment(6_000, 512);
  let uiTurnReached = false;
  let uiTurnReachedBeforeFirstWrite: boolean | null = null;
  const timer = setTimeout(() => { uiTurnReached = true; }, 0);
  mockBeforeSnapshotWrite = () => {
    if (uiTurnReachedBeforeFirstWrite == null) uiTurnReachedBeforeFirstWrite = uiTurnReached;
  };

  await writeNativeEquipmentCatalogSnapshot(17, 'ITINVENT', items, items.length);
  clearTimeout(timer);

  expect(uiTurnReachedBeforeFirstWrite).toBe(true);
});

it('keeps encrypted catalog shards comfortably below the Android bridge limit', async () => {
  const items = equipment(5_000, 512);

  await expect(writeNativeEquipmentCatalogSnapshot(17, 'ITINVENT', items, items.length)).resolves.toBe(true);

  const shardSizes = [...mockSnapshots.entries()]
    .filter(([key, value]) => key.includes('database-catalog-shard-') && (value as { equipment?: unknown[] }).equipment)
    .map(([, value]) => new TextEncoder().encode(JSON.stringify(value)).byteLength);
  expect(shardSizes.length).toBeGreaterThan(1);
  expect(Math.max(...shardSizes)).toBeLessThanOrEqual(600 * 1024);
});

it('restores the previous complete catalog when committed shards fail read-back verification', async () => {
  const previous = equipment(3);
  await expect(writeNativeEquipmentCatalogSnapshot(17, 'ITINVENT', previous, previous.length)).resolves.toBe(true);

  let corruptNextManifest = true;
  mockBeforeSnapshotWrite = (_scope, data) => {
    const manifest = data as { kind?: string; shards?: Array<{ scope: string }> };
    if (!corruptNextManifest || manifest.kind !== 'equipment-catalog-shards-v1') return;
    corruptNextManifest = false;
    const firstShard = manifest.shards?.[0]?.scope;
    if (firstShard) mockSnapshots.delete(`17:${firstShard}`);
  };

  const replacement = equipment(10, 128);
  await expect(writeNativeEquipmentCatalogSnapshot(17, 'ITINVENT', replacement, replacement.length)).resolves.toBe(false);
  await expect(readNativeEquipmentCatalogSnapshot(17, 'ITINVENT')).resolves.toEqual(
    expect.objectContaining({ data: expect.objectContaining({ equipment: previous }) }),
  );
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

async function writeCatalog(userId: number, databaseId: string, items: EquipmentRecord[]) {
  await expect(writeNativeEquipmentCatalogSnapshot(userId, databaseId, items, items.length)).resolves.toBe(true);
}

it('verifies the manifest on a warm read without re-reading shards', async () => {
  const items = equipment(1_500, 256);
  await writeCatalog(17, 'ITINVENT', items);

  const first = await readNativeEquipmentCatalogSnapshot(17, 'ITINVENT');
  expect(first?.data.equipment).toEqual(items);
  expect(countScopeReads(true)).toBeGreaterThan(0);

  mockReadSnapshot.mockClear();
  const second = await readNativeEquipmentCatalogSnapshot(17, 'ITINVENT');
  expect(second?.data).toEqual(first?.data);
  expect(countScopeReads(false)).toBe(1);
  expect(countScopeReads(true)).toBe(0);
});

it('deduplicates concurrent reads so the catalog loads once', async () => {
  const items = equipment(1_500, 256);
  await writeCatalog(17, 'ITINVENT', items);
  invalidateNativeEquipmentCatalogCache(17);
  mockReadSnapshot.mockClear();

  const results = await Promise.all([
    readNativeEquipmentCatalogSnapshot(17, 'ITINVENT'),
    readNativeEquipmentCatalogSnapshot(17, 'ITINVENT'),
    readNativeEquipmentCatalogSnapshot(17, 'ITINVENT'),
  ]);

  for (const result of results) expect(result?.data.equipment).toEqual(items);
  expect(countScopeReads(false)).toBe(1);
  expect(countScopeReads(true)).toBeGreaterThan(0);
  const shardScopes = [...mockSnapshots.keys()].filter((key) => key.includes('database-catalog-shard-'));
  for (const key of shardScopes) {
    expect(
      mockReadSnapshot.mock.calls.filter(([scope]) => `17:${scope}` === key).length,
    ).toBe(1);
  }
});

it('finds items by normalized inventory number through the index helper', async () => {
  const first = { ...equipment(1)[0], inv_no: 'INV-1', model_name: 'First' };
  const duplicate = { ...equipment(1)[0], inv_no: ' inv-1 ', model_name: 'Second' };
  const other = { ...equipment(1)[0], inv_no: 'INV-2' };
  await writeCatalog(17, 'ITINVENT', [first, duplicate, other]);
  await readNativeEquipmentCatalogSnapshot(17, 'ITINVENT');

  await expect(findNativeEquipmentCatalogItem(17, 'ITINVENT', ' inv-1 ')).resolves.toBe(first);
  await expect(findNativeEquipmentCatalogItem(17, 'ITINVENT', 'INV-2')).resolves.toBe(other);
  await expect(findNativeEquipmentCatalogItem(17, 'ITINVENT', 'INV-9')).resolves.toBeNull();
  await expect(findNativeEquipmentCatalogItem(17, 'ITINVENT', '')).resolves.toBeNull();
});

it('switches scopes with the database and never leaks another scope from memory', async () => {
  const itemsA = equipment(300, 128);
  const itemsB = [{ ...equipment(1)[0], inv_no: 'INV-B', model_name: 'OnlyInB' }];
  await writeCatalog(17, 'DB-A', itemsA);
  await writeCatalog(17, 'DB-B', itemsB);
  await readNativeEquipmentCatalogSnapshot(17, 'DB-A');

  const snapB = await readNativeEquipmentCatalogSnapshot(17, 'DB-B');
  expect(snapB?.data.equipment).toEqual(itemsB);
  expect(snapB?.data.databaseId).toBe('DB-B');
  await expect(readNativeEquipmentCatalogSnapshot(99, 'DB-A')).resolves.toBeNull();
});

it('keeps the newer memory slot when a stale read from another database finishes late', async () => {
  const itemsA = equipment(300, 128);
  const itemsB = [{ ...equipment(1)[0], inv_no: 'INV-B', model_name: 'OnlyInB' }];
  await writeCatalog(17, 'DB-A', itemsA);
  const shardScopesA = [...mockSnapshots.keys()].filter((key) => key.startsWith('17:database-catalog-shard-'));
  await writeCatalog(17, 'DB-B', itemsB);
  invalidateNativeEquipmentCatalogCache(17);

  const gate = deferred<{ savedAt: number; data: unknown } | null>();
  let gateActive = true;
  mockReadSnapshot.mockImplementation(async (scope: string, userId: number, maxAgeMs?: number) => {
    if (gateActive && shardScopesA.includes(`${userId}:${scope}`)) {
      gateActive = false;
      return gate.promise;
    }
    return mockReadNativeSnapshotDefault(scope, userId, maxAgeMs);
  });

  const pendingA = readNativeEquipmentCatalogSnapshot(17, 'DB-A');
  await new Promise((resolve) => setTimeout(resolve, 0));
  const snapB = await readNativeEquipmentCatalogSnapshot(17, 'DB-B');
  expect(snapB?.data.equipment).toEqual(itemsB);

  const shardScope = shardScopesA[0].slice('17:'.length);
  gate.resolve(await mockReadNativeSnapshotDefault(shardScope, 17));
  const snapA = await pendingA;
  expect(snapA?.data.equipment).toEqual(itemsA);

  mockReadSnapshot.mockClear();
  const snapB2 = await readNativeEquipmentCatalogSnapshot(17, 'DB-B');
  expect(snapB2?.data.equipment).toEqual(itemsB);
  expect(countScopeReads(true)).toBe(0);
});

it('honors the oldest shard age and drops memory when the manifest is gone', async () => {
  const items = equipment(1_500, 256);
  await writeCatalog(17, 'ITINVENT', items);
  invalidateNativeEquipmentCatalogCache(17);

  const shardKeys = [...mockSnapshots.keys()].filter((key) => key.startsWith('17:database-catalog-shard-'));
  expect(shardKeys.length).toBeGreaterThan(0);
  mockSavedAts.set(shardKeys[0], Date.now() - 10_000);
  await readNativeEquipmentCatalogSnapshot(17, 'ITINVENT');

  await expect(readNativeEquipmentCatalogSnapshot(17, 'ITINVENT', 5_000)).resolves.toBeNull();

  mockReadSnapshot.mockClear();
  const warmAgain = await readNativeEquipmentCatalogSnapshot(17, 'ITINVENT', 60_000);
  expect(warmAgain?.data.equipment).toEqual(items);
  expect(countScopeReads(true)).toBeGreaterThan(0);

  const manifestKey = [...mockSnapshots.keys()].find(
    (key) => key.startsWith('17:database-catalog-') && !key.includes('-shard-'),
  );
  expect(manifestKey).toBeTruthy();
  mockSnapshots.delete(manifestKey as string);
  await expect(readNativeEquipmentCatalogSnapshot(17, 'ITINVENT')).resolves.toBeNull();
  await expect(readNativeEquipmentCatalogSnapshot(17, 'ITINVENT')).resolves.toBeNull();
});

it('invalidates in-flight reads on cache clear and on session generation change', async () => {
  const items = equipment(300, 128);
  await writeCatalog(17, 'DB-A', items);
  invalidateNativeEquipmentCatalogCache(17);
  const shardScopesA = [...mockSnapshots.keys()].filter((key) => key.startsWith('17:database-catalog-shard-'));

  const gate = deferred<{ savedAt: number; data: unknown } | null>();
  let gateActive = true;
  mockReadSnapshot.mockImplementation(async (scope: string, userId: number, maxAgeMs?: number) => {
    if (gateActive && shardScopesA.includes(`${userId}:${scope}`)) {
      gateActive = false;
      return gate.promise;
    }
    return mockReadNativeSnapshotDefault(scope, userId, maxAgeMs);
  });

  const pendingOld = readNativeEquipmentCatalogSnapshot(17, 'DB-A');
  await new Promise((resolve) => setTimeout(resolve, 0));
  const cacheMock = jest.requireMock('./nativeSnapshotCache') as {
    getClearListeners?: () => Array<(userId: number) => void>;
  };
  for (const listener of cacheMock.getClearListeners?.() || []) listener(17);

  const pendingNew = readNativeEquipmentCatalogSnapshot(17, 'DB-A');
  gate.resolve(await mockReadNativeSnapshotDefault(shardScopesA[0].slice('17:'.length), 17));
  const [snapOld, snapNew] = await Promise.all([pendingOld, pendingNew]);
  expect(snapOld).toBeNull();
  expect(snapNew?.data.equipment).toEqual(items);

  mockReadSnapshot.mockClear();
  const warm = await readNativeEquipmentCatalogSnapshot(17, 'DB-A');
  expect(warm?.data.equipment).toEqual(items);
  mockReadSnapshot.mockClear();
  mockSessionGeneration = 2;
  const afterLogin = await readNativeEquipmentCatalogSnapshot(17, 'DB-A');
  expect(afterLogin?.data.equipment).toEqual(items);
  expect(countScopeReads(true)).toBeGreaterThan(0);
});

it('does not let warm memory mask corrupted shards for bypass reads', async () => {
  const items = equipment(300, 128);
  await writeCatalog(17, 'ITINVENT', items);
  await readNativeEquipmentCatalogSnapshot(17, 'ITINVENT');

  const shardKeys = [...mockSnapshots.keys()].filter((key) => key.startsWith('17:database-catalog-shard-'));
  mockSnapshots.delete(shardKeys[0]);

  await expect(
    readNativeEquipmentCatalogSnapshot(17, 'ITINVENT', Number.MAX_SAFE_INTEGER, { bypassMemory: true }),
  ).resolves.toBeNull();
  await expect(readNativeEquipmentCatalogSnapshot(17, 'ITINVENT')).resolves.toBeNull();
});

it('reads an over-budget catalog fully but does not retain it in memory', async () => {
  const items = equipment(4_000, 1_800);
  await writeCatalog(17, 'ITINVENT', items);

  const first = await readNativeEquipmentCatalogSnapshot(17, 'ITINVENT');
  expect(first?.data.equipment.length).toBe(items.length);

  mockReadSnapshot.mockClear();
  const second = await readNativeEquipmentCatalogSnapshot(17, 'ITINVENT');
  expect(second?.data.equipment.length).toBe(items.length);
  expect(countScopeReads(true)).toBeGreaterThan(0);

  await expect(findNativeEquipmentCatalogItem(17, 'ITINVENT', 'INV-000005')).resolves.toEqual(
    expect.objectContaining({ inv_no: 'INV-000005' }),
  );
});

it('evicts the retained slot when a read starts for a different user', async () => {
  const items = equipment(1_500, 256);
  await writeCatalog(17, 'ITINVENT', items);
  await readNativeEquipmentCatalogSnapshot(17, 'ITINVENT');

  await expect(readNativeEquipmentCatalogSnapshot(99, 'ITINVENT')).resolves.toBeNull();

  mockReadSnapshot.mockClear();
  const again = await readNativeEquipmentCatalogSnapshot(17, 'ITINVENT');
  expect(again?.data.equipment).toEqual(items);
  expect(countScopeReads(true)).toBeGreaterThan(0);
});

it('evicts the retained slot when a read starts for a different database', async () => {
  const itemsA = equipment(1_500, 256);
  const itemsB = equipment(4_000, 1_800);
  await writeCatalog(17, 'DB-A', itemsA);
  await writeCatalog(17, 'DB-B', itemsB);
  await readNativeEquipmentCatalogSnapshot(17, 'DB-A');

  const snapB = await readNativeEquipmentCatalogSnapshot(17, 'DB-B');
  expect(snapB?.data.equipment.length).toBe(itemsB.length);

  mockReadSnapshot.mockClear();
  const againA = await readNativeEquipmentCatalogSnapshot(17, 'DB-A');
  expect(againA?.data.equipment).toEqual(itemsA);
  expect(countScopeReads(true)).toBeGreaterThan(0);
});

it('serves the new dataset when a warm catalog revision changes on disk', async () => {
  const first = equipment(300, 128);
  await writeCatalog(17, 'ITINVENT', first);
  await readNativeEquipmentCatalogSnapshot(17, 'ITINVENT');

  const manifestKey = [...mockSnapshots.keys()].find(
    (key) => key.startsWith('17:database-catalog-') && !key.includes('-shard-'),
  );
  const oldManifest = mockSnapshots.get(manifestKey as string) as {
    shards: Array<{ scope: string; count: number }>;
  };
  const shardScope = oldManifest.shards[0].scope;
  const replacement = [{ ...equipment(1)[0], inv_no: 'INV-NEW', model_name: 'Replaced' }];
  const revision = 'rev-external';
  await mockWriteSnapshot(shardScope as never, 17, {
    kind: 'equipment-catalog-shard-v1',
    revision,
    index: 0,
    equipment: replacement,
  });
  await mockWriteSnapshot((manifestKey as string).slice('17:'.length) as never, 17, {
    kind: 'equipment-catalog-shards-v1',
    revision,
    databaseId: 'ITINVENT',
    itemCount: replacement.length,
    total: replacement.length,
    shards: [{ scope: shardScope, count: replacement.length }],
  });

  const snap = await readNativeEquipmentCatalogSnapshot(17, 'ITINVENT');
  expect(snap?.data.equipment).toEqual(replacement);
  expect(snap?.data.total).toBe(replacement.length);
});
