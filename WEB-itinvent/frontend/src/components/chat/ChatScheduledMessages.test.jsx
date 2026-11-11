import React from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), update: vi.fn(), cancel: vi.fn() }));
const config = vi.hoisted(() => ({ value: { scheduled_messages_enabled: true } }));
vi.mock('../../api/chatScheduled', () => ({ chatScheduledAPI: api }));
vi.mock('../../api/chatConfig', () => ({ getChatConfigCached: () => Promise.resolve(config.value) }));

import {
  ChatComposerScheduling,
  ScheduleSendDialog,
  ScheduledMessagesBar,
  ScheduledMessagesDialog,
} from './ChatScheduledMessages';
import useChatScheduledMessages from './useChatScheduledMessages';

const future = (hours) => new Date(Date.now() + hours * 3600_000).toISOString();

describe('ScheduleSendDialog', () => {
  it('schedules the typed text for the chosen preset and refuses a past time', () => {
    const onConfirm = vi.fn();
    render(<ScheduleSendDialog open initialBody="Привет" onClose={vi.fn()} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Запланировать' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const [body, date] = onConfirm.mock.calls[0];
    expect(body).toBe('Привет');
    expect(date.getTime()).toBeGreaterThan(Date.now() + 30 * 60 * 1000); // default: in about an hour

    fireEvent.change(screen.getByLabelText('Дата и время отправки'), { target: { value: '2020-01-01T10:00' } });
    expect(screen.getByText('Время должно быть в будущем')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Запланировать' })).toBeDisabled();
  });

  it('needs a text and takes a preset', () => {
    const onConfirm = vi.fn();
    render(<ScheduleSendDialog open initialBody="" onClose={vi.fn()} onConfirm={onConfirm} />);
    expect(screen.getByRole('button', { name: 'Запланировать' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Текст отложенного сообщения'), { target: { value: 'Текст' } });
    fireEvent.click(screen.getByText('Завтра в 9:00'));
    fireEvent.click(screen.getByRole('button', { name: 'Запланировать' }));
    const [, date] = onConfirm.mock.calls[0];
    expect([date.getHours(), date.getMinutes()]).toEqual([9, 0]);
  });
});

describe('ScheduledMessagesBar and list', () => {
  it('shows nothing without messages, a counter with them, and failed ones in red text', () => {
    const { container, rerender } = render(<ScheduledMessagesBar items={[]} onOpen={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    const onOpen = vi.fn();
    rerender(<ScheduledMessagesBar items={[{ id: 'a', status: 'scheduled', scheduled_for: future(2) }, { id: 'b', status: 'failed', scheduled_for: future(1) }]} onOpen={onOpen} />);
    expect(screen.getByTestId('chat-scheduled-bar')).toHaveTextContent(/Запланировано: 1 · ближайшее .* · не отправлено: 1/);
    fireEvent.click(screen.getByTestId('chat-scheduled-bar'));
    expect(onOpen).toHaveBeenCalled();
  });

  it('lists messages with edit and cancel', () => {
    const onEdit = vi.fn();
    const onCancel = vi.fn();
    const items = [{ id: 'a', body: 'Первое', status: 'scheduled', scheduled_for: future(2) }, { id: 'b', body: 'Второе', status: 'failed', error_text: 'нет доступа', scheduled_for: future(1) }];
    render(<ScheduledMessagesDialog open items={items} onClose={vi.fn()} onEdit={onEdit} onCancel={onCancel} />);
    expect(screen.getAllByTestId('chat-scheduled-item')).toHaveLength(2);
    expect(screen.getByText(/Не отправлено: нет доступа/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByLabelText('Изменить запланированное сообщение')[0]);
    expect(onEdit).toHaveBeenCalledWith(items[0]);
    fireEvent.click(screen.getAllByLabelText('Отменить запланированное сообщение')[1]);
    expect(onCancel).toHaveBeenCalledWith(items[1]);
  });
});

describe('ChatComposerScheduling', () => {
  const scheduledApi = (extra = {}) => ({
    enabled: true, items: [], busy: false, error: '', clearError: vi.fn(),
    schedule: vi.fn().mockResolvedValue({ id: 'new' }), update: vi.fn().mockResolvedValue({ id: 'a' }), cancel: vi.fn(),
    ...extra,
  });

  it('renders nothing when the feature is off', () => {
    const { container } = render(<ChatComposerScheduling scheduled={scheduledApi({ enabled: false })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('send-later menu -> dialog -> schedules the text with the reply and clears the composer', async () => {
    const scheduled = scheduledApi();
    const onMessageTextChange = vi.fn();
    const onClearReply = vi.fn();
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    const Host = () => {
      const [menuAnchor, setMenuAnchor] = React.useState(anchor);
      return (
        <ChatComposerScheduling
          scheduled={scheduled}
          menuAnchor={menuAnchor}
          onCloseMenu={() => setMenuAnchor(null)}
          messageText="Напомнить завтра"
          replyMessage={{ id: 'm5' }}
          onMessageTextChange={onMessageTextChange}
          onClearReply={onClearReply}
        />
      );
    };
    render(<Host />);
    fireEvent.click(await screen.findByTestId('chat-send-later-menu-item'));
    fireEvent.click(await screen.findByRole('button', { name: 'Запланировать' }));
    await waitFor(() => expect(scheduled.schedule).toHaveBeenCalledTimes(1));
    const [body, when, replyId] = scheduled.schedule.mock.calls[0];
    expect([body, replyId]).toEqual(['Напомнить завтра', 'm5']);
    expect(Number.isNaN(Date.parse(when))).toBe(false);
    await waitFor(() => expect(onMessageTextChange).toHaveBeenCalledWith(''));
    expect(onClearReply).toHaveBeenCalled();
  });

  it('keeps the text when the server refuses', async () => {
    const scheduled = scheduledApi({ schedule: vi.fn().mockResolvedValue(null), error: 'Время отправки должно быть в будущем' });
    const onMessageTextChange = vi.fn();
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    render(
      <ChatComposerScheduling scheduled={scheduled} menuAnchor={anchor} onCloseMenu={vi.fn()} messageText="Текст" onMessageTextChange={onMessageTextChange} />,
    );
    fireEvent.click(await screen.findByTestId('chat-send-later-menu-item'));
    fireEvent.click(await screen.findByRole('button', { name: 'Запланировать' }));
    await waitFor(() => expect(scheduled.schedule).toHaveBeenCalled());
    expect(onMessageTextChange).not.toHaveBeenCalled();
    expect(await screen.findByText('Время отправки должно быть в будущем')).toBeInTheDocument();
  });

  it('edits a scheduled message from the list', async () => {
    const item = { id: 'a', body: 'Старый текст', status: 'scheduled', scheduled_for: future(5) };
    const scheduled = scheduledApi({ items: [item] });
    render(<ChatComposerScheduling scheduled={scheduled} listOpen onCloseList={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Изменить запланированное сообщение'));
    fireEvent.change(await screen.findByLabelText('Текст отложенного сообщения'), { target: { value: 'Новый текст' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(scheduled.update).toHaveBeenCalledWith('a', expect.objectContaining({ body: 'Новый текст' })));
  });
});

describe('useChatScheduledMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.value = { scheduled_messages_enabled: true };
    api.list.mockResolvedValue([{ id: 'a', status: 'scheduled', scheduled_for: future(3), body: 'x' }]);
  });

  it('loads the list of the conversation only when the server enabled the feature', async () => {
    const { result } = renderHook(() => useChatScheduledMessages({ conversationId: 'c1' }));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(api.list).toHaveBeenCalledWith('c1');
    expect(result.current.enabled).toBe(true);

    config.value = { scheduled_messages_enabled: false };
    api.list.mockClear();
    const off = renderHook(() => useChatScheduledMessages({ conversationId: 'c1' }));
    await act(async () => { await Promise.resolve(); });
    expect(off.result.current.enabled).toBe(false);
    expect(api.list).not.toHaveBeenCalled();
  });

  it('does nothing for AI conversations (available=false)', async () => {
    const { result } = renderHook(() => useChatScheduledMessages({ conversationId: 'c1', available: false }));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.enabled).toBe(false);
    expect(api.list).not.toHaveBeenCalled();
  });

  it('schedule/cancel reload the list and report the server detail on failure', async () => {
    api.create.mockResolvedValue({ id: 'n' });
    api.cancel.mockRejectedValue({ response: { data: { detail: 'Это сообщение уже отправляется или отправлено' } } });
    const { result } = renderHook(() => useChatScheduledMessages({ conversationId: 'c1' }));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(async () => { await result.current.schedule('Привет', future(1), 'm1'); });
    expect(api.create).toHaveBeenCalledWith('c1', { body: 'Привет', scheduledFor: expect.any(String), replyToMessageId: 'm1' });
    expect(api.list.mock.calls.length).toBeGreaterThanOrEqual(2);
    await act(async () => { await result.current.cancel('a'); });
    expect(result.current.error).toBe('Это сообщение уже отправляется или отправлено');
  });
});
