import * as SecureStore from 'expo-secure-store';
import type { ChatMessage } from '../api/types';
import {
  clearNativeChatOutbox,
  createNativeChatOutbox,
  readNativeChatOutbox,
  subscribeNativeChatDelivery,
} from './nativeChatOutbox';
import { getChatSendTimingSummary, resetChatSendTiming } from '../diagnostics/chatSendTiming';
import { createNativeChatDeliveryRunner } from './nativeChatDeliveryRunner';

const userId = 7;
const pending: ChatMessage = {
  id: 'pending:m1', client_message_id: 'm1', conversation_id: 'chat-x',
  sender_user_id: userId, body_text: 'Привет',
};
const saved: ChatMessage = { ...pending, id: 'server-1' };

beforeEach(async () => { await clearNativeChatOutbox(); });
afterEach(async () => { await clearNativeChatOutbox(); });

it('backs off a failed local delivery claim and resumes after storage recovers', async () => {
  await createNativeChatOutbox(userId, 'chat-x').queue(pending);
  jest.useFakeTimers();
  const write = jest.mocked(SecureStore.setItemAsync);
  const original = write.getMockImplementation()!;
  write.mockClear().mockRejectedValue(new Error('Storage unavailable'));
  const transport = jest.fn(async () => saved), onError = jest.fn();
  const runner = createNativeChatDeliveryRunner({ userId, canDeliver: () => true, transport,
    persistConfirmed: async () => true, onError });
  try {
    await jest.advanceTimersByTimeAsync(1000);
    expect(transport).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(1);
    write.mockImplementation(original);
    await jest.advanceTimersByTimeAsync(5000);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(await readNativeChatOutbox(userId)).toEqual([]);
  } finally {
    runner.dispose(); write.mockImplementation(original); jest.useRealTimers();
  }
});

it('picks up a freshly queued message well under the old half-second floor', async () => {
  const transport = jest.fn(async () => saved);
  const runner = createNativeChatDeliveryRunner({
    userId,
    canDeliver: () => true,
    transport,
    persistConfirmed: async () => true,
  });
  try {
    await createNativeChatOutbox(userId, 'chat-x').queue(pending);
    const started = Date.now();
    while (!transport.mock.calls.length && Date.now() - started < 400) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(transport).toHaveBeenCalledTimes(1);
    expect(Date.now() - started).toBeLessThan(400);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await readNativeChatOutbox(userId)).toEqual([]);
  } finally {
    runner.dispose();
  }
});

it('keeps the client-side reply preview when the ACK arrives lean', async () => {
  const replyPending: ChatMessage = {
    ...pending,
    id: 'pending:rep1',
    client_message_id: 'rep1',
    reply_preview: { id: 'm9', sender_name: 'Коллега', kind: 'text', body: 'исходное' },
  };
  // The send endpoint answers with a lean ACK: reply_preview is deliberately
  // absent even though reply_to_message_id was recorded server-side.
  const leanSaved: ChatMessage = {
    ...replyPending, id: 'server-rep1', reply_preview: null, reply_to_message_id: 'm9',
  } as ChatMessage;
  const transport = jest.fn(async () => leanSaved);
  const published: ChatMessage[] = [];
  const offDelivery = subscribeNativeChatDelivery((event) => {
    if (event.loaded === undefined) published.push(event.message);
  });
  const runner = createNativeChatDeliveryRunner({
    userId,
    canDeliver: () => true,
    transport,
    persistConfirmed: async () => true,
  });
  try {
    await createNativeChatOutbox(userId, 'chat-x').queue(replyPending);
    const started = Date.now();
    while (!transport.mock.calls.length && Date.now() - started < 400) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(transport).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const confirmed = published.find((item) => item.client_message_id === 'rep1');
    expect(confirmed?.reply_preview).toEqual(replyPending.reply_preview);
    expect(await readNativeChatOutbox(userId)).toEqual([]);
  } finally {
    runner.dispose();
    offDelivery();
  }
});

it('delivers a later message while an earlier one stays paused in the same dialog', async () => {
  const first: ChatMessage = { ...pending, id: 'pending:m1', client_message_id: 'm1' };
  const second: ChatMessage = { ...pending, id: 'pending:m2', client_message_id: 'm2' };
  const transport = jest.fn(async (entry: { message: ChatMessage }) => {
    if (entry.message.client_message_id === 'm1') throw new Error('permanent failure');
    return { ...saved, id: 'server-2', client_message_id: 'm2' };
  });
  const runner = createNativeChatDeliveryRunner({
    userId,
    canDeliver: () => true,
    transport: transport as never,
    persistConfirmed: async () => true,
  });
  try {
    const outbox = createNativeChatOutbox(userId, 'chat-x');
    await outbox.queue(first);
    const started = Date.now();
    while (transport.mock.calls.length < 1 && Date.now() - started < 1000) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(transport).toHaveBeenCalledTimes(1);

    await outbox.queue(second);
    while (transport.mock.calls.length < 2 && Date.now() - started < 2000) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(transport.mock.calls.map((call) => call[0].message.client_message_id)).toEqual(['m1', 'm2']);
    // m2 is confirmed and flushed; m1 remains parked for manual retry.
    const rows = await readNativeChatOutbox(userId);
    expect(rows.map((row) => [row.message.client_message_id, row.delivery?.state]))
      .toEqual([['m1', 'paused']]);
  } finally {
    runner.dispose();
  }
});

it('parks a validation (4xx) failure without scheduling an auto retry', async () => {
  const transport = jest.fn(async () => {
    throw Object.assign(new Error('validation'), { isAxiosError: true, response: { status: 422 } });
  });
  const runner = createNativeChatDeliveryRunner({
    userId,
    canDeliver: () => true,
    transport,
    persistConfirmed: async () => true,
  });
  try {
    await createNativeChatOutbox(userId, 'chat-x').queue(pending);
    const started = Date.now();
    while (!transport.mock.calls.length && Date.now() - started < 1000) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(transport).toHaveBeenCalledTimes(1);
    // Non-transient failure → paused immediately; the pump must not fire again.
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(transport).toHaveBeenCalledTimes(1);
    const rows = await readNativeChatOutbox(userId);
    expect(rows[0]?.delivery?.state).toBe('paused');
  } finally {
    runner.dispose();
  }
});

it('retries a transient failure once on the durable backoff deadline', async () => {
  let calls = 0;
  const transport = jest.fn(async () => {
    calls += 1;
    if (calls === 1) {
      throw Object.assign(new Error('server busy'), { isAxiosError: true, response: { status: 503 } });
    }
    return saved;
  });
  const runner = createNativeChatDeliveryRunner({
    userId,
    canDeliver: () => true,
    transport,
    persistConfirmed: async () => true,
  });
  try {
    await createNativeChatOutbox(userId, 'chat-x').queue(pending);
    const started = Date.now();
    while (!transport.mock.calls.length && Date.now() - started < 1000) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const rows = await readNativeChatOutbox(userId);
    expect(rows[0]?.delivery?.state).toBe('retry');
    expect(rows[0]?.delivery?.notBefore).toBeGreaterThan(Date.now());
    // Before the deadline no new attempt is made.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(transport).toHaveBeenCalledTimes(1);
  } finally {
    runner.dispose();
  }
});

it('rejects a manual retry while the delivery job is already in flight', async () => {
  let resolveTransport: ((message: ChatMessage) => void) | null = null;
  const transport = jest.fn(() => new Promise<ChatMessage>((resolve) => { resolveTransport = resolve; }));
  const runner = createNativeChatDeliveryRunner({
    userId,
    canDeliver: () => true,
    transport,
    persistConfirmed: async () => true,
  });
  try {
    const outbox = createNativeChatOutbox(userId, 'chat-x');
    await outbox.queue(pending);
    const started = Date.now();
    while (!transport.mock.calls.length && Date.now() - started < 1000) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await expect(outbox.retryDelivery('m1')).rejects.toMatchObject({ code: 'HUBIT_NO_DELIVERY' });
    (resolveTransport as ((message: ChatMessage) => void) | null)?.(saved);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(transport).toHaveBeenCalledTimes(1);
    expect(await readNativeChatOutbox(userId)).toEqual([]);
  } finally {
    runner.dispose();
  }
});

it('keeps one message under the storage budget: at most 3 writes and 1 read', async () => {
  resetChatSendTiming();
  const transport = jest.fn(async () => saved);
  const runner = createNativeChatDeliveryRunner({
    userId,
    canDeliver: () => true,
    transport,
    persistConfirmed: async () => true,
  });
  try {
    await createNativeChatOutbox(userId, 'chat-x').queue(pending);
    const started = Date.now();
    while (!transport.mock.calls.length && Date.now() - started < 1000) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(await readNativeChatOutbox(userId)).toEqual([]);

    const ops = getChatSendTimingSummary().storageOps;
    // queue stamp-write + claim write + confirmed-row removal (delete op).
    expect(ops.write.count + ops.delete.count).toBeLessThanOrEqual(3);
    expect(ops.read.count).toBeLessThanOrEqual(1);
  } finally {
    runner.dispose();
  }
});

it('keeps the queued entry when delivery is not currently allowed', async () => {
  const transport = jest.fn(async () => saved);
  const runner = createNativeChatDeliveryRunner({
    userId,
    canDeliver: () => false,
    transport,
    persistConfirmed: async () => true,
  });
  try {
    await createNativeChatOutbox(userId, 'chat-x').queue(pending);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(transport).not.toHaveBeenCalled();
    expect(await readNativeChatOutbox(userId)).toHaveLength(1);
  } finally {
    runner.dispose();
  }
});
