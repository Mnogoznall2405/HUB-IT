import apiClient from './client';
import type { AddressBookEntry } from '../addressBook/addressBookFormat';

export const ADDRESS_BOOK_SYNC_TIMEOUT_MS = 120_000;
export const ADDRESS_BOOK_SEARCH_LIMIT = 50;

export type AddressBookSearchResponse = {
  items: AddressBookEntry[];
  total: number;
  limit?: number;
  updated_at?: string | null;
  last_error?: string | null;
};

export type AddressBookStatus = {
  count?: number;
  updated_at?: string | null;
  last_error?: string | null;
  sync_in_progress?: boolean;
};

export async function searchAddressBook(
  options: { q?: string; limit?: number } = {},
): Promise<AddressBookSearchResponse> {
  const { data } = await apiClient.get<AddressBookSearchResponse>('/address-book/search', {
    params: {
      q: options.q ?? '',
      limit: options.limit ?? ADDRESS_BOOK_SEARCH_LIMIT,
    },
  });
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    total: Number(data?.total || 0),
    limit: data?.limit,
    updated_at: data?.updated_at || '',
    last_error: data?.last_error || '',
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
