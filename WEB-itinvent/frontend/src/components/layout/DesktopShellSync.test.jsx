import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { syncDesktopQuickRoutes, syncDesktopShellStatus } from '../../lib/desktopBridge';
import DesktopShellSync from './DesktopShellSync';

vi.mock('../../lib/desktopBridge', () => ({
  syncDesktopQuickRoutes: vi.fn(),
  syncDesktopShellStatus: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DesktopShellSync', () => {
  it('publishes authoritative counters and clears them when the layout unmounts', () => {
    const view = render(
      <DesktopShellSync
        authenticated
        online
        unreadTotal={7}
        chatUnread={4}
        mailUnread={2}
        tasksAttention={1}
        quickRoutes={[
          { id: 'tasks', label: 'Задачи', route: '/tasks', badge: 3 },
        ]}
      />,
    );

    expect(syncDesktopShellStatus).toHaveBeenLastCalledWith({
      authenticated: true,
      online: true,
      unread_total: 7,
      chat_unread: 4,
      mail_unread: 2,
      tasks_attention: 1,
    });
    expect(syncDesktopQuickRoutes).toHaveBeenLastCalledWith([
      { id: 'tasks', label: 'Задачи', route: '/tasks', badge: 3 },
    ]);

    view.unmount();
    expect(syncDesktopShellStatus).toHaveBeenLastCalledWith({
      authenticated: false,
      online: false,
      unread_total: 0,
      chat_unread: 0,
      mail_unread: 0,
      tasks_attention: 0,
    });
    expect(syncDesktopQuickRoutes).toHaveBeenLastCalledWith([]);
  });
});
