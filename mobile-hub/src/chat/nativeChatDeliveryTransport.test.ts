import * as chatApi from '../api/chatApi';
import type { ChatMessage } from '../api/types';
import { createNativeChatDeliveryTransport } from './nativeChatDeliveryTransport';
import type { NativeChatOutboxEntry } from './nativeChatOutbox';

jest.mock('../api/chatApi', () => ({
  sendTextMessage: jest.fn(),
  sendSticker: jest.fn(),
  shareTask: jest.fn(),
}));

const mocked = chatApi as jest.Mocked<typeof chatApi>;

const helpers = {} as never;

function entry(overrides: Partial<NativeChatOutboxEntry> = {}): NativeChatOutboxEntry {
  const message: ChatMessage = {
    id: 'pending:client-1',
    client_message_id: 'client-1',
    conversation_id: 'conversation-1',
    sender_user_id: 7,
    body_text: 'текст',
    created_at: '2026-09-30T10:00:00Z',
    local_status: 'sending',
  };
  return {
    userId: 7,
    title: 'Диалог',
    createdAt: Date.now(),
    message,
    delivery: { version: 1, state: 'sending', attempts: 0, notBefore: 0 },
    ...overrides,
  } as NativeChatOutboxEntry;
}

beforeEach(() => {
  jest.clearAllMocks();
  const saved: ChatMessage = {
    id: 'server-1',
    conversation_id: 'conversation-1',
    sender_user_id: 7,
    body_text: 'текст',
  };
  mocked.sendTextMessage.mockResolvedValue(saved);
  mocked.sendSticker.mockResolvedValue(saved);
  mocked.shareTask.mockResolvedValue(saved);
});

it('routes a sticker command through sendSticker with the durable client id', async () => {
  const transport = createNativeChatDeliveryTransport(() => true);
  const row = entry({
    message: {
      ...entry().message,
      kind: 'file',
      body_text: '',
      reply_preview: { id: 'original-9' } as never,
    },
    command: { type: 'sticker', sticker_id: 'sticker-42' },
  });
  const result = await transport(row, new AbortController().signal, helpers);

  expect(mocked.sendSticker).toHaveBeenCalledWith('conversation-1', 'sticker-42', {
    clientMessageId: 'client-1',
    replyToMessageId: 'original-9',
    signal: expect.any(AbortSignal),
  });
  expect(mocked.sendTextMessage).not.toHaveBeenCalled();
  expect(mocked.shareTask).not.toHaveBeenCalled();
  expect(result.id).toBe('server-1');
});

it('routes a task-share command through shareTask with the durable client id', async () => {
  const transport = createNativeChatDeliveryTransport(() => true);
  const row = entry({
    command: { type: 'task_share', task_id: 'task-77' },
  });
  await transport(row, new AbortController().signal, helpers);

  expect(mocked.shareTask).toHaveBeenCalledWith('conversation-1', 'task-77', {
    clientMessageId: 'client-1',
    replyToMessageId: undefined,
    signal: expect.any(AbortSignal),
  });
  expect(mocked.sendTextMessage).not.toHaveBeenCalled();
  expect(mocked.sendSticker).not.toHaveBeenCalled();
});

it('keeps plain text rows on sendTextMessage', async () => {
  const transport = createNativeChatDeliveryTransport(() => true);
  await transport(entry(), new AbortController().signal, helpers);

  expect(mocked.sendTextMessage).toHaveBeenCalledWith('conversation-1', 'текст', {
    clientMessageId: 'client-1',
    replyToMessageId: undefined,
    kind: undefined,
    signal: expect.any(AbortSignal),
  });
  expect(mocked.sendSticker).not.toHaveBeenCalled();
  expect(mocked.shareTask).not.toHaveBeenCalled();
});

it('refuses to start a delivery while the session cannot deliver', async () => {
  const transport = createNativeChatDeliveryTransport(() => false);
  await expect(transport(
    entry({ command: { type: 'sticker', sticker_id: 's-1' } }),
    new AbortController().signal,
    helpers,
  )).rejects.toMatchObject({ code: 'HUBIT_OFFLINE_READ_ONLY' });
  expect(mocked.sendSticker).not.toHaveBeenCalled();
});
