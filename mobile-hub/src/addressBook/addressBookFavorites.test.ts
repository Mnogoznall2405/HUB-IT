import {
  ADDRESS_BOOK_MAX_FAVORITES,
  ADDRESS_BOOK_MAX_RECENT,
  clearRecentEmployees,
  getFavoriteEmployeeCodes,
  getRecentEmployeeCodes,
  pushRecentEmployee,
  toggleFavoriteEmployee,
} from './addressBookFavorites';
import {
  clearNativeSnapshots,
  readNativeEntitySnapshot,
  writeNativeEntitySnapshot,
} from '../cache/nativeSnapshotCache';

const OWNER_A = 98101;
const OWNER_B = 98102;

const writeRaw = (userId: number, key: string, data: unknown) => (
  writeNativeEntitySnapshot('address-book-favorites', userId, key, data)
);

beforeEach(async () => {
  await clearNativeSnapshots(OWNER_A);
  await clearNativeSnapshots(OWNER_B);
});

describe('addressBookFavorites', () => {
  it('toggles a favorite code on and off', async () => {
    expect(await getFavoriteEmployeeCodes(OWNER_A)).toEqual([]);

    const added = await toggleFavoriteEmployee(OWNER_A, 'E1');
    expect(added).toEqual({ codes: ['E1'], active: true });
    expect(await getFavoriteEmployeeCodes(OWNER_A)).toEqual(['E1']);

    const addedSecond = await toggleFavoriteEmployee(OWNER_A, 'E2');
    expect(addedSecond.codes).toEqual(['E2', 'E1']);

    const removed = await toggleFavoriteEmployee(OWNER_A, 'E1');
    expect(removed).toEqual({ codes: ['E2'], active: false });
    expect(await getFavoriteEmployeeCodes(OWNER_A)).toEqual(['E2']);
  });

  it('caps favorites at 50 and recents at 20', async () => {
    await writeRaw(OWNER_A, 'favorites', Array.from({ length: 60 }, (_, index) => `F${index}`));
    await writeRaw(OWNER_A, 'recent', Array.from({ length: 30 }, (_, index) => `R${index}`));

    expect((await getFavoriteEmployeeCodes(OWNER_A))).toHaveLength(ADDRESS_BOOK_MAX_FAVORITES);
    expect((await getRecentEmployeeCodes(OWNER_A))).toHaveLength(ADDRESS_BOOK_MAX_RECENT);

    const codes = Array.from({ length: ADDRESS_BOOK_MAX_FAVORITES }, (_, index) => `F${index}`);
    await writeRaw(OWNER_A, 'favorites', codes);
    const toggled = await toggleFavoriteEmployee(OWNER_A, 'NEW');
    expect(toggled.codes).toHaveLength(ADDRESS_BOOK_MAX_FAVORITES);
    expect(toggled.codes[0]).toBe('NEW');
  });

  it('dedupes and keeps the most-recent-first order for recents', async () => {
    await pushRecentEmployee(OWNER_A, 'E1');
    await pushRecentEmployee(OWNER_A, 'E2');
    await pushRecentEmployee(OWNER_A, 'E1');

    expect(await getRecentEmployeeCodes(OWNER_A)).toEqual(['E1', 'E2']);
  });

  it('normalizes whitespace and drops empty/duplicate codes', async () => {
    await writeRaw(OWNER_A, 'favorites', ['  E1  ', '', 'E1', null, ' E2 ', 42]);
    expect(await getFavoriteEmployeeCodes(OWNER_A)).toEqual(['E1', 'E2', '42']);

    const added = await toggleFavoriteEmployee(OWNER_A, '  E3  ');
    expect(added.codes).toContain('E3');
  });

  it('degrades corrupted payloads to an empty list', async () => {
    await writeRaw(OWNER_A, 'favorites', { broken: true });
    await writeRaw(OWNER_A, 'recent', 'not-an-array');

    expect(await getFavoriteEmployeeCodes(OWNER_A)).toEqual([]);
    expect(await getRecentEmployeeCodes(OWNER_A)).toEqual([]);
  });

  it('keeps codes isolated per user', async () => {
    await toggleFavoriteEmployee(OWNER_A, 'E1');
    await pushRecentEmployee(OWNER_A, 'E1');
    await toggleFavoriteEmployee(OWNER_B, 'OTHER');

    expect(await getFavoriteEmployeeCodes(OWNER_A)).toEqual(['E1']);
    expect(await getFavoriteEmployeeCodes(OWNER_B)).toEqual(['OTHER']);
    expect(await getRecentEmployeeCodes(OWNER_B)).toEqual([]);
  });

  it('clears only recents and keeps favorites', async () => {
    await toggleFavoriteEmployee(OWNER_A, 'E1');
    await pushRecentEmployee(OWNER_A, 'E2');

    expect(await clearRecentEmployees(OWNER_A)).toEqual([]);
    expect(await getRecentEmployeeCodes(OWNER_A)).toEqual([]);
    expect(await getFavoriteEmployeeCodes(OWNER_A)).toEqual(['E1']);
  });

  it('serializes concurrent mutations so no update is lost', async () => {
    await Promise.all([
      toggleFavoriteEmployee(OWNER_A, 'E1'),
      toggleFavoriteEmployee(OWNER_A, 'E2'),
      toggleFavoriteEmployee(OWNER_A, 'E3'),
    ]);
    // Each mutation observed the previous write instead of overwriting it.
    expect(await getFavoriteEmployeeCodes(OWNER_A)).toEqual(['E3', 'E2', 'E1']);

    await Promise.all([
      pushRecentEmployee(OWNER_A, 'R1'),
      pushRecentEmployee(OWNER_A, 'R2'),
      pushRecentEmployee(OWNER_A, 'R3'),
    ]);
    expect(await getRecentEmployeeCodes(OWNER_A)).toEqual(['R3', 'R2', 'R1']);

    // A toggle-off racing another toggle still sees the latest list.
    await Promise.all([
      toggleFavoriteEmployee(OWNER_A, 'E1'),
      toggleFavoriteEmployee(OWNER_A, 'E4'),
    ]);
    expect(await getFavoriteEmployeeCodes(OWNER_A)).toEqual(['E4', 'E3', 'E2']);
  });

  it('ignores invalid user ids without throwing', async () => {
    expect(await getFavoriteEmployeeCodes(0)).toEqual([]);
    expect(await getRecentEmployeeCodes(Number.NaN)).toEqual([]);
    const toggled = await toggleFavoriteEmployee(0, 'E1');
    expect(toggled).toEqual({ codes: ['E1'], active: true });
    // Nothing was persisted for the invalid owner id.
    expect(await readNativeEntitySnapshot('address-book-favorites', 0, 'favorites')).toBeNull();
  });
});
