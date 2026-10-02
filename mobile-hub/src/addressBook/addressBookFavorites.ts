// Per-user address-book favorites and recently-opened codes, persisted in the
// encrypted user snapshot cache under the 'address-book-favorites' scope.
// Only employee_code values are stored — never names, phones or emails.
// Corrupted or oversized payloads degrade to an empty list instead of
// breaking the screen.

import {
  readNativeEntitySnapshot,
  writeNativeEntitySnapshot,
} from '../cache/nativeSnapshotCache';

const FAVORITES_SCOPE = 'address-book-favorites';
const FAVORITES_KEY = 'favorites';
const RECENT_KEY = 'recent';

export const ADDRESS_BOOK_MAX_FAVORITES = 50;
export const ADDRESS_BOOK_MAX_RECENT = 20;

const normalizeCodeList = (value: unknown, limit: number): string[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const codes: string[] = [];
  for (const entry of value) {
    const code = String(entry ?? '').trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    codes.push(code);
    if (codes.length >= limit) break;
  }
  return codes;
};

const readCodes = async (userId: number, key: string, limit: number): Promise<string[]> => {
  const owner = Number(userId || 0);
  if (!Number.isInteger(owner) || owner <= 0) return [];
  const snapshot = await readNativeEntitySnapshot<string[]>(FAVORITES_SCOPE, owner, key);
  return normalizeCodeList(snapshot?.data, limit);
};

const writeCodes = async (userId: number, key: string, codes: unknown, limit: number): Promise<string[]> => {
  const owner = Number(userId || 0);
  const list = normalizeCodeList(codes, limit);
  if (!Number.isInteger(owner) || owner <= 0) return list;
  await writeNativeEntitySnapshot(FAVORITES_SCOPE, owner, key, list);
  return list;
};

export const getFavoriteEmployeeCodes = (userId: number): Promise<string[]> => (
  readCodes(userId, FAVORITES_KEY, ADDRESS_BOOK_MAX_FAVORITES)
);

// Read-modify-write on the same key must be serialized: two fast star taps
// (or toggle + pushRecent) would otherwise race and lose one of the updates.
// The stored tail never rejects, so one failed mutation does not stall the rest.
const mutationTails = new Map<string, Promise<void>>();

const enqueueMutation = <T>(key: string, task: () => Promise<T>): Promise<T> => {
  const tail = mutationTails.get(key) ?? Promise.resolve();
  const result = tail.then(task);
  mutationTails.set(key, result.then(() => undefined, () => undefined));
  return result;
};

export const toggleFavoriteEmployee = (
  userId: number,
  employeeCode: string,
): Promise<{ codes: string[]; active: boolean }> => (
  enqueueMutation(`${Number(userId || 0)}:${FAVORITES_KEY}`, async () => {
    const code = String(employeeCode || '').trim();
    const current = await getFavoriteEmployeeCodes(userId);
    if (!code) return { codes: current, active: false };
    if (current.includes(code)) {
      return { codes: await writeCodes(userId, FAVORITES_KEY, current.filter((item) => item !== code), ADDRESS_BOOK_MAX_FAVORITES), active: false };
    }
    return { codes: await writeCodes(userId, FAVORITES_KEY, [code, ...current], ADDRESS_BOOK_MAX_FAVORITES), active: true };
  })
);

export const getRecentEmployeeCodes = (userId: number): Promise<string[]> => (
  readCodes(userId, RECENT_KEY, ADDRESS_BOOK_MAX_RECENT)
);

export const pushRecentEmployee = (userId: number, employeeCode: string): Promise<string[]> => (
  enqueueMutation(`${Number(userId || 0)}:${RECENT_KEY}`, async () => {
    const code = String(employeeCode || '').trim();
    const current = await getRecentEmployeeCodes(userId);
    if (!code) return current;
    return writeCodes(userId, RECENT_KEY, [code, ...current.filter((item) => item !== code)], ADDRESS_BOOK_MAX_RECENT);
  })
);

export const clearRecentEmployees = (userId: number): Promise<string[]> => (
  enqueueMutation(`${Number(userId || 0)}:${RECENT_KEY}`, () => (
    writeCodes(userId, RECENT_KEY, [], ADDRESS_BOOK_MAX_RECENT)
  ))
);
