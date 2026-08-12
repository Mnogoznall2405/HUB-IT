import { describe, expect, it } from 'vitest';

import {
  buildSystemNotificationId,
  createSystemNotificationEnvelope,
  SYSTEM_NOTIFICATION_CHANNELS,
} from './systemNotificationEnvelope';

describe('systemNotificationEnvelope', () => {
  it.each([
    ['chat', '/chat?conversation=conv-1'],
    ['mention', '/chat?conversation=conv-1&message=msg-1'],
    ['task', '/tasks?task=task-1&task_tab=comments'],
    ['feed', '/feed?post=post-1'],
    ['mail', '/mail?folder=inbox&message=mail-1'],
    ['ticket', '/tickets?ticket=ticket-1'],
    ['scan', '/scan-center?incident=scan-1'],
  ])('accepts the %s channel and preserves its local route', (channel, route) => {
    const envelope = createSystemNotificationEnvelope({
      id: buildSystemNotificationId(channel, `${channel}-1`),
      channel,
      title: 'Заголовок',
      body: 'Текст уведомления',
      route,
      created_at: '2026-08-11T12:00:00Z',
      urgency: 'normal',
    });

    expect(envelope).toEqual({
      id: `${channel}:${channel}-1`,
      channel,
      title: 'Заголовок',
      body: 'Текст уведомления',
      route,
      created_at: '2026-08-11T12:00:00.000Z',
      urgency: 'normal',
    });
  });

  it('keeps the supported channel list explicit', () => {
    expect(SYSTEM_NOTIFICATION_CHANNELS).toEqual([
      'chat',
      'mention',
      'task',
      'feed',
      'mail',
      'ticket',
      'scan',
    ]);
  });

  it('normalizes controls and truncates text to bridge v1 limits', () => {
    const envelope = createSystemNotificationEnvelope({
      id: buildSystemNotificationId('task', 'task with spaces/<>'),
      channel: 'task',
      title: `  Новая\nзадача ${'я'.repeat(200)}  `,
      body: `  Строка\tописания ${'б'.repeat(600)}  `,
      route: '/tasks?task=task-1',
      created_at: '2026-08-11T12:00:00+00:00',
      urgency: 'high',
    });

    expect(envelope.id).toBe('task:task_with_spaces___');
    expect(envelope.title).not.toMatch(/[\n\r]/u);
    expect(envelope.body).not.toMatch(/[\t\n\r]/u);
    expect(envelope.title.length).toBeLessThanOrEqual(128);
    expect(envelope.body.length).toBeLessThanOrEqual(512);
    expect(envelope.title.endsWith('…')).toBe(true);
    expect(envelope.body.endsWith('…')).toBe(true);
  });

  it.each([
    { route: 'https://hubit.zsgp.ru/tasks' },
    { route: '//evil.example/path' },
    { route: '/tasks\\evil' },
    { route: '/tasks\u0000' },
    { route: `/${'a'.repeat(1024)}` },
    { channel: 'system' },
    { urgency: 'urgent' },
    { created_at: 'not-a-date' },
    { id: 'task:bad id' },
    { unexpected: true },
  ])('rejects malformed or expanded envelopes: %j', (override) => {
    expect(createSystemNotificationEnvelope({
      id: 'task:task-1',
      channel: 'task',
      title: 'Заголовок',
      body: 'Текст',
      route: '/tasks?task=task-1',
      created_at: '2026-08-11T12:00:00Z',
      urgency: 'normal',
      ...override,
    })).toBeNull();
  });
});
