import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import { PreferencesProvider, usePreferences } from './PreferencesContext';
import { DEFAULT_PREFERENCES, normalizePreferencePayload } from './preferenceNormalizers';
import * as api from '../api/settingsApi';
import * as cache from './preferenceCache';

let mockOffline = true;
let mockUser = 1;
jest.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: { id: mockUser }, offlineMode: mockOffline }) }));
jest.mock('../api/settingsApi', () => ({ getMySettings: jest.fn(), updateMySettings: jest.fn() }));
jest.mock('./preferenceCache', () => ({ cachePreferences: jest.fn(), readCachedPreferences: jest.fn(), readPendingPreferences: jest.fn(), writePendingPreferences: jest.fn() }));
function Controls() {
  const { preferences, savePreferences } = usePreferences();
  return <><Text testID="theme">{preferences.theme_mode}</Text>
    <Pressable testID="dark" onPress={() => void savePreferences({ theme_mode: 'dark' })} />
    <Pressable testID="light" onPress={() => void savePreferences({ theme_mode: 'light' })} /></>;
}
const App = () => <PreferencesProvider><Controls /></PreferencesProvider>;
beforeEach(() => {
  jest.clearAllMocks(); mockOffline = true; mockUser = 1;
  const pending = new Map<number, object>();
  jest.mocked(cache.readCachedPreferences).mockResolvedValue({ ...DEFAULT_PREFERENCES });
  jest.mocked(cache.readPendingPreferences).mockImplementation(async id => pending.get(id) || {});
  jest.mocked(cache.writePendingPreferences).mockImplementation(async (id, patch) => { pending.set(id, patch); });
  jest.mocked(cache.cachePreferences).mockResolvedValue();
  jest.mocked(api.getMySettings).mockResolvedValue({ ...DEFAULT_PREFERENCES });
  jest.mocked(api.updateMySettings).mockImplementation(async patch => normalizePreferencePayload({ ...DEFAULT_PREFERENCES, ...patch }));
});
it('persists offline preferences and synchronizes them after reconnect', async () => {
  const view = await render(<App />);
  await waitFor(() => expect(cache.readCachedPreferences).toHaveBeenCalledWith(1));
  await fireEvent.press(view.getByTestId('dark'));
  await waitFor(() => expect(cache.writePendingPreferences).toHaveBeenCalledWith(1, { theme_mode: 'dark' }));
  expect(api.updateMySettings).not.toHaveBeenCalled();
  expect(view.getByTestId('theme').props.children).toBe('dark');
  mockOffline = false; await view.rerender(<App />);
  await waitFor(() => expect(api.updateMySettings).toHaveBeenCalledWith({ theme_mode: 'dark' }));
  await waitFor(() => expect(cache.writePendingPreferences).toHaveBeenLastCalledWith(1, {}));
});
it('keeps a newer edit when an older server response finishes', async () => {
  let finish!: (value: typeof DEFAULT_PREFERENCES) => void;
  jest.mocked(api.updateMySettings).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = await render(<App />);
  await fireEvent.press(view.getByTestId('dark'));
  await waitFor(() => expect(cache.writePendingPreferences).toHaveBeenCalled());
  mockOffline = false; await view.rerender(<App />);
  await waitFor(() => expect(api.updateMySettings).toHaveBeenCalledTimes(1));
  await fireEvent.press(view.getByTestId('light'));
  await waitFor(() => expect(cache.writePendingPreferences).toHaveBeenLastCalledWith(1, { theme_mode: 'light' }));
  await act(async () => finish({ ...DEFAULT_PREFERENCES, theme_mode: 'dark' }));
  await waitFor(() => expect(api.updateMySettings).toHaveBeenLastCalledWith({ theme_mode: 'light' }));
  expect(view.getByTestId('theme').props.children).toBe('light');
});
it('does not apply a previous account response after switching users', async () => {
  let finish!: (value: typeof DEFAULT_PREFERENCES) => void;
  jest.mocked(api.getMySettings).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  mockOffline = false;
  const view = await render(<App />);
  await waitFor(() => expect(api.getMySettings).toHaveBeenCalled());
  mockUser = 2; await view.rerender(<App />);
  await act(async () => finish({ ...DEFAULT_PREFERENCES, theme_mode: 'dark' }));
  await waitFor(() => expect(cache.readCachedPreferences).toHaveBeenCalledWith(2));
  expect(view.getByTestId('theme').props.children).toBe('light');
});
