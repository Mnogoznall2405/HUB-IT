import {
  canDeleteChatMessage,
  canDeleteSelectedMessages,
  canReplyToSelectedMessages,
  canSelectChatMessage,
  getSelectedMessagesCopyText,
  selectedMessagesFromIds,
  startMessageSelection,
  toggleSelectedMessageId,
} from './chatMessageSelection';

describe('native chat message selection', () => {
  const own = {
    id: 'own-1',
    conversation_id: 'c1',
    sender_user_id: 1,
    is_own: true,
    body_text: 'Моё',
  };
  const other = {
    id: 'other-1',
    conversation_id: 'c1',
    sender_user_id: 2,
    is_own: false,
    body_text: 'Чужое',
  };

  it('starts with the long-pressed message and toggles the next tap', () => {
    expect(startMessageSelection('own-1')).toEqual(['own-1']);
    expect(toggleSelectedMessageId(['own-1'], 'other-1')).toEqual(['own-1', 'other-1']);
    expect(toggleSelectedMessageId(['own-1', 'other-1'], 'own-1')).toEqual(['other-1']);
  });

  it('keeps system and failed messages out of selection', () => {
    expect(canSelectChatMessage({ ...own, kind: 'system' })).toBe(false);
    expect(canSelectChatMessage({ ...own, local_status: 'sending' })).toBe(false);
    expect(canSelectChatMessage(other)).toBe(true);
  });

  it('allows deleting own messages and foreign messages only in a group', () => {
    expect(canDeleteChatMessage(own, { conversationKind: 'direct', currentUserId: 1 })).toBe(true);
    expect(canDeleteChatMessage(other, { conversationKind: 'direct', currentUserId: 1 })).toBe(false);
    expect(canDeleteChatMessage(other, { conversationKind: 'group', currentUserId: 1 })).toBe(true);
    expect(canDeleteSelectedMessages([own, other], { conversationKind: 'direct', currentUserId: 1 })).toBe(false);
    expect(canDeleteSelectedMessages([own, other], { conversationKind: 'group', currentUserId: 1 })).toBe(true);
  });

  it('replies only to a single selected message and copies visible text', () => {
    expect(canReplyToSelectedMessages([own])).toBe(true);
    expect(canReplyToSelectedMessages([own, other])).toBe(false);
    expect(getSelectedMessagesCopyText([own, other])).toBe('Моё\n\nЧужое');
    expect(selectedMessagesFromIds([other, own], ['own-1', 'other-1']).map((item) => item.id))
      .toEqual(['own-1', 'other-1']);
  });
});
