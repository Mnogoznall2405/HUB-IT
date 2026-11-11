import {
  shouldStartMessageSwipe,
  shouldStartReplySwipe,
  shouldTriggerForward,
  shouldTriggerReply,
} from './SwipeableChatBubble';

describe('swipe to reply thresholds', () => {
  it('starts only for a deliberate horizontal right swipe', () => {
    expect(shouldStartReplySwipe(18, 2)).toBe(true);
    expect(shouldStartReplySwipe(4, 0)).toBe(false);
    expect(shouldStartReplySwipe(18, 16)).toBe(false);
    expect(shouldStartReplySwipe(-30, 1)).toBe(false);
  });

  it('triggers reply at the stable threshold', () => {
    expect(shouldTriggerReply(43)).toBe(false);
    expect(shouldTriggerReply(44)).toBe(true);
  });

  it('reserves a deliberate left swipe for forwarding', () => {
    expect(shouldStartMessageSwipe(-18, 2, { canReply: true, canForward: true })).toBe(true);
    expect(shouldStartMessageSwipe(-18, 2, { canReply: true, canForward: false })).toBe(false);
    expect(shouldTriggerForward(-43)).toBe(false);
    expect(shouldTriggerForward(-44)).toBe(true);
  });
});
