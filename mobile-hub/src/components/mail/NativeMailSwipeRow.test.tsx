import { act, render } from '@testing-library/react-native';
import { Animated, PanResponder, Text, type PanResponderCallbacks, type PanResponderGestureState, type GestureResponderEvent } from 'react-native';
import { getFluentTokens } from '../../theme/fluentTokens';
import { NativeMailSwipeRow } from './NativeMailSwipeRow';

let mockReduceMotion = false;
jest.mock('../../accessibility/useReducedMotion', () => ({ useReducedMotion: () => mockReduceMotion }));
let handlers: PanResponderCallbacks;
const event = {} as GestureResponderEvent;
const gesture = (dx: number, dy = 0) => ({ dx, dy } as PanResponderGestureState);
const base = { isRead: false, canArchive: true, disabled: false, tokens: getFluentTokens('dark') };
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
  expect(onAction).toHaveBeenLastCalledWith('archive');
  expect(handlers.onMoveShouldSetPanResponder?.(event, gesture(90))).toBe(false);
  await act(async () => reject(new Error('synthetic failure')));
  await act(async () => handlers.onPanResponderRelease?.(event, gesture(90)));
  expect(onAction).toHaveBeenCalledTimes(2);
  expect(onAction).toHaveBeenLastCalledWith('toggle-read');
});

it('disables unavailable directions and ignores a release after actions become disabled', async () => {
  const onAction = jest.fn();
  const view = await render(<NativeMailSwipeRow {...base} canArchive={false} onAction={onAction}><Text>Письмо</Text></NativeMailSwipeRow>);
  expect(handlers.onMoveShouldSetPanResponder?.(event, gesture(-90))).toBe(false);
  await view.rerender(<NativeMailSwipeRow {...base} disabled onAction={onAction}><Text>Письмо</Text></NativeMailSwipeRow>);
  await act(async () => handlers.onPanResponderRelease?.(event, gesture(90)));
  expect(onAction).not.toHaveBeenCalled();
});

it('maps the left swipe in Trash to the explicit permanent-delete request instead of a silent delete', async () => {
  const onAction = jest.fn();
  await render(<NativeMailSwipeRow {...base} canArchive={false} canDeleteForever onAction={onAction}><Text>Письмо</Text></NativeMailSwipeRow>);
  await act(async () => handlers.onPanResponderRelease?.(event, gesture(-90)));
  expect(onAction).toHaveBeenCalledTimes(1);
  expect(onAction).toHaveBeenLastCalledWith('delete-forever');
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

it('keeps the revealed swipe underlay hidden from the accessibility tree', async () => {
  const onAction = jest.fn();
  const view = await render(<NativeMailSwipeRow {...base} onAction={onAction}><Text>Письмо</Text></NativeMailSwipeRow>);
  const hidden = view.root?.queryAll(
    (node) => node.props?.accessibilityElementsHidden === true
      && node.props?.importantForAccessibility === 'no-hide-descendants',
  ) ?? [];
  expect(hidden.length).toBe(1);
});

it('never captures or releases a gesture while the row is disabled', async () => {
  const onAction = jest.fn();
  await render(<NativeMailSwipeRow {...base} disabled onAction={onAction}><Text>Письмо</Text></NativeMailSwipeRow>);
  expect(handlers.onMoveShouldSetPanResponder?.(event, gesture(90))).toBe(false);
  expect(handlers.onMoveShouldSetPanResponder?.(event, gesture(-90))).toBe(false);
  await act(async () => handlers.onPanResponderRelease?.(event, gesture(90)));
  expect(onAction).not.toHaveBeenCalled();
});

it('honours configured swipe targets and ignores a direction set to «Выкл.»', async () => {
  const onAction = jest.fn();
  await render(<NativeMailSwipeRow {...base} swipeRight="archive" swipeLeft="none" onAction={onAction}><Text>Письмо</Text></NativeMailSwipeRow>);
  expect(handlers.onMoveShouldSetPanResponder?.(event, gesture(-90))).toBe(false);
  expect(handlers.onMoveShouldSetPanResponder?.(event, gesture(90))).toBe(true);
  await act(async () => handlers.onPanResponderRelease?.(event, gesture(90)));
  expect(onAction).toHaveBeenCalledTimes(1);
  expect(onAction).toHaveBeenLastCalledWith('archive');
  await act(async () => handlers.onPanResponderRelease?.(event, gesture(-90)));
  expect(onAction).toHaveBeenCalledTimes(1);
});
