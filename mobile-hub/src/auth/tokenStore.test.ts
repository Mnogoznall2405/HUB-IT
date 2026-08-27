import {
  clearTokens,
  getCachedSessionUser,
  getSessionUserId,
  setCachedSessionUser,
  setSessionUserId,
  setTokens,
  subscribeAccessTokenChanges,
} from './tokenStore';
import { readNativeSnapshot, writeNativeSnapshot } from '../cache/nativeSnapshotCache';

const cachedUser = {
  id: 38,
  username: 'cached-user',
  role: 'viewer',
  permissions: ['dashboard.read'],
};

it('keeps the headless task owner only for the active authenticated session', async () => {
  await setTokens('access-token', 'refresh-token');
  await setSessionUserId(38);

  await expect(getSessionUserId()).resolves.toBe(38);
  await clearTokens();
  await expect(getSessionUserId()).resolves.toBeNull();
});

it('keeps the cached native identity only while its tokens exist', async () => {
  await setTokens('access-token', 'refresh-token');
  await setCachedSessionUser(cachedUser);
  await writeNativeSnapshot('dashboard', cachedUser.id, { private: true });

  await expect(getCachedSessionUser()).resolves.toEqual(cachedUser);
  await clearTokens();
  await expect(getCachedSessionUser()).resolves.toBeNull();
  await expect(readNativeSnapshot('dashboard', cachedUser.id)).resolves.toBeNull();
});

it('rejects an invalid session owner', async () => {
  await expect(setSessionUserId(0)).rejects.toThrow('Некорректный идентификатор пользователя');
});

it('notifies mounted media when the access token changes', async () => {
  const listener = jest.fn();
  const unsubscribe = subscribeAccessTokenChanges(listener);

  await setTokens('next-access-token', 'next-refresh-token');
  expect(listener).toHaveBeenCalledWith('next-access-token');

  unsubscribe();
  await setTokens('ignored-access-token', 'ignored-refresh-token');
  expect(listener).toHaveBeenCalledTimes(1);
});
