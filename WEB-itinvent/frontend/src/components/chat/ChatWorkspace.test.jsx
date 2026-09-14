import React from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ChatContextPanel from './ChatContextPanel';
import ChatMediaPreviewDialog from './ChatMediaPreviewDialog';
import useChatPreviewController from '../../pages/chat/useChatPreviewController';
import { ChatBubble } from './ChatBubble';
import { buildChatUiTokens } from './chatUiTokens';
import useChatPanelMembers from './useChatPanelMembers';

const api = vi.hoisted(() => ({ summary: vi.fn(), attachments: vi.fn(), messages: vi.fn(), detail: vi.fn() }));
vi.mock('../../api/client', async (original) => ({ ...(await original()), chatAPI: { getConversationAssetsSummary: api.summary, getConversationAttachments: api.attachments } }));
vi.mock('../../api/chatAttachments', () => ({ default: { getConversationAttachments: api.attachments } }));
vi.mock('../../api/chatThreadMessages', () => ({ default: { getMessages: api.messages } }));
vi.mock('../../api/chatConversationDetails', () => ({ default: { getConversation: api.detail } }));
const theme = createTheme({ palette: { mode: 'dark' } });
const ui = buildChatUiTokens(theme);
const photo = (id, messageId = `message-${id}`) => ({ id, message_id: messageId, file_name: `${id}.jpg`, mime_type: 'image/jpeg', created_at: '2026-09-14T10:00:00Z' });
const members = Array.from({ length: 25 }, (_, index) => ({ user: { id: index + 1, full_name: `Участник ${String(index + 1).padStart(2, '0')}` }, member_role: 'member' }));
const conversation = { id: 'conversation-1', kind: 'group', title: 'Беседа', members, member_count: members.length };
const wrapper = ({ children }) => <ThemeProvider theme={theme}>{children}</ThemeProvider>;
const panel = (props = {}) => <ChatContextPanel theme={theme} ui={ui} activeConversation={conversation} open messages={[]} {...props} />;

beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset());
  api.summary.mockResolvedValue({ photos_count: 2, shared_tasks_count: 1 });
  api.attachments.mockResolvedValue({ items: [], has_more: false });
  api.messages.mockResolvedValue({ items: [], has_more: false });
  api.detail.mockResolvedValue(conversation);
});

describe('complete chat context panel', () => {
  it('shows all desktop members and searches full names', async () => {
    render(panel(), { wrapper });
    fireEvent.click(screen.getByRole('button', { pressed: false, name: /Участники/ }));
    expect(screen.getByRole('button', { name: 'Открыть карточку Участник 25' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Найти участника' }), { target: { value: '25' } });
    expect(screen.queryByRole('button', { name: 'Открыть карточку Участник 01' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Открыть карточку Участник 25' })).toBeInTheDocument();
  });
  it('loads complete members when the inbox only supplied a preview', async () => {
    render(panel({ activeConversation: { ...conversation, members: undefined, member_preview: members.slice(0, 3) } }), { wrapper });
    fireEvent.click(screen.getByRole('button', { pressed: false, name: /Участники/ }));
    expect(await screen.findByRole('button', { name: 'Открыть карточку Участник 25' })).toBeInTheDocument();
    expect(api.detail).toHaveBeenCalledWith(conversation.id, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });
  it('paginates media without losing the first page or duplicating items', async () => {
    api.attachments.mockResolvedValueOnce({ items: [photo('one')], has_more: true, next_before_attachment_id: 'one' })
      .mockResolvedValueOnce({ items: [photo('one'), photo('two')], has_more: false });
    render(panel(), { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: 'Показать ещё вложения' }));
    expect(await screen.findByRole('button', { name: 'Открыть two.jpg' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Открыть one.jpg' })).toHaveLength(1);
    expect(api.attachments).toHaveBeenLastCalledWith(conversation.id, expect.objectContaining({ before_attachment_id: 'one' }));
  });
  it('finds tasks in older history independently of loaded thread messages', async () => {
    api.messages.mockResolvedValueOnce({ items: [{ id: 'recent', kind: 'text', body: 'Текст' }], has_more: true })
      .mockResolvedValueOnce({ items: [{ id: 'old', kind: 'task_share', task_preview: { id: 'task-1', title: 'Давняя задача' } }], has_more: false });
    const onOpenTask = vi.fn();
    render(panel({ onOpenTask }), { wrapper });
    fireEvent.click(screen.getByRole('button', { name: /Задачи/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Искать в более ранних сообщениях' }));
    fireEvent.click(await screen.findByRole('button', { name: /Давняя задача/ }));
    expect(onOpenTask).toHaveBeenCalledWith('task-1');
    expect(api.messages).toHaveBeenLastCalledWith(conversation.id, { limit: 100, before_message_id: 'recent' });
  });
  it('ignores a late photo response after switching to files', async () => {
    let resolvePhotos;
    api.attachments.mockImplementationOnce(() => new Promise((resolve) => { resolvePhotos = resolve; }))
      .mockResolvedValueOnce({ items: [], has_more: false });
    render(panel(), { wrapper });
    fireEvent.click(screen.getByRole('button', { name: /Файлы/ }));
    await waitFor(() => expect(api.attachments).toHaveBeenCalledTimes(2));
    await act(async () => resolvePhotos({ items: [photo('stale')], has_more: true, next_before_attachment_id: 'stale' }));
    expect(screen.queryByText('stale.jpg')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Показать ещё вложения' })).not.toBeInTheDocument();
  });
  it('retries a failed second attachment page with the same cursor', async () => {
    api.attachments.mockResolvedValueOnce({ items: [photo('one')], has_more: true, next_before_attachment_id: 'one' })
      .mockRejectedValueOnce(new Error('Сеть недоступна'))
      .mockResolvedValueOnce({ items: [photo('two')], has_more: false });
    render(panel(), { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: 'Показать ещё вложения' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('button', { name: 'Открыть two.jpg' })).toBeInTheDocument();
    expect(api.attachments).toHaveBeenLastCalledWith(conversation.id, expect.objectContaining({ before_attachment_id: 'one' }));
  });
  it('loads audio through its own attachment filter', async () => {
    render(panel(), { wrapper });
    fireEvent.click(screen.getByRole('button', { name: /Аудио/, pressed: false }));
    await waitFor(() => expect(api.attachments).toHaveBeenLastCalledWith(conversation.id, expect.objectContaining({ kind: 'audio' })));
  });
  it('stops showing loading when complete members arrive from the page detail loader', () => {
    api.detail.mockImplementation(() => new Promise(() => {}));
    const { result, rerender } = renderHook(({ value }) => useChatPanelMembers(value, true), { initialProps: { value: { ...conversation, members: undefined } } });
    expect(result.current.loading).toBe(true);
    rerender({ value: conversation });
    expect(result.current.loading).toBe(false);
    expect(result.current.members).toHaveLength(25);
  });
});

describe('conversation media gallery', () => {
  const args = () => ({ activeConversationIdRef: { current: conversation.id }, messagesRef: { current: [
    { id: 'm1', sender: { full_name: 'Анна' }, attachments: [photo('a', 'm1')] },
    { id: 'm2', sender: { full_name: 'Борис' }, attachments: [photo('b', 'm2')] },
  ] }, loadChatDialogsModule: vi.fn(), notifyApiError: vi.fn() });
  it('combines different messages and paginates older photos with their own URLs', async () => {
    api.attachments.mockResolvedValueOnce({ items: [photo('c', 'm3')], has_more: true, next_before_attachment_id: 'c' })
      .mockResolvedValueOnce({ items: [photo('d', 'm4')], has_more: false });
    const { result } = renderHook(() => useChatPreviewController(args()));
    await act(async () => result.current.openMediaViewer('m1', photo('a', 'm1')));
    expect(result.current.attachmentPreview.items).toHaveLength(3);
    expect(result.current.attachmentPreview.items.find((item) => item.id === 'b').originalUrl).toContain('/messages/m2/attachments/b/');
    await act(async () => result.current.attachmentPreview.loadMore());
    expect(result.current.attachmentPreview.items).toHaveLength(4);
    expect(api.attachments).toHaveBeenLastCalledWith(conversation.id, expect.objectContaining({ kind: 'image', before_attachment_id: 'c' }));
  });
  it('does not reopen the viewer after closing during a request', async () => {
    let finish;
    api.attachments.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useChatPreviewController(args()));
    act(() => result.current.openMediaViewer('m1', photo('a', 'm1')));
    act(() => result.current.closeAttachmentPreview());
    await act(async () => finish({ items: [photo('late')], has_more: false }));
    expect(result.current.attachmentPreview).toBeNull();
  });
  it('closes the gallery on conversation change and ignores the previous request', async () => {
    let finish;
    api.attachments.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const options = args();
    const { result, rerender } = renderHook(() => useChatPreviewController(options));
    act(() => result.current.openMediaViewer('m1', photo('a', 'm1')));
    options.activeConversationIdRef.current = 'another-chat';
    rerender();
    expect(result.current.attachmentPreview).toBeNull();
    await act(async () => finish({ items: [photo('late')], has_more: false }));
    expect(result.current.attachmentPreview).toBeNull();
  });
  it('updates sender metadata while navigating and preserves selection when a page arrives', () => {
    const items = [{ ...photo('a', 'm1'), messageId: 'm1', originalUrl: '/a.jpg', senderName: 'Анна' }, { ...photo('b', 'm2'), messageId: 'm2', originalUrl: '/b.jpg', senderName: 'Борис' }];
    const preview = { messageId: 'm1', attachment: items[0], items, activeIndex: 0 };
    const { rerender } = render(<ChatMediaPreviewDialog attachmentPreview={preview} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Следующее вложение' }));
    expect(screen.getByText('Борис')).toBeInTheDocument();
    rerender(<ChatMediaPreviewDialog attachmentPreview={{ ...preview, items: [{ ...photo('new'), originalUrl: '/new.jpg' }, ...items] }} />);
    expect(screen.getByText('Борис')).toBeInTheDocument();
    expect(screen.getByText('Фотография 3 из 3')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByText('Анна')).toBeInTheDocument();
  });
});

it('aligns outgoing wide bubbles on the left while keeping their own color', () => {
  const { container, rerender } = render(<ChatBubble theme={theme} ui={{ ...ui, wideMessageLayout: true }} message={{ id: 'own', kind: 'text', body: 'Своё сообщение', is_own: true }} />, { wrapper });
  const surface = container.querySelector('[data-chat-bubble-surface]');
  expect(surface.parentElement).toHaveClass('items-start');
  const background = getComputedStyle(surface).backgroundColor;
  rerender(<ChatBubble theme={theme} ui={ui} message={{ id: 'own', kind: 'text', body: 'Своё сообщение', is_own: true }} />);
  expect(container.querySelector('[data-chat-bubble-surface]').parentElement).toHaveClass('items-end');
  expect(getComputedStyle(container.querySelector('[data-chat-bubble-surface]')).backgroundColor).toBe(background);
});
