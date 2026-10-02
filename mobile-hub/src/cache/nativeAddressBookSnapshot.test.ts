import {
  invalidateAddressBookDirectoryCache,
  readNativeAddressBookSnapshot,
  writeNativeAddressBookSnapshot,
} from './nativeAddressBookSnapshot';
import { readNativeSnapshot } from './nativeSnapshotCache';

const mockReadNativeSnapshot = readNativeSnapshot as jest.Mock;

const mockSnapshots = new Map<string, unknown>();
let mockBeforeSnapshotWrite: (() => void) | null = null;
let mockAfterSnapshotWrite: ((scope: string, userId: number, data: unknown) => void) | null = null;
let mockBeforeSnapshotRead: ((scope: string) => void | Promise<void>) | null = null;

jest.mock('./nativeSnapshotCache', () => ({
  readNativeSnapshot: jest.fn(async (scope: string, userId: number) => {
    await mockBeforeSnapshotRead?.(scope);
    const data = mockSnapshots.get(`${userId}:${scope}`);
    return data === undefined ? null : { savedAt: 1, data };
  }),
  writeNativeSnapshot: jest.fn(async (scope: string, userId: number, data: unknown) => {
    mockBeforeSnapshotWrite?.();
    const bytes = new TextEncoder().encode(JSON.stringify({
      version: 1,
      userId,
      savedAt: 1,
      data,
    })).byteLength;
    if (scope !== 'address-book' && bytes > 2 * 1024 * 1024) return false;
    mockSnapshots.set(`${userId}:${scope}`, data);
    mockAfterSnapshotWrite?.(scope, userId, data);
    return true;
  }),
}));

jest.mock('./nativeSnapshotStorage', () => ({
  MAX_NATIVE_SNAPSHOT_BYTES: 2 * 1024 * 1024,
  deleteEncryptedNativeSnapshot: jest.fn(async (scope: string, userId: number) => {
    mockSnapshots.delete(`${userId}:${scope}`);
  }),
}));

function directory(noteLength: number, count: number) {
  return {
    items: Array.from({ length: count }, (_, index) => ({
      full_name: `Employee ${index}`,
      department: 'IT',
      position: 'Specialist',
      note: 'x'.repeat(noteLength),
    })),
    total: count,
    updated_at: '2026-09-01T08:00:00Z',
    last_error: '',
    has_more: false,
  };
}

beforeEach(() => {
  mockSnapshots.clear();
  invalidateAddressBookDirectoryCache();
  mockBeforeSnapshotWrite = null;
  mockAfterSnapshotWrite = null;
  mockBeforeSnapshotRead = null;
});

it('keeps both concurrent replacements valid and publishes the last complete revision', async () => {
  const first = directory(20, 3);
  const second = directory(20, 4);
  expect(await Promise.all([
    writeNativeAddressBookSnapshot(17, first),
    writeNativeAddressBookSnapshot(17, second),
  ])).toEqual([true, true]);
  expect((await readNativeAddressBookSnapshot(17))?.data).toEqual(second);
});

it('persists and restores a complete address book larger than 15 MB', async () => {
  const value = directory(1_050_000, 15);

  await expect(writeNativeAddressBookSnapshot(17, value)).resolves.toBe(true);
  await expect(readNativeAddressBookSnapshot<typeof value>(17)).resolves.toEqual(
    expect.objectContaining({ data: value }),
  );
});

it('preserves 5000 unique directory entries across encrypted shards', async () => {
  const value = directory(2_048, 5_000);

  await expect(writeNativeAddressBookSnapshot(17, value)).resolves.toBe(true);
  const restored = await readNativeAddressBookSnapshot<typeof value>(17);

  expect(restored?.data.items).toHaveLength(5_000);
  expect(restored?.data.total).toBe(5_000);
  expect(restored?.data.items[0]?.full_name).toBe('Employee 0');
  expect(restored?.data.items.at(-1)?.full_name).toBe('Employee 4999');
});

it('splits a production-sized directory into Android-friendly encrypted chunks', async () => {
  const value = directory(512, 2_692);

  await expect(writeNativeAddressBookSnapshot(17, value)).resolves.toBe(true);
  const manifest = mockSnapshots.get('17:address-book') as { shards: Array<{ scope: string }> };

  expect(manifest.shards.length).toBeGreaterThanOrEqual(3);
  for (const descriptor of manifest.shards) {
    const shard = mockSnapshots.get(`17:${descriptor.scope}`);
    const serializedBytes = new TextEncoder().encode(JSON.stringify({
      version: 1,
      userId: 17,
      savedAt: 1,
      data: shard,
    })).byteLength;
    expect(serializedBytes).toBeLessThanOrEqual(640 * 1024);
  }
});

it('reads encrypted shards sequentially to avoid Android bridge memory bursts', async () => {
  const value = directory(512, 2_692);
  await expect(writeNativeAddressBookSnapshot(17, value)).resolves.toBe(true);
  invalidateAddressBookDirectoryCache();
  let activeShardReads = 0;
  let maximumConcurrentShardReads = 0;
  mockBeforeSnapshotRead = async (scope) => {
    if (!scope.startsWith('address-book-shard-')) return;
    activeShardReads += 1;
    maximumConcurrentShardReads = Math.max(maximumConcurrentShardReads, activeShardReads);
    await new Promise((resolve) => setTimeout(resolve, 0));
    activeShardReads -= 1;
  };

  await expect(readNativeAddressBookSnapshot<typeof value>(17)).resolves.toEqual(
    expect.objectContaining({ data: value }),
  );
  expect(maximumConcurrentShardReads).toBe(1);
});

it('keeps the previous complete version when a replacement shard cannot be stored', async () => {
  const previous = directory(100, 3);
  await expect(writeNativeAddressBookSnapshot(17, previous)).resolves.toBe(true);

  const oversizedSingleEntry = directory(2_200_000, 1);
  await expect(writeNativeAddressBookSnapshot(17, oversizedSingleEntry)).resolves.toBe(false);
  await expect(readNativeAddressBookSnapshot<typeof previous>(17)).resolves.toEqual(
    expect.objectContaining({ data: previous }),
  );
});

it('restores the previous complete version when committed replacement fails read-back verification', async () => {
  const previous = directory(100, 3);
  await expect(writeNativeAddressBookSnapshot(17, previous)).resolves.toBe(true);

  const replacement = directory(512, 2_692);
  mockAfterSnapshotWrite = (scope, userId, data) => {
    const manifest = data as { kind?: string; itemCount?: number; shards?: Array<{ scope: string }> };
    if (scope === 'address-book' && manifest.itemCount === replacement.items.length) {
      mockSnapshots.delete(`${userId}:${manifest.shards?.[0]?.scope}`);
    }
  };

  await expect(writeNativeAddressBookSnapshot(17, replacement)).resolves.toBe(false);
  await expect(readNativeAddressBookSnapshot<typeof previous>(17)).resolves.toEqual(
    expect.objectContaining({ data: previous }),
  );
});

it('refuses to replace a complete directory with a partial payload', async () => {
  const previous = directory(100, 3);
  await expect(writeNativeAddressBookSnapshot(17, previous)).resolves.toBe(true);

  await expect(writeNativeAddressBookSnapshot(17, {
    ...directory(100, 2),
    total: 3,
    has_more: true,
  })).resolves.toBe(false);
  await expect(readNativeAddressBookSnapshot<typeof previous>(17)).resolves.toEqual(
    expect.objectContaining({ data: previous }),
  );
});

it('yields to the UI before writing the first shard of a large directory', async () => {
  const value = directory(512, 6_000);
  let uiTurnReached = false;
  let uiTurnReachedBeforeFirstWrite: boolean | null = null;
  const timer = setTimeout(() => {
    uiTurnReached = true;
  }, 0);
  mockBeforeSnapshotWrite = () => {
    if (uiTurnReachedBeforeFirstWrite == null) uiTurnReachedBeforeFirstWrite = uiTurnReached;
  };

  const write = writeNativeAddressBookSnapshot(17, value);
  await write;
  clearTimeout(timer);

  expect(uiTurnReachedBeforeFirstWrite).toBe(true);
});

it('treats a malformed shard as a cache miss instead of crashing offline state', async () => {
  const value = directory(100, 3);
  await expect(writeNativeAddressBookSnapshot(17, value)).resolves.toBe(true);
  const manifest = mockSnapshots.get('17:address-book') as { shards: Array<{ scope: string }> };
  const firstShardKey = `17:${manifest.shards[0].scope}`;
  mockSnapshots.set(firstShardKey, {
    ...(mockSnapshots.get(firstShardKey) as object),
    items: null,
  });
  invalidateAddressBookDirectoryCache();

  await expect(readNativeAddressBookSnapshot<typeof value>(17)).resolves.toBeNull();
});

it('serves repeat screen opens from memory without touching storage', async () => {
  const value = directory(64, 5);
  await expect(writeNativeAddressBookSnapshot(17, value)).resolves.toBe(true);
  mockReadNativeSnapshot.mockClear();

  await expect(readNativeAddressBookSnapshot<typeof value>(17)).resolves.toEqual(
    expect.objectContaining({ data: value }),
  );
  await expect(readNativeAddressBookSnapshot<typeof value>(17)).resolves.toEqual(
    expect.objectContaining({ data: value }),
  );
  expect(mockReadNativeSnapshot).not.toHaveBeenCalled();
});

it('keeps the in-memory directory isolated per user', async () => {
  const value = directory(64, 2);
  await expect(writeNativeAddressBookSnapshot(17, value)).resolves.toBe(true);
  mockReadNativeSnapshot.mockClear();

  await expect(readNativeAddressBookSnapshot(18)).resolves.toBeNull();
  expect(mockReadNativeSnapshot).toHaveBeenCalledWith('address-book', 18);
});

it('drops the in-memory directory on explicit invalidation', async () => {
  const value = directory(64, 3);
  await expect(writeNativeAddressBookSnapshot(17, value)).resolves.toBe(true);
  invalidateAddressBookDirectoryCache();
  mockReadNativeSnapshot.mockClear();

  await expect(readNativeAddressBookSnapshot<typeof value>(17)).resolves.toEqual(
    expect.objectContaining({ data: value }),
  );
  expect(mockReadNativeSnapshot).toHaveBeenCalled();
});

it('re-reads storage on bypassMemory even when the slot is warm', async () => {
  const value = directory(64, 4);
  await expect(writeNativeAddressBookSnapshot(17, value)).resolves.toBe(true);
  mockReadNativeSnapshot.mockClear();

  // Warm slot serves the normal read without touching storage…
  await expect(readNativeAddressBookSnapshot<typeof value>(17)).resolves.toEqual(
    expect.objectContaining({ data: value }),
  );
  expect(mockReadNativeSnapshot).not.toHaveBeenCalled();

  // …but the post-write verification path must hit the shards again.
  await expect(readNativeAddressBookSnapshot<typeof value>(17, { bypassMemory: true })).resolves.toEqual(
    expect.objectContaining({ data: value }),
  );
  expect(mockReadNativeSnapshot).toHaveBeenCalled();
});

it('does not cache a directory whose write failed verification', async () => {
  await expect(writeNativeAddressBookSnapshot(17, {
    ...directory(64, 1),
    total: 2,
    has_more: true,
  })).resolves.toBe(false);
  mockReadNativeSnapshot.mockClear();

  await expect(readNativeAddressBookSnapshot(17)).resolves.toBeNull();
  expect(mockReadNativeSnapshot).toHaveBeenCalled();
});
