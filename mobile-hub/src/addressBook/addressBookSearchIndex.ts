// Address-book search index (N4): the normalized haystack per entry is built
// once per snapshot, in chunks that yield to the event loop so typing is never
// blocked. Queries are then plain `includes` checks over prepared strings.
// `byCode` maps employee_code → item index so list modes pick saved codes
// without scanning the directory.

import { normalizeText, type AddressBookEntry } from './addressBookFormat';

export const SEARCH_INDEX_CHUNK_SIZE = 300;

// Same normalization as the previous per-query filter — the oracle in
// `addressBookSearchIndex.test.ts` keeps the original implementation verbatim
// and asserts identical results.
export function normalizeAddressBookSearch(value: unknown): string {
  return String(value || '')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, ' ')
    .trim();
}

function buildEntryHaystack(item: AddressBookEntry): string {
  const contacts = [
    ...(item.work_phones || []),
    ...(item.personal_phones || []),
    ...(item.work_emails || []),
    ...(item.personal_emails || []),
  ];
  const parts: unknown[] = [
    item.full_name,
    item.position,
    item.department,
    item.department_location,
    item.office_address,
    item.office_room,
    item.workplace_number,
  ];
  for (const contact of contacts) {
    parts.push(contact?.kind, contact?.value, contact?.normalized);
  }
  return normalizeAddressBookSearch(parts.join(' '));
}

export type AddressBookSearchIndex = {
  items: AddressBookEntry[];
  haystacks: string[];
  byCode: Map<string, number>;
};

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function buildAddressBookSearchIndex(
  items: AddressBookEntry[],
  chunkSize = SEARCH_INDEX_CHUNK_SIZE,
): Promise<AddressBookSearchIndex> {
  const haystacks = new Array<string>(items.length);
  const byCode = new Map<string, number>();
  const chunk = Math.max(1, chunkSize);
  for (let index = 0; index < items.length; index += 1) {
    haystacks[index] = buildEntryHaystack(items[index]);
    const code = normalizeText(items[index]?.employee_code);
    if (code) byCode.set(code, index);
    if ((index + 1) % chunk === 0) await yieldToEventLoop();
  }
  return { items, haystacks, byCode };
}

export function addressBookEntryIndicesByCode(
  index: AddressBookSearchIndex,
  codes: readonly string[],
): number[] {
  const indices: number[] = [];
  for (const code of codes) {
    const found = index.byCode.get(code);
    if (found !== undefined) indices.push(found);
  }
  return indices;
}

export function searchAddressBookIndex(
  index: AddressBookSearchIndex,
  query: string,
  indices?: readonly number[],
): AddressBookEntry[] {
  const tokens = normalizeAddressBookSearch(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return indices ? indices.map((row) => index.items[row]) : index.items;
  }
  const count = indices ? indices.length : index.haystacks.length;
  const out: AddressBookEntry[] = [];
  for (let row = 0; row < count; row += 1) {
    const itemIndex = indices ? indices[row] : row;
    const haystack = index.haystacks[itemIndex];
    let matched = true;
    for (const token of tokens) {
      if (!haystack.includes(token)) {
        matched = false;
        break;
      }
    }
    if (matched) out.push(index.items[itemIndex]);
  }
  return out;
}
