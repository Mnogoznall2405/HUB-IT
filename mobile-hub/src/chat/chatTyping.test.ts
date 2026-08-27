import {
  applyTypingParticipant,
  formatChatPresenceText,
  formatPresenceSubtitle,
  formatTypingLine,
  parsePresenceEnvelope,
  parseTypingEnvelope,
} from './chatTyping';

describe('native chat typing', () => {
  it('parses started and stopped envelopes from the existing socket contract', () => {
    expect(parseTypingEnvelope({
      type: 'chat.typing.started',
      conversation_id: 'c1',
      payload: { user_id: 7, sender_name: 'Мария' },
    })).toEqual({
      conversationId: 'c1',
      userId: 7,
      name: 'Мария',
      isTyping: true,
    });
    expect(parseTypingEnvelope({
      type: 'chat.typing.stopped',
      conversation_id: 'c1',
      payload: { user_id: 7, sender_name: 'Мария', is_typing: false },
    })?.isTyping).toBe(false);
  });

  it('keeps one row per user and formats the header line', () => {
    const first = applyTypingParticipant([], { userId: 7, name: 'Мария' }, true);
    const second = applyTypingParticipant(first, { userId: 8, name: 'Иван' }, true);
    expect(formatTypingLine(second)).toBe('Мария и Иван печатают…');
    expect(formatTypingLine(applyTypingParticipant(second, { userId: 7, name: 'Мария' }, false)))
      .toBe('Иван печатает…');
  });

  it('formats a compact presence subtitle', () => {
    expect(formatPresenceSubtitle({ status: 'online' })).toBe('в сети');
    expect(formatPresenceSubtitle({ last_seen_at: new Date().toISOString() })).toBe('был(а) только что');
    expect(formatPresenceSubtitle(null)).toBe('HUB-IT Chat');
  });

  it('formats a full person presence line like the web profile', () => {
    expect(formatChatPresenceText({ is_online: true })).toBe('В сети');
    expect(formatChatPresenceText({ last_seen_at: new Date().toISOString() })).toBe('Был(а) только что');
    expect(formatChatPresenceText(null)).toBe('Не в сети');
  });

  it('parses a presence update from the existing socket contract', () => {
    expect(parsePresenceEnvelope({
      type: 'chat.presence.updated',
      payload: { user_id: 7, presence: { status: 'online' } },
    })).toEqual({
      userId: 7,
      presence: { status: 'online' },
    });
  });
});
