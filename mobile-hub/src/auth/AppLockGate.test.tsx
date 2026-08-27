import { act, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';

const mockUnlock = jest.fn(async () => undefined);
const mockUser = { id: 7, username: 'test-user' };
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

jest.mock('./AuthContext', () => ({
  useAuth: () => ({
    biometricEnabled: true,
    logout: jest.fn(async () => undefined),
    user: mockUser,
  }),
}));

jest.mock('./biometricAuth', () => ({
  getAppLockSettings: jest.fn(async () => ({ enabled: true, timeoutSeconds: 0 })),
  shouldLockAfterBackground: jest.fn(() => true),
  subscribeAppLockSettings: (listener: (settings: {
    enabled: boolean;
    timeoutSeconds: number;
  }) => void) => mockSubscribeSettings(listener),
  unlockBiometricAppLock: () => mockUnlock(),
}));

jest.mock('../accessibility/useReducedMotion', () => ({
  useReducedMotion: () => true,
}));

jest.mock('../native/haptics', () => ({
  hapticError: jest.fn(async () => undefined),
  hapticSuccess: jest.fn(async () => undefined),
}));

import { AppLockGate } from './AppLockGate';

describe('AppLockGate lifecycle', () => {
  it('does not ask for a fingerprint after a transient Android inactive state', async () => {
    const originalState = Object.getOwnPropertyDescriptor(AppState, 'currentState');
    Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
    let stateListener: ((state: AppStateStatus) => void) | undefined;
    const remove = jest.fn();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_, listener) => {
      stateListener = listener;
      return { remove };
    });

    const view = await render(<AppLockGate />);
    await waitFor(() => expect(stateListener).toBeDefined());
    await act(async () => {
      stateListener?.('inactive');
      stateListener?.('active');
      await Promise.resolve();
    });

    expect(mockUnlock).not.toHaveBeenCalled();
    expect(view.queryByTestId('app-lock-scroll')).toBeNull();

    await view.unmount();
    expect(remove).toHaveBeenCalled();
    jest.restoreAllMocks();
    if (originalState) Object.defineProperty(AppState, 'currentState', originalState);
  });
});
