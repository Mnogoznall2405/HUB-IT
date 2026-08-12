import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BrowserNotificationsSettingsCard } from './BrowserNotificationsSettingsCard';

const mocks = vi.hoisted(() => ({
  state: {
    supported: true,
    permission: 'granted',
    enabled: true,
    explicitlySet: true,
  },
  setEnabled: vi.fn(),
}));

vi.mock('../../../../lib/platform', () => ({
  isNativeShellRuntime: () => true,
}));

vi.mock('../../../../lib/windowsNotifications', () => ({
  getWindowsNotificationState: () => mocks.state,
  requestBrowserNotificationPermission: vi.fn(),
  setWindowsNotificationsEnabled: mocks.setEnabled,
  WINDOWS_NOTIFICATIONS_CHANGED_EVENT: 'itinvent:windows-notifications-changed',
}));

describe('BrowserNotificationsSettingsCard in HUB Desktop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state = {
      supported: true,
      permission: 'granted',
      enabled: true,
      explicitlySet: true,
    };
  });

  it('explains hidden-window delivery and the persistent fallback without a second channel model', () => {
    render(<BrowserNotificationsSettingsCard />);

    expect(screen.getByText('Windows-уведомления')).toBeInTheDocument();
    expect(screen.getByText(/окно открыто, свёрнуто или скрыто в tray/i)).toBeInTheDocument();
    expect(screen.getByText(/закреплённую плашку/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Разрешить уведомления' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox'));
    expect(mocks.setEnabled).toHaveBeenCalledWith(false);
  });
});
