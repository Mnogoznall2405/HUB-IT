import {
  nativeChatDestinationFromPortalPath,
  parseNativeChatEnabled,
  resolveNativeChatEnabled,
} from './nativeChatFeature';

describe('native Chat feature routing', () => {
  it.each(['1', 'true', 'TRUE', 'yes', 'on'])('enables the feature for %s', (value) => {
    expect(parseNativeChatEnabled(value)).toBe(true);
  });

  it.each([undefined, '', '0', 'false', 'disabled'])('keeps the feature disabled for %s', (value) => {
    expect(parseNativeChatEnabled(value)).toBe(false);
  });

  it('enables the completed native Chat by default but keeps an explicit rollback flag', () => {
    expect(resolveNativeChatEnabled(undefined)).toBe(true);
    expect(resolveNativeChatEnabled('false')).toBe(false);
  });

  it('maps the Chat inbox and conversation paths to native routes', () => {
    expect(nativeChatDestinationFromPortalPath('/chat')).toEqual({ pathname: '/(shell)/chat' });
    expect(nativeChatDestinationFromPortalPath('/chat?conversation=conversation%20one&message=message-7'))
      .toEqual({
        pathname: '/(shell)/chat/[conversationId]',
        params: { conversationId: 'conversation one', messageId: 'message-7' },
      });
  });

  it.each(['/tasks', '//evil.example/chat', 'https://evil.example/chat', '/api/v1/chat'])
  ('does not intercept a non-Chat or unsafe path: %s', (path) => {
    expect(nativeChatDestinationFromPortalPath(path)).toBeNull();
  });
});
