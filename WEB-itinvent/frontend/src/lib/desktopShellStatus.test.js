import { describe, expect, it } from 'vitest';
import { buildDesktopShellStatus, EMPTY_DESKTOP_SHELL_STATUS } from './desktopShellStatus';

describe('desktopShellStatus', () => {
  it('builds the strict shell status without summing category counters', () => {
    expect(buildDesktopShellStatus({
      authenticated: true,
      online: true,
      unreadTotal: 7,
      chatUnread: 4,
      mailUnread: 2,
      tasksAttention: 1,
    })).toEqual({
      authenticated: true,
      online: true,
      unread_total: 7,
      chat_unread: 4,
      mail_unread: 2,
      tasks_attention: 1,
    });
  });

  it('normalizes API-shaped values to bounded integer counters', () => {
    expect(buildDesktopShellStatus({
      authenticated: 1,
      online: 0,
      unreadTotal: '12',
      chatUnread: -4,
      mailUnread: 10001,
      tasksAttention: 2.9,
    })).toEqual({
      authenticated: true,
      online: false,
      unread_total: 12,
      chat_unread: 0,
      mail_unread: 9999,
      tasks_attention: 2,
    });
  });

  it('provides an anonymous zero state for logout', () => {
    expect(EMPTY_DESKTOP_SHELL_STATUS).toEqual({
      authenticated: false,
      online: false,
      unread_total: 0,
      chat_unread: 0,
      mail_unread: 0,
      tasks_attention: 0,
    });
  });
});
