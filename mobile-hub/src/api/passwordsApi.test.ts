import apiClient from './client';
import * as tokenStore from '../auth/tokenStore';
import {
  listPasswordVaultEntries,
  revealPasswordVaultEntry,
  unlockPasswordVaultWithBiometrics,
  updatePasswordVaultEntry,
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
  });
  expect(client.get).toHaveBeenCalledWith('/passwords', { params: { q: 'root', group: '', tag: '', include_archived: true }, signal: undefined });
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
