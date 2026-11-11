import { File, Paths } from 'expo-file-system';
let mockUuidSequence = 0;
jest.mock('expo-crypto', () => ({ ...jest.requireActual('expo-crypto'), randomUUID: () => `synthetic-file-${++mockUuidSequence}` }));
import { clearNativeChatDraftFiles, persistNativeChatDraftFiles } from './nativeChatDraftFiles';

beforeEach(() => {
  clearNativeChatDraftFiles();
  jest.restoreAllMocks();
});

it('copies to private documents, reuses the copy and survives picker cache removal', async () => {
  const source = new File(Paths.cache, 'draft-file');
  source.write('Синтетическое вложение');
  const picked = { uri: source.uri, name: 'Файл.txt', size: source.size, mimeType: 'text/plain', source: 'document' as const };
  const [first] = await persistNativeChatDraftFiles(7, [picked]);
  const [again] = await persistNativeChatDraftFiles(7, [picked]);
  expect(again.uri).toBe(first.uri);
  expect(first.uri).not.toBe(source.uri);
  source.delete();
  expect(await new File(first.uri).text()).toBe('Синтетическое вложение');
  expect((await persistNativeChatDraftFiles(7, [picked]))[0].uri).toBe(first.uri);
  expect((await persistNativeChatDraftFiles(7, [first]))[0].uri).toBe(first.uri);
  clearNativeChatDraftFiles();
  expect(new File(first.uri).exists).toBe(false);
});

it('keeps copies scoped by user and reports a missing source', async () => {
  const source = new File(Paths.cache, 'shared-source');
  source.write('fixture');
  const picked = { uri: source.uri, name: 'Тест.txt', size: source.size, mimeType: 'text/plain', source: 'document' as const };
  expect((await persistNativeChatDraftFiles(7, [picked]))[0].uri)
    .not.toBe((await persistNativeChatDraftFiles(8, [picked]))[0].uri);
  source.delete();
  await expect(persistNativeChatDraftFiles(9, [picked])).rejects.toThrow('Файл черновика недоступен');
});

it('replaces a truncated private copy while the source is still available', async () => {
  const source = new File(Paths.cache, 'recoverable-source');
  source.write('Полное синтетическое вложение');
  const picked = { uri: source.uri, name: 'Файл.txt', size: source.size, mimeType: 'text/plain', source: 'document' as const };
  const [first] = await persistNativeChatDraftFiles(7, [picked]);
  new File(first.uri).write('x');
  const [recovered] = await persistNativeChatDraftFiles(7, [picked]);
  expect(await new File(recovered.uri).text()).toBe('Полное синтетическое вложение');
});

it('does not return a truncated cached copy after its source disappears', async () => {
  const source = new File(Paths.cache, 'lost-source');
  source.write('Полное вложение');
  const picked = { uri: source.uri, name: 'Файл.txt', size: source.size, mimeType: 'text/plain', source: 'document' as const };
  const [first] = await persistNativeChatDraftFiles(7, [picked]);
  new File(first.uri).write('x');
  source.delete();
  await expect(persistNativeChatDraftFiles(7, [picked])).rejects.toThrow('Файл черновика недоступен');
  expect(new File(first.uri).exists).toBe(true);
});

it('checks the recorded size when a restored draft points directly to its private file', async () => {
  const source = new File(Paths.cache, 'restored-source');
  source.write('Полное вложение');
  const picked = { uri: source.uri, name: 'Файл.txt', size: source.size, mimeType: 'text/plain', source: 'document' as const };
  const [saved] = await persistNativeChatDraftFiles(7, [picked]);
  source.delete();
  new File(saved.uri).write('x');
  await expect(persistNativeChatDraftFiles(7, [saved])).rejects.toThrow('Размер вложения изменился');
  expect(new File(saved.uri).exists).toBe(true);
});

it('waits for deferred File.copy before validating size or resolving', async () => {
  const source = new File(Paths.cache, 'slow-copy-source');
  source.write('Содержимое для медленного копирования');
  const picked = {
    uri: source.uri,
    name: 'Файл.txt',
    size: source.size,
    mimeType: 'text/plain',
    source: 'document' as const,
  };

  let releaseCopy!: () => void;
  const gate = new Promise<void>((resolve) => { releaseCopy = resolve; });
  const originalCopy = File.prototype.copy;
  const copySpy = jest.spyOn(File.prototype, 'copy').mockImplementation(function (this: File, destination) {
    return gate.then(async () => {
      await originalCopy.call(this, destination);
    });
  });

  try {
    const pending = persistNativeChatDraftFiles(7, [picked]);
    let settled: 'pending' | 'resolved' | 'rejected' = 'pending';
    let durableUri = '';
    pending.then((files) => {
      settled = 'resolved';
      durableUri = files[0]?.uri || '';
    }, () => { settled = 'rejected'; });

    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe('pending');
    expect(copySpy).toHaveBeenCalled();

    releaseCopy();
    const [durable] = await pending;
    expect(settled).toBe('resolved');
    expect(durable.uri).toBe(durableUri);
    expect(durable.uri).not.toBe(source.uri);
    expect(await new File(durable.uri).text()).toBe('Содержимое для медленного копирования');
    expect(durable.size).toBe(source.size);
  } finally {
    copySpy.mockRestore();
  }
});

it('surfaces an async copy rejection without leaving an incomplete durable file', async () => {
  const source = new File(Paths.cache, 'failing-copy-source');
  source.write('Исходник остаётся');
  const picked = {
    uri: source.uri,
    name: 'Файл.txt',
    size: source.size,
    mimeType: 'text/plain',
    source: 'document' as const,
  };
  const destinationUris: string[] = [];
  const copySpy = jest.spyOn(File.prototype, 'copy').mockImplementation(function (_destination) {
    destinationUris.push((_destination as File).uri);
    return Promise.reject(new Error('synthetic copy failure'));
  });

  try {
    await expect(persistNativeChatDraftFiles(7, [picked])).rejects.toThrow(
      'Не удалось сохранить вложение на устройстве',
    );
    expect(source.exists).toBe(true);
    expect(await source.text()).toBe('Исходник остаётся');
    expect(destinationUris).toHaveLength(1);
    expect(new File(destinationUris[0]).exists).toBe(false);
  } finally {
    copySpy.mockRestore();
  }
});

it('copies several attachments sequentially and keeps earlier durable files when a later copy fails', async () => {
  const firstSource = new File(Paths.cache, 'batch-one');
  const secondSource = new File(Paths.cache, 'batch-two');
  firstSource.write('Первое вложение');
  secondSource.write('Второе вложение');
  const files = [
    { uri: firstSource.uri, name: 'one.txt', size: firstSource.size, mimeType: 'text/plain', source: 'document' as const },
    { uri: secondSource.uri, name: 'two.txt', size: secondSource.size, mimeType: 'text/plain', source: 'document' as const },
  ];
  let calls = 0;
  const originalCopy = File.prototype.copy;
  const copySpy = jest.spyOn(File.prototype, 'copy').mockImplementation(function (this: File, destination) {
    calls += 1;
    if (calls === 2) return Promise.reject(new Error('second copy failed'));
    return originalCopy.call(this, destination);
  });

  try {
    await expect(persistNativeChatDraftFiles(7, files)).rejects.toThrow(
      'Не удалось сохранить вложение на устройстве',
    );
    expect(calls).toBe(2);
    expect(firstSource.exists).toBe(true);
    expect(secondSource.exists).toBe(true);
  } finally {
    copySpy.mockRestore();
  }
});
