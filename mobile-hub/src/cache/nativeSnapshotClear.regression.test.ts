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
