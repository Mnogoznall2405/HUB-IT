import { act, fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';

const mockLogin = jest.fn();
const mockUnlock = jest.fn();
let mockBiometricEnabled = false;
let mockRestoreState = 'idle';
let mockUser: { id: number; username: string; role: string; permissions: string[] } | null = null;
const mockRetryRestore = jest.fn();
beforeEach(() => {
  mockBiometricEnabled = false;
  mockRestoreState = 'idle'; mockUser = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
});

jest.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    biometricEnabled: mockBiometricEnabled,
    login: mockLogin,
    hasPermission: () => false,
    unlockWithBiometrics: mockUnlock,
    user: mockUser,
    sessionRestoreState: mockRestoreState,
    retrySessionRestore: mockRetryRestore,
  }),
}));

import LoginScreen from '../../app/(auth)/login';

it('exposes a heading and identifies the first missing login field', async () => {
  const screen = await render(<LoginScreen />);

  expect(screen.getByRole('header', { name: 'HUB-IT' })).toBeTruthy();
  await fireEvent.press(screen.getByText('Войти'));
  expect(screen.getByRole('alert')).toHaveTextContent('Введите логин');

  const fields = screen.getAllByTestId('text-input-outlined');
  expect(fields[0].props.accessibilityHint).toBe('Поле обязательно для входа');

  await fireEvent.changeText(fields[0], 'mobile-user');
  await fireEvent.press(screen.getByText('Войти'));
  expect(screen.getByRole('alert')).toHaveTextContent('Введите пароль');
  expect(screen.getAllByTestId('text-input-outlined')[1].props.accessibilityHint)
    .toBe('Поле обязательно для входа');
  expect(mockLogin).not.toHaveBeenCalled();
});

it('submits only one login attempt when the keyboard submits twice', async () => {
  mockLogin.mockReturnValueOnce(new Promise(() => {}));
  const view = await render(<LoginScreen />);
  await fireEvent.changeText(view.getAllByTestId('text-input-outlined')[0], 'synthetic-user');
  await fireEvent.changeText(view.getAllByTestId('text-input-outlined')[1], 'synthetic-password');
  const submit = view.getAllByTestId('text-input-outlined')[1].props.onSubmitEditing;
  await act(async () => { submit(); submit(); });
  expect(mockLogin).toHaveBeenCalledTimes(1);
});

it('does not start password login during biometric authentication', async () => {
  mockBiometricEnabled = true;
  mockUnlock.mockReturnValueOnce(new Promise(() => {}));
  const view = await render(<LoginScreen />);
  await fireEvent.changeText(view.getAllByTestId('text-input-outlined')[0], 'synthetic-user');
  await fireEvent.changeText(view.getAllByTestId('text-input-outlined')[1], 'synthetic-password');
  await fireEvent.press(view.getByText('Войти по отпечатку'));
  await fireEvent(view.getAllByTestId('text-input-outlined')[1], 'submitEditing');
  expect(mockUnlock).toHaveBeenCalledTimes(1);
  expect(mockLogin).not.toHaveBeenCalled();
});

it('reveals without changing or submitting the password and hides on background without showing it on return', async () => {
  let listener: (state: AppStateStatus) => void = () => undefined;
  const remove = jest.fn();
  const appState = jest.spyOn(AppState, 'addEventListener').mockImplementation((_, callback) => {
    listener = callback;
    return { remove };
  });
  const view = await render(<LoginScreen />);
  const password = () => view.getAllByTestId('text-input-outlined')[1];
  await fireEvent.changeText(password(), 'synthetic-value');
  expect(password().props.secureTextEntry).toBe(true);
  await fireEvent.press(view.getByLabelText('Показать пароль'));
  expect(password().props.secureTextEntry).toBe(false);
  expect(password().props.value).toBe('synthetic-value');
  expect(password().props.autoComplete).toBe('current-password');
  expect(mockLogin).not.toHaveBeenCalled();
  await act(async () => listener('background'));
  expect(password().props.secureTextEntry).toBe(true);
  await act(async () => listener('active'));
  expect(password().props.secureTextEntry).toBe(true);
  expect(password().props.value).toBe('synthetic-value');
  await view.unmount();
  expect(remove).toHaveBeenCalled();
  appState.mockRestore();
});

it('hides the password when sending credentials and keeps help separate from login', async () => {
  mockLogin.mockReturnValueOnce(new Promise(() => {}));
  const view = await render(<LoginScreen />);
  await fireEvent.press(view.getByText('Не удаётся войти?'));
  expect(view.getByText(/обратитесь к администратору HUB-IT/)).toBeTruthy();
  expect(mockLogin).not.toHaveBeenCalled();
  await fireEvent.changeText(view.getAllByTestId('text-input-outlined')[0], 'synthetic-user');
  await fireEvent.changeText(view.getAllByTestId('text-input-outlined')[1], 'synthetic-value');
  await fireEvent.press(view.getByLabelText('Показать пароль'));
  await fireEvent.press(view.getByText('Войти'));
  expect(view.getAllByTestId('text-input-outlined')[1].props.secureTextEntry).toBe(true);
  expect(view.getAllByTestId('text-input-outlined')[1].props.editable).toBe(false);
  expect(mockLogin).toHaveBeenCalledWith('synthetic-user', 'synthetic-value');
});

it('explains a temporary restore failure, retries and opens the app after recovery', async () => {
  mockRestoreState = 'unavailable';
  const view = await render(<LoginScreen />);
  expect(view.getByRole('alert')).toHaveTextContent('Не удалось проверить сохранённый вход. Проверьте подключение и повторите.');
  await fireEvent.press(view.getByText('Повторить проверку входа'));
  expect(mockRetryRestore).toHaveBeenCalledTimes(1);
  expect(mockLogin).not.toHaveBeenCalled();
  mockRestoreState = 'idle';
  mockUser = { id: 7, username: 'synthetic', role: 'viewer', permissions: ['dashboard.read'] };
  await view.rerender(<LoginScreen />);
  expect(require('expo-router').router.replace).toHaveBeenCalled();
});

it('explains an expired session without suggesting retry of the expired credentials', async () => {
  mockRestoreState = 'expired';
  const view = await render(<LoginScreen />);
  expect(view.getByRole('alert')).toHaveTextContent('Сессия завершена. Войдите снова.');
  expect(view.queryByText('Повторить проверку входа')).toBeNull();
  expect(view.getByText('Войти')).toBeTruthy();
});
