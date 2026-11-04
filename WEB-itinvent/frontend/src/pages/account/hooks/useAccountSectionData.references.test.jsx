import { renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const getAvailableDatabases = vi.hoisted(() => vi.fn());

vi.mock('@mui/material', () => ({ useMediaQuery: () => true }));
vi.mock('../../../api/client', () => ({ authAPI: {}, settingsAPI: {} }));
vi.mock('../../../api/passwords', () => ({ passwordsAPI: {} }));
vi.mock('../../../api/database', () => ({ databaseAPI: { getAvailableDatabases } }));
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
    user: { id: 69, username: 'koshkina_av', role: 'viewer' },
    hasPermission: (permission) => permission === 'database.references.manage',
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
    usePreferences: () => ({
      preferences: { theme_mode: 'light', font_family: 'Aptos', font_scale: 1, mobile_bottom_nav_items: [] },
      savePreferences: vi.fn(),
    }),
  };
});

import { useAccountSectionData } from './useAccountSectionData';

const wrapper = ({ children }) => (
  <MemoryRouter initialEntries={['/admin/references']}>
    <Routes>
      <Route path="/admin/:section" element={children} />
    </Routes>
  </MemoryRouter>
);

describe('useAccountSectionData references section', () => {
  it('loads the ITINVENT databases for a user who can only manage references', async () => {
    getAvailableDatabases.mockResolvedValue([{ id: 'ITINVENT', name: 'ITINVENT' }]);

    const { result } = renderHook(() => useAccountSectionData('admin'), { wrapper });

    expect(result.current.activeSection).toBe('references');
    await waitFor(() => expect(result.current.dbOptions).toEqual([{ id: 'ITINVENT', name: 'ITINVENT' }]));
  });
});
