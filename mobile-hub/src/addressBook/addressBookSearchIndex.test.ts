import {
  addressBookEntryIndicesByCode,
  buildAddressBookSearchIndex,
  searchAddressBookIndex,
  SEARCH_INDEX_CHUNK_SIZE,
} from './addressBookSearchIndex';
import type { AddressBookEntry } from './addressBookFormat';

// Oracle: the pre-N4 per-query filter, copied verbatim from
// NativeAddressBookScreen.tsx (it built the haystack for every item on every
// keystroke). Results must be byte-identical, order included.
function normalizeDirectorySearch(value: unknown): string {
  return String(value || '')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, ' ')
    .trim();
}

function filterAddressBookEntries(items: AddressBookEntry[], query: string): AddressBookEntry[] {
  const tokens = normalizeDirectorySearch(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return items;
  return items.filter((item) => {
    const contacts = [
      ...(item.work_phones || []),
      ...(item.personal_phones || []),
      ...(item.work_emails || []),
      ...(item.personal_emails || []),
    ].flatMap((value) => [value.kind, value.value, value.normalized]);
    const haystack = normalizeDirectorySearch([
      item.full_name,
      item.position,
      item.department,
      item.department_location,
      item.office_address,
      item.office_room,
      item.workplace_number,
      ...contacts,
    ].join(' '));
    return tokens.every((token) => haystack.includes(token));
  });
}

const SURNAMES = ['Иванов', 'Петров', 'Сидоров', 'Ёжиков', 'Кузнецов', 'Смирнов', 'Васильев', 'Орлов'];
const DEPARTMENTS = ['Отдел мониторинга', 'ИТ департамент', 'Бухгалтерия', 'Служба охраны', 'Транспортный отдел'];
const CITIES = ['Тюмень', 'Москва', 'Сургут', 'Екатеринбург'];

const ITEMS: AddressBookEntry[] = Array.from({ length: 3000 }, (_, index) => ({
  employee_code: `E${index}`,
  full_name: `${SURNAMES[index % SURNAMES.length]} Имя${index} Отч${index}`,
  position: index % 7 === 0 ? 'Ведущий специалист' : 'Специалист',
  department: DEPARTMENTS[index % DEPARTMENTS.length],
  department_location: CITIES[index % CITIES.length],
  office_address: `ул. Ленина ${index % 90}`,
  office_room: String(100 + (index % 200)),
  workplace_number: `РМ-${index % 500}`,
  work_phones: [{ kind: 'Рабочий телефон', value: `8345200${String(1000 + index).slice(-4)}`, normalized: `7345200${String(1000 + index).slice(-4)}` }],
  personal_phones: [{ kind: 'Мобильный телефон', value: `892200${String(100000 + index)}`, normalized: `792200${String(100000 + index)}` }],
  work_emails: [{ kind: 'Корпоративный E-mail', value: `user${index}@zsgp.ru`, normalized: `user${index}@zsgp.ru` }],
  personal_emails: [],
}));

const QUERIES = [
  '', '   ', 'иван', 'ИВАНОВ', 'иванов ведущий', 'петров тюмень',
  '8345', '+7 345', '345-20', '8922', '7922', 'user100@zsgp.ru', 'zsgp',
  'ёжиков', 'ежиков', 'ЕЖИКОВ', 'ленина 45', 'каб', 'рм-17', 'рм 17',
  'мониторинг специалист москва', 'отдел', 'несуществующий запрос xyz',
  '  двойные   пробелы  ', 'e-mail', 'смирнов екатеринбург каб', 'ТЮМЕНЬ',
  'иванов-petrov', '234', 'орлов сургут', 'user', 'телефон',
  'иван петров сидоров', 'магнитогорск', 'бух', '1',
];

const percentile = (samples: number[], p: number) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
};

describe('addressBookSearchIndex', () => {
  it('returns results identical to the previous filter on 35+ queries', async () => {
    const index = await buildAddressBookSearchIndex(ITEMS);
    for (const query of QUERIES) {
      expect(searchAddressBookIndex(index, query)).toEqual(filterAddressBookEntries(ITEMS, query));
    }
  });

  it('builds the index in chunks within the V8 time budget', async () => {
    const started = performance.now();
    const index = await buildAddressBookSearchIndex(ITEMS);
    const buildMs = performance.now() - started;
    expect(index.haystacks).toHaveLength(ITEMS.length);
    expect(index.byCode.get('E2999')).toBe(2999);
    // Gate from the assignment: ≤ 150 ms on V8 for 3000 records.
    expect(buildMs).toBeLessThan(150);
  });

  it('searches within the indexed p95 gate', async () => {
    const index = await buildAddressBookSearchIndex(ITEMS);
    const samples: number[] = [];
    for (let round = 0; round < 6; round += 1) {
      for (const query of QUERIES) {
        const started = performance.now();
        searchAddressBookIndex(index, query);
        samples.push(performance.now() - started);
      }
    }
    // Gate from the assignment: indexed search p95 ≤ 5 ms on 3000 records.
    expect(percentile(samples, 0.95)).toBeLessThan(5);
  });

  it('picks entries by employee_code without scanning', async () => {
    const index = await buildAddressBookSearchIndex(ITEMS);
    const indices = addressBookEntryIndicesByCode(index, ['E7', 'E3', 'E-STALE', 'E42']);
    expect(indices).toEqual([7, 3, 42]);
    expect(searchAddressBookIndex(index, '', indices)).toEqual([ITEMS[7], ITEMS[3], ITEMS[42]]);
    expect(searchAddressBookIndex(index, 'иванов', indices)).toEqual(
      [ITEMS[7], ITEMS[3], ITEMS[42]].filter((item) =>
        filterAddressBookEntries([item], 'иванов').length > 0),
    );
  });

  it('still produces a complete index with a small chunk size', async () => {
    const index = await buildAddressBookSearchIndex(ITEMS.slice(0, SEARCH_INDEX_CHUNK_SIZE + 5), 10);
    expect(index.haystacks).toHaveLength(SEARCH_INDEX_CHUNK_SIZE + 5);
    expect(searchAddressBookIndex(index, 'иванов')).toEqual(
      filterAddressBookEntries(ITEMS.slice(0, SEARCH_INDEX_CHUNK_SIZE + 5), 'иванов'),
    );
  });
});
