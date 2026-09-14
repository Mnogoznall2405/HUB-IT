import { File, Paths } from 'expo-file-system';
import { clearNativeFormDrafts, createNativeFormDraftSession } from './nativeFormDrafts';
import { writeEncryptedNativeSnapshot } from '../cache/nativeSnapshotStorage';

const mockStore = new Map<string, string>();
jest.mock('../cache/nativeSnapshotStorage', () => ({
  readEncryptedNativeSnapshot: jest.fn(async (scope: string, user: number) => mockStore.get(`${user}:${scope}`) || null),
  writeEncryptedNativeSnapshot: jest.fn(async (scope: string, user: number, data: string) => { mockStore.set(`${user}:${scope}`, data); return true; }),
  deleteEncryptedNativeSnapshot: jest.fn(async (scope: string, user: number) => { mockStore.delete(`${user}:${scope}`); }),
}));
let mockId = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `draft-${++mockId}` }));
beforeEach(async () => { await clearNativeFormDrafts(); mockStore.clear(); });

it('restores durable files and atomically remaps feed cover/order after picker cleanup', async () => {
  const source = new File(Paths.cache, 'feed-upload'); source.write('photo');
  const state = { body: 'draft', newFiles: [{ uri: source.uri, name: 'photo.jpg', size: source.size, mimeType: 'image/jpeg', uploadId: 'stable-upload' }], attachmentOrder: [`new:${source.uri}`], coverKey: `new:${source.uri}`, createRequest: { id: 'stable-request', fingerprint: 'same' } };
  const session = createNativeFormDraftSession<typeof state>(1, 'feed-editor-new');
  const saved = await session.write(state);
  source.delete();
  const reopened = await createNativeFormDraftSession<typeof saved>(1, 'feed-editor-new').read();
  expect(reopened).toEqual(saved);
  expect(saved.coverKey).toBe(`new:${saved.newFiles[0].uri}`);
  expect(saved.attachmentOrder).toEqual([saved.coverKey]);
  expect(await new File(saved.newFiles[0].uri).text()).toBe('photo');
});

it('isolates users and preserves pending workflow identity', async () => {
  const state = { attempt: { key: 'existing-key', signature: 'unchanged' }, command: { command_id: 'known-command', status: 'state_unknown' }, selectedDocument: { ref: 'doc' } };
  await createNativeFormDraftSession(2, 'docflow-assignment').write(state);
  expect(await createNativeFormDraftSession(3, 'docflow-assignment').read()).toBeNull();
  expect(await createNativeFormDraftSession(2, 'docflow-assignment').read()).toEqual(state);
});

it('does not let a stale editor overwrite or delete a newer revision', async () => {
  const first = createNativeFormDraftSession(1, 'task-create'); await first.write({ title: 'first' });
  const second = createNativeFormDraftSession(1, 'task-create'); await second.read(); await second.write({ title: 'second' });
  await expect(first.write({ title: 'stale' })).rejects.toThrow('другом окне');
  await expect(first.clear()).rejects.toThrow('обновлён');
  expect(await second.read()).toEqual({ title: 'second' });
});

it('preserves last good state after a failed storage write', async () => {
  const session = createNativeFormDraftSession(1, 'task-create'); await session.write({ title: 'saved' });
  jest.mocked(writeEncryptedNativeSnapshot).mockResolvedValueOnce(false);
  await expect(session.write({ title: 'unsaved' })).rejects.toThrow('Не удалось сохранить');
  expect(await session.read()).toEqual({ title: 'saved' });
});

it('invalidates queued saves on logout and removes durable data', async () => {
  const session = createNativeFormDraftSession(1, 'task-create'); await session.write({ title: 'old' });
  const pending = session.write({ title: 'late' });
  const assertion = expect(pending).rejects.toThrow('завершена');
  await clearNativeFormDrafts(); await assertion;
  expect(await createNativeFormDraftSession(1, 'task-create').read()).toBeNull();
});
