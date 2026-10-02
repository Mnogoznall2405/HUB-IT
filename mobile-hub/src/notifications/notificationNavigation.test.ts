import type { NotificationResponse } from 'expo-notifications';
import {
  notificationOpenHrefFromResponse,
  portalPathFromNotificationResponse,
} from './notificationNavigation';

function responseWithData(data: Record<string, unknown>): NotificationResponse {
  return {
    notification: {
      request: {
        content: { data },
      },
    },
  } as NotificationResponse;
}

describe('notification portal navigation', () => {
  it.each([
    ['/tasks?task=42', '/tasks?task=42'],
    ['/mail?folder=inbox&message=one', '/mail?folder=inbox&message=one'],
    ['/feed?post=7#feed-comment-3', '/feed?post=7#feed-comment-3'],
  ])('opens the backend route %s inside the portal', (route, expected) => {
    expect(portalPathFromNotificationResponse(responseWithData({ route }))).toBe(expected);
  });

  it('falls back to a conversation deep link for legacy Chat payloads', () => {
    expect(portalPathFromNotificationResponse(responseWithData({
      conversation_id: 'conversation / one',
    }))).toBe('/chat?conversation=conversation%20%2F%20one');
  });

  it.each([
    'https://evil.example/tasks',
    '//evil.example/tasks',
    '/api/v1/auth/me',
    'javascript:alert(1)',
  ])('rejects an unsafe notification route: %s', (route) => {
    expect(portalPathFromNotificationResponse(responseWithData({ route }))).toBe('/dashboard');
  });

  it('opens the dashboard when the payload has no route', () => {
    expect(portalPathFromNotificationResponse(responseWithData({}))).toBe('/dashboard');
  });

  it('opens the native Chat thread from a Chat push', () => {
    expect(notificationOpenHrefFromResponse(responseWithData({
      route: '/chat?conversation=conversation-2&message=message-7',
    }))).toEqual({
      pathname: '/(shell)/chat/[conversationId]',
      params: { conversationId: 'conversation-2', messageId: 'message-7' },
    });
    expect(notificationOpenHrefFromResponse(responseWithData({
      conversation_id: 'conversation-2',
    }))).toEqual({
      pathname: '/(shell)/chat/[conversationId]',
      params: { conversationId: 'conversation-2' },
    });
  });

  it('opens the native task detail from a task push route', () => {
    expect(notificationOpenHrefFromResponse(responseWithData({
      route: '/tasks?task=task-42',
    }))).toEqual({
      pathname: '/(shell)/tasks/[taskId]',
      params: { taskId: 'task-42' },
    });
  });

  it('routes an AI Chat push into the ИИ workspace', () => {
    expect(portalPathFromNotificationResponse(responseWithData({
      route: '/chat?conversation=ai-1&message=message-7',
      conversation_kind: 'ai',
    }))).toBe('/chat?conversation=ai-1&message=message-7&workspace=ai');
    expect(portalPathFromNotificationResponse(responseWithData({
      conversation_id: 'ai-1',
      conversation_kind: 'ai',
    }))).toBe('/chat?conversation=ai-1&workspace=ai');
  });

  it('does not duplicate workspace when the Chat route already carries it', () => {
    expect(portalPathFromNotificationResponse(responseWithData({
      route: '/chat?conversation=ai-1&workspace=ai',
      conversation_kind: 'ai',
    }))).toBe('/chat?conversation=ai-1&workspace=ai');
  });

  it('leaves non-AI routes and conversations unchanged', () => {
    expect(portalPathFromNotificationResponse(responseWithData({
      route: '/tasks?task=42',
      conversation_kind: 'ai',
    }))).toBe('/tasks?task=42');
    expect(portalPathFromNotificationResponse(responseWithData({
      conversation_id: 'conversation-2',
      conversation_kind: 'direct',
    }))).toBe('/chat?conversation=conversation-2');
  });

  it('opens the native AI thread with the workspace param', () => {
    expect(notificationOpenHrefFromResponse(responseWithData({
      conversation_id: 'ai-1',
      conversation_kind: 'ai',
    }))).toEqual({
      pathname: '/(shell)/chat/[conversationId]',
      params: { conversationId: 'ai-1', workspace: 'ai' },
    });
  });
});
