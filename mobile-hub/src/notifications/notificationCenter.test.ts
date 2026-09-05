import {
  buildNotificationCenterItems,
  groupNotificationCenterItems,
  hubNotificationPortalPath,
  mailNotificationPortalPath,
} from './notificationCenter';

describe('native notification center model', () => {
  it('maps supported HUB entities to native portal destinations', () => {
    expect(hubNotificationPortalPath({ id: '1', entity_type: 'task', entity_id: 'task/7' }))
      .toBe('/tasks?task=task%2F7');
    expect(hubNotificationPortalPath({ id: '2', entity_type: 'announcement', entity_id: 'post-1#comment-2' }))
      .toBe('/feed?post=post-1#feed-comment-comment-2');
    expect(hubNotificationPortalPath({
      id: '3',
      entity_type: 'chat',
      entity_id: 'conversation-1',
      payload: { message_id: 'message-2' },
    })).toBe('/chat?conversation=conversation-1&message=message-2');
    expect(hubNotificationPortalPath({ id: '4', entity_type: 'unknown', entity_id: 'x' }))
      .toBe('/dashboard');
    expect(hubNotificationPortalPath({ id: '5', entity_type: 'docflow', entity_id: 'task-1' }))
      .toBe('/docflow?task=task-1');
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
