import { act, render } from '@testing-library/react-native';
import { Animated } from 'react-native';
import { ChatComposerContext } from './ChatComposerContext';

jest.mock('../../accessibility/useReducedMotion', () => ({ useReducedMotion: () => false }));

afterEach(() => jest.restoreAllMocks());

it('keeps the latest reply visible during its own exit despite a late previous exit callback', async () => {
  const finishes: ((value: { finished: boolean }) => void)[] = [];
  jest.spyOn(Animated, 'timing').mockImplementation(() => ({
    start: (callback) => { finishes.push(callback || (() => {})); }, stop: jest.fn(), reset: jest.fn(),
  }));
  const view = await render(<ChatComposerContext mode="reply" preview="first" />);
  await view.rerender(<ChatComposerContext mode={null} />);
  const oldExit = finishes[finishes.length - 1];
  await view.rerender(<ChatComposerContext mode="reply" preview="second" />);
  expect(view.queryByText('first')).toBeNull();
  await view.rerender(<ChatComposerContext mode={null} />);
  const newExit = finishes[finishes.length - 1];
  await act(async () => { oldExit({ finished: true }); });
  expect(view.getByText('second', { includeHiddenElements: true })).toBeTruthy();
  await act(async () => { newExit({ finished: true }); });
  expect(view.queryByText('second', { includeHiddenElements: true })).toBeNull();
});
