import {
  clearNativeMailSearchHistory,
  pushNativeMailSearchQuery,
  readNativeMailSearchHistory,
} from './nativeMailSearchHistory';

it('stores fresh queries first, deduplicates case-insensitively and caps at 8', async () => {
  await pushNativeMailSearchQuery(7, 'box-1', 'первый');
  await pushNativeMailSearchQuery(7, 'box-1', 'Второй');
  await pushNativeMailSearchQuery(7, 'box-1', 'ПЕРВЫЙ');
  let history = await readNativeMailSearchHistory(7, 'box-1');
  expect(history).toEqual(['ПЕРВЫЙ', 'Второй']);

  for (let index = 0; index < 10; index += 1) {
    await pushNativeMailSearchQuery(7, 'box-1', `запрос-${index}`);
  }
  history = await readNativeMailSearchHistory(7, 'box-1');
  expect(history).toHaveLength(8);
  expect(history[0]).toBe('запрос-9');
});

it('scopes history by user and mailbox', async () => {
  await pushNativeMailSearchQuery(7, 'box-1', 'коробка один');
  await pushNativeMailSearchQuery(7, 'box-2', 'коробка два');
  await expect(readNativeMailSearchHistory(7, 'box-1')).resolves.toEqual(['коробка один']);
  await expect(readNativeMailSearchHistory(7, 'box-2')).resolves.toEqual(['коробка два']);
  await expect(readNativeMailSearchHistory(8, 'box-1')).resolves.toEqual([]);
  await expect(readNativeMailSearchHistory(0, 'box-1')).resolves.toEqual([]);
});

it('ignores too short or too long queries without losing history', async () => {
  await pushNativeMailSearchQuery(7, 'box-1', 'нормальный');
  await pushNativeMailSearchQuery(7, 'box-1', 'x');
  await pushNativeMailSearchQuery(7, 'box-1', 'a'.repeat(201));
  await expect(readNativeMailSearchHistory(7, 'box-1')).resolves.toEqual(['нормальный']);
});

it('clears only the requested scope', async () => {
  await pushNativeMailSearchQuery(7, 'box-1', 'один');
  await pushNativeMailSearchQuery(7, 'box-2', 'два');
  await clearNativeMailSearchHistory(7, 'box-1');
  await expect(readNativeMailSearchHistory(7, 'box-1')).resolves.toEqual([]);
  await expect(readNativeMailSearchHistory(7, 'box-2')).resolves.toEqual(['два']);
});
