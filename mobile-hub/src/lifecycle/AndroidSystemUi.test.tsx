import { NavigationBar } from 'expo-navigation-bar';
import { act, render } from '@testing-library/react-native';
import { AppState, Keyboard, Platform, type AppStateStatus } from 'react-native';
import { AndroidSystemUi } from './AndroidSystemUi';

jest.mock('expo-navigation-bar', () => {
  const MockNavigationBar = () => null;
  MockNavigationBar.setHidden = jest.fn();
  return { NavigationBar: MockNavigationBar };
});

const originalPlatform = Object.getOwnPropertyDescriptor(Platform, 'OS');

afterEach(() => {
  jest.restoreAllMocks();
  (NavigationBar.setHidden as jest.Mock).mockClear();
  if (originalPlatform) Object.defineProperty(Platform, 'OS', originalPlatform);
});

it('re-hides the Android navigation bar after resume and keyboard dismissal', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  let onAppStateChange: ((state: AppStateStatus) => void) | undefined;
  let onKeyboardDidHide: (() => void) | undefined;
  const removeAppState = jest.fn();
  const removeKeyboard = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, listener) => {
    onAppStateChange = listener;
    return { remove: removeAppState };
  });
  jest.spyOn(Keyboard, 'addListener').mockImplementation((event, listener) => {
    expect(event).toBe('keyboardDidHide');
    onKeyboardDidHide = listener as unknown as () => void;
    return { remove: removeKeyboard } as unknown as ReturnType<typeof Keyboard.addListener>;
  });

  const screen = await render(<AndroidSystemUi navigationBarStyle="dark" />);
  await act(async () => undefined);
  expect(NavigationBar.setHidden).toHaveBeenCalledTimes(1);

  await act(async () => onAppStateChange?.('background'));
  expect(NavigationBar.setHidden).toHaveBeenCalledTimes(1);
  await act(async () => onAppStateChange?.('active'));
  await act(async () => onKeyboardDidHide?.());
  expect(NavigationBar.setHidden).toHaveBeenCalledTimes(3);

  await act(async () => screen.unmount());
  expect(removeAppState).toHaveBeenCalledTimes(1);
  expect(removeKeyboard).toHaveBeenCalledTimes(1);
});
