import { fireEvent, render } from '@testing-library/react-native';
import { NativeMyFilesPromptSheet } from './NativeMyFilesSheets';
import { getFluentTokens } from '../../theme/fluentTokens';

it('explains saving and disables cancellation until it completes', async () => {
  const close = jest.fn();
  const props = { visible: true, title: 'Имя файла', placeholder: 'Имя', initialValue: 'report', submitLabel: 'Сохранить', tokens: getFluentTokens('light'), onSubmit: jest.fn(), onClose: close };
  const view = await render(<NativeMyFilesPromptSheet {...props} busy />);
  expect(view.getByText('Сохраняем…')).toBeTruthy();
  expect(view.getByLabelText('Отмена').props.accessibilityState.disabled).toBe(true);
  await fireEvent.press(view.getByLabelText('Отмена'));
  for (const control of view.getAllByLabelText('Закрыть')) await fireEvent.press(control);
  expect(close).not.toHaveBeenCalled();
  expect(view.getByTestId('native-my-files-prompt-input').props.editable).toBe(false);
  await view.rerender(<NativeMyFilesPromptSheet {...props} busy={false} />);
  await fireEvent.press(view.getByLabelText('Отмена'));
  expect(close).toHaveBeenCalledTimes(1);
});
