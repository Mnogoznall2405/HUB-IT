import * as SecureStore from 'expo-secure-store';
import type { ChatMessage } from '../api/types';
import {
  clearNativeChatOutbox,
  createNativeChatOutbox,
  readNativeChatOutbox,
  subscribeNativeChatDelivery,
} from './nativeChatOutbox';
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
