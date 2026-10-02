import { describe, expect, it } from 'vitest';

import { areChatBubblePropsEqual } from './ChatBubble';

const palette = { mode: 'light' };
const typography = { fontFamily: 'Aptos' };
const breakpoints = { values: { xs: 0 } };
const message = { id: 'm1', body: 'hello' };
const onOpenReads = () => {};

const buildProps = (overrides = {}) => ({
  message,
  onOpenReads,
  theme: { palette, typography, breakpoints },
  ui: { bubbleOwnBg: '#effdde', density: { bubblePx: 1.2 } },
  ...overrides,
});

describe('areChatBubblePropsEqual (Д2-3)', () => {
  it('treats recreated theme/ui objects with the same values as equal', () => {
    const next = buildProps({
      theme: { palette, typography, breakpoints },
      ui: { bubbleOwnBg: '#effdde', density: { bubblePx: 1.2 } },
    });
    expect(areChatBubblePropsEqual(buildProps(), next)).toBe(true);
  });

  it('re-renders when a ui token value changes', () => {
    const next = buildProps({ ui: { bubbleOwnBg: '#2b5278', density: { bubblePx: 1.2 } } });
    expect(areChatBubblePropsEqual(buildProps(), next)).toBe(false);
    const nested = buildProps({ ui: { bubbleOwnBg: '#effdde', density: { bubblePx: 1.4 } } });
    expect(areChatBubblePropsEqual(buildProps(), nested)).toBe(false);
  });

  it('re-renders when the theme palette is really replaced', () => {
    const next = buildProps({ theme: { palette: { mode: 'dark' }, typography, breakpoints } });
    expect(areChatBubblePropsEqual(buildProps(), next)).toBe(false);
  });

  it('re-renders when the message or a handler identity changes', () => {
    expect(areChatBubblePropsEqual(buildProps(), buildProps({ message: { ...message } }))).toBe(false);
    expect(areChatBubblePropsEqual(buildProps(), buildProps({ onOpenReads: () => {} }))).toBe(false);
  });

  it('re-renders when a prop is added or removed', () => {
    expect(areChatBubblePropsEqual(buildProps(), buildProps({ highlighted: true }))).toBe(false);
  });
});
