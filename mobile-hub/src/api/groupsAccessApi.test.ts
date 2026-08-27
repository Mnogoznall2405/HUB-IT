import apiClient from './client';
import { getGroupsAccessStatus, listGroupsAccessGroups } from './groupsAccessApi';

jest.mock('./client', () => ({ __esModule: true, default: { get: jest.fn() } }));
const client = apiClient as unknown as { get: jest.Mock };

beforeEach(() => jest.clearAllMocks());

it('normalizes status without trusting snapshot field types', async () => {
  client.get.mockResolvedValue({ data: { status: 'ok', last_sync_at: '2026-08-24T10:00:00Z', branches: ['SPb', '', 5], summary: { group_count: '608', user_count: 515 } } });
  await expect(getGroupsAccessStatus()).resolves.toEqual({
    status: 'ok',
    last_sync_at: '2026-08-24T10:00:00Z',
    error: '',
    branches: ['SPb', '5'],
    summary: { group_count: 608, user_count: 515 },
  });
  expect(client.get).toHaveBeenCalledWith('/groups-access/status', { signal: undefined });
});

it('uses bounded server pagination and discards malformed group rows', async () => {
  client.get.mockResolvedValue({ data: {
    items: [
      { dn: 'CN=RW-Files,OU=SPb', cn: 'RW-Files', branch: 'SPb', folder_path: 'Общие/Проекты', access_level: 'write', member_count: '12' },
      { cn: 'missing-dn' },
    ],
    total: 81,
    page: 2,
    limit: 40,
    synced_at: '2026-08-24T10:00:00Z',
  } });
  const page = await listGroupsAccessGroups({ branch: ' SPb ', q: ' Проекты ', page: 2, limit: 5000 });
  expect(page).toEqual(expect.objectContaining({ total: 81, page: 2, limit: 40, has_more: true }));
  expect(page.items).toEqual([expect.objectContaining({ dn: 'CN=RW-Files,OU=SPb', folder_path: 'Общие/Проекты', member_count: 12 })]);
  expect(client.get).toHaveBeenCalledWith('/groups-access/matrix', {
    params: { branch: 'SPb', q: 'Проекты', page: 2, limit: 100 },
    signal: undefined,
  });
});
