import { act, fireEvent, render } from '@testing-library/react-native';
import { Pressable, Text, TextInput } from 'react-native';
import { useMailQuickReplyDraft } from './useMailQuickReplyDraft';

const mockRead = jest.fn();
const mockWrite = jest.fn();
const mockPending = jest.fn();
jest.mock('./mailQuickReplyDrafts', () => ({
  createMailQuickReplyDraftSession: () => ({ read: mockRead, readPendingKey: mockPending, write: mockWrite, clearIfText: jest.fn() }),
}));
function Harness({ entityId = 'one', userId = 1 }: { entityId?: string; userId?: number }) {
  const draft = useMailQuickReplyDraft({ userId, mailboxId: 'box', kind: 'message', entityId });
  return <><TextInput accessibilityLabel="Черновик" value={draft.text} onChangeText={draft.setText} /><Text>{draft.storageError}</Text><Pressable accessibilityLabel="Повторить восстановление" onPress={draft.retryRestore} /><Text>{draft.ready ? "Готов" : "Заблокирован"}</Text></>;
}
beforeEach(() => { mockRead.mockReset(); mockPending.mockReset().mockResolvedValue(''); mockWrite.mockReset().mockResolvedValue(undefined); });

it('hides the previous reply while another message draft is loading', async () => {
  mockRead.mockResolvedValueOnce('Ответ первому');
  const view = await render(<Harness />);
  expect(view.getByLabelText('Черновик').props.value).toBe('Ответ первому');
  const oldInput = view.getByLabelText('Черновик').props.onChangeText;
  let finish!: (text: string) => void;
  mockRead.mockReturnValueOnce(new Promise<string>((resolve) => { finish = resolve; }));
  await view.rerender(<Harness entityId="two" />);
  expect(view.getByLabelText('Черновик').props.value).toBe('');
  await act(async () => { oldInput('Поздний ввод'); });
  expect(mockWrite).not.toHaveBeenCalled();
  await act(async () => { finish('Ответ второму'); });
  expect(view.getByLabelText('Черновик').props.value).toBe('Ответ второму');
});

it('clears private input when the user scope becomes unavailable', async () => {
  mockRead.mockResolvedValue('Личный ответ');
  const view = await render(<Harness />);
  await view.rerender(<Harness userId={0} />);
  expect(view.getByLabelText('Черновик').props.value).toBe('');
});

it('ignores an old read after navigating away and back to the same message', async () => {
  let finish!: (text: string) => void;
  mockRead.mockReturnValueOnce(new Promise<string>((resolve) => { finish = resolve; }));
  const view = await render(<Harness />);
  mockRead.mockResolvedValueOnce('Другой ответ');
  await view.rerender(<Harness entityId="two" />);
  mockRead.mockResolvedValueOnce('Последняя версия');
  await view.rerender(<Harness />);
  await act(async () => { finish('Старая версия'); });
  expect(view.getByLabelText('Черновик').props.value).toBe('Последняя версия');
});

it('does not write from an input callback after the editor unmounts', async () => {
  mockRead.mockResolvedValue('');
  const view = await render(<Harness />);
  const oldInput = view.getByLabelText('Черновик').props.onChangeText;
  await view.unmount();
  await act(async () => { oldInput('Поздний ввод'); });
  expect(mockWrite).not.toHaveBeenCalled();
});

it('does not leak a late write error into a different message', async () => {
  mockRead.mockResolvedValue('');
  let fail!: (cause: Error) => void;
  mockWrite.mockReturnValueOnce(new Promise<void>((_, reject) => { fail = reject; }));
  const view = await render(<Harness />);
  await fireEvent.changeText(view.getByLabelText('Черновик'), 'Первый ответ');
  await view.rerender(<Harness entityId="two" />);
  await act(async () => { fail(new Error('Synthetic write error')); });
  expect(view.queryByText(/Ответ не сохранён на устройстве/)).toBeNull();
});

it('keeps input locked until the previous send attempt is restored', async () => {
  let finish!: (text: string) => void;
  mockRead.mockReturnValue(new Promise<string>((resolve) => { finish = resolve; }));
  mockPending.mockResolvedValue('pending-attempt');
  const view = await render(<Harness />);
  await fireEvent.changeText(view.getByLabelText('Черновик'), 'Новый ввод');
  await act(async () => { finish('Прежняя версия'); });
  expect(view.getByLabelText('Черновик').props.value).toBe('Прежняя версия');
  expect(mockWrite).not.toHaveBeenCalled();
  await fireEvent.changeText(view.getByLabelText('Черновик'), 'Изменённый ответ');
  expect(mockWrite).not.toHaveBeenCalled();
});

it('preserves the input and explains a failed device write', async () => {
  mockRead.mockResolvedValue('');
  mockWrite.mockRejectedValue(new Error('Synthetic error containing private input'));
  const view = await render(<Harness />);
  await fireEvent.changeText(view.getByLabelText('Черновик'), 'Текст');
  expect(view.getByLabelText('Черновик').props.value).toBe('Текст');
  expect(view.getByText(/Ответ не сохранён на устройстве/)).toBeTruthy();
  expect(view.queryByText(/private input/)).toBeNull();
});

it('retries a failed restore without overwriting the saved reply', async () => {
  mockRead.mockRejectedValueOnce(new Error('Synthetic private error'));
  const view = await render(<Harness />);
  expect(view.getByText('Заблокирован')).toBeTruthy();
  await fireEvent.changeText(view.getByLabelText('Черновик'), 'Новый текст');
  expect(mockWrite).not.toHaveBeenCalled();
  mockRead.mockResolvedValueOnce('Сохранённый ответ');
  await fireEvent.press(view.getByLabelText('Повторить восстановление'));
  expect(view.getByText('Готов')).toBeTruthy();
  expect(view.getByLabelText('Черновик').props.value).toBe('Сохранённый ответ');
  expect(view.queryByText(/Не удалось восстановить/)).toBeNull();
  await fireEvent.changeText(view.getByLabelText('Черновик'), 'Обновлённый ответ');
  expect(mockWrite).toHaveBeenLastCalledWith('Обновлённый ответ');
});
