import * as Crypto from 'expo-crypto';
import { clearNativeSnapshots, readNativeSnapshot, writeNativeSnapshot, writeNativeEntitySnapshot, readNativeEntitySnapshot } from './nativeSnapshotCache';

it('clears in-flight and queued snapshots before allowing new writes for the user', async () => {
  const generate = Crypto.AESEncryptionKey.generate;
  let finish!: () => void;
  let started = false;
  const spy = jest.spyOn(Crypto.AESEncryptionKey, 'generate').mockImplementationOnce(async (...args) => {
    started = true;
    await new Promise<void>(resolve => { finish = resolve; });
    return generate(...args);
  });
  const first = writeNativeSnapshot('dashboard', 90321, { marker: 'old' });
  const queued = writeNativeEntitySnapshot('task-details', 90321, 'task', { marker: 'old' });
  for (let i = 0; i < 50 && !started; i++) await Promise.resolve();
  expect(started).toBe(true);
  const clearing = clearNativeSnapshots(90321);
  expect(await writeNativeSnapshot('dashboard', 90323, { marker: 'other-user' })).toBe(true);
  expect(await writeNativeSnapshot('dashboard', 90321, { marker: 'during-clear' })).toBe(false);
  finish();
  await Promise.all([first, queued, clearing]);
  spy.mockRestore();
  expect(await readNativeSnapshot('dashboard', 90321)).toBeNull();
  expect(await readNativeEntitySnapshot('task-details', 90321, 'task')).toBeNull();
  expect((await readNativeSnapshot<{ marker: string }>('dashboard', 90323))?.data.marker).toBe('other-user');
  expect(await writeNativeSnapshot('dashboard', 90321, { marker: 'new' })).toBe(true);
  expect((await readNativeSnapshot<{ marker: string }>('dashboard', 90321))?.data.marker).toBe('new');
});

it('clears address-book favorites together with the rest of the user cache', async () => {
  await writeNativeEntitySnapshot('address-book-favorites', 90421, 'favorites', ['E1', 'E2']);
  await writeNativeEntitySnapshot('address-book-favorites', 90421, 'recent', ['E9']);
  await writeNativeEntitySnapshot('address-book-favorites', 90422, 'favorites', ['OTHER']);
  expect(await readNativeEntitySnapshot('address-book-favorites', 90421, 'favorites')).not.toBeNull();

  await clearNativeSnapshots(90421);

  expect(await readNativeEntitySnapshot('address-book-favorites', 90421, 'favorites')).toBeNull();
  expect(await readNativeEntitySnapshot('address-book-favorites', 90421, 'recent')).toBeNull();
  // Another user's favorites survive the clear.
  expect((await readNativeEntitySnapshot<string[]>('address-book-favorites', 90422, 'favorites'))?.data).toEqual(['OTHER']);
});

it('drops the in-memory address-book directory when the user cache is cleared', async () => {
  const {
    readNativeAddressBookSnapshot,
    writeNativeAddressBookSnapshot,
  } = require('./nativeAddressBookSnapshot') as typeof import('./nativeAddressBookSnapshot');
  const payload = {
    items: [{ full_name: 'In Memory Employee' }],
    total: 1,
    updated_at: '2026-09-01T08:00:00Z',
    last_error: '',
    has_more: false,
  };
  await writeNativeAddressBookSnapshot(90431, payload);
  // The verified write warms the in-memory slot.
  expect((await readNativeAddressBookSnapshot<typeof payload>(90431))?.data.items).toHaveLength(1);

  await clearNativeSnapshots(90431);

  // The slot must be invalidated: a stale read would resurrect deleted data.
  expect(await readNativeAddressBookSnapshot(90431)).toBeNull();
});
