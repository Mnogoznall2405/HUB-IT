import { act, fireEvent, render } from '@testing-library/react-native';
import { Animated } from 'react-native';
import { ChatComposerContext } from './ChatComposerContext';

let mockReducedMotion = false;
jest.mock('../../accessibility/useReducedMotion', () => ({ useReducedMotion: () => mockReducedMotion }));
beforeEach(() => { mockReducedMotion = false; });

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

it('opens the current source and respects busy cancellation after reply switches to edit', async () => {
  const previousOpen = jest.fn(), currentOpen = jest.fn(), cancel = jest.fn();
  const view = await render(<ChatComposerContext mode="reply" preview="first" onOpen={previousOpen} onCancel={cancel} />);
  await view.rerender(<ChatComposerContext mode="edit" preview="edited" onOpen={currentOpen} onCancel={cancel} busy />);
  expect(view.queryByText('first')).toBeNull();
  await fireEvent.press(view.getByLabelText('Перейти к исходному сообщению'));
  expect(previousOpen).not.toHaveBeenCalled();
  expect(currentOpen).toHaveBeenCalledTimes(1);
  await fireEvent.press(view.getByLabelText('Отменить редактирование'));
  expect(cancel).not.toHaveBeenCalled();
  await view.rerender(<ChatComposerContext mode="reply" preview="next reply" onCancel={cancel} />);
  await fireEvent.press(view.getByLabelText('Отменить ответ'));
  expect(cancel).toHaveBeenCalledTimes(1);
});

it('removes the exiting preview immediately when reduced motion becomes enabled', async () => {
  const finishes: ((value: { finished: boolean }) => void)[] = [];
  jest.spyOn(Animated, 'timing').mockImplementation(() => ({
    start: (callback) => { finishes.push(callback || (() => {})); }, stop: jest.fn(), reset: jest.fn(),
  }));
  const view = await render(<ChatComposerContext mode="reply" preview="leaving" />);
  await view.rerender(<ChatComposerContext mode={null} />);
  const previousExit = finishes[finishes.length - 1];
  mockReducedMotion = true;
  await view.rerender(<ChatComposerContext mode={null} />);
  expect(view.queryByText('leaving', { includeHiddenElements: true })).toBeNull();
  await view.rerender(<ChatComposerContext mode="edit" preview="current edit" />);
  await act(async () => { previousExit({ finished: true }); });
  expect(view.getByText('current edit')).toBeTruthy();
});
