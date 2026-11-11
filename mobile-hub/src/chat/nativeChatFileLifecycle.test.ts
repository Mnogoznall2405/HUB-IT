import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { clearAllNativeChatDrafts, clearNativeChatDraft, getNativeChatDraftState, setNativeChatDraft } from './chatDrafts';
import { clearNativeChatOutbox, createNativeChatOutbox } from './nativeChatOutbox';
import { deleteUnreferencedChatFiles, pinNativeChatDraftFiles, inspectNativeChatDraftFiles, persistNativeChatDraftFiles } from './nativeChatDraftFiles';
import { CHAT_DRAFT_STORAGE_KEY, CHAT_OUTBOX_STORAGE_KEY, enqueueNativeChatStorage } from './nativeChatStorageQueue';

let mockSequence = 0;
jest.mock('expo-crypto', () => ({ ...jest.requireActual('expo-crypto'), randomUUID: () => `lifecycle-${++mockSequence}` }));
beforeEach(async () => { await clearNativeChatOutbox(); await clearAllNativeChatDrafts(); });

function pickedFile() {
  const source = new File(Paths.cache, 'source-file');
  source.write('Данные вложения');
  return { uri: source.uri, name: 'Файл.txt', size: source.size, mimeType: 'text/plain', source: 'document' as const };
}

it('reports an unlinked crash file without deleting it or scanning another user', async () => {
  const directory = new Directory(Paths.document, 'hubit-chat-draft-files', '7');
  directory.create({ intermediates: true, idempotent: true });
  const orphan = new File(directory, 'crash-copy');
  orphan.write('synthetic bytes');
  const otherDirectory = new Directory(Paths.document, 'hubit-chat-draft-files', '8');
  otherDirectory.create({ intermediates: true, idempotent: true });
  const other = new File(otherDirectory, 'other-user'); other.write('other bytes');
  const report = await inspectNativeChatDraftFiles(7);
  expect(report).toEqual({ files: 1, linked: 0, unlinked: 1, unlinkedBytes: orphan.size, missing: 0, complete: true });
  expect(orphan.exists).toBe(true); expect(other.exists).toBe(true);
  expect(JSON.stringify(report)).not.toContain(orphan.uri);
});

it('protects active picker copies and counts missing durable references without changing metadata', async () => {
  const picked = pickedFile();
  const durable = (await persistNativeChatDraftFiles(7, [picked]))[0];
  const unpin = pinNativeChatDraftFiles([picked]);
  try { expect(await inspectNativeChatDraftFiles(7)).toMatchObject({ linked: 1, unlinked: 0 }); }
  finally { unpin(); }
  await setNativeChatDraft(7, 'a', 'draft', { files: [durable] });
  const raw = await SecureStore.getItemAsync(CHAT_DRAFT_STORAGE_KEY);
  new File(durable.uri).delete();
  expect(await inspectNativeChatDraftFiles(7)).toMatchObject({ files: 0, missing: 1 });
  expect(await SecureStore.getItemAsync(CHAT_DRAFT_STORAGE_KEY)).toBe(raw);
});

it('refuses to label orphan files when reference metadata is corrupt', async () => {
  const durable = (await persistNativeChatDraftFiles(7, [pickedFile()]))[0];
  await SecureStore.setItemAsync(CHAT_OUTBOX_STORAGE_KEY, '{bad');
  await expect(inspectNativeChatDraftFiles(7)).rejects.toThrow('Не удалось проверить ссылки');
  expect(new File(durable.uri).exists).toBe(true);
  expect(await SecureStore.getItemAsync(CHAT_OUTBOX_STORAGE_KEY)).toBe('{bad');
});

it('marks unexpected directories as incomplete without descending or deleting them', async () => {
  const nested = new Directory(Paths.document, 'hubit-chat-draft-files', '7', 'unexpected');
  nested.create({ intermediates: true, idempotent: true });
  const file = new File(nested, 'nested-file'); file.write('nested bytes');
  expect(await inspectNativeChatDraftFiles(7)).toMatchObject({ files: 0, complete: false });
  expect(file.exists).toBe(true);
});

it('keeps the shared copy until both draft and outbox references are gone', async () => {
  const picked = pickedFile();
  await setNativeChatDraft(7, 'a', 'Подпись', { files: [picked] });
  const uri = (await getNativeChatDraftState(7, 'a'))!.context!.files![0].uri;
  const outbox = createNativeChatOutbox(7, 'a');
  await outbox.prepareUpload({ id: 'pending:1', client_message_id: '1', conversation_id: 'a', sender_user_id: 7 }, { body: '', files: [picked] });
  await clearNativeChatDraft(7, 'a');
  expect(new File(uri).exists).toBe(true);
  outbox.finishUpload('1');
  await outbox.discard('1');
  expect(new File(uri).exists).toBe(false);
  expect(new File(picked.uri).exists).toBe(true);
});

it('protects an active editor using the original picker URI', async () => {
  const picked = pickedFile();
  await setNativeChatDraft(7, 'a', '', { files: [picked] });
  const uri = (await getNativeChatDraftState(7, 'a'))!.context!.files![0].uri;
  const unpin = pinNativeChatDraftFiles([picked]);
  try {
    await clearNativeChatDraft(7, 'a');
    expect(new File(uri).exists).toBe(true);
  } finally { unpin(); }
  await enqueueNativeChatStorage(() => deleteUnreferencedChatFiles([picked.uri]));
  expect(new File(uri).exists).toBe(false);
  expect(new File(picked.uri).exists).toBe(true);
});

it('does not delete files when another reference store cannot be decoded', async () => {
  const picked = pickedFile();
  await setNativeChatDraft(7, 'a', '', { files: [picked] });
  const uri = (await getNativeChatDraftState(7, 'a'))!.context!.files![0].uri;
  await SecureStore.setItemAsync(CHAT_OUTBOX_STORAGE_KEY, '{invalid');
  await clearNativeChatDraft(7, 'a');
  expect(new File(uri).exists).toBe(true);
  await SecureStore.deleteItemAsync(CHAT_OUTBOX_STORAGE_KEY);
  await enqueueNativeChatStorage(() => deleteUnreferencedChatFiles([uri, picked.uri]));
  expect(new File(uri).exists).toBe(false);
  expect(new File(picked.uri).exists).toBe(true);
});

it('serializes a new draft reference with removal of an old one', async () => {
  const picked = pickedFile();
  await setNativeChatDraft(7, 'a', '', { files: [picked] });
  const file = (await getNativeChatDraftState(7, 'a'))!.context!.files![0];
  await Promise.all([
    setNativeChatDraft(7, 'b', 'Другой диалог', { files: [file] }),
    clearNativeChatDraft(7, 'a'),
  ]);
  expect(new File(file.uri).exists).toBe(true);
  await clearNativeChatDraft(7, 'b');
  expect(new File(file.uri).exists).toBe(false);
});

it('preserves candidate files if attachment metadata is structurally damaged', async () => {
  const picked = pickedFile();
  await setNativeChatDraft(7, 'a', '', { files: [picked] });
  const uri = (await getNativeChatDraftState(7, 'a'))!.context!.files![0].uri;
  await SecureStore.setItemAsync(CHAT_OUTBOX_STORAGE_KEY, JSON.stringify([{ userId: 7, message: { client_message_id: 'bad', conversation_id: 'a' }, upload: 'damaged' }]));
  await SecureStore.deleteItemAsync(CHAT_DRAFT_STORAGE_KEY);
  await expect(enqueueNativeChatStorage(() => deleteUnreferencedChatFiles([uri]))).rejects.toThrow('Не удалось проверить ссылки');
  expect(new File(uri).exists).toBe(true);
});
