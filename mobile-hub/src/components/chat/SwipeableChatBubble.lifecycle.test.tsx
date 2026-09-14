import { act, render } from '@testing-library/react-native';
import { Animated, PanResponder, type PanResponderCallbacks, type PanResponderGestureState, type GestureResponderEvent } from 'react-native';
import { lockChatVoiceSurface, unlockChatVoiceSurface } from '../../chat/chatVoice';
import { SwipeableChatBubble } from './SwipeableChatBubble';

let mockReducedMotion = false;
jest.mock('../../accessibility/useReducedMotion', () => ({ useReducedMotion: () => mockReducedMotion }));
const message = { id: 'message-1', conversation_id: 'c1', sender_user_id: 1, body_text: 'Swipe me' };
let handlers: PanResponderCallbacks;
const event = {} as GestureResponderEvent;
const gesture = { dx: 50, dy: 0 } as PanResponderGestureState;
beforeEach(() => {
  mockReducedMotion = false;
  jest.spyOn(PanResponder, 'create').mockImplementation((config) => { handlers = config; return { panHandlers: {} }; });
  jest.spyOn(Animated, 'spring').mockReturnValue({ start: jest.fn(), stop: jest.fn(), reset: jest.fn() });
});
afterEach(() => jest.restoreAllMocks());

it.each(['disabled', 'message', 'voice', 'terminated'] as const)('cancels the acquired reply gesture after %s', async (change) => {
  const reply = jest.fn();
  const view = await render(<SwipeableChatBubble isOwn={false} message={message} onSwipeReply={reply} />);
  const acquired = handlers;
  await act(async () => { acquired.onPanResponderGrant?.(event, gesture); acquired.onPanResponderMove?.(event, gesture); });
  if (change === 'disabled') await view.rerender(<SwipeableChatBubble isOwn={false} message={message} onSwipeReply={reply} swipeEnabled={false} />);
  if (change === 'message') await view.rerender(<SwipeableChatBubble isOwn={false} message={{ ...message, id: 'message-2' }} onSwipeReply={reply} />);
  if (change === 'voice') lockChatVoiceSurface();
  if (change === 'terminated') await act(async () => { acquired.onPanResponderTerminate?.(event, gesture); });
  try {
    await act(async () => { acquired.onPanResponderRelease?.(event, gesture); });
    expect(reply).not.toHaveBeenCalled();
  } finally { if (change === 'voice') unlockChatVoiceSurface(); await view.unmount(); }
});

it('invokes the latest callback once and skips spring when reduced motion changes during a swipe', async () => {
  const oldReply = jest.fn(), newReply = jest.fn();
  const view = await render(<SwipeableChatBubble isOwn={false} message={message} onSwipeReply={oldReply} />);
  const acquired = handlers;
  await act(async () => { acquired.onPanResponderGrant?.(event, gesture); acquired.onPanResponderMove?.(event, gesture); });
  mockReducedMotion = true;
  await view.rerender(<SwipeableChatBubble isOwn={false} message={message} onSwipeReply={newReply} />);
  await act(async () => { acquired.onPanResponderRelease?.(event, gesture); acquired.onPanResponderRelease?.(event, gesture); });
  expect(oldReply).not.toHaveBeenCalled();
  expect(newReply).toHaveBeenCalledTimes(1);
  expect(Animated.spring).not.toHaveBeenCalled();
});

it('forwards a deliberate left gesture once and ignores a vertical takeover', async () => {
  const forward = jest.fn();
  await render(<SwipeableChatBubble isOwn={false} message={message} onSwipeForward={forward} />);
  await act(async () => {
    handlers.onPanResponderGrant?.(event, gesture);
    handlers.onPanResponderRelease?.(event, { ...gesture, dx: -50 });
    handlers.onPanResponderRelease?.(event, { ...gesture, dx: -50 });
  });
  expect(forward).toHaveBeenCalledTimes(1);
  await act(async () => {
    handlers.onPanResponderGrant?.(event, gesture);
    handlers.onPanResponderRelease?.(event, { ...gesture, dx: -50, dy: 90 });
  });
  expect(forward).toHaveBeenCalledTimes(1);
});
