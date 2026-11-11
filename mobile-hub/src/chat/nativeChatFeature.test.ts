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

  it('carries a valid workspace into the Chat inbox and thread routes', () => {
    expect(nativeChatDestinationFromPortalPath('/chat?workspace=ai'))
      .toEqual({ pathname: '/(shell)/chat', params: { workspace: 'ai' } });
    expect(nativeChatDestinationFromPortalPath('/chat?conversation=c-1&message=m-1&workspace=chats'))
      .toEqual({
        pathname: '/(shell)/chat/[conversationId]',
        params: { conversationId: 'c-1', messageId: 'm-1', workspace: 'chats' },
      });
  });

  it.each([
    ['/chat?workspace=bogus', { pathname: '/(shell)/chat' }],
    ['/chat?workspace=', { pathname: '/(shell)/chat' }],
    [
      '/chat?conversation=c-1&workspace=admin',
      { pathname: '/(shell)/chat/[conversationId]', params: { conversationId: 'c-1' } },
    ],
  ])('ignores an invalid workspace: %s', (path, expected) => {
    expect(nativeChatDestinationFromPortalPath(path)).toEqual(expected);
  });
});
