import type { ChatMessage } from '../api/types';
import {
  clearNativeChatOutbox,
  createNativeChatOutbox,
  readNativeChatOutbox,
} from './nativeChatOutbox';
import { drainNativeChatOutboxInBackground } from './nativeChatBackgroundDrain';

const userId = 7;
const pending: ChatMessage = {
  id: 'pending:m1', client_message_id: 'm1', conversation_id: 'chat-x',
  sender_user_id: userId, body_text: 'Привет',
};
const saved: ChatMessage = { ...pending, id: 'server-1' };

beforeEach(async () => { await clearNativeChatOutbox(); });
afterEach(async () => { await clearNativeChatOutbox(); });

const drainOptions = (transport: jest.Mock) => ({
  transport: transport as never,
  persistConfirmed: async () => true,
  pollMs: 10,
  budgetMs: 2000,
});

it('drains a queued message through the runner semantics', async () => {
  await createNativeChatOutbox(userId, 'chat-x').queue(pending);
  const transport = jest.fn(async () => saved);
  await drainNativeChatOutboxInBackground(userId, drainOptions(transport));
  expect(transport).toHaveBeenCalledTimes(1);
  expect(await readNativeChatOutbox(userId)).toEqual([]);
});

it('returns after a transient failure leaves a durable retry deadline', async () => {
  await createNativeChatOutbox(userId, 'chat-x').queue(pending);
  const transport = jest.fn(async () => {
    throw Object.assign(new Error('server busy'), { isAxiosError: true, response: { status: 503 } });
  });
  await drainNativeChatOutboxInBackground(userId, drainOptions(transport));
  expect(transport).toHaveBeenCalledTimes(1);
  const rows = await readNativeChatOutbox(userId);
  expect(rows[0]?.delivery?.state).toBe('retry');
  expect(rows[0]?.delivery?.notBefore).toBeGreaterThan(Date.now());
});

it('delivers around a paused row without retrying it', async () => {
  const second: ChatMessage = { ...pending, id: 'pending:m2', client_message_id: 'm2' };
  const failing = jest.fn(async () => {
    throw Object.assign(new Error('validation'), { isAxiosError: true, response: { status: 422 } });
  });
  const outbox = createNativeChatOutbox(userId, 'chat-x');
  await outbox.queue(pending);
  await drainNativeChatOutboxInBackground(userId, drainOptions(failing));
  expect((await readNativeChatOutbox(userId))[0]?.delivery?.state).toBe('paused');

  await outbox.queue(second);
  const transport = jest.fn(async (entry: { message: ChatMessage }) => ({ ...saved, client_message_id: entry.message.client_message_id }));
  await drainNativeChatOutboxInBackground(userId, drainOptions(transport));
  expect(transport.mock.calls.map((call) => call[0].message.client_message_id)).toEqual(['m2']);
  const rows = await readNativeChatOutbox(userId);
  expect(rows.map((row) => [row.message.client_message_id, row.delivery?.state])).toEqual([['m1', 'paused']]);
});

it('does not deliver when the session no longer owns the task', async () => {
  await createNativeChatOutbox(userId, 'chat-x').queue(pending);
  const transport = jest.fn(async () => saved);
  await drainNativeChatOutboxInBackground(userId, { ...drainOptions(transport), ownsSession: () => false });
  expect(transport).not.toHaveBeenCalled();
  expect(await readNativeChatOutbox(userId)).toHaveLength(1);
});

it('runs at most one drain at a time: a concurrent call returns without a second pump', async () => {
  await createNativeChatOutbox(userId, 'chat-x').queue(pending);
  let releaseFirst!: (value: ChatMessage) => void;
  const firstTransport = jest.fn(() => new Promise<ChatMessage>((resolve) => { releaseFirst = resolve; }));
  const first = drainNativeChatOutboxInBackground(userId, drainOptions(firstTransport));
  const started = Date.now();
  while (!firstTransport.mock.calls.length && Date.now() - started < 2000) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(firstTransport).toHaveBeenCalledTimes(1);
  const secondTransport = jest.fn(async () => saved);
  // The token is still held by the first drain — no parallel pump is allowed.
  await drainNativeChatOutboxInBackground(userId, drainOptions(secondTransport));
  expect(secondTransport).not.toHaveBeenCalled();
  releaseFirst(saved);
  await first;
  expect(firstTransport).toHaveBeenCalledTimes(1);
  expect(await readNativeChatOutbox(userId)).toEqual([]);
});
