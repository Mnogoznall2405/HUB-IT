import { act, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  preferences: { theme_mode: 'light', font_family: 'Aptos', font_scale: 1, mobile_bottom_nav_items: [] },
}));

vi.mock('@mui/material', () => ({ useMediaQuery: () => false }));
vi.mock('../../../api/client', () => ({ authAPI: {}, settingsAPI: {} }));
vi.mock('../../../api/passwords', () => ({ passwordsAPI: {} }));
vi.mock('../../../api/database', () => ({ databaseAPI: { getAvailableDatabases: vi.fn().mockResolvedValue([]) } }));
vi.mock('../../../lib/passkeyWebAuthn', () => ({ isPasskeyRegistrationAvailable: () => false }));
vi.mock('../../../lib/trustedDeviceEnrollment', () => ({
  buildDefaultTrustedDeviceLabel: () => '',
  extractWebAuthnErrorMessage: () => '',
  normalizeWebAuthnErrorName: () => '',
  registerTrustedDevice: vi.fn(),
  resolveTrustedDeviceRegistrationMode: () => ({ platformOnly: false }),
}));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'ivanov', role: 'user' },
    hasPermission: () => false,
    refreshSession: vi.fn(),
    logout: vi.fn(),
  }),
}));
vi.mock('../../../contexts/NotificationContext', () => ({
  useNotification: () => ({
    notifySuccess: vi.fn(), notifyInfo: vi.fn(), notifyApiError: vi.fn(),
  }),
}));
vi.mock('../../../contexts/PreferencesContext', async () => {
  const actual = await vi.importActual('../../../contexts/PreferencesContext');
  return {
    ...actual,
    usePreferences: () => ({ preferences: state.preferences, savePreferences: vi.fn() }),
  };
});

import { useAccountSectionData } from './useAccountSectionData';

const wrapper = ({ children }) => <MemoryRouter>{children}</MemoryRouter>;

describe('useAccountSectionData appearance draft', () => {
  beforeEach(() => {
    state.preferences = { theme_mode: 'light', font_family: 'Aptos', font_scale: 1, mobile_bottom_nav_items: [] };
  });

  it('keeps unsaved appearance edits when preferences are refreshed with identical values', () => {
    const { result, rerender } = renderHook(() => useAccountSectionData('settings'), { wrapper });
    expect(result.current.themeMode).toBe('light');

    act(() => { result.current.setThemeMode('dark'); });
    expect(result.current.themeMode).toBe('dark');

    // Provider refresh (e.g. auth-changed): a new object with the very same stored values.
    state.preferences = { ...state.preferences };
    rerender();

    expect(result.current.themeMode).toBe('dark');
  });

  it('adopts new stored values once they differ from the last synced ones', () => {
    const { result, rerender } = renderHook(() => useAccountSectionData('settings'), { wrapper });
    act(() => { result.current.setThemeMode('dark'); });

    state.preferences = { ...state.preferences, theme_mode: 'system', font_scale: 1.25 };
    rerender();

    expect(result.current.themeMode).toBe('system');
    expect(result.current.fontScale).toBe(1.25);
  });
});
