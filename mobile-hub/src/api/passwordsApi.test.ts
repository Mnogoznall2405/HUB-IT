import apiClient from './client';
import * as tokenStore from '../auth/tokenStore';
import {
  archivePasswordVaultEntry,
  archivePasswordVaultGroup,
  createPasswordVaultEntry,
  createPasswordVaultGroup,
  listPasswordVaultEntries,
  listPasswordVaultGroups,
  revealPasswordVaultEntry,
  unlockPasswordVaultWithBiometrics,
  updatePasswordVaultEntry,
  updatePasswordVaultGroup,
} from './passwordsApi';

jest.mock('./client', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), patch: jest.fn() },
  withMobileAuthHeaders: (clientDeviceId?: string) => ({
    'X-Auth-Client': 'mobile',
    ...(clientDeviceId ? { 'X-Client-Device-ID': clientDeviceId } : {}),
  }),
}));
jest.mock('../auth/tokenStore', () => ({ getOrCreateClientDeviceId: jest.fn() }));
const client = apiClient as unknown as { get: jest.Mock; post: jest.Mock; patch: jest.Mock };

beforeEach(() => jest.clearAllMocks());

it('normalizes metadata without inventing entries or password values', async () => {
  client.get.mockResolvedValue({ data: { items: [{ id: 'entry-1', login: ' admin ', group: 'Servers', tags: ['Prod', 'prod'] }, { login: 'bad' }], groups: ['Servers'], tags: ['Prod'], unlocked_until: null } });
  await expect(listPasswordVaultEntries({ q: ' root ', includeArchived: true })).resolves.toEqual({
    items: [expect.objectContaining({ id: 'entry-1', login: 'admin', group: 'Servers', tags: ['Prod'] })],
    groups: ['Servers'],
    tags: ['Prod'],
    unlocked_until: '',
    total: 1,
    truncated: false,
  });
  expect(client.get).toHaveBeenCalledWith('/passwords', { params: { q: 'root', group: '', tag: '', include_archived: true, limit: 200, offset: 0 }, signal: undefined });
});

it('unlocks the vault with the device-bound biometric credential and mobile headers', async () => {
  (tokenStore.getOrCreateClientDeviceId as jest.Mock).mockResolvedValue('device-17');
  client.post.mockResolvedValue({ data: { unlocked_until: '2026-09-03T12:05:00+00:00' } });

  await expect(unlockPasswordVaultWithBiometrics('mb1.credential.secret')).resolves.toEqual({
    unlocked_until: '2026-09-03T12:05:00+00:00',
  });
  expect(client.post).toHaveBeenCalledWith(
    '/passwords/unlock/mobile-biometric',
    { renewal_token: 'mb1.credential.secret' },
    { headers: { 'X-Auth-Client': 'mobile', 'X-Client-Device-ID': 'device-17' } },
  );
});

it('reveals one password and updates only normalized editable fields', async () => {
  (tokenStore.getOrCreateClientDeviceId as jest.Mock).mockResolvedValue('device-17');
  client.post.mockResolvedValue({ data: { password: 'plain-secret', unlocked_until: '2026-09-03T12:05:00+00:00' } });
  client.patch.mockResolvedValue({ data: { id: 'entry-1', login: 'admin', group: 'Servers', tags: [], description: '', password_configured: true } });

  await expect(revealPasswordVaultEntry('entry/1', 'show')).resolves.toEqual({
    password: 'plain-secret',
    unlocked_until: '2026-09-03T12:05:00+00:00',
  });
  await updatePasswordVaultEntry('entry/1', {
    group: ' Servers ',
    tags: ['Prod', 'prod', '#VPN'],
    login: ' admin ',
    description: ' note ',
    password: 'new-secret',
  });

  expect(client.post).toHaveBeenCalledWith('/passwords/entry%2F1/reveal', { purpose: 'show' });
  expect(client.patch).toHaveBeenCalledWith(
    '/passwords/entry%2F1',
    {
      group: 'Servers',
      tags: ['Prod', 'VPN'],
      login: 'admin',
      description: 'note',
      password: 'new-secret',
    },
    { headers: { 'X-Auth-Client': 'mobile', 'X-Client-Device-ID': 'device-17' } },
  );
});

it('creates an entry with the backend payload shape and mobile headers', async () => {
  (tokenStore.getOrCreateClientDeviceId as jest.Mock).mockResolvedValue('device-17');
  client.post.mockResolvedValue({ data: { id: 'entry-9', login: 'new-admin', group: 'Servers', tags: ['Prod'], is_archived: false } });

  await expect(createPasswordVaultEntry({
    group: ' Servers ',
    tags: ['#Prod', 'prod', 'VPN'],
    login: ' new-admin ',
    description: ' note ',
    password: 'fresh-secret',
  })).resolves.toEqual(expect.objectContaining({ id: 'entry-9', login: 'new-admin', group: 'Servers' }));

  expect(client.post).toHaveBeenCalledWith(
    '/passwords',
    {
      group: 'Servers',
      tags: ['Prod', 'VPN'],
      login: 'new-admin',
      description: 'note',
      password: 'fresh-secret',
    },
    { headers: { 'X-Auth-Client': 'mobile', 'X-Client-Device-ID': 'device-17' } },
  );
});

it('archives an entry with an empty body and returns the archived entry', async () => {
  (tokenStore.getOrCreateClientDeviceId as jest.Mock).mockResolvedValue('device-17');
  client.post.mockResolvedValue({ data: { id: 'entry-1', login: 'admin', group: 'Servers', is_archived: true } });

  await expect(archivePasswordVaultEntry('entry/1')).resolves.toEqual(
    expect.objectContaining({ id: 'entry-1', is_archived: true }),
  );
  expect(client.post).toHaveBeenCalledWith(
    '/passwords/entry%2F1/archive',
    undefined,
    { headers: { 'X-Auth-Client': 'mobile', 'X-Client-Device-ID': 'device-17' } },
  );
});

it('lists, creates, renames and archives vault groups on the backend routes', async () => {
  (tokenStore.getOrCreateClientDeviceId as jest.Mock).mockResolvedValue('device-17');
  client.get.mockResolvedValue({ data: { items: [
    { id: 'group-1', name: 'Servers', sort_order: 0, is_active: true },
    { id: 'group-2', name: 'Old', sort_order: 3, is_active: false },
    { name: 'no-id' },
  ] } });
  client.post.mockResolvedValue({ data: { id: 'group-3', name: 'Kassa', sort_order: 1, is_active: true } });
  client.patch.mockResolvedValue({ data: { id: 'group-1', name: 'Servers-2', sort_order: 0, is_active: true } });

  await expect(listPasswordVaultGroups({ includeInactive: true })).resolves.toEqual([
    { id: 'group-1', name: 'Servers', sort_order: 0, is_active: true },
    { id: 'group-2', name: 'Old', sort_order: 3, is_active: false },
  ]);
  expect(client.get).toHaveBeenCalledWith('/passwords/groups', { params: { include_inactive: true } });

  await expect(createPasswordVaultGroup({ name: ' Kassa ', sort_order: 1 })).resolves.toEqual(
    expect.objectContaining({ id: 'group-3', name: 'Kassa' }),
  );
  expect(client.post).toHaveBeenCalledWith(
    '/passwords/groups',
    { name: 'Kassa', sort_order: 1 },
    { headers: { 'X-Auth-Client': 'mobile', 'X-Client-Device-ID': 'device-17' } },
  );

  await updatePasswordVaultGroup('group/1', { name: ' Servers-2 ', sort_order: 0 });
  expect(client.patch).toHaveBeenCalledWith(
    '/passwords/groups/group%2F1',
    { name: 'Servers-2', sort_order: 0 },
    { headers: { 'X-Auth-Client': 'mobile', 'X-Client-Device-ID': 'device-17' } },
  );

  client.post.mockResolvedValue({ data: { id: 'group-1', name: 'Servers-2', sort_order: 0, is_active: false } });
  await expect(archivePasswordVaultGroup('group/1')).resolves.toEqual(
    expect.objectContaining({ id: 'group-1', is_active: false }),
  );
  expect(client.post).toHaveBeenLastCalledWith(
    '/passwords/groups/group%2F1/archive',
    undefined,
    { headers: { 'X-Auth-Client': 'mobile', 'X-Client-Device-ID': 'device-17' } },
  );
});
