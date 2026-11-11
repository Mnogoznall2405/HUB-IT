import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import * as api from '../../api/chatApi';
import { ChatOpenCodePanel } from './ChatOpenCodePanel';

let mockOffline = false;
jest.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 1 }, offlineMode: mockOffline }) }));
jest.mock('../../api/chatApi', () => ({
  getAiConversationAccess: jest.fn(), getAiSandboxConversation: jest.fn(),
  respondAiSandboxPermission: jest.fn(), attachAiSandboxFile: jest.fn(), attachAiSandboxArchive: jest.fn(),
}));
const mocked = jest.mocked(api);
const snapshot = (path = 'result.txt') => ({ enabled: true, job: { status: 'running' },
  files: [{ id: 'f1', path, kind: 'output', availability: 'not_applicable' }],
  pending_permissions: [{ id: 'p1', tool: 'write', summary: 'Write file' }],
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockOffline = false;
  AppState.currentState = 'active';
  mocked.getAiSandboxConversation.mockReset();
  mocked.getAiConversationAccess.mockResolvedValue({ can_use: true });
  mocked.getAiSandboxConversation.mockResolvedValue(snapshot());
  mocked.attachAiSandboxFile.mockResolvedValue(undefined);
});
afterEach(() => { jest.useRealTimers(); });

it('refreshes new permissions while visible and stops after closing', async () => {
  mocked.getAiSandboxConversation.mockResolvedValueOnce({ enabled: true });
  const view = await render(<ChatOpenCodePanel conversationId="a" visible />);
  await waitFor(() => expect(mocked.getAiSandboxConversation).toHaveBeenCalledTimes(1));
  await act(async () => { jest.advanceTimersByTime(5000); });
  expect(view.getByText('result.txt')).toBeTruthy();
  expect(view.getByLabelText('Разрешить один раз')).toBeTruthy();
  await view.rerender(<ChatOpenCodePanel conversationId="a" visible={false} />);
  const count = mocked.getAiSandboxConversation.mock.calls.length;
  await act(async () => { jest.advanceTimersByTime(15000); });
  expect(mocked.getAiSandboxConversation).toHaveBeenCalledTimes(count);
});

it('ignores an old conversation snapshot after changing conversations', async () => {
  const old = deferred<unknown>();
  mocked.getAiSandboxConversation.mockImplementation((id) => id === 'a' ? old.promise : Promise.resolve(snapshot('new.txt')));
  const view = await render(<ChatOpenCodePanel conversationId="a" visible />);
  await view.rerender(<ChatOpenCodePanel conversationId="b" visible />);
  await waitFor(() => expect(view.getByText('new.txt')).toBeTruthy());
  await act(async () => { old.resolve(snapshot('old.txt')); });
  expect(view.queryByText('old.txt')).toBeNull();
  expect(view.getByText('new.txt')).toBeTruthy();
});

it('serializes actions and describes accepted delivery without claiming completion', async () => {
  const upload = deferred<void>();
  mocked.attachAiSandboxFile.mockReturnValue(upload.promise);
  const view = await render(<ChatOpenCodePanel conversationId="a" visible />);
  await waitFor(() => expect(view.getByLabelText('Прикрепить').props.accessibilityState.disabled).toBe(false));
  await fireEvent.press(view.getByLabelText('Прикрепить'));
  await fireEvent.press(view.getByLabelText('Прикрепить архив'));
  expect(mocked.attachAiSandboxArchive).not.toHaveBeenCalled();
  await act(async () => { upload.resolve(); });
  expect(view.getByText('Доставка файла запрошена. Он появится в чате после обработки.')).toBeTruthy();
  expect(view.queryByText('Файл прикреплён к чату.')).toBeNull();
});

it('does not move an old action notice into another conversation', async () => {
  const upload = deferred<void>();
  mocked.attachAiSandboxFile.mockReturnValue(upload.promise);
  const view = await render(<ChatOpenCodePanel conversationId="a" visible />);
  await waitFor(() => expect(view.getByLabelText('Прикрепить').props.accessibilityState.disabled).toBe(false));
  await fireEvent.press(view.getByLabelText('Прикрепить'));
  await view.rerender(<ChatOpenCodePanel conversationId="b" visible />);
  await act(async () => { upload.resolve(); });
  expect(view.queryByText('Доставка файла запрошена. Он появится в чате после обработки.')).toBeNull();
});

it('blocks permission actions when access is revoked, preserving the snapshot', async () => {
  const view = await render(<ChatOpenCodePanel conversationId="a" visible />);
  await waitFor(() => expect(view.getByLabelText('Разрешить один раз').props.accessibilityState.disabled).toBe(false));
  mocked.getAiConversationAccess.mockResolvedValue({ can_use: false });
  await act(async () => { jest.advanceTimersByTime(15000); });
  await fireEvent.press(view.getByLabelText('Разрешить один раз'));
  expect(mocked.respondAiSandboxPermission).not.toHaveBeenCalled();
  expect(view.getByText('result.txt')).toBeTruthy();
  expect(view.getByText('Доступ к агенту не предоставлен или отозван. История доступна для просмотра.')).toBeTruthy();
});

it('does not request workspace or permissions offline', async () => {
  mockOffline = true;
  const view = await render(<ChatOpenCodePanel conversationId="a" visible />);
  await act(async () => { jest.advanceTimersByTime(15000); });
  expect(mocked.getAiSandboxConversation).not.toHaveBeenCalled();
  expect(mocked.getAiConversationAccess).not.toHaveBeenCalled();
  expect(view.getByText('Нет сети. Подключитесь, чтобы обновить состояние OpenCode.')).toBeTruthy();
});

it('pauses in the background and refreshes immediately on return', async () => {
  const listeners: Array<(state: AppStateStatus) => void> = [];
  const original = AppState.currentState;
  const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    listeners.push(listener);
    return { remove: jest.fn() };
  });
  try {
    AppState.currentState = 'active';
    const view = await render(<ChatOpenCodePanel conversationId="a" visible />);
    await waitFor(() => expect(view.getByText('result.txt')).toBeTruthy());
    await act(async () => { AppState.currentState = 'background'; listeners.forEach((fn) => fn('background')); });
    const count = mocked.getAiSandboxConversation.mock.calls.length;
    await act(async () => { jest.advanceTimersByTime(15000); });
    expect(mocked.getAiSandboxConversation).toHaveBeenCalledTimes(count);
    await act(async () => { AppState.currentState = 'active'; listeners.forEach((fn) => fn('active')); });
    expect(mocked.getAiSandboxConversation).toHaveBeenCalledTimes(count + 1);
    await view.unmount();
  } finally { AppState.currentState = original; spy.mockRestore(); }
});
