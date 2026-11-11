import { useEffect, useMemo } from 'react';
import { syncDesktopQuickRoutes, syncDesktopShellStatus } from '../../lib/desktopBridge';
import {
  buildDesktopShellStatus,
  EMPTY_DESKTOP_SHELL_STATUS,
} from '../../lib/desktopShellStatus';

export default function DesktopShellSync({
  authenticated,
  online,
  unreadTotal,
  chatUnread,
  mailUnread,
  tasksAttention,
  quickRoutes = [],
}) {
  const status = useMemo(() => buildDesktopShellStatus({
    authenticated,
    online,
    unreadTotal,
    chatUnread,
    mailUnread,
    tasksAttention,
  }), [
    authenticated,
    chatUnread,
    mailUnread,
    online,
    tasksAttention,
    unreadTotal,
  ]);

  useEffect(() => {
    syncDesktopShellStatus(status);
  }, [status]);

  useEffect(() => {
    syncDesktopQuickRoutes(quickRoutes);
  }, [quickRoutes]);

  useEffect(() => () => {
    syncDesktopShellStatus(EMPTY_DESKTOP_SHELL_STATUS);
    syncDesktopQuickRoutes([]);
  }, []);

  return null;
}
