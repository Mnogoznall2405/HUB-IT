import { describe, expect, it } from 'vitest';

import {
  normalizeCapacitorAppUrl,
  normalizePushNotificationRoute,
} from './capacitorLinks';

describe('normalizeCapacitorAppUrl', () => {
  it('keeps same-origin https paths', () => {
    expect(normalizeCapacitorAppUrl('https://hubit.zsgp.ru/chat?conversation=c1')).toBe('/chat?conversation=c1');
  });

  it('rejects external https hosts', () => {
    expect(normalizeCapacitorAppUrl('https://example.com/chat')).toBeNull();
  });

  it('maps hubit task links to app routes', () => {
    expect(normalizeCapacitorAppUrl('hubit://tasks/TASK-42')).toBe('/tasks?task=TASK-42');
  });

  it('maps hubit chat links and preserves message query', () => {
    expect(normalizeCapacitorAppUrl('hubit://chat/conv-1?message=msg-2')).toBe('/chat?message=msg-2&conversation=conv-1');
  });

  it('maps hubit mail links to message_id query', () => {
    expect(normalizeCapacitorAppUrl('hubit://mail/mail-1?mailbox_id=inbox')).toBe('/mail?mailbox_id=inbox&message_id=mail-1');
  });

  it('rejects unknown custom scheme sections', () => {
    expect(normalizeCapacitorAppUrl('hubit://unknown/value')).toBeNull();
  });
});

describe('normalizePushNotificationRoute', () => {
  it('uses direct route from notification data', () => {
    expect(normalizePushNotificationRoute({
      notification: {
        data: { route: '/database?tab=printers' },
      },
    })).toBe('/database?tab=printers');
  });

  it('builds chat route from notification ids', () => {
    expect(normalizePushNotificationRoute({
      notification: {
        data: {
          conversation_id: 'c1',
          message_id: 'm2',
        },
      },
    })).toBe('/chat?conversation=c1&message=m2');
  });

  it('builds task route from notification ids', () => {
    expect(normalizePushNotificationRoute({
      notification: {
        data: { task_id: 'T-7' },
      },
    })).toBe('/tasks?task=T-7');
  });
});
