import { describe, expect, it } from 'vitest';

import {
  buildMentionCandidates,
  mergeActiveConversation,
  resolveActiveConversationSummary,
} from './chatActiveConversationModel';

describe('chatActiveConversationModel', () => {
  it('resolveActiveConversationSummary prefers conversations over searchChats', () => {
    const conversations = [{ id: 'c1', title: 'From list' }];
    const searchChats = [{ id: 'c1', title: 'From search' }];
    expect(resolveActiveConversationSummary({
      activeConversationId: 'c1',
      conversations,
      searchChats,
    })).toEqual({ id: 'c1', title: 'From list' });
  });

  it('resolveActiveConversationSummary falls back to searchChats', () => {
    expect(resolveActiveConversationSummary({
      activeConversationId: 'c2',
      conversations: [{ id: 'c1' }],
      searchChats: [{ id: 'c2', title: 'Search hit' }],
    })).toEqual({ id: 'c2', title: 'Search hit' });
  });

  it('mergeActiveConversation merges detail over summary', () => {
    const summary = {
      id: 'c1',
      title: 'Summary',
      direct_peer: { id: 2, full_name: 'Peer' },
      member_preview: [{ id: 3, username: 'a' }],
    };
    const detail = {
      id: 'c1',
      title: 'Detail title',
      members: [{ id: 4, username: 'b' }],
      member_preview: [{ id: 5, username: 'c' }],
    };
    expect(mergeActiveConversation({
      activeConversationId: 'c1',
      activeConversationSummary: summary,
      conversationDetailsById: { c1: detail },
    })).toMatchObject({
      title: 'Detail title',
      direct_peer: { id: 2, full_name: 'Peer' },
      members: [{ id: 4, username: 'b' }],
      member_preview: [{ id: 5, username: 'c' }],
    });
  });

  it('buildMentionCandidates deduplicates and excludes current user', () => {
    const candidates = buildMentionCandidates({
      currentUserId: 1,
      activeConversation: {
        direct_peer: { id: 2, username: 'peer', full_name: 'Peer' },
        members: [
          { id: 1, username: 'me' },
          { id: 2, username: 'peer', full_name: 'Peer' },
          { id: 3, username: 'other', full_name: 'Other' },
        ],
      },
      searchPeople: [{ id: 3, username: 'other', full_name: 'Other' }],
    });
    expect(candidates.map((item) => item.id)).toEqual([2, 3]);
  });
});
