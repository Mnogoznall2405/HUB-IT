import { act, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// FE-0232: a failed bulk delegate load must not turn into an empty
// `task_delegate_links` that a later save writes back, erasing real links.

const {
  mockGetUsers,
  mockGetTaskDelegatesBulk,
  mockGetSessions,
  mockUpdateUser,
  mockUpdateTaskDelegates,
  mockNotifySuccess,
  mockNotifyInfo,
  mockNotifyApiError,
  mockRefreshSession,
} = vi.hoisted(() => ({
  mockGetUsers: vi.fn(),
  mockGetTaskDelegatesBulk: vi.fn(),
  mockGetSessions: vi.fn(),
  mockUpdateUser: vi.fn(),
  mockUpdateTaskDelegates: vi.fn(),
  mockNotifySuccess: vi.fn(),
  mockNotifyInfo: vi.fn(),
  mockNotifyApiError: vi.fn(),
  mockRefreshSession: vi.fn(),
}));

vi.mock('@mui/material', () => ({ useMediaQuery: () => false }));
vi.mock('../../../api/client', () => ({
  authAPI: {
    getUsers: mockGetUsers,
    getTaskDelegatesBulk: mockGetTaskDelegatesBulk,
    getSessions: mockGetSessions,
    updateUser: mockUpdateUser,
    updateTaskDelegates: mockUpdateTaskDelegates,
  },
  settingsAPI: {},
}));
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
    user: { id: 1, username: 'admin', role: 'admin' },
    hasPermission: () => true,
    refreshSession: mockRefreshSession,
    logout: vi.fn(),
  }),
}));
vi.mock('../../../contexts/NotificationContext', () => ({
  useNotification: () => ({
    notifySuccess: mockNotifySuccess,
    notifyInfo: mockNotifyInfo,
    notifyApiError: mockNotifyApiError,
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
  <MemoryRouter initialEntries={['/admin/users']}>
    <Routes>
      <Route path="/admin/:section" element={children} />
    </Routes>
  </MemoryRouter>
);

const OWNER = { id: 11, username: 'owner', role: 'viewer' };
const makeDraft = () => ({
  id: 11,
  username: 'owner',
  role: 'viewer',
  is_active: true,
  auth_source: 'local',
  task_delegate_links: [],
});

describe('useAccountSectionData delegate-save guard (FE-0232)', () => {
  beforeEach(() => {
    [
      mockGetUsers, mockGetTaskDelegatesBulk, mockGetSessions, mockUpdateUser,
      mockUpdateTaskDelegates, mockNotifySuccess, mockNotifyInfo,
      mockNotifyApiError, mockRefreshSession,
    ].forEach((fn) => fn.mockReset());
    mockGetUsers.mockResolvedValue([OWNER]);
    mockGetSessions.mockResolvedValue([]);
    mockUpdateUser.mockResolvedValue({ ...OWNER });
    mockUpdateTaskDelegates.mockResolvedValue({ ok: true });
  });

  async function renderUsersHook() {
    const hook = renderHook(() => useAccountSectionData('admin'), { wrapper });
    await waitFor(() => {
      expect(hook.result.current.usersLoading).toBe(false);
    });
    return hook;
  }

  it('does not send an empty delegate list when the bulk load failed', async () => {
    mockGetTaskDelegatesBulk.mockRejectedValue(new Error('500 bulk failure'));

    const { result } = await renderUsersHook();
    expect(result.current.users).toHaveLength(1);
    expect(result.current.users[0].task_delegate_links).toEqual([]);

    let saveResult;
    await act(async () => {
      saveResult = await result.current.handleUpdateUser(makeDraft());
    });

    expect(saveResult.ok).toBe(true);
    expect(mockUpdateUser).toHaveBeenCalledWith(11, expect.objectContaining({ role: 'viewer' }));
    // The empty draft must never be written over real server-side links.
    expect(mockUpdateTaskDelegates).not.toHaveBeenCalled();
    expect(mockNotifyInfo).toHaveBeenCalledWith(
      expect.stringContaining('Связи помощников'),
      expect.anything(),
    );
  });

  it('still sends delegate links after a successful bulk load (control)', async () => {
    mockGetTaskDelegatesBulk.mockResolvedValue({
      items: [{
        owner_user_id: 11,
        task_delegate_links: [{ delegate_user_id: '12', role_type: 'assistant', is_active: true }],
      }],
    });

    const { result } = await renderUsersHook();
    expect(result.current.users[0].task_delegate_links).toHaveLength(1);

    await act(async () => {
      await result.current.handleUpdateUser({
        ...makeDraft(),
        task_delegate_links: [{ delegate_user_id: '12', role_type: 'assistant' }],
      });
    });

    expect(mockUpdateTaskDelegates).toHaveBeenCalledWith(11, [
      { delegate_user_id: 12, role_type: 'assistant', is_active: true },
    ]);
  });

  it('sends delegate updates again once a later load succeeds', async () => {
    mockGetTaskDelegatesBulk.mockRejectedValueOnce(new Error('transient 500'));
    mockGetTaskDelegatesBulk.mockResolvedValue({ items: [] });

    const { result } = await renderUsersHook();

    // First save while the flag is set: PUT skipped, but the post-save
    // loadUsers() retry succeeds and clears the flag.
    await act(async () => {
      await result.current.handleUpdateUser(makeDraft());
    });
    expect(mockUpdateTaskDelegates).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.handleUpdateUser({
        ...makeDraft(),
        task_delegate_links: [{ delegate_user_id: '9', role_type: 'deputy' }],
      });
    });
    expect(mockUpdateTaskDelegates).toHaveBeenCalledWith(11, [
      { delegate_user_id: 9, role_type: 'deputy', is_active: true },
    ]);
  });
});
