import { act, fireEvent, render } from '@testing-library/react-native';
import { Animated, StyleSheet } from 'react-native';
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
