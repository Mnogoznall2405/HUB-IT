import * as ScreenCapture from 'expo-screen-capture';
import { act, render } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { AppPrivacyShield } from './AppPrivacyShield';

const authState = { user: { id: 7 } as unknown };

jest.mock('../auth/AuthContext', () => ({
  useAuth: () => authState,
}));

jest.mock('expo-screen-capture', () => ({
  preventScreenCaptureAsync: jest.fn(async () => undefined),
  allowScreenCaptureAsync: jest.fn(async () => undefined),
}));

it('protects Android recents only while an authenticated app is not active', async () => {
  let onStateChange: ((state: AppStateStatus) => void) | null = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, listener) => {
    onStateChange = listener;
    return { remove: jest.fn() };
  });
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });

  const screen = await render(<AppPrivacyShield />);
  await act(async () => undefined);
  expect(ScreenCapture.allowScreenCaptureAsync).toHaveBeenCalledWith('hubit-app-switcher-privacy');

  await act(async () => {
    onStateChange?.('background');
  });
  expect(ScreenCapture.preventScreenCaptureAsync).toHaveBeenCalledWith('hubit-app-switcher-privacy');

  await act(async () => {
    onStateChange?.('active');
  });
  expect(ScreenCapture.allowScreenCaptureAsync).toHaveBeenCalledTimes(2);

  authState.user = null;
  await screen.rerender(<AppPrivacyShield />);
  await act(async () => undefined);
  expect(ScreenCapture.allowScreenCaptureAsync).toHaveBeenCalledTimes(4);
});
