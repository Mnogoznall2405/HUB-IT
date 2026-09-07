import { File, Paths } from 'expo-file-system';
let mockUuidSequence = 0;
jest.mock('expo-crypto', () => ({ ...jest.requireActual('expo-crypto'), randomUUID: () => `synthetic-file-${++mockUuidSequence}` }));
import { clearNativeChatDraftFiles, persistNativeChatDraftFiles } from './nativeChatDraftFiles';

beforeEach(() => {
  clearNativeChatDraftFiles();
});

it('copies to private documents, reuses the copy and survives picker cache removal', async () => {
  const source = new File(Paths.cache, 'draft-file');
  source.write('Синтетическое вложение');
  const picked = { uri: source.uri, name: 'Файл.txt', size: source.size, mimeType: 'text/plain', source: 'document' as const };
  const [first] = persistNativeChatDraftFiles(7, [picked]);
  const [again] = persistNativeChatDraftFiles(7, [picked]);
  expect(again.uri).toBe(first.uri);
  expect(first.uri).not.toBe(source.uri);
  source.delete();
  expect(await new File(first.uri).text()).toBe('Синтетическое вложение');
  expect(persistNativeChatDraftFiles(7, [picked])[0].uri).toBe(first.uri);
  expect(persistNativeChatDraftFiles(7, [first])[0].uri).toBe(first.uri);
  clearNativeChatDraftFiles();
  expect(new File(first.uri).exists).toBe(false);
});

it('keeps copies scoped by user and reports a missing source', () => {
  const source = new File(Paths.cache, 'shared-source');
  source.write('fixture');
  const picked = { uri: source.uri, name: 'Тест.txt', size: source.size, mimeType: 'text/plain', source: 'document' as const };
  expect(persistNativeChatDraftFiles(7, [picked])[0].uri).not.toBe(persistNativeChatDraftFiles(8, [picked])[0].uri);
  source.delete();
  expect(() => persistNativeChatDraftFiles(9, [picked])).toThrow('Файл черновика недоступен');
});

it('replaces a truncated private copy while the source is still available', async () => {
  const source = new File(Paths.cache, 'recoverable-source');
  source.write('Полное синтетическое вложение');
  const picked = { uri: source.uri, name: 'Файл.txt', size: source.size, mimeType: 'text/plain', source: 'document' as const };
  const [first] = persistNativeChatDraftFiles(7, [picked]);
  new File(first.uri).write('x');
  const [recovered] = persistNativeChatDraftFiles(7, [picked]);
  expect(await new File(recovered.uri).text()).toBe('Полное синтетическое вложение');
});

it('does not return a truncated cached copy after its source disappears', () => {
  const source = new File(Paths.cache, 'lost-source');
  source.write('Полное вложение');
  const picked = { uri: source.uri, name: 'Файл.txt', size: source.size, mimeType: 'text/plain', source: 'document' as const };
  const [first] = persistNativeChatDraftFiles(7, [picked]);
  new File(first.uri).write('x');
  source.delete();
  expect(() => persistNativeChatDraftFiles(7, [picked])).toThrow('Файл черновика недоступен');
  expect(new File(first.uri).exists).toBe(true);
});

it('checks the recorded size when a restored draft points directly to its private file', () => {
  const source = new File(Paths.cache, 'restored-source');
  source.write('Полное вложение');
  const picked = { uri: source.uri, name: 'Файл.txt', size: source.size, mimeType: 'text/plain', source: 'document' as const };
  const [saved] = persistNativeChatDraftFiles(7, [picked]);
  source.delete();
  new File(saved.uri).write('x');
  expect(() => persistNativeChatDraftFiles(7, [saved])).toThrow('Размер вложения изменился');
  expect(new File(saved.uri).exists).toBe(true);
});
