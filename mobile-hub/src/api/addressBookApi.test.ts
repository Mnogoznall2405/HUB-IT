import apiClient from './client';
import {
  ADDRESS_BOOK_SYNC_TIMEOUT_MS,
  getAddressBookStatus,
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
    jest.clearAllMocks();
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
