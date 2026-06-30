import { describe, expect, it } from 'vitest';

import { patchConversationWithPresence } from './useChatConversationSyncCallbacks';
import {
  resolveAiAwareTypingLine,
  resolveConversationHeaderSubtitle,
} from './useChatThreadHeaderPresentation';

describe('useChatThreadHeaderPresentation helpers', () => {
  it('resolveConversationHeaderSubtitle prefers typing users', () => {
    expect(resolveConversationHeaderSubtitle({
      typingUsers: ['Alice'],
      activeConversation: { title: 'Team' },
    })).toBe('Alice печатает...');
  });

  it('resolveAiAwareTypingLine prefers AI status on ai conversations', () => {
    expect(resolveAiAwareTypingLine({
      activeConversationKind: 'ai',
      activeAiStatusDisplay: { visible: true, primaryText: 'Думаю…' },
      typingLine: 'Bob печатает',
    })).toBe('Думаю…');
  });

  it('falls back to typing line when AI status is hidden', () => {
    expect(resolveAiAwareTypingLine({
      activeConversationKind: 'ai',
      activeAiStatusDisplay: { visible: false },
      typingLine: 'typing',
    })).toBe('typing');
  });
});

describe('patchConversationWithPresence', () => {
  it('patches direct peer presence without changing unrelated conversations', () => {
    const conversation = {
      kind: 'direct',
      direct_peer: { id: 5, full_name: 'Alice' },
    };
    const next = patchConversationWithPresence(conversation, 5, { online: true });
    expect(next.direct_peer.presence).toEqual({ online: true });
    expect(patchConversationWithPresence(conversation, 6, { online: true })).toBe(conversation);
  });
});
