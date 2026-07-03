import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetStatus,
  mockGetMatrix,
  mockGetGroup,
  mockHasPermission,
  mockNotifyApiError,
  mockUseMediaQuery,
  mockAuthUser,
} = vi.hoisted(() => ({
  mockGetStatus: vi.fn(),
  mockGetMatrix: vi.fn(),
  mockGetGroup: vi.fn(),
  mockHasPermission: vi.fn((permission) => permission === 'groups_access.read'),
  mockNotifyApiError: vi.fn(),
  mockUseMediaQuery: vi.fn(() => false),
  mockAuthUser: {
    id: 1,
    username: 'admin',
    role: 'admin',
  },
}));

vi.mock('@mui/material/useMediaQuery', () => ({
  default: mockUseMediaQuery,
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: mockAuthUser,
    hasPermission: mockHasPermission,
  }),
}));

vi.mock('../contexts/NotificationContext', () => ({
  useNotification: () => ({
    notifySuccess: vi.fn(),
    notifyApiError: mockNotifyApiError,
  }),
}));

vi.mock('../components/layout/MainLayout', () => ({
  default: ({ children }) => <div data-testid="main-layout">{children}</div>,
}));

vi.mock('../components/layout/PageShell', () => ({
  default: ({ title, children }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));

vi.mock('../api/groupsAccess', () => ({
  groupsAccessAPI: {
    getStatus: mockGetStatus,
    getMatrix: mockGetMatrix,
    getGroup: mockGetGroup,
    refresh: vi.fn(),
  },
}));

import GroupsAccess from './GroupsAccess';

const renderPage = () => render(
  <MemoryRouter>
    <ThemeProvider theme={createTheme()}>
      <GroupsAccess />
    </ThemeProvider>
  </MemoryRouter>,
);

describe('GroupsAccess', () => {
  beforeEach(() => {
    mockGetStatus.mockReset();
    mockGetMatrix.mockReset();
    mockGetGroup.mockReset();
    mockNotifyApiError.mockReset();
    mockUseMediaQuery.mockReturnValue(false);

    mockGetStatus.mockResolvedValue({
      status: 'ok',
      last_sync_at: '2026-07-03T10:00:00Z',
      summary: { group_count: 1, user_count: 1 },
    });
    mockGetMatrix.mockResolvedValue({
      items: [
        {
          dn: 'CN=Designers,OU=SPb,OU=Groups,DC=zsgp,DC=corp',
          cn: 'Designers',
          branch: 'SPb',
          folder_label: 'Designers',
          folder_path: 'Resources / Designers',
          access_level: 'member',
          member_count: 1,
        },
      ],
      total: 1,
    });
    mockGetGroup.mockResolvedValue({
      status: 'ok',
      group: {
        dn: 'CN=Designers,OU=SPb,OU=Groups,DC=zsgp,DC=corp',
        cn: 'Designers',
        branch: 'SPb',
        folder_label: 'Designers',
        folder_path: 'Resources / Designers',
        access_level: 'member',
      },
      members: [{ login: 'petrov_p', display_name: 'Петров П.П.' }],
    });
  });

  it('renders page with folder path and selected group members', async () => {
    renderPage();

    expect(await screen.findByText('Доступ к папкам')).toBeInTheDocument();
    await waitFor(() => expect(mockGetMatrix).toHaveBeenCalled());
    expect(screen.getAllByText('Designers').length).toBeGreaterThan(0);
    expect(await screen.findByText('petrov_p')).toBeInTheDocument();
  });
});
