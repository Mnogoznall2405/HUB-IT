import { act, render } from '@testing-library/react-native';
import { Animated, PanResponder, Text, type PanResponderCallbacks, type PanResponderGestureState, type GestureResponderEvent } from 'react-native';
import { getFluentTokens } from '../../theme/fluentTokens';
import { NativeMailSwipeRow } from './NativeMailSwipeRow';

let mockReduceMotion = false;
jest.mock('../../accessibility/useReducedMotion', () => ({ useReducedMotion: () => mockReduceMotion }));
let handlers: PanResponderCallbacks;
const event = {} as GestureResponderEvent;
const gesture = (dx: number, dy = 0) => ({ dx, dy } as PanResponderGestureState);
const base = { isRead: false, canDelete: true, disabled: false, tokens: getFluentTokens('dark') };
beforeEach(() => {
  mockReduceMotion = false;
  jest.spyOn(PanResponder, 'create').mockImplementation((config) => { handlers = config; return { panHandlers: {} }; });
});
afterEach(() => jest.restoreAllMocks());

it('returns cancelled and terminated gestures with a native spring and never sends a diagonal release', async () => {
  const spring = jest.spyOn(Animated, 'spring');
  const onAction = jest.fn();
  await render(<NativeMailSwipeRow {...base} onAction={onAction}><Text>Письмо</Text></NativeMailSwipeRow>);
  spring.mockClear();
  expect(handlers.onMoveShouldSetPanResponder?.(event, gesture(20, 2))).toBe(true);
  expect(handlers.onMoveShouldSetPanResponder?.(event, gesture(20, 40))).toBe(false);
  await act(async () => {
    handlers.onPanResponderMove?.(event, gesture(80, 2));
    handlers.onPanResponderRelease?.(event, gesture(80, 90));
    handlers.onPanResponderRelease?.(event, gesture(30, 1));
    handlers.onPanResponderTerminate?.(event, gesture(90, 0));
  });
  expect(onAction).not.toHaveBeenCalled();
  expect(spring).toHaveBeenCalledTimes(3);
  expect(spring).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ toValue: 0, bounciness: 0, useNativeDriver: true }));
});

it('serializes releases until the action settles and allows retry after rejection', async () => {
  let reject!: (error: Error) => void;
  const onAction = jest.fn(() => new Promise<void>((_, fail) => { reject = fail; }));
  await render(<NativeMailSwipeRow {...base} onAction={onAction}><Text>Письмо</Text></NativeMailSwipeRow>);
  await act(async () => {
    handlers.onPanResponderRelease?.(event, gesture(-90));
    handlers.onPanResponderRelease?.(event, gesture(-90));
  });
  expect(onAction).toHaveBeenCalledTimes(1);
  expect(handlers.onMoveShouldSetPanResponder?.(event, gesture(90))).toBe(false);
  await act(async () => reject(new Error('synthetic failure')));
  await act(async () => handlers.onPanResponderRelease?.(event, gesture(90)));
  expect(onAction).toHaveBeenCalledTimes(2);
});

it('disables unavailable directions and ignores a release after actions become disabled', async () => {
  const onAction = jest.fn();
  const view = await render(<NativeMailSwipeRow {...base} canDelete={false} onAction={onAction}><Text>Письмо</Text></NativeMailSwipeRow>);
  expect(handlers.onMoveShouldSetPanResponder?.(event, gesture(-90))).toBe(false);
  await view.rerender(<NativeMailSwipeRow {...base} disabled onAction={onAction}><Text>Письмо</Text></NativeMailSwipeRow>);
  await act(async () => handlers.onPanResponderRelease?.(event, gesture(90)));
  expect(onAction).not.toHaveBeenCalled();
});

it('settles immediately with reduced motion while preserving the action', async () => {
  mockReduceMotion = true;
  const spring = jest.spyOn(Animated, 'spring');
  const reset = jest.spyOn(Animated.Value.prototype, 'setValue');
  const onAction = jest.fn();
  await render(<NativeMailSwipeRow {...base} onAction={onAction}><Text>Письмо</Text></NativeMailSwipeRow>);
  await act(async () => handlers.onPanResponderRelease?.(event, gesture(90)));
  expect(spring).not.toHaveBeenCalled();
  expect(reset).toHaveBeenCalledWith(0);
  expect(onAction).toHaveBeenCalledWith('toggle-read');
});
