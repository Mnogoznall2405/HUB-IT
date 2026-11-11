import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import * as chatApi from '../api/chatApi';
import { openPortalPath } from '../navigation/moduleRegistry';
import { IncomingShareGate, describeShareFiles } from './IncomingShareGate';
import {
  copyIncomingShareFiles,
  discardIncomingShare,
  getPendingIncomingTextShare,
  queueIncomingShare,
} from './incomingShare';
import { filterShareTargets } from './ShareChatPicker';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 7 }, hasPermission: () => true }),
}));
jest.mock('../navigation/moduleRegistry', () => ({ openPortalPath: jest.fn() }));
jest.mock('../api/chatApi', () => ({ getConversationPage: jest.fn() }));
jest.mock('../chat/nativeChatInboxSnapshot', () => ({ readNativeChatInboxSnapshot: jest.fn(async () => null) }));
jest.mock('./incomingShare', () => ({
  getPendingIncomingTextShare: jest.fn(),
  subscribeIncomingTextShare: jest.fn(() => () => undefined),
  copyIncomingShareFiles: jest.fn(),
  queueIncomingShare: jest.fn(),
  discardIncomingShare: jest.fn(),
}));

const fileShare = {
  id: 'share-1',
  text: '',
  subject: '',
  mimeType: 'image/jpeg',
  receivedAt: 1_787_400_000_000,
  files: [
    { name: 'IMG_0001.jpg', mimeType: 'image/jpeg', size: 2_400_000 },
    { name: 'Отчёт.pdf', mimeType: 'application/pdf', size: 150_000 },
  ],
};
const conversation = (id: string, title: string, extra: Record<string, unknown> = {}) => (
  { id, title, kind: 'direct', last_message_at: '2026-10-06T10:00:00Z', ...extra }
);

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getPendingIncomingTextShare).mockResolvedValue(fileShare);
  jest.mocked(chatApi.getConversationPage).mockResolvedValue({
    items: [conversation('c1', 'Иванов Иван'), conversation('c2', 'Группа ИТ', { kind: 'group' })],
    has_more: false,
    next_cursor: null,
  } as never);
});

describe('incoming file share', () => {
  it('summarises the files and offers the destinations', async () => {
    expect(describeShareFiles(fileShare)).toBe('2 файла · 2,4 МБ');
    const view = await render(<IncomingShareGate />);
    expect(await view.findByText('2 файла · 2,4 МБ')).toBeTruthy();
    expect(view.getByText('IMG_0001.jpg')).toBeTruthy();
    expect(view.getByText('Отправить в чат')).toBeTruthy();
    expect(view.getByText('Создать письмо')).toBeTruthy();
    expect(view.getByText('Создать задачу')).toBeTruthy();
  });

  it('copies the files only after a chat is chosen, queues them for that chat and opens it', async () => {
    const copied = [{ uri: 'file:///cache/a.jpg', name: 'a.jpg', mimeType: 'image/jpeg', size: 10, source: 'gallery' as const }];
    jest.mocked(copyIncomingShareFiles).mockResolvedValue(copied);
    const view = await render(<IncomingShareGate />);
    fireEvent.press(await view.findByText('Отправить в чат'));
    expect(copyIncomingShareFiles).not.toHaveBeenCalled();

    fireEvent.press(await view.findByTestId('share-chat-c2'));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith({
      pathname: '/(shell)/chat/[conversationId]',
      params: { conversationId: 'c2' },
    }));
    expect(queueIncomingShare).toHaveBeenCalledWith(fileShare, 'chat', { copiedFiles: copied, conversationId: 'c2' });
  });

  it('routes the files to a new mail or task as well', async () => {
    jest.mocked(copyIncomingShareFiles).mockResolvedValue([
      { uri: 'file:///cache/a.jpg', name: 'a.jpg', mimeType: 'image/jpeg', size: 10, source: 'gallery' },
    ]);
    const view = await render(<IncomingShareGate />);
    fireEvent.press(await view.findByText('Создать письмо'));
    await waitFor(() => expect(openPortalPath).toHaveBeenCalledWith('/mail?compose=new'));
    expect(queueIncomingShare).toHaveBeenCalledWith(fileShare, 'mail', expect.objectContaining({ copiedFiles: expect.any(Array) }));
  });

  it('keeps the dialog and explains when no file could be prepared', async () => {
    jest.mocked(copyIncomingShareFiles).mockResolvedValue([]);
    const view = await render(<IncomingShareGate />);
    fireEvent.press(await view.findByText('Создать задачу'));
    expect(await view.findByText(/Не удалось подготовить файлы/)).toBeTruthy();
    expect(queueIncomingShare).not.toHaveBeenCalled();
    expect(openPortalPath).not.toHaveBeenCalled();
  });

  it('discards the share when the user cancels', async () => {
    const view = await render(<IncomingShareGate />);
    fireEvent.press(await view.findByText('Отменить'));
    expect(discardIncomingShare).toHaveBeenCalledWith(fileShare);
    await act(async () => undefined);
    expect(view.queryByText('Отправить в чат')).toBeNull();
  });
});

describe('share target list', () => {
  it('lists regular, non-archived chats that match the search, pinned and newest first', () => {
    const items = [
      conversation('old', 'Иванов Старый', { last_message_at: '2026-10-01T10:00:00Z' }),
      conversation('new', 'Иванов Новый', { last_message_at: '2026-10-06T10:00:00Z' }),
      conversation('pin', 'Петров', { is_pinned: true, last_message_at: '2026-09-01T10:00:00Z' }),
      conversation('arch', 'Иванов Архив', { is_archived: true }),
      conversation('ai', 'Иванов ИИ', { kind: 'ai' }),
    ] as never;
    expect(filterShareTargets(items, '').map((item) => item.id)).toEqual(['pin', 'new', 'old']);
    expect(filterShareTargets(items, 'иванов').map((item) => item.id)).toEqual(['new', 'old']);
  });
});
