import { render } from '@testing-library/react-native';
import { HubBottomNav } from './HubBottomNav';

const mockUpdateState = {
  status: 'available',
  currentVersion: '1.1.20',
  currentBuild: '22',
  feed: { version: '1.1.21', versionCode: 23 },
};

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 7 }, hasPermission: () => true }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('../../preferences/PreferencesContext', () => ({
  usePreferences: () => ({ preferences: { theme_mode: 'dark', mobile_bottom_nav_items: ['/menu'] } }),
}));

jest.mock('../../navigation/useNavUnreadCounts', () => ({
  useNavUnreadCounts: () => ({}),
}));

jest.mock('../../navigation/moduleRegistry', () => ({
  openPortalPath: jest.fn(),
}));

jest.mock('../../navigation/mobileNavItems', () => ({
  resolveMobileNavigationItems: () => [{
    path: '/menu',
    shortLabel: 'Меню',
    label: 'Меню',
    icon: 'menu',
  }],
  getVisibleNavigationItems: () => [],
  resolveActiveBottomNavPath: () => '/menu',
  getNavigationBadgeCount: () => 0,
  getMailNavigationBadgeMeta: () => null,
}));

jest.mock('../../updates/useMobileUpdater', () => ({
  hasPendingMobileUpdate: () => true,
  useMobileUpdater: () => ({ state: mockUpdateState }),
}));

describe('HubBottomNav update badge', () => {
  beforeEach(() => {
    mockUpdateState.status = 'available';
  });

  it('shows a dedicated update badge on the Menu tab', async () => {
    const view = await render(<HubBottomNav currentPath="/menu" />);

    expect(view.getByTestId('hub-bottom-nav-update-badge')).toBeTruthy();
    expect(view.getByLabelText('Меню. Доступно обновление приложения')).toBeTruthy();
  });

  it('replaces the arrow with activity while the APK is downloading', async () => {
    mockUpdateState.status = 'downloading';
    const view = await render(<HubBottomNav currentPath="/menu" />);

    expect(view.getByTestId('hub-bottom-nav-update-badge')).toBeTruthy();
    expect(view.getByTestId('hub-bottom-nav-update-spinner')).toBeTruthy();
  });
});
