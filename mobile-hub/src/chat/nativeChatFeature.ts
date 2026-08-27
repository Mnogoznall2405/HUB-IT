export type NativeChatDestination =
  | { pathname: '/(shell)/chat' }
  | {
      pathname: '/(shell)/chat/[conversationId]';
      params: { conversationId: string; messageId?: string };
    };

export function parseNativeChatEnabled(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

export function resolveNativeChatEnabled(value: string | undefined): boolean {
  return value === undefined ? true : parseNativeChatEnabled(value);
}

export const NATIVE_CHAT_ENABLED = resolveNativeChatEnabled(process.env.EXPO_PUBLIC_NATIVE_CHAT_ENABLED);

export function nativeChatDestinationFromPortalPath(path: string): NativeChatDestination | null {
  const raw = String(path || '').trim();
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw, 'https://hubit.invalid');
  } catch {
    return null;
  }
  if (parsed.origin !== 'https://hubit.invalid' || parsed.pathname !== '/chat') return null;

  const conversationId = String(
    parsed.searchParams.get('conversation')
      || parsed.searchParams.get('conversation_id')
      || '',
  ).trim();
  if (!conversationId) return { pathname: '/(shell)/chat' };

  const messageId = String(
    parsed.searchParams.get('message')
      || parsed.searchParams.get('message_id')
      || '',
  ).trim();
  return {
    pathname: '/(shell)/chat/[conversationId]',
    params: {
      conversationId,
      ...(messageId ? { messageId } : {}),
    },
  };
}
