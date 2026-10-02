import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADDRESS_BOOK_MAX_FAVORITES,
  ADDRESS_BOOK_MAX_RECENT,
  clearRecentEmployees,
  getFavoriteEmployeeCodes,
  getRecentEmployeeCodes,
  isFavoriteEmployee,
  pushRecentEmployee,
  toggleFavoriteEmployee,
} from './addressBookFavorites';

describe('addressBookFavorites storage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stores only employee codes per user namespace', () => {
    toggleFavoriteEmployee('u1', 'E1');
    toggleFavoriteEmployee('u2', 'E2');

    expect(getFavoriteEmployeeCodes('u1')).toEqual(['E1']);
    expect(getFavoriteEmployeeCodes('u2')).toEqual(['E2']);
    expect(isFavoriteEmployee('u1', 'E1')).toBe(true);
    expect(isFavoriteEmployee('u1', 'E2')).toBe(false);

    const keys = Object.keys(window.localStorage);
    expect(keys).toContain('hubit.addressBook.favorites.u1');
    expect(keys).toContain('hubit.addressBook.favorites.u2');
    expect(window.localStorage.getItem('hubit.addressBook.favorites.u1')).toBe('["E1"]');
  });

  it('toggles favorites and reports the new state', () => {
    expect(toggleFavoriteEmployee('u', 'E1')).toEqual({ codes: ['E1'], active: true });
    expect(toggleFavoriteEmployee('u', 'E1')).toEqual({ codes: [], active: false });
    expect(isFavoriteEmployee('u', 'E1')).toBe(false);
  });

  it('caps favorites at 50', () => {
    for (let i = 0; i < ADDRESS_BOOK_MAX_FAVORITES + 5; i += 1) {
      toggleFavoriteEmployee('u', `E${i}`);
    }
    expect(getFavoriteEmployeeCodes('u')).toHaveLength(ADDRESS_BOOK_MAX_FAVORITES);
    // Oldest entries are evicted; the most recent code is first.
    expect(getFavoriteEmployeeCodes('u')[0]).toBe(`E${ADDRESS_BOOK_MAX_FAVORITES + 4}`);
  });

  it('keeps recents unique, most recent first, capped at 20', () => {
    for (let i = 0; i < ADDRESS_BOOK_MAX_RECENT + 3; i += 1) {
      pushRecentEmployee('u', `R${i}`);
    }
    pushRecentEmployee('u', 'R5');
    const recents = getRecentEmployeeCodes('u');
    expect(recents).toHaveLength(ADDRESS_BOOK_MAX_RECENT);
    expect(recents[0]).toBe('R5');
    expect(recents.filter((c) => c === 'R5')).toHaveLength(1);

    clearRecentEmployees('u');
    expect(getRecentEmployeeCodes('u')).toEqual([]);
  });

  it('ignores empty and whitespace codes', () => {
    expect(toggleFavoriteEmployee('u', '  ').codes).toEqual([]);
    expect(pushRecentEmployee('u', null)).toEqual([]);
  });

  it('survives corrupted JSON in storage', () => {
    window.localStorage.setItem('hubit.addressBook.favorites.u', '{broken');
    window.localStorage.setItem('hubit.addressBook.recent.u', '"not-an-array"');
    expect(getFavoriteEmployeeCodes('u')).toEqual([]);
    expect(getRecentEmployeeCodes('u')).toEqual([]);
  });

  it('degrades to memory storage when localStorage throws', () => {
    const deny = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const denyGet = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });

    // Writes fall back to memory, reads fall back to the same memory copy.
    const { codes } = toggleFavoriteEmployee('u', 'E9');
    expect(codes).toEqual(['E9']);

    deny.mockRestore();
    denyGet.mockRestore();
    // After storage recovers the memory fallback is not consulted for reads
    // unless storage itself is empty — a fresh read returns storage content.
    expect(getFavoriteEmployeeCodes('u')).toEqual([]);
  });
});
