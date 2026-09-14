import { act, fireEvent, render } from '@testing-library/react-native';
import { Animated, PanResponder, StyleSheet, type PanResponderCallbacks, type GestureResponderEvent, type PanResponderGestureState } from 'react-native';
import { NativeMailImageViewer } from './NativeMailImageViewer';

const mockReduced = jest.fn(() => false);
jest.mock('../../accessibility/useReducedMotion', () => ({ useReducedMotion: () => mockReduced() }));
const items = ['a', 'b', 'c'].map((key) => ({ key, name: `${key}.jpg`, uri: `file:///${key}.jpg` }));
afterEach(() => { jest.restoreAllMocks(); mockReduced.mockReturnValue(false); });

it('keeps the outgoing photo outside the viewport and serializes repeated presses', async () => {
  let finish!: (result: { finished: boolean }) => void;
  let outgoing!: Animated.Value;
  jest.spyOn(Animated, 'timing').mockImplementation((value, config) => ({
    start: (callback) => {
      outgoing = value as Animated.Value;
      outgoing.setValue(Number(config.toValue));
      finish = callback!;
    }, stop: jest.fn(), reset: jest.fn(),
  }));
  const onChange = jest.fn();
  const props = { items, currentKey: 'a', onChange, onClose: jest.fn() };
  const view = await render(<NativeMailImageViewer {...props} />);
  await fireEvent.press(view.getByLabelText('Следующее изображение'));
  await fireEvent.press(view.getByLabelText('Следующее изображение'));
  expect(Animated.timing).toHaveBeenCalledTimes(1);
  await act(async () => { finish({ finished: true }); });
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith('b');
  expect((outgoing as unknown as { __getValue(): number }).__getValue()).toBeLessThan(0);
  await view.rerender(<NativeMailImageViewer {...props} currentKey="b" />);
  expect(StyleSheet.flatten(view.getByTestId('native-mail-image-viewer-stage').props.style).transform[0].translateX).toBe(0);
  expect(view.getByText('2 / 3')).toBeTruthy();
});

it('ignores completion from a page replaced by an external selection', async () => {
  let finish!: (result: { finished: boolean }) => void;
  jest.spyOn(Animated, 'timing').mockImplementation(() => ({
    start: (callback) => { finish = callback!; }, stop: jest.fn(), reset: jest.fn(),
  }));
  const props = { items, currentKey: 'a', onChange: jest.fn(), onClose: jest.fn() };
  const view = await render(<NativeMailImageViewer {...props} />);
  await fireEvent.press(view.getByLabelText('Следующее изображение'));
  await view.rerender(<NativeMailImageViewer {...props} currentKey="c" />);
  await act(async () => { finish({ finished: true }); });
  expect(props.onChange).not.toHaveBeenCalled();
  expect(view.getByText('3 / 3')).toBeTruthy();
});

it('switches immediately when reduced motion is enabled', async () => {
  mockReduced.mockReturnValue(true);
  const props = { items, currentKey: 'a', onChange: jest.fn(), onClose: jest.fn() };
  const timing = jest.spyOn(Animated, 'timing');
  const view = await render(<NativeMailImageViewer {...props} />);
  await fireEvent.press(view.getByLabelText('Следующее изображение'));
  expect(props.onChange).toHaveBeenCalledWith('b');
  expect(timing).not.toHaveBeenCalled();
});

it('zooms with two fingers, pans within bounds and never dismisses after a pinch', async () => {
  mockReduced.mockReturnValue(true);
  let handlers: PanResponderCallbacks = {};
  jest.spyOn(PanResponder, 'create').mockImplementation(value => { handlers = value; return { panHandlers: {} }; });
  const props = { items, currentKey: 'a', onChange: jest.fn(), onClose: jest.fn() };
  const view = await render(<NativeMailImageViewer {...props} />);
  const event = (distance: number, count = 2) => ({ nativeEvent: { touches: count === 2
    ? [{ pageX: 0, pageY: 100 }, { pageX: distance, pageY: 100 }] : [{ pageX: 0, pageY: 100 }] } }) as unknown as GestureResponderEvent;
  const gesture = (dx = 0, dy = 0, numberActiveTouches = 2) => ({ dx, dy, numberActiveTouches }) as PanResponderGestureState;
  await fireEvent(view.getByTestId('native-mail-image-viewer-stage'), 'layout', { nativeEvent: { layout: { width: 300, height: 400 } } });
  await act(async () => {
    handlers.onPanResponderGrant?.(event(100), gesture());
    handlers.onPanResponderMove?.(event(100), gesture());
    handlers.onPanResponderMove?.(event(200), gesture());
    handlers.onPanResponderRelease?.(event(200, 1), gesture(0, 200, 0));
  });
  expect(view.getByText('200%')).toBeTruthy();
  expect(props.onClose).not.toHaveBeenCalled();
  expect(props.onChange).not.toHaveBeenCalled();
  await act(async () => {
    handlers.onPanResponderGrant?.(event(0, 1), gesture(0, 0, 1));
    handlers.onPanResponderMove?.(event(0, 1), gesture(1000, 1000, 1));
    handlers.onPanResponderRelease?.(event(0, 1), gesture(1000, 1000, 0));
  });
  const transform = StyleSheet.flatten(view.getByTestId('native-mail-image-zoom').props.style).transform as { translateX?: number; translateY?: number }[];
  expect(transform[0].translateX).toBe(150);
  expect(transform[1].translateY).toBe(200);
  expect(props.onClose).not.toHaveBeenCalled();
  await fireEvent.press(view.getByLabelText('Сбросить'));
  expect(view.getByText('100%')).toBeTruthy();
  await act(async () => {
    handlers.onPanResponderGrant?.(event(100), gesture());
    handlers.onPanResponderMove?.(event(100), gesture(0, 110));
    handlers.onPanResponderRelease?.(event(100, 1), gesture(0, 110, 0));
  });
  expect(props.onClose).not.toHaveBeenCalled();
  await act(async () => {
    handlers.onPanResponderGrant?.(event(0, 1), gesture(0, 0, 1));
    handlers.onPanResponderMove?.(event(0, 1), gesture(0, 120, 1));
    handlers.onPanResponderRelease?.(event(0, 1), gesture(0, 120, 0));
  });
  expect(props.onClose).toHaveBeenCalledTimes(1);
});

it('provides bounded button zoom and resets it on page change', async () => {
  const props = { items, currentKey: 'a', onChange: jest.fn(), onClose: jest.fn() };
  const view = await render(<NativeMailImageViewer {...props} />);
  for (let index = 0; index < 8; index += 1) await fireEvent.press(view.getByLabelText('Увеличить изображение'));
  expect(view.getByText('400%')).toBeTruthy();
  expect(view.getByLabelText('Увеличить изображение').props.accessibilityState.disabled).toBe(true);
  await view.rerender(<NativeMailImageViewer {...props} currentKey="b" />);
  expect(view.getByText('100%')).toBeTruthy();
});
