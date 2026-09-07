import * as SecureStore from 'expo-secure-store';
import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  getCachedSessionUser,
  getSessionUserId,
  setCachedSessionUser,
  setSessionUserId,
  setTokens,
  subscribeAccessTokenChanges,
} from './tokenStore';
import { readNativeSnapshot, writeNativeSnapshot } from '../cache/nativeSnapshotCache';
import { clearNativeMyFilesOffline } from '../myFiles/nativeMyFilesOfflineStore';

jest.mock('../myFiles/nativeMyFilesOfflineStore', () => ({
  clearNativeMyFilesOffline: jest.fn(async () => undefined),
}));

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
  expect(clearNativeMyFilesOffline).not.toHaveBeenCalled();
});

it('keeps encrypted offline data when an expired session clears its credentials', async () => {
  await setTokens('access-token', 'refresh-token');
  await setCachedSessionUser(cachedUser);
  await writeNativeSnapshot('dashboard', cachedUser.id, { private: true });

  await expect(getCachedSessionUser()).resolves.toEqual(cachedUser);
  await clearTokens();
  await expect(getCachedSessionUser()).resolves.toBeNull();
  await expect(readNativeSnapshot('dashboard', cachedUser.id)).resolves.toEqual(
    expect.objectContaining({ data: { private: true } }),
  );
});

it('removes encrypted offline data only during an explicit device logout', async () => {
  await setTokens('access-token', 'refresh-token');
  await setCachedSessionUser(cachedUser);
  await writeNativeSnapshot('dashboard', cachedUser.id, { private: true });

  await clearTokens({ clearOfflineData: true });

  await expect(readNativeSnapshot('dashboard', cachedUser.id)).resolves.toBeNull();
  expect(clearNativeMyFilesOffline).toHaveBeenCalledWith(cachedUser.id);
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

it('finishes delayed old credential deletion before persisting a newer login', async () => {
  await setTokens('old-access', 'old-refresh');
  const remove = jest.mocked(SecureStore.deleteItemAsync).getMockImplementation()!;
  let release!: () => void;
  let started!: () => void;
  const deleting = new Promise<void>((resolve) => { started = resolve; });
  jest.mocked(SecureStore.deleteItemAsync).mockImplementationOnce(async (key, options) => {
    started();
    await new Promise<void>((resolve) => { release = resolve; });
    return remove(key, options);
  });
  const clearing = clearTokens();
  await deleting;
  const login = setTokens('new-access', 'new-refresh');
  release();
  await Promise.all([clearing, login]);
  expect(await getAccessToken()).toBe('new-access');
  expect(await getRefreshToken()).toBe('new-refresh');
});

it('holds readers until the entire token pair has been written', async () => {
  await setTokens('old-access', 'old-refresh');
  const write = jest.mocked(SecureStore.setItemAsync).getMockImplementation()!;
  let release!: () => void;
  let started!: () => void;
  const writing = new Promise<void>((resolve) => { started = resolve; });
  jest.mocked(SecureStore.setItemAsync).mockImplementationOnce(async (key, value, options) => {
    await write(key, value, options);
    started();
    await new Promise<void>((resolve) => { release = resolve; });
  });
  const login = setTokens('new-access', 'new-refresh');
  await writing;
  let readFinished = false;
  const read = Promise.all([getAccessToken(), getRefreshToken()]).then((pair) => { readFinished = true; return pair; });
  await Promise.resolve();
  expect(readFinished).toBe(false);
  release();
  await login;
  expect(await read).toEqual(['new-access', 'new-refresh']);
});

it('continues processing after a rejected write and lets a later logout win', async () => {
  jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error('Synthetic storage failure'));
  await expect(setTokens('failed-access', 'failed-refresh')).rejects.toThrow('Synthetic storage failure');
  const login = setTokens('new-access', 'new-refresh');
  const logout = clearTokens();
  await Promise.all([login, logout]);
  expect(await getAccessToken()).toBeNull();
  expect(await getRefreshToken()).toBeNull();
});
