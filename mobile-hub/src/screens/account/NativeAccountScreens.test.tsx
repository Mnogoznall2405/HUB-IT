import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { NativeAdminHubScreen } from './NativeAdminHubScreen';
import { NativeAppearanceSettingsScreen } from './NativeAppearanceSettingsScreen';
import { NativeSettingsHubScreen } from './NativeSettingsHubScreen';
import { DEFAULT_PREFERENCES, type UserPreferences } from '../../preferences/preferenceNormalizers';

let mockAuth: {
  user: { id: number; username: string; role: string; permissions: string[] };
  hasPermission: (permission: string) => boolean;
};

let mockPreferences: {
  preferences: UserPreferences;
  loading: boolean;
  refreshPreferences: jest.Mock;
  savePreferences: jest.Mock;
};

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => mockAuth,
}));

jest.mock('../../preferences/PreferencesContext', () => ({
  usePreferences: () => mockPreferences,
}));

function setAdminAuth() {
  mockAuth = {
    user: { id: 1, username: 'admin', role: 'admin', permissions: [] },
    hasPermission: () => false,
  };
}

describe('native account hubs', () => {
  beforeEach(() => {
    mockPreferences = {
      preferences: { ...DEFAULT_PREFERENCES },
      loading: false,
      refreshPreferences: jest.fn(),
      savePreferences: jest.fn(async (patch: Partial<UserPreferences>) => ({
        ...DEFAULT_PREFERENCES,
        ...patch,
      })),
    };
  });

  it('shows all five personal settings sections', async () => {
    setAdminAuth();
    const view = await render(<NativeSettingsHubScreen />);
    expect(view.getByTestId('native-settings-section-appearance')).toBeTruthy();
    expect(view.getByTestId('native-settings-section-notifications')).toBeTruthy();
    expect(view.getByTestId('native-settings-section-security')).toBeTruthy();
    expect(view.getByTestId('native-settings-section-app')).toBeTruthy();
    expect(view.getByTestId('native-settings-section-about')).toBeTruthy();
  });

  it('shows only native admin sections to an admin', async () => {
    setAdminAuth();
    const view = await render(<NativeAdminHubScreen />);
    expect(view.getByTestId('native-admin-section-users')).toBeTruthy();
    expect(view.getByTestId('native-admin-section-departments')).toBeTruthy();
    expect(view.getByTestId('native-admin-section-sessions')).toBeTruthy();
    expect(view.queryByTestId('native-admin-section-ad-users')).toBeNull();
    expect(view.queryByTestId('native-admin-section-ai-bots')).toBeNull();
    expect(view.queryByTestId('native-admin-section-system')).toBeNull();
  });

  it('hides Users for an operator without settings.users.manage', async () => {
    mockAuth = {
      user: {
        id: 8,
        username: 'operator',
        role: 'operator',
        permissions: ['departments.manage'],
      },
      hasPermission: (permission) => permission === 'departments.manage',
    };
    const view = await render(<NativeAdminHubScreen />);
    expect(view.getByTestId('native-admin-section-departments')).toBeTruthy();
    expect(view.queryByTestId('native-admin-section-users')).toBeNull();
    expect(view.queryByTestId('native-admin-section-system')).toBeNull();
  });
});

describe('native appearance settings', () => {
  beforeEach(() => {
    mockAuth = {
      user: {
        id: 1,
        username: 'admin',
        role: 'admin',
        permissions: ['dashboard.read', 'tasks.read', 'chat.read', 'mail.access'],
      },
      hasPermission: () => true,
    };
    mockPreferences = {
      preferences: { ...DEFAULT_PREFERENCES },
      loading: false,
      refreshPreferences: jest.fn(),
      savePreferences: jest.fn(async (patch: Partial<UserPreferences>) => ({
        ...DEFAULT_PREFERENCES,
        ...patch,
      })),
    };
  });

  it('saves the selected theme immediately', async () => {
    const view = await render(<NativeAppearanceSettingsScreen />);
    await act(async () => {
      fireEvent.press(view.getByTestId('native-theme-dark'));
    });
    await waitFor(() => {
      expect(mockPreferences.savePreferences).toHaveBeenCalledWith({ theme_mode: 'dark' });
    });
  });
});
