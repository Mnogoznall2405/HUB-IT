import { act, render } from '@testing-library/react-native';
import { lockChatVoiceSurface, unlockChatVoiceSurface } from '../../chat/chatVoice';
import {
  applySwipeResistance,
  fireSwipe,
  resolveSwipeRelease,
  REPLY_THRESHOLD,
  SwipeableChatBubble,
} from './SwipeableChatBubble';

let mockReducedMotion = false;
jest.mock('../../accessibility/useReducedMotion', () => ({ useReducedMotion: () => mockReducedMotion }));
const message = { id: 'message-1', conversation_id: 'c1', sender_user_id: 1, body_text: 'Swipe me' };
beforeEach(() => { mockReducedMotion = false; });

it.each([true, false])('renders the bubble with reply and forward indicators (reduceMotion=%s)', async (reduceMotion) => {
  mockReducedMotion = reduceMotion;
  const view = await render(<SwipeableChatBubble isOwn={false} message={message} onSwipeReply={() => {}} onSwipeForward={() => {}} />);
  expect(view.getByText('Swipe me')).toBeTruthy();
});

it('resolves a release at the reply threshold and resists overdrag', () => {
  expect(resolveSwipeRelease(REPLY_THRESHOLD, { canReply: true, canForward: false })).toBe('reply');
  expect(resolveSwipeRelease(-REPLY_THRESHOLD, { canReply: true, canForward: true })).toBe('forward');
  expect(resolveSwipeRelease(-REPLY_THRESHOLD, { canReply: true, canForward: false })).toBeNull();
  expect(resolveSwipeRelease(20, { canReply: true, canForward: true })).toBeNull();
});

it('applies rubber-band resistance past the offset cap', () => {
  const min = -60;
  const max = 60;
  expect(applySwipeResistance(30, min, max)).toBe(30);
  expect(applySwipeResistance(80, min, max)).toBeGreaterThan(60);
  expect(applySwipeResistance(80, min, max)).toBeLessThanOrEqual(74);
  expect(applySwipeResistance(-200, min, max)).toBeGreaterThanOrEqual(min - 14);
});

it('does not fire while the voice surface is locked', async () => {
  const reply = jest.fn();
  const forward = jest.fn();
  lockChatVoiceSurface();
  try {
    fireSwipe('reply', reply, forward);
    fireSwipe('forward', reply, forward);
  } finally {
    unlockChatVoiceSurface();
  }
  expect(reply).not.toHaveBeenCalled();
  expect(forward).not.toHaveBeenCalled();
  fireSwipe('reply', reply, forward);
  fireSwipe('forward', reply, forward);
  expect(reply).toHaveBeenCalledTimes(1);
  expect(forward).toHaveBeenCalledTimes(1);
});
