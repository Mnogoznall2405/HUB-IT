import apiClient from './client';
import type { AddressBookEntry } from '../addressBook/addressBookFormat';

export const ADDRESS_BOOK_SYNC_TIMEOUT_MS = 120_000;
export const ADDRESS_BOOK_SNAPSHOT_TIMEOUT_MS = 120_000;
export const ADDRESS_BOOK_SEARCH_LIMIT = 50;

export type AddressBookSearchResponse = {
  items: AddressBookEntry[];
  total: number;
  limit?: number;
  offset?: number;
  has_more?: boolean;
  updated_at?: string | null;
  last_error?: string | null;
};

export type AddressBookStatus = {
  count?: number;
  updated_at?: string | null;
  last_error?: string | null;
  sync_in_progress?: boolean;
};

function normalizeAddressBookResponse(data: AddressBookSearchResponse | null | undefined): AddressBookSearchResponse {
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    total: Number(data?.total || 0),
    limit: data?.limit,
    ...(data?.offset == null ? {} : { offset: Number(data.offset || 0) }),
    ...(data?.has_more == null ? {} : { has_more: Boolean(data.has_more) }),
    updated_at: data?.updated_at || '',
    last_error: data?.last_error || '',
  };
}

function isSnapshotEndpointUnavailable(cause: unknown): boolean {
  const status = Number((cause as { response?: { status?: unknown } } | null)?.response?.status || 0);
  return status === 404 || status === 405;
}

export async function searchAddressBook(
  options: { q?: string; limit?: number; offset?: number } = {},
): Promise<AddressBookSearchResponse> {
  const { data } = await apiClient.get<AddressBookSearchResponse>('/address-book/search', {
    params: {
      q: options.q ?? '',
      limit: options.limit ?? ADDRESS_BOOK_SEARCH_LIMIT,
      ...(options.offset == null ? {} : { offset: Math.max(0, Number(options.offset || 0)) }),
    },
  });
  return normalizeAddressBookResponse(data);
}

export async function getCompleteAddressBook(pageSize = 200): Promise<AddressBookSearchResponse> {
  try {
    const { data } = await apiClient.get<AddressBookSearchResponse>('/address-book/snapshot', {
      timeout: ADDRESS_BOOK_SNAPSHOT_TIMEOUT_MS,
    });
    const snapshot = normalizeAddressBookResponse(data);
    if (snapshot.has_more === true || snapshot.items.length !== snapshot.total) {
      throw new Error('Получен неполный снимок адресной книги.');
    }
    return {
      ...snapshot,
      offset: 0,
      has_more: false,
    };
  } catch (cause) {
    if (!isSnapshotEndpointUnavailable(cause)) throw cause;
  }

  const limit = Math.max(1, Math.min(200, Math.trunc(Number(pageSize || 200))));
  const items: AddressBookEntry[] = [];
  let total: number | null = null;
  let offset = 0;
  let updatedAt = '';
  let lastError = '';

  for (;;) {
    const page = await searchAddressBook({ q: '', limit, offset });
    if (offset > 0 && page.offset == null) {
      throw new Error('Сервер адресной книги не поддерживает полную выгрузку. Обновите сервер и повторите подготовку.');
    }
    if (page.offset != null && page.offset !== offset) {
      throw new Error('Сервер вернул несогласованную страницу адресной книги. Повторите подготовку.');
    }
    const pageTotal = Math.max(0, Math.trunc(Number(page.total || 0)));
    if (total == null) total = pageTotal;
    else if (pageTotal !== total) {
      throw new Error('Сервер изменил адресную книгу во время выгрузки. Повторите подготовку.');
    }
    items.push(...page.items);
    if (items.length > total) {
      throw new Error('Получен неполный снимок адресной книги.');
    }
    updatedAt = page.updated_at || updatedAt;
    lastError = page.last_error || lastError;
    offset += page.items.length;
    const hasMore = page.has_more ?? offset < total;
    if (!hasMore || page.items.length === 0 || offset >= total) break;
  }

  const expectedTotal = total ?? 0;
  if (items.length !== expectedTotal) {
    throw new Error('Получен неполный снимок адресной книги.');
  }

  return {
    items,
    total: expectedTotal,
    limit,
    offset: 0,
    has_more: false,
    updated_at: updatedAt,
    last_error: lastError,
  };
}

export async function getAddressBookStatus(): Promise<AddressBookStatus> {
  const { data } = await apiClient.get<AddressBookStatus>('/address-book/status');
  return data || {};
}

export async function syncAddressBook(): Promise<AddressBookStatus> {
  const { data } = await apiClient.post<AddressBookStatus>('/address-book/sync', null, {
    timeout: ADDRESS_BOOK_SYNC_TIMEOUT_MS,
  });
  return data || {};
}
