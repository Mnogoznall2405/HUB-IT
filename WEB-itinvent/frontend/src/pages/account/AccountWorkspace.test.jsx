import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const accountState = vi.hoisted(() => ({ activeSection: 'app', mobileApp: false, databasesError: '', retryDatabases: vi.fn() }));

vi.mock('../../lib/mobileAppBridge', () => ({
  isMobileAppWebViewRuntime: () => accountState.mobileApp,
}));

vi.mock('../../components/account/AccountCategoryLayout', () => ({
  default: ({ children, blockingError }) => <main>{blockingError}{children}</main>,
}));

vi.mock('../../components/desktop/DesktopInstallerDownload', () => ({
  default: ({ variant }) => <div data-testid="desktop-download" data-variant={variant} />,
}));

vi.mock('../../components/mobile/MobileInstallerDownload', () => ({
  default: ({ variant }) => <div data-testid="mobile-download" data-variant={variant} />,
}));

vi.mock('./settings/HubItPwaSettingsCard', () => ({
  default: () => <div data-testid="pwa-settings" />,
}));

vi.mock('./settings/MobileNativeAppSettingsCard', () => ({
  default: () => <div data-testid="native-app-settings" />,
}));

vi.mock('./settings/notifications/NotificationChannelsSettingsCard', () => ({
  NotificationChannelsSettingsCard: ({ embedded }) => <div data-testid="notification-channels" data-embedded={embedded} />,
}));

vi.mock('./settings/notifications/ChatNotificationsSettingsCard', () => ({
  ChatNotificationsSettingsCard: ({ embedded }) => <div data-testid="chat-delivery" data-embedded={embedded} />,
}));

vi.mock('./settings/notifications/BrowserNotificationsSettingsCard', () => ({
  BrowserNotificationsSettingsCard: ({ embedded }) => <div data-testid="device-delivery" data-embedded={embedded} />,
}));

vi.mock('./settings/notifications/MobileNativeNotificationsSettingsCard', () => ({
  MobileNativeNotificationsSettingsCard: ({ embedded }) => <div data-testid="native-notifications" data-embedded={embedded} />,
}));

vi.mock('../About', () => ({
  default: ({ mode }) => <div data-testid="about-presentation" data-mode={mode} />,
}));

vi.mock('./hooks/useAccountSectionData', () => ({
  useAccountSectionData: () => ({
    activeSection: accountState.activeSection,
    backupCodes: [],
    backupCodesDialogOpen: false,
    blockingError: '',
    databasesError: accountState.databasesError,
    retryDatabases: accountState.retryDatabases,
    setBackupCodesDialogOpen: vi.fn(),
    setBlockingError: vi.fn(),
    user: {},
  }),
}));

import Settings from './AccountWorkspace';

describe('Application settings', () => {
  beforeEach(() => {
    accountState.activeSection = 'app';
    accountState.mobileApp = false;
    accountState.databasesError = '';
    accountState.retryDatabases.mockClear();
  });

  it('offers a manual retry when database loading fails', () => {
    accountState.databasesError = 'Не удалось загрузить список баз данных.';
    render(<Settings />);
    expect(screen.getByText(accountState.databasesError)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить загрузку баз' }));
    expect(accountState.retryDatabases).toHaveBeenCalledTimes(1);
  });

  it('shows self-update controls inside APK instead of a second APK download card', () => {
    accountState.mobileApp = true;
    render(<Settings />);

    expect(screen.getByTestId('native-app-settings')).toBeInTheDocument();
    expect(screen.queryByTestId('mobile-download')).not.toBeInTheDocument();
  });

  it('keeps Android, Desktop and PWA as separate application choices', () => {
    render(<Settings />);

    expect(screen.getByTestId('mobile-download')).toHaveAttribute('data-variant', 'settings');
    expect(screen.getByTestId('desktop-download')).toHaveAttribute('data-variant', 'settings');
    expect(screen.getByTestId('pwa-settings')).toBeInTheDocument();
  });

  it('embeds the full HUB-IT presentation in the About section', () => {
    accountState.activeSection = 'about';
    render(<Settings />);

    expect(screen.getByTestId('about-presentation')).toHaveAttribute('data-mode', 'embedded');
  });

  it('groups all notification controls into one settings card', () => {
    accountState.activeSection = 'notifications';
    render(<Settings />);

    expect(screen.getAllByText('Уведомления')).toHaveLength(1);
    expect(screen.getByTestId('notification-channels')).toHaveAttribute('data-embedded', 'true');
    expect(screen.getByTestId('chat-delivery')).toHaveAttribute('data-embedded', 'true');
    expect(screen.getByTestId('device-delivery')).toHaveAttribute('data-embedded', 'true');
  });

  it('uses Android notification controls inside APK and hides browser delivery controls', () => {
    accountState.activeSection = 'notifications';
    accountState.mobileApp = true;
    render(<Settings />);

    expect(screen.getByTestId('notification-channels')).toBeInTheDocument();
    expect(screen.getByTestId('native-notifications')).toHaveAttribute('data-embedded', 'true');
    expect(screen.queryByTestId('chat-delivery')).not.toBeInTheDocument();
    expect(screen.queryByTestId('device-delivery')).not.toBeInTheDocument();
  });
});
