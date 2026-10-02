import { readNativeChatInboxSnapshot } from '../chat/nativeChatInboxSnapshot';
import {
  buildNotificationCenterItems,
  groupNotificationCenterItems,
  hubNotificationPortalPath,
  mailNotificationPortalPath,
} from './notificationCenter';

jest.mock('../chat/nativeChatInboxSnapshot', () => ({
  readNativeChatInboxSnapshot: jest.fn(async () => null),
}));

const mockedInboxSnapshot = jest.mocked(readNativeChatInboxSnapshot);

describe('native notification center model', () => {
  it('maps supported HUB entities to native portal destinations', async () => {
    await expect(hubNotificationPortalPath({ id: '1', entity_type: 'task', entity_id: 'task/7' }))
      .resolves.toBe('/tasks?task=task%2F7');
    await expect(hubNotificationPortalPath({ id: '2', entity_type: 'announcement', entity_id: 'post-1#comment-2' }))
      .resolves.toBe('/feed?post=post-1#feed-comment-comment-2');
    await expect(hubNotificationPortalPath({
      id: '3',
      entity_type: 'chat',
      entity_id: 'conversation-1',
      payload: { message_id: 'message-2' },
    })).resolves.toBe('/chat?conversation=conversation-1&message=message-2');
    await expect(hubNotificationPortalPath({ id: '4', entity_type: 'unknown', entity_id: 'x' }))
      .resolves.toBe('/dashboard');
    await expect(hubNotificationPortalPath({ id: '5', entity_type: 'docflow', entity_id: 'task-1' }))
      .resolves.toBe('/docflow?task=task-1');
  });

  it('routes AI chat notifications into the ИИ workspace from the payload kind', async () => {
    await expect(hubNotificationPortalPath({
      id: '10',
      entity_type: 'chat',
      entity_id: 'ai-1',
      payload: { conversation_kind: 'ai', message_id: 'message-9' },
    })).resolves.toBe('/chat?conversation=ai-1&message=message-9&workspace=ai');
    await expect(hubNotificationPortalPath({
      id: '11',
      entity_type: 'chat',
      entity_id: 'ai-2',
      payload: { kind: 'ai' },
    })).resolves.toBe('/chat?conversation=ai-2&workspace=ai');
    expect(mockedInboxSnapshot).not.toHaveBeenCalled();
  });

  it('resolves the AI workspace through the cached chat inbox', async () => {
    mockedInboxSnapshot.mockResolvedValueOnce({
      savedAt: 1,
      data: {
        items: [{ id: 'ai-3', kind: 'ai' }, { id: 'direct-1', kind: 'direct' }],
        has_more: false,
        next_cursor: null,
      },
    } as never);
    await expect(hubNotificationPortalPath(
      { id: '12', entity_type: 'chat', entity_id: 'ai-3' },
      { userId: 7 },
    )).resolves.toBe('/chat?conversation=ai-3&workspace=ai');
  });

  it('keeps the current Chat path when the kind is direct or unknown', async () => {
    await expect(hubNotificationPortalPath({
      id: '13',
      entity_type: 'chat',
      entity_id: 'direct-1',
      payload: { conversation_kind: 'direct' },
    })).resolves.toBe('/chat?conversation=direct-1');
    await expect(hubNotificationPortalPath(
      { id: '14', entity_type: 'chat', entity_id: 'missing-1' },
      { userId: 7 },
    )).resolves.toBe('/chat?conversation=missing-1');
    await expect(hubNotificationPortalPath(
      { id: '15', entity_type: 'chat', entity_id: 'no-user-1' },
    )).resolves.toBe('/chat?conversation=no-user-1');
  });

  it('builds a mailbox-scoped web destination for mail', () => {
    expect(mailNotificationPortalPath({ id: 'message/7', mailbox_id: 'box 1' }))
      .toBe('/mail?folder=inbox&message=message%2F7&mailbox_id=box+1');
  });

  it('merges, sorts and groups HUB and mail notifications by day', () => {
    const today = new Date(2026, 7, 24, 12, 0, 0);
    const items = buildNotificationCenterItems(
      [{
        id: 'hub-1',
        title: 'Задача',
        entity_type: 'task',
        unread: 1,
        created_at: new Date(2026, 7, 23, 18, 0, 0).toISOString(),
      }],
      [{
        id: 'mail-1',
        sender: 'Иван',
        subject: 'Отчёт',
        mailbox_id: 'box-1',
        received_at: new Date(2026, 7, 24, 9, 0, 0).toISOString(),
        is_read: false,
      }],
    );

    expect(items.map((item) => item.key)).toEqual(['mail:box-1:mail-1', 'hub:hub-1']);
    expect(groupNotificationCenterItems(items, today).map((section) => section.title))
      .toEqual(['Сегодня', 'Вчера']);
  });
});
