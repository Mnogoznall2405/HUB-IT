import { describe, expect, it } from 'vitest';
import { CHAT_MOBILE_BREAKPOINT_PX, CHAT_MOBILE_MEDIA } from './chatMobileModel';

describe('chat mobile breakpoint (Д2-5, п. 5)', () => {
  it('switches to the single-pane phone layout below 700 px only', () => {
    expect(CHAT_MOBILE_BREAKPOINT_PX).toBe(700);
    expect(CHAT_MOBILE_MEDIA).toBe('(max-width:699.95px)');
  });
});
