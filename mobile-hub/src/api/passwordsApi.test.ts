import apiClient from './client';
import { listPasswordVaultEntries } from './passwordsApi';

jest.mock('./client', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
const client = apiClient as unknown as { get: jest.Mock; post: jest.Mock };

beforeEach(() => jest.clearAllMocks());

it('normalizes metadata without inventing entries or password values', async () => {
  client.get.mockResolvedValue({ data: { items: [{ id: 'entry-1', login: ' admin ', group: 'Servers', tags: ['Prod', 'prod'] }, { login: 'bad' }], groups: ['Servers'], tags: ['Prod'], unlocked_until: null } });
  await expect(listPasswordVaultEntries({ q: ' root ', includeArchived: true })).resolves.toEqual({
    items: [expect.objectContaining({ id: 'entry-1', login: 'admin', group: 'Servers', tags: ['Prod'] })],
    groups: ['Servers'],
    tags: ['Prod'],
    unlocked_until: '',
  });
  expect(client.get).toHaveBeenCalledWith('/passwords', { params: { q: 'root', group: '', tag: '', include_archived: true }, signal: undefined });
});
