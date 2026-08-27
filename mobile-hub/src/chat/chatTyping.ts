export type TypingParticipant = {
  userId: number;
  name: string;
};

export type TypingEnvelope = {
  type?: string;
  conversation_id?: string;
  payload?: {
    user_id?: number;
    sender_name?: string;
    is_typing?: boolean;
    conversation_id?: string;
  };
};

export function parseTypingEnvelope(envelope: unknown): {
  conversationId: string;
  userId: number;
  name: string;
  isTyping: boolean;
} | null {
  const value = (envelope || {}) as TypingEnvelope;
  const payload = value.payload || {};
  const conversationId = String(value.conversation_id || payload.conversation_id || '').trim();
  const userId = Number(payload.user_id || 0);
  const name = String(payload.sender_name || '').trim();
  if (!conversationId || !Number.isInteger(userId) || userId <= 0) return null;
  const isTyping = String(value.type || '').trim() === 'chat.typing.started' || Boolean(payload.is_typing);
  if (String(value.type || '').trim() === 'chat.typing.stopped') {
    return { conversationId, userId, name, isTyping: false };
  }
  return { conversationId, userId, name, isTyping };
}

export function applyTypingParticipant(
  current: TypingParticipant[],
  next: TypingParticipant,
  isTyping: boolean,
): TypingParticipant[] {
  const without = current.filter((item) => item.userId !== next.userId);
  if (!isTyping) return without;
  return [...without, { userId: next.userId, name: next.name || 'Участник' }];
}

export function formatTypingLine(participants: TypingParticipant[]): string {
  const names = participants.map((item) => item.name).filter(Boolean);
  if (!names.length) return '';
  if (names.length === 1) return `${names[0]} печатает…`;
  if (names.length === 2) return `${names[0]} и ${names[1]} печатают…`;
  return `${names[0]} и ещё ${names.length - 1} печатают…`;
}

export function parsePresenceEnvelope(envelope: unknown): {
  userId: number;
  presence: {
    status?: string;
    is_online?: boolean;
    last_seen_at?: string | null;
  };
} | null {
  const payload = ((envelope || {}) as { payload?: {
    user_id?: number;
    presence?: {
      status?: string;
      is_online?: boolean;
      last_seen_at?: string | null;
    };
  } }).payload || {};
  const userId = Number(payload.user_id || 0);
  if (!Number.isInteger(userId) || userId <= 0 || !payload.presence) return null;
  return { userId, presence: payload.presence };
}

export function isChatPresenceOnline(presence?: {
  status?: string;
  is_online?: boolean;
  last_seen_at?: string | null;
} | null): boolean {
  return Boolean(presence?.is_online || presence?.status === 'online');
}

export function formatChatPresenceText(presence?: {
  status?: string;
  is_online?: boolean;
  last_seen_at?: string | null;
} | null): string {
  if (!presence) return 'Не в сети';
  if (isChatPresenceOnline(presence)) return 'В сети';
  const raw = String(presence.last_seen_at || '').trim();
  if (!raw) return 'Не в сети';
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return 'Не в сети';
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) return 'Был(а) только что';
  if (diffMs < 60 * 60 * 1000) return `Был(а) ${Math.max(1, Math.floor(diffMs / 60_000))} мин назад`;
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return `Сегодня в ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return `Вчера в ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
  }
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatPresenceSubtitle(presence?: {
  status?: string;
  is_online?: boolean;
  last_seen_at?: string | null;
} | null): string {
  if (!presence) return 'HUB-IT Chat';
  if (isChatPresenceOnline(presence)) return 'в сети';
  const raw = String(presence.last_seen_at || '').trim();
  if (!raw) return 'не в сети';
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return 'не в сети';
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) return 'был(а) только что';
  if (diffMs < 60 * 60 * 1000) return `был(а) ${Math.max(1, Math.floor(diffMs / 60_000))} мин назад`;
  return 'не в сети';
}
