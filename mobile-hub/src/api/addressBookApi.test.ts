import apiClient from './client';
import {
  ADDRESS_BOOK_SNAPSHOT_TIMEOUT_MS,
  ADDRESS_BOOK_SYNC_TIMEOUT_MS,
  getAddressBookStatus,
  getCompleteAddressBook,
  searchAddressBook,
  syncAddressBook,
} from './addressBookApi';

jest.mock('./client', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

const mockedClient = apiClient as unknown as {
  get: jest.Mock;
  post: jest.Mock;
};

describe('addressBookApi', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('searches with query and limit', async () => {
    mockedClient.get.mockResolvedValue({
      data: { items: [{ full_name: 'Ivanov' }], total: 1, updated_at: '2026-05-21T10:00:00Z' },
    });

    await expect(searchAddressBook({ q: 'ivanov', limit: 50 })).resolves.toEqual({
      items: [{ full_name: 'Ivanov' }],
      total: 1,
      limit: undefined,
      updated_at: '2026-05-21T10:00:00Z',
      last_error: '',
    });
    expect(mockedClient.get).toHaveBeenCalledWith('/address-book/search', {
      params: { q: 'ivanov', limit: 50 },
    });
  });

  it('loads the complete offline directory through one atomic snapshot request', async () => {
    mockedClient.get.mockResolvedValueOnce({
      data: {
        items: [{ full_name: 'Alpha' }, { full_name: 'Bravo' }],
        total: 2,
        updated_at: '2026-09-02T10:00:00Z',
      },
    });

    await expect(getCompleteAddressBook()).resolves.toEqual(expect.objectContaining({
      items: [{ full_name: 'Alpha' }, { full_name: 'Bravo' }],
      total: 2,
      has_more: false,
      updated_at: '2026-09-02T10:00:00Z',
    }));
    expect(mockedClient.get).toHaveBeenCalledTimes(1);
    expect(mockedClient.get).toHaveBeenCalledWith('/address-book/snapshot', {
      timeout: ADDRESS_BOOK_SNAPSHOT_TIMEOUT_MS,
    });
  });

  it('does not cap a complete offline snapshot at 5000 directory entries', async () => {
    const items = Array.from({ length: 5_000 }, (_, index) => ({
      full_name: `Employee ${index}`,
      employee_code: `E${index}`,
    }));
    mockedClient.get.mockResolvedValueOnce({
      data: { items, total: items.length, has_more: false },
    });

    const result = await getCompleteAddressBook();

    expect(result.items).toHaveLength(5_000);
    expect(result.items.at(-1)?.full_name).toBe('Employee 4999');
    expect(mockedClient.get).toHaveBeenCalledTimes(1);
  });

  it('falls back to every legacy page when the snapshot endpoint is unavailable', async () => {
    mockedClient.get
      .mockRejectedValueOnce({ response: { status: 404 } })
      .mockResolvedValueOnce({
        data: { items: [{ full_name: 'Alpha' }], total: 2, limit: 1, offset: 0, has_more: true },
      })
      .mockResolvedValueOnce({
        data: { items: [{ full_name: 'Bravo' }], total: 2, limit: 1, offset: 1, has_more: false },
      });

    await expect(getCompleteAddressBook(1)).resolves.toEqual(expect.objectContaining({
      items: [{ full_name: 'Alpha' }, { full_name: 'Bravo' }],
      total: 2,
      has_more: false,
    }));
    expect(mockedClient.get).toHaveBeenNthCalledWith(1, '/address-book/snapshot', {
      timeout: ADDRESS_BOOK_SNAPSHOT_TIMEOUT_MS,
    });
    expect(mockedClient.get).toHaveBeenNthCalledWith(2, '/address-book/search', {
      params: { q: '', limit: 1, offset: 0 },
    });
    expect(mockedClient.get).toHaveBeenNthCalledWith(3, '/address-book/search', {
      params: { q: '', limit: 1, offset: 1 },
    });
  });

  it('rejects a legacy server that ignores pagination instead of caching duplicate contacts', async () => {
    mockedClient.get
      .mockRejectedValueOnce({ response: { status: 404 } })
      .mockResolvedValueOnce({
        data: { items: [{ full_name: 'Alpha' }], total: 2, limit: 1 },
      })
      .mockResolvedValueOnce({
        data: { items: [{ full_name: 'Alpha' }], total: 2, limit: 1 },
      });

    await expect(getCompleteAddressBook(1)).rejects.toThrow('не поддерживает полную выгрузку');
  });

  it('does not hide snapshot server failures behind a legacy refetch', async () => {
    const failure = { response: { status: 500 } };
    mockedClient.get.mockRejectedValueOnce(failure);

    await expect(getCompleteAddressBook()).rejects.toBe(failure);
    expect(mockedClient.get).toHaveBeenCalledTimes(1);
    expect(mockedClient.get).toHaveBeenCalledWith('/address-book/snapshot', {
      timeout: ADDRESS_BOOK_SNAPSHOT_TIMEOUT_MS,
    });
  });

  it('rejects an incomplete snapshot instead of replacing the complete offline copy', async () => {
    mockedClient.get.mockResolvedValueOnce({
      data: {
        items: [{ full_name: 'Alpha' }],
        total: 2,
        has_more: true,
      },
    });

    await expect(getCompleteAddressBook()).rejects.toThrow('неполный снимок адресной книги');
    expect(mockedClient.get).toHaveBeenCalledTimes(1);
  });

  it('rejects a snapshot whose declared total differs from its item count', async () => {
    mockedClient.get.mockResolvedValueOnce({
      data: {
        items: [{ full_name: 'Alpha' }, { full_name: 'Bravo' }],
        total: 1,
        has_more: false,
      },
    });

    await expect(getCompleteAddressBook()).rejects.toThrow('неполный снимок адресной книги');
  });

  it('loads status and syncs with a long timeout', async () => {
    mockedClient.get.mockResolvedValue({ data: { count: 10, updated_at: 'now' } });
    mockedClient.post.mockResolvedValue({ data: { count: 11, updated_at: 'later' } });

    await expect(getAddressBookStatus()).resolves.toEqual({ count: 10, updated_at: 'now' });
    await expect(syncAddressBook()).resolves.toEqual({ count: 11, updated_at: 'later' });
    expect(mockedClient.post).toHaveBeenCalledWith('/address-book/sync', null, {
      timeout: ADDRESS_BOOK_SYNC_TIMEOUT_MS,
    });
  });
});
