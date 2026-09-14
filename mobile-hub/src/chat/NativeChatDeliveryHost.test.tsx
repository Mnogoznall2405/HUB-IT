import { act, render } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { NativeChatDeliveryHost } from './NativeChatDeliveryHost';
import { createNativeChatDeliveryRunner } from './nativeChatDeliveryRunner';
import { setNativeChatDeliveryBlocked } from './nativeChatDeliveryGate';

let mockUserId = 7, mockOffline = false, mockSessionGeneration = 1;
const mockSocketListeners = new Set<() => void>();
jest.mock('../auth/AuthContext', () => ({ useAuth: () => ({
  user: { id: mockUserId }, offlineMode: mockOffline, hasPermission: () => true,
}) }));
jest.mock('../auth/tokenStore', () => ({ ...jest.requireActual('../auth/tokenStore'), getSessionGeneration: () => mockSessionGeneration }));
jest.mock('./nativeChatDeliveryRunner', () => ({ createNativeChatDeliveryRunner: jest.fn() }));
jest.mock('./chatSocket', () => ({ chatSocket: { on: (_name: string, callback: () => void) => {
  mockSocketListeners.add(callback); return () => mockSocketListeners.delete(callback);
} } }));

const createRunner = jest.mocked(createNativeChatDeliveryRunner);
const appListeners = new Set<(state: AppStateStatus) => void>();
let originalState: PropertyDescriptor | undefined;
beforeEach(() => {
  jest.useFakeTimers();
  mockUserId = 7; mockOffline = false; mockSessionGeneration = 1;
  mockSocketListeners.clear(); appListeners.clear();
  setNativeChatDeliveryBlocked(false);
  originalState = Object.getOwnPropertyDescriptor(AppState, 'currentState');
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    appListeners.add(listener); return { remove: () => { appListeners.delete(listener); } };
  });
  createRunner.mockReset().mockImplementation(() => ({ wake: jest.fn(), dispose: jest.fn() }));
});
afterEach(() => {
  if (originalState) Object.defineProperty(AppState, 'currentState', originalState);
  setNativeChatDeliveryBlocked(true);
  jest.restoreAllMocks(); jest.useRealTimers();
});
const settle = () => act(async () => { await jest.advanceTimersByTimeAsync(0); });

it('disposes on background and creates one runner on repeated foreground and socket events', async () => {
  const view = await render(<NativeChatDeliveryHost />);
  await settle();
  const first = createRunner.mock.results[0].value;
  await act(async () => { appListeners.forEach((listener) => listener('background')); });
  expect(first.dispose).toHaveBeenCalledTimes(1);
  expect(createRunner.mock.calls[0][0].canDeliver()).toBe(false);
  await act(async () => {
    appListeners.forEach((listener) => listener('active'));
    appListeners.forEach((listener) => listener('active'));
    mockSocketListeners.forEach((listener) => listener());
  });
  expect(createRunner).toHaveBeenCalledTimes(2);
  expect(appListeners.size).toBe(1);
  expect(mockSocketListeners.size).toBe(1);
  await view.unmount();
  expect(appListeners.size).toBe(0);
  expect(mockSocketListeners.size).toBe(0);
});

it('keeps delivery suspended offline and while the app gate is locked', async () => {
  const view = await render(<NativeChatDeliveryHost />); await settle();
  const first = createRunner.mock.results[0].value;
  mockOffline = true;
  await view.rerender(<NativeChatDeliveryHost />); await settle();
  expect(first.dispose).toHaveBeenCalledTimes(1);
  expect(createRunner).toHaveBeenCalledTimes(1);
  await act(async () => { setNativeChatDeliveryBlocked(true); });
  mockOffline = false;
  await view.rerender(<NativeChatDeliveryHost />); await settle();
  expect(createRunner).toHaveBeenCalledTimes(1);
  await act(async () => { setNativeChatDeliveryBlocked(false); });
  expect(createRunner).toHaveBeenCalledTimes(2);
  await view.unmount();
});

it('invalidates old session callbacks after account replacement', async () => {
  const view = await render(<NativeChatDeliveryHost />); await settle();
  const previousOptions = createRunner.mock.calls[0][0], previous = createRunner.mock.results[0].value;
  mockUserId = 8; mockSessionGeneration += 1;
  await view.rerender(<NativeChatDeliveryHost />); await settle();
  expect(previous.dispose).toHaveBeenCalledTimes(1);
  expect(previousOptions.canDeliver()).toBe(false);
  expect(createRunner.mock.calls[1][0].userId).toBe(8);
  expect(createRunner.mock.calls[1][0].canDeliver()).toBe(true);
  expect(appListeners.size).toBe(1);
  expect(mockSocketListeners.size).toBe(1);
  await view.unmount();
});
