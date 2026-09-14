import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert, AppState } from 'react-native';
import * as api from '../../api/adminSettingsApi';
import { NativeAdminAdUsersScreen, NativeAdminAiBotsScreen, NativeAdminSystemScreen } from './NativeAdminAdditionalScreens';
import { NativeAdminEnvEditor } from './NativeAdminEnvEditor';
import { unlockBiometricAppLock } from '../../auth/biometricAuth';
import * as ScreenCapture from 'expo-screen-capture';
let mockAuth = { user: { id: 1, role: 'admin' }, offlineMode: false, biometricEnabled: true, hasPermission: (_permission: string) => true };
jest.mock('../../auth/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../../preferences/PreferencesContext', () => ({ usePreferences: () => ({ preferences: jest.requireActual('../../preferences/preferenceNormalizers').DEFAULT_PREFERENCES }) }));
jest.mock('../../api/adminSettingsApi');
jest.mock('../../auth/biometricAuth', () => ({ unlockBiometricAppLock: jest.fn(async () => undefined) }));
jest.mock('expo-screen-capture', () => ({ preventScreenCaptureAsync: jest.fn(async () => undefined), allowScreenCaptureAsync: jest.fn(async () => undefined) }));
beforeEach(() => {
  AppState.currentState = 'active';
  jest.clearAllMocks();
  mockAuth = { user: { id: 1, role: 'admin' }, offlineMode: false, biometricEnabled: true, hasPermission: () => true };
  (api.getAdCandidates as jest.Mock).mockResolvedValue([{ login: 'ivanov', display_name: 'Иванов', import_status: 'new' }]);
  (api.getAdminAiBots as jest.Mock).mockResolvedValue([{ id: 'bot', slug: 'helper', title: 'Помощник', model: 'model', description: '', system_prompt: 'Помогай', temperature: 0.2, max_tokens: 2000, is_enabled: true, enabled_tools: ['existing-tool'] }]);
  (api.getAdminAppSettings as jest.Mock).mockResolvedValue({ admin_login_allowed_ips: [], available_controllers: [{ username: 'controller', full_name: 'Контролёр' }], transfer_act_reminder_controller_username: null });
  (api.getAdminEnvSettings as jest.Mock).mockResolvedValue({ items: [{ key: 'TEST_SETTING', value: 'old', is_sensitive: false }] });
});
it('blocks administrative API calls without access and while offline', async () => {
  mockAuth.user.role = 'operator'; mockAuth.hasPermission = () => false;
  const view = await render(<NativeAdminSystemScreen />);
  expect(view.getByText('Нет доступа к этому разделу.')).toBeTruthy();
  expect(api.getAdminAppSettings).not.toHaveBeenCalled();
  mockAuth.user.role = 'admin'; mockAuth.offlineMode = true;
  await view.rerender(<NativeAdminSystemScreen />);
  expect(api.getAdminAppSettings).not.toHaveBeenCalled();
});
it('does not expose AD import to a non-admin with an AD permission', async () => {
  mockAuth.user.role = 'operator';
  const view = await render(<NativeAdminAdUsersScreen />);
  expect(view.getByText('Нет доступа к этому разделу.')).toBeTruthy();
  expect(api.getAdCandidates).not.toHaveBeenCalled();
});
it('imports only the explicitly confirmed AD user', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  try {
    const view = await render(<NativeAdminAdUsersScreen />);
    await waitFor(() => expect(view.getByText('Импортировать')).toBeTruthy());
    await fireEvent.press(view.getByText('Импортировать'));
    expect(api.importAdUser).not.toHaveBeenCalled();
    await act(async () => { alert.mock.calls.at(-1)?.[2]?.find(button => button.text === 'Продолжить')?.onPress?.(); });
    await waitFor(() => expect(api.importAdUser).toHaveBeenCalledWith('ivanov'));
  } finally { alert.mockRestore(); }
});
it('rejects an old confirmation after the account changes', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  try {
    const view = await render(<NativeAdminAdUsersScreen />);
    await waitFor(() => expect(view.getByText('Импортировать')).toBeTruthy());
    await fireEvent.press(view.getByText('Импортировать'));
    const confirm = alert.mock.calls.at(-1)?.[2]?.find(button => button.text === 'Продолжить')?.onPress;
    mockAuth.user = { id: 2, role: 'admin' };
    await view.rerender(<NativeAdminAdUsersScreen />);
    await act(async () => { confirm?.(); });
    expect(api.importAdUser).not.toHaveBeenCalled();
  } finally { alert.mockRestore(); }
});
it('edits bot settings without replacing existing tool or access configuration', async () => {
  const view = await render(<NativeAdminAiBotsScreen />);
  await waitFor(() => expect(view.getByText('Настроить Помощник')).toBeTruthy());
  await fireEvent.press(view.getByText('Настроить Помощник'));
  await fireEvent.press(view.getByText('Сохранить бота'));
  await waitFor(() => expect(api.saveAdminAiBot).toHaveBeenCalled());
  const [id, patch] = (api.saveAdminAiBot as jest.Mock).mock.calls[0];
  expect(id).toBe('bot');
  expect(patch).not.toHaveProperty('enabled_tools');
  expect(patch).not.toHaveProperty('allowed_kb_scope');
});
it('does not fetch server variables before fingerprint confirmation', async () => {
  const view = await render(<NativeAdminEnvEditor />);
  expect(api.getAdminEnvSettings).not.toHaveBeenCalled();
  await fireEvent.press(view.getByText('Открыть по отпечатку'));
  await waitFor(() => expect(view.getByText('TEST_SETTING')).toBeTruthy());
  expect(unlockBiometricAppLock).toHaveBeenCalledTimes(1);
  expect(api.getAdminEnvSettings).toHaveBeenCalledTimes(1);
});

it('keeps server variables locked if screen capture protection fails', async () => {
  (ScreenCapture.preventScreenCaptureAsync as jest.Mock).mockRejectedValueOnce(new Error('unavailable'));
  const view = await render(<NativeAdminEnvEditor />);
  await fireEvent.press(view.getByText('Открыть по отпечатку'));
  await waitFor(() => expect(view.getByText('Не удалось подтвердить отпечаток или включить защиту экрана.')).toBeTruthy());
  expect(api.getAdminEnvSettings).not.toHaveBeenCalled();
});

it('clears server variables on background and requires a new unlock', async () => {
  const listeners: Array<(state: string) => void> = [];
  const listen = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
    listeners.push(callback as (state: string) => void);
    return { remove: jest.fn() };
  });
  try {
    const view = await render(<NativeAdminEnvEditor />);
    await fireEvent.press(view.getByText('Открыть по отпечатку'));
    await waitFor(() => expect(view.getByText('TEST_SETTING')).toBeTruthy());
    await act(async () => { AppState.currentState = 'background'; listeners.forEach(listener => listener('background')); });
    expect(view.queryByText('TEST_SETTING')).toBeNull();
    await act(async () => { AppState.currentState = 'active'; listeners.forEach(listener => listener('active')); });
    expect(view.getByText('Открыть по отпечатку')).toBeTruthy();
    expect(api.getAdminEnvSettings).toHaveBeenCalledTimes(1);
  } finally { listen.mockRestore(); }
});
