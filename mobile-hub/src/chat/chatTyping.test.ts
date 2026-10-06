import {
  applyTypingParticipant,
  formatChatPresenceText,
  formatPresenceSubtitle,
  formatTypingLine,
  formatTypingStatus,
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
      expiresInMs: 5000,
    });
    // R-TYPING-2: server TTL is honoured instead of a fixed client guess.
    expect(parseTypingEnvelope({
      type: 'chat.typing.started',
      conversation_id: 'c1',
      payload: { user_id: 7, sender_name: 'Мария', expires_in_ms: 9000 },
    })?.expiresInMs).toBe(9000);
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
    expect(formatPresenceSubtitle(null)).toBe('');
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

describe('formatTypingStatus (conversation header)', () => {
  const maria = { userId: 1, name: 'Иванова Мария Петровна' };
  const ivan = { userId: 2, name: 'Сидоров Иван Олегович' };

  it('says only "печатает" in a direct chat — the title already names the person', () => {
    expect(formatTypingStatus([maria], 'direct')).toBe('печатает');
  });

  it('names the typist as "Фамилия Имя" without the patronymic in a group', () => {
    expect(formatTypingStatus([maria], 'group')).toBe('Иванова Мария печатает');
    expect(formatTypingStatus([maria, ivan], 'group')).toBe('Иванова Мария и Сидоров Иван печатают');
    expect(formatTypingStatus([maria, ivan, { userId: 3, name: 'Петров Пётр' }], 'group')).toBe('Иванова Мария и ещё 2 печатают');
  });

  it('is empty when nobody types', () => {
    expect(formatTypingStatus([], 'group')).toBe('');
  });
});
