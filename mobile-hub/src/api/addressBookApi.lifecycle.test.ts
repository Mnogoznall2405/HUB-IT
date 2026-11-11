import apiClient from './client';
import { getCompleteAddressBook } from './addressBookApi';

jest.mock('./client', () => ({ __esModule: true, default: { get: jest.fn() } }));

it('stops fallback pagination when the caller loses its session', async () => {
  let active = true;
  jest.mocked(apiClient.get)
    .mockRejectedValueOnce({ response: { status: 404 } })
    .mockImplementationOnce(async () => {
      active = false;
      return { data: { items: [{ full_name: 'Audit' }], total: 2, offset: 0, has_more: true } };
    });
  await expect(getCompleteAddressBook(1, () => { if (!active) throw new Error('session changed'); })).rejects.toThrow('session changed');
  expect(apiClient.get).toHaveBeenCalledTimes(2);
});
