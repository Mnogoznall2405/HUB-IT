import { describe, expect, it } from 'vitest';

import {
  conversationExistsInList,
  sameConversationId,
} from './chatConversationModel';

describe('conversation id matching', () => {
  it('treats numeric and string ids as the same conversation', () => {
    expect(sameConversationId(7, '7')).toBe(true);
    expect(sameConversationId(' 7 ', 7)).toBe(true);
    expect(sameConversationId('', '7')).toBe(false);
    expect(sameConversationId(7, 8)).toBe(false);
  });

  it('finds a requested conversation even when the list stores numeric ids', () => {
    expect(conversationExistsInList([{ id: 7 }], '7')).toBe(true);
    expect(conversationExistsInList([{ id: '7' }], 7)).toBe(true);
    expect(conversationExistsInList([{ id: 8 }], '7')).toBe(false);
    expect(conversationExistsInList([], '7')).toBe(false);
  });
});
