import { describe, expect, it } from 'vitest';

import { resolveComposerSelectionRange } from './useChatComposerSelection';

describe('useChatComposerSelection helpers', () => {
  it('resolveComposerSelectionRange prefers stored selection over input', () => {
    const composerRef = {
      current: {
        selectionStart: 1,
        selectionEnd: 4,
      },
    };
    const composerSelectionRef = { current: { start: 2, end: 3 } };

    expect(resolveComposerSelectionRange({
      composerRef,
      composerSelectionRef,
      messageText: 'hello',
    })).toEqual({
      start: 2,
      end: 3,
      currentValue: 'hello',
    });
  });

  it('resolveComposerSelectionRange falls back to input selection', () => {
    const composerRef = {
      current: {
        selectionStart: 1,
        selectionEnd: 3,
      },
    };
    const composerSelectionRef = { current: { start: null, end: null } };

    expect(resolveComposerSelectionRange({
      composerRef,
      composerSelectionRef,
      messageText: 'hello',
    })).toEqual({
      start: 1,
      end: 3,
      currentValue: 'hello',
    });
  });

  it('resolveComposerSelectionRange defaults to end of message text', () => {
    expect(resolveComposerSelectionRange({
      composerRef: { current: null },
      composerSelectionRef: { current: {} },
      messageText: 'abc',
    })).toEqual({
      start: 3,
      end: 3,
      currentValue: 'abc',
    });
  });
});
