import { act, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';

const mockUnlock = jest.fn(async () => {
  throw new Error('Не удалось подтвердить отпечаток');
});
const mockUser = { id: 7, username: 'test-user' };
const mockLogout = jest.fn(async () => undefined);
const mockSubscribeSettings = jest.fn((listener: (settings: {
  enabled: boolean;
  timeoutSeconds: number;
}) => void) => {
  listener({ enabled: true, timeoutSeconds: 0 });
  return jest.fn();
});

jest.mock('expo-screen-capture', () => ({
  allowScreenCaptureAsync: jest.fn(async () => undefined),
  preventScreenCaptureAsync: jest.fn(async () => undefined),
}));

jest.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    biometricEnabled: true,
    logout: mockLogout,
    user: mockUser,
  }),
}));

jest.mock('../auth/biometricAuth', () => ({
  getAppLockSettings: jest.fn(async () => ({ enabled: true, timeoutSeconds: 0 })),
  shouldLockAfterBackground: jest.fn(() => true),
  subscribeAppLockSettings: (listener: (settings: {
    enabled: boolean;
    timeoutSeconds: number;
  }) => void) => mockSubscribeSettings(listener),
  unlockBiometricAppLock: () => mockUnlock(),
}));

jest.mock('./useReducedMotion', () => ({
  useReducedMotion: () => true,
}));

jest.mock('../native/haptics', () => ({
  hapticError: jest.fn(async () => undefined),
  hapticSuccess: jest.fn(async () => undefined),
}));

import { AppLockGate } from '../auth/AppLockGate';

it('keeps the biometric lock controls scrollable after returning from background', async () => {
  const originalState = Object.getOwnPropertyDescriptor(AppState, 'currentState');
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  let stateListener: ((state: AppStateStatus) => void) | undefined;
  const remove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, listener) => {
    stateListener = listener;
    return { remove };
  });

  const screen = await render(<AppLockGate />);
  await waitFor(() => expect(stateListener).toBeDefined());
  await waitFor(() => expect(mockSubscribeSettings).toHaveBeenCalled());
  await act(async () => undefined);
  await act(async () => stateListener?.('background'));
  await act(async () => stateListener?.('active'));

  expect(await screen.findByTestId('app-lock-scroll')).toBeTruthy();
  expect(screen.getByRole('header', { name: 'HUB-IT заблокирован' })).toBeTruthy();
  expect(screen.getByRole('alert')).toHaveTextContent('Не удалось подтвердить отпечаток');
  expect(screen.getByRole('button', { name: 'Разблокировать HUB-IT отпечатком пальца' }))
    .toBeEnabled();

  await screen.unmount();
  expect(remove).toHaveBeenCalled();
  jest.restoreAllMocks();
  if (originalState) Object.defineProperty(AppState, 'currentState', originalState);
});
