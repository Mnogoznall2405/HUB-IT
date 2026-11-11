import { fireEvent, render } from '@testing-library/react-native';
import { ChatComposerContext } from './ChatComposerContext';

it('shows the reply plate on the first render and drops it the moment the mode clears', async () => {
  const view = await render(<ChatComposerContext mode="reply" label="Анна" preview="первое" />);
  expect(view.getByText('первое')).toBeTruthy();
  expect(view.getByText('Анна')).toBeTruthy();
  await view.rerender(<ChatComposerContext mode={null} />);
  expect(view.queryByText('первое', { includeHiddenElements: true })).toBeNull();
  expect(view.queryByTestId('chat-composer-context')).toBeNull();
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
