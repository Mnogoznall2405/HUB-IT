import { useState } from 'react';
import { Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { getFluentTokens } from '../../theme/fluentTokens';
import { splitMailRecipients } from '../../mail/nativeMailModel';
import { NativeMailRecipientInput } from './NativeMailRecipientInput';

function Harness({ initial = '', disabled = false }: { initial?: string; disabled?: boolean }) {
  const [value, setValue] = useState(initial);
  return <><NativeMailRecipientInput label="Кому" value={value} onChangeText={setValue} onFocus={() => {}}
    tokens={getFluentTokens('light')} disabled={disabled} />
    <Text testID="recipients">{JSON.stringify(splitMailRecipients(value))}</Text></>;
}

it('commits pasted addresses and shows invalid addresses individually', async () => {
  const view = await render(<Harness />);
  await fireEvent.changeText(view.getByLabelText('Кому'), 'Иван <ivan@example.com>; broken; other@example.com');
  await fireEvent(view.getByLabelText('Кому'), 'submitEditing');
  expect(view.getByLabelText('Изменить адрес ivan@example.com')).toBeTruthy();
  expect(view.getByText('Проверьте адрес')).toBeTruthy();
  expect(view.getByLabelText('Изменить адрес other@example.com')).toBeTruthy();
  expect(view.getByLabelText('Кому').props.value).toBe('');
});

it('edits an invalid recipient without losing another address or unfinished input', async () => {
  const view = await render(<Harness initial="broken; keep@example.com; unfinished" />);
  await fireEvent.press(view.getByLabelText('Изменить адрес broken'));
  expect(view.getByLabelText('Кому').props.value).toBe('broken');
  await fireEvent.changeText(view.getByLabelText('Кому'), 'fixed@example.com');
  await fireEvent(view.getByLabelText('Кому'), 'blur');
  expect(view.getByLabelText('Изменить адрес keep@example.com')).toBeTruthy();
  expect(view.getByLabelText('Изменить адрес unfinished')).toBeTruthy();
  expect(view.getByLabelText('Изменить адрес fixed@example.com')).toBeTruthy();
  expect(view.queryByLabelText('Изменить адрес broken')).toBeNull();
});

it('removes only the chosen recipient and keeps the current search text', async () => {
  const view = await render(<Harness initial="first@example.com; second@example.com; search" />);
  await fireEvent.press(view.getByLabelText('Удалить адрес first@example.com'));
  expect(view.getByLabelText('Кому').props.value).toBe('search');
  expect(view.getByTestId('recipients').props.children).toBe('["second@example.com","search"]');
});

it('locks editing and deletion during sending', async () => {
  const view = await render(<Harness initial="first@example.com; " disabled />);
  await fireEvent.press(view.getByLabelText('Удалить адрес first@example.com'));
  await fireEvent.press(view.getByLabelText('Изменить адрес first@example.com'));
  expect(view.getByLabelText('Кому').props.editable).toBe(false);
  expect(view.getByTestId('recipients').props.children).toBe('["first@example.com"]');
});
