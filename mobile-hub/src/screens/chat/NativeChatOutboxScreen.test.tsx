import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import * as api from '../../api/chatApi';
import { clearNativeChatOutbox, createNativeChatOutbox } from '../../chat/nativeChatOutbox';
import { NativeChatOutboxWithDelivery as NativeChatOutboxScreen } from '../../test/NativeChatWithDelivery';
import { inspectNativeChatDraftFiles } from '../../chat/nativeChatDraftFiles';

let mockAllowed = true;
let mockOffline = false;
let mockUserId = 7;
jest.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ user: { id: mockUserId }, hasPermission: () => mockAllowed, offlineMode: mockOffline }) }));
jest.mock('../../api/chatApi', () => ({ sendTextMessage: jest.fn(), sendFileMessage: jest.fn() }));
jest.mock('../../chat/nativeChatDraftFiles', () => ({
  persistNativeChatDraftFiles: async (_user: number, files: unknown) => files,
  deleteUnreferencedChatFiles: async () => undefined,
  inspectNativeChatDraftFiles: jest.fn(),
}));
const message = { id: 'pending:1', conversation_id: 'a', client_message_id: 'one', sender_user_id: 7, body_text: 'Ожидающий текст' };

it.each(['text', 'file'].flatMap((kind) => ['access', 'offline', 'user', 'return'].map((change) => [kind, change])))('does not start %s transport after %s changes during queue preparation', async (kind, change) => {
  if (kind === 'text') await seed();
  else {
    const queue = createNativeChatOutbox(7, 'a');
    await queue.prepareUpload(message, { body: '', files: [{ uri: 'file:///synthetic/a.txt', name: 'a.txt', size: 10, source: 'document', mimeType: 'text/plain' }] });
    queue.finishUpload('one');
  }
  const view = await render(<NativeChatOutboxScreen />);
  await view.findByLabelText('Повторить отправку');
  const raw = await SecureStore.getItemAsync('hubit_native_chat_outbox_v1');
  let finish!: (value: string | null) => void;
  jest.mocked(SecureStore.getItemAsync).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  await fireEvent.press(view.getByLabelText('Повторить отправку'));
  if (change === 'offline') mockOffline = true;
  else if (change === 'user') mockUserId = 8;
  else mockAllowed = false;
  await view.rerender(<NativeChatOutboxScreen />);
  if (change === 'return') {
    mockAllowed = true;
    await view.rerender(<NativeChatOutboxScreen />);
  }
  await act(async () => { finish(raw); });
  expect(api.sendTextMessage).not.toHaveBeenCalled();
  expect(api.sendFileMessage).not.toHaveBeenCalled();
  expect(await createNativeChatOutbox(7, 'a').read()).toHaveLength(1);
});
async function seed(userId = 7, title = 'Рабочая группа') {
  await expect(createNativeChatOutbox(userId, 'a', () => title).send({ ...message, sender_user_id: userId }, async () => { throw new Error('Network'); })).rejects.toThrow();
}
beforeEach(async () => {
  await clearNativeChatOutbox();
  mockAllowed = true; mockOffline = false; mockUserId = 7;
  jest.clearAllMocks();
  jest.mocked(api.sendTextMessage).mockResolvedValue({ ...message, id: 'server-one' });
  jest.mocked(api.sendFileMessage).mockResolvedValue({ ...message, id: 'server-file' });
});

it('shows read-only file totals offline without exposing names or removing queued messages', async () => {
  await seed(); mockOffline = true;
  jest.mocked(inspectNativeChatDraftFiles).mockResolvedValueOnce({ files: 3, linked: 1, unlinked: 2, unlinkedBytes: 2048, missing: 0, complete: true });
  const view = await render(<NativeChatOutboxScreen />);
  await view.findByText('Ожидающий текст');
  await fireEvent.press(view.getByLabelText('Проверить сохранённые файлы'));
  await waitFor(() => expect(view.getByText(/Проверено файлов: 3.*Файлы не удалены/)).toBeTruthy());
  expect(inspectNativeChatDraftFiles).toHaveBeenCalledWith(7);
  expect(await createNativeChatOutbox(7, 'a').read()).toHaveLength(1);
  expect(api.sendTextMessage).not.toHaveBeenCalled();
});

it('ignores a late file report from the previous user', async () => {
  let finish!: (value: Awaited<ReturnType<typeof inspectNativeChatDraftFiles>>) => void;
  jest.mocked(inspectNativeChatDraftFiles).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const view = await render(<NativeChatOutboxScreen />);
  await fireEvent.press(view.getByLabelText('Проверить сохранённые файлы'));
  mockUserId = 8;
  await view.rerender(<NativeChatOutboxScreen />);
  await act(async () => { finish({ files: 987, linked: 0, unlinked: 987, unlinkedBytes: 0, missing: 0, complete: true }); });
  expect(view.queryByText(/Проверено файлов: 987/)).toBeNull();
});

it('shows only the current user queue and retries with the original id', async () => {
  await seed(); await seed(8, 'Чужой диалог');
  const view = await render(<NativeChatOutboxScreen />);
  await waitFor(() => expect(view.getByText('Рабочая группа')).toBeTruthy());
  expect(view.queryByText('Чужой диалог')).toBeNull();
  await fireEvent.press(view.getByLabelText('Открыть диалог: Рабочая группа'));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/(shell)/chat/[conversationId]', params: { conversationId: 'a' } });
  await fireEvent.press(view.getByLabelText('Повторить отправку'));
  await waitFor(() => expect(view.getByText('Нет сообщений, ожидающих отправки')).toBeTruthy());
  expect(api.sendTextMessage).toHaveBeenCalledWith('a', 'Ожидающий текст', expect.objectContaining({ clientMessageId: 'one' }));
});

it('keeps a failed send visible with an error and allows retry', async () => {
  await seed();
  jest.mocked(api.sendTextMessage).mockRejectedValueOnce(new Error('Network'));
  const view = await render(<NativeChatOutboxScreen />);
  await fireEvent.press(await view.findByLabelText('Повторить отправку'));
  await waitFor(() => expect(view.getByText('Не удалось отправить. Сообщение осталось в очереди.')).toBeTruthy());
  expect(view.getByText('Ожидающий текст')).toBeTruthy();
  await fireEvent.press(view.getByLabelText('Повторить отправку'));
  await waitFor(() => expect(view.getByText('Нет сообщений, ожидающих отправки')).toBeTruthy());
});

it('marks only the active conversation when client ids coincide across rows', async () => {
  await seed();
  await expect(createNativeChatOutbox(7, 'b', () => 'Другой диалог').send({ ...message, conversation_id: 'b' }, async () => { throw new Error('Network'); })).rejects.toThrow();
  let finish!: (value: typeof message) => void;
  jest.mocked(api.sendTextMessage).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const view = await render(<NativeChatOutboxScreen />);
  await view.findByText('Другой диалог');
  await fireEvent.press(view.getAllByLabelText('Повторить отправку')[0]);
  await waitFor(() => expect(api.sendTextMessage).toHaveBeenCalledTimes(1));
  expect(view.getAllByText('Выполняется…')).toHaveLength(1);
  expect(view.getAllByText('Ожидает повтора')).toHaveLength(1);
  await act(async () => { finish({ ...message, id: 'server-one' }); });
});

it('retries file uploads with their stored client id', async () => {
  const queue = createNativeChatOutbox(7, 'a');
  await queue.prepareUpload(message, { body: 'Подпись', files: [{ uri: 'file:///synthetic/a.txt', name: 'a.txt', size: 10, source: 'document', mimeType: 'text/plain' }] });
  queue.finishUpload('one');
  const view = await render(<NativeChatOutboxScreen />);
  await fireEvent.press(await view.findByLabelText('Повторить отправку'));
  await waitFor(() => expect(view.getByText('Нет сообщений, ожидающих отправки')).toBeTruthy());
  expect(api.sendFileMessage).toHaveBeenCalledWith('a', expect.any(FormData));
  const form = jest.mocked(api.sendFileMessage).mock.calls[0][1];
  expect(form.get('client_message_id')).toBe('one');
});

it('confirms local removal and does not send while offline', async () => {
  await seed(); mockOffline = true;
  const alert = jest.spyOn(Alert, 'alert');
  try {
    const view = await render(<NativeChatOutboxScreen />);
    await fireEvent.press(await view.findByLabelText('Повторить отправку'));
    expect(api.sendTextMessage).not.toHaveBeenCalled();
    await fireEvent.press(view.getByLabelText('Убрать сообщение из очереди'));
    expect(view.getByText('Ожидающий текст')).toBeTruthy();
    await act(async () => { alert.mock.calls[0][2]?.[1].onPress?.(); });
    await waitFor(() => expect(view.getByText('Нет сообщений, ожидающих отправки')).toBeTruthy());
  } finally { alert.mockRestore(); }
});

it('distinguishes a read error from an empty queue and supports refresh', async () => {
  jest.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error('Storage'));
  const view = await render(<NativeChatOutboxScreen />);
  await waitFor(() => expect(view.getByText('Не удалось прочитать очередь. Сохранённые сообщения не удалены.')).toBeTruthy());
  expect(view.queryByText('Нет сообщений, ожидающих отправки')).toBeNull();
  await fireEvent.press(view.getByLabelText('Обновить очередь'));
  await waitFor(() => expect(view.getByText('Нет сообщений, ожидающих отправки')).toBeTruthy());
});

it('does not expose the queue without chat permission', async () => {
  await seed(); mockAllowed = false;
  const view = await render(<NativeChatOutboxScreen />);
  expect(view.getByText('Нет доступа к чату')).toBeTruthy();
  expect(view.queryByText('Ожидающий текст')).toBeNull();
});

it('ignores an old removal confirmation after switching users', async () => {
  await seed();
  const alert = jest.spyOn(Alert, 'alert');
  try {
    const view = await render(<NativeChatOutboxScreen />);
    await fireEvent.press(await view.findByLabelText('Убрать сообщение из очереди'));
    const confirm = alert.mock.calls[0][2]?.[1].onPress;
    mockUserId = 8;
    await view.rerender(<NativeChatOutboxScreen />);
    await act(async () => { confirm?.(); });
    expect(await createNativeChatOutbox(7, 'a').read()).toHaveLength(1);
    expect(view.queryByText('Ожидающий текст')).toBeNull();
  } finally { alert.mockRestore(); }
});

it('ignores a confirmation from a previous permission scope even when access returns', async () => {
  await seed();
  const alert = jest.spyOn(Alert, 'alert');
  try {
    const view = await render(<NativeChatOutboxScreen />);
    await fireEvent.press(await view.findByLabelText('Убрать сообщение из очереди'));
    const confirm = alert.mock.calls[0][2]?.[1].onPress;
    mockAllowed = false;
    await view.rerender(<NativeChatOutboxScreen />);
    mockAllowed = true;
    await view.rerender(<NativeChatOutboxScreen />);
    await view.findByText('Ожидающий текст');
    await act(async () => { confirm?.(); });
    expect(await createNativeChatOutbox(7, 'a').read()).toHaveLength(1);
    expect(view.getByText('Ожидающий текст')).toBeTruthy();
  } finally { alert.mockRestore(); }
});
