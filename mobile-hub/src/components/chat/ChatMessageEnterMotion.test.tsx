import { useEffect } from 'react';
import { Animated, Text } from 'react-native';
import { act, render } from '@testing-library/react-native';
import {
  CHAT_MESSAGE_ENTER_DURATION_MS,
  ChatMessageEnterMotion,
  chatMessageMotionKey,
} from './ChatMessageEnterMotion';

describe('chat message enter motion', () => {
  it('keeps the same render key when an optimistic message is reconciled by client id', () => {
    expect(chatMessageMotionKey({ id: 'pending:mobile-1', client_message_id: 'mobile-1', sender_user_id: 7 }))
      .toBe(chatMessageMotionKey({ id: 'server-42', client_message_id: 'mobile-1', sender_user_id: 7 }));
    expect(CHAT_MESSAGE_ENTER_DURATION_MS).toBe(250);
  });

  it('falls back to the authoritative message id for incoming messages', () => {
    expect(chatMessageMotionKey({ id: 'server-43', client_message_id: null, sender_user_id: 8 }))
      .toBe('message:server-43');
  });

  it('skips movement when reduced motion is enabled', async () => {
    const onFinished = jest.fn();
    const view = await render(
      <ChatMessageEnterMotion
        motionKey="message:server-43"
        kind="incoming"
        reduceMotion
        onFinished={onFinished}
      >
        <Text>Новое сообщение</Text>
      </ChatMessageEnterMotion>,
    );

    expect(view.getByText('Новое сообщение')).toBeTruthy();
    expect(onFinished).toHaveBeenCalledWith('message:server-43');
  });
});

it('consumes a completed animation only once and ignores its late native callback after reuse', async () => {
  const finishes: ((value: { finished: boolean }) => void)[] = [];
  const timing = jest.spyOn(Animated, 'timing').mockImplementation(() => ({ start: (callback) => { finishes.push(callback || (() => {})); }, stop: jest.fn(), reset: jest.fn() }));
  const onFinished = jest.fn();
  const view = await render(<ChatMessageEnterMotion motionKey="first" kind="outgoing" reduceMotion={false} onFinished={onFinished}><Text>first</Text></ChatMessageEnterMotion>);
  await act(async () => { finishes[0]({ finished: true }); });
  await view.rerender(<ChatMessageEnterMotion motionKey="second" kind="outgoing" reduceMotion={false} onFinished={onFinished}><Text>second</Text></ChatMessageEnterMotion>);
  await act(async () => { finishes[0]({ finished: true }); });
  expect(onFinished.mock.calls).toEqual([['first']]);
  await act(async () => { finishes[1]({ finished: true }); });
  expect(onFinished.mock.calls).toEqual([['first'], ['second']]);
  await view.unmount();
  expect(onFinished).toHaveBeenCalledTimes(2);
  timing.mockRestore();
});

it('keeps the bubble mounted when its entry animation is consumed', async () => {
  const mount = jest.fn();
  const unmount = jest.fn();
  function Bubble() { useEffect(() => { mount(); return unmount; }, []); return <Text>attachment</Text>; }
  const onFinished = jest.fn();
  const view = await render(<ChatMessageEnterMotion motionKey="client:1:one" kind="outgoing" reduceMotion onFinished={onFinished}><Bubble /></ChatMessageEnterMotion>);
  await view.rerender(<ChatMessageEnterMotion motionKey="client:1:one" reduceMotion onFinished={onFinished}><Bubble /></ChatMessageEnterMotion>);
  expect(mount).toHaveBeenCalledTimes(1);
  expect(unmount).not.toHaveBeenCalled();
});
