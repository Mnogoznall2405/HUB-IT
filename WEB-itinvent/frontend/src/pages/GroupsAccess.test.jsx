import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetStatus,
  mockGetMatrix,
  mockGetGroup,
  mockSearchUser,
  mockGetMatrixGrid,
  mockGetExport,
  mockHasPermission,
  mockNotifyApiError,
  mockUseMediaQuery,
  mockAuthUser,
  mockExportModuleLoaded,
  mockExportWorkbook,
  mockExportGroupMembersWorkbook,
} = vi.hoisted(() => ({
  mockGetStatus: vi.fn(),
  mockGetMatrix: vi.fn(),
  mockGetGroup: vi.fn(),
  mockSearchUser: vi.fn(),
  mockGetMatrixGrid: vi.fn(),
  mockGetExport: vi.fn(),
  mockHasPermission: vi.fn((permission) => permission === 'groups_access.read'),
  mockNotifyApiError: vi.fn(),
  mockUseMediaQuery: vi.fn(() => false),
  mockAuthUser: {
    id: 1,
    username: 'admin',
    role: 'admin',
  },
  mockExportModuleLoaded: vi.fn(),
  mockExportWorkbook: vi.fn(),
  mockExportGroupMembersWorkbook: vi.fn(),
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
  default: ({ title, actions, children }) => (
    <div>
      <h1>{title}</h1>
      <div data-testid="page-actions">{actions}</div>
      {children}
    </div>
  ),
}));

vi.mock('../api/groupsAccess', () => ({
  groupsAccessAPI: {
    getStatus: mockGetStatus,
    getMatrix: mockGetMatrix,
    getGroup: mockGetGroup,
    searchUser: mockSearchUser,
    getMatrixGrid: mockGetMatrixGrid,
    getExport: mockGetExport,
    refresh: vi.fn(),
  },
}));

vi.mock('../lib/groupsAccessExport', () => {
  mockExportModuleLoaded();
  return {
    exportGroupsAccessWorkbook: mockExportWorkbook,
    exportGroupMembersWorkbook: mockExportGroupMembersWorkbook,
  };
});

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
    mockSearchUser.mockReset();
    mockGetMatrixGrid.mockReset();
    mockGetExport.mockReset();
    mockNotifyApiError.mockReset();
    mockUseMediaQuery.mockReturnValue(false);
    mockExportModuleLoaded.mockReset();
    mockExportWorkbook.mockReset();
    mockExportGroupMembersWorkbook.mockReset();

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
    mockSearchUser.mockResolvedValue({
      items: [
        {
          login: 'petrov_p',
          display_name: 'Петров П.П.',
          access_count: 1,
          access: [
            {
              group_dn: 'CN=Designers,OU=SPb,OU=Groups,DC=zsgp,DC=corp',
              folder_label: 'Designers',
              folder_path: 'Resources / Designers',
              branch: 'SPb',
              access_level: 'member',
            },
          ],
        },
      ],
      total: 1,
    });
    mockGetMatrixGrid.mockResolvedValue({
      groups: [],
      users: [],
      cells: [],
      summary: { group_count: 0, user_count: 0, cell_count: 0 },
    });
    mockGetExport.mockResolvedValue({
      groups: [
        {
          dn: 'CN=Designers,OU=SPb,OU=Groups,DC=zsgp,DC=corp',
          cn: 'Designers',
          branch: 'SPb',
          folder_label: 'Designers',
          folder_path: 'Resources / Designers',
          access_level: 'member',
        },
      ],
      users: [],
      synced_at: '2026-07-03T10:00:00Z',
    });
  });

  it('renders page with folder path and selected group members', async () => {
    renderPage();

    expect(await screen.findByText('Доступ к папкам')).toBeInTheDocument();
    await waitFor(() => expect(mockGetMatrix).toHaveBeenCalled());
    expect(screen.getAllByText('Designers').length).toBeGreaterThan(0);
    expect(await screen.findByText('petrov_p')).toBeInTheDocument();
    expect(mockGetMatrix).toHaveBeenCalledTimes(1);
  });

  it('uses an explicit employee search mode', async () => {
    renderPage();

    fireEvent.click(await screen.findByText('По сотруднику'));
    fireEvent.change(screen.getByPlaceholderText('Логин или ФИО сотрудника'), {
      target: { value: 'petrov' },
    });

    await waitFor(() => expect(mockSearchUser).toHaveBeenCalledWith({
      q: 'petrov',
      branch: '',
      limit: 200,
    }));
    expect(await screen.findByText('Найдено: 1 учёток · 1 доступов')).toBeInTheDocument();
    expect(screen.getByTestId('groups-access-user-results-scroll')).toBeInTheDocument();
  });

  it('ignores a slow answer to an old employee query after the query changed', async () => {
    let resolveOld;
    mockSearchUser.mockImplementation(({ q }) => (q === 'petrov'
      ? new Promise((resolve) => { resolveOld = resolve; })
      : Promise.resolve({
        items: [{ login: 'ivanov_i', display_name: 'Иванов И.И.', access_count: 0, access: [] }],
        total: 1,
      })));
    renderPage();

    fireEvent.click(await screen.findByText('По сотруднику'));
    const input = screen.getByPlaceholderText('Логин или ФИО сотрудника');
    fireEvent.change(input, { target: { value: 'petrov' } });
    await waitFor(() => expect(mockSearchUser).toHaveBeenCalledWith(expect.objectContaining({ q: 'petrov' })));
    fireEvent.change(input, { target: { value: 'ivanov' } });
    expect(await screen.findByText('ivanov_i')).toBeInTheDocument();

    resolveOld({
      items: [{ login: 'petrov_p', display_name: 'Петров П.П.', access_count: 0, access: [] }],
      total: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screen.queryByText('petrov_p')).toBeNull();
    expect(screen.getByText('ivanov_i')).toBeInTheDocument();
  });

  it('does not show results of the previous mode after switching modes while a load is in flight', async () => {
    let resolveFolders;
    mockGetMatrix.mockReset();
    mockGetMatrix.mockImplementationOnce(() => new Promise((resolve) => { resolveFolders = resolve; }));
    renderPage();

    await waitFor(() => expect(mockGetMatrix).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByText('По сотруднику'));
    fireEvent.change(screen.getByPlaceholderText('Логин или ФИО сотрудника'), { target: { value: 'petrov' } });
    expect(await screen.findByText('petrov_p')).toBeInTheDocument();

    resolveFolders({
      items: [{
        dn: 'CN=Late,OU=SPb,OU=Groups,DC=zsgp,DC=corp',
        cn: 'LateFolder',
        branch: 'SPb',
        folder_label: 'LateFolder',
        folder_path: 'Resources / LateFolder',
        access_level: 'member',
        member_count: 1,
      }],
      total: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screen.queryByText('LateFolder')).toBeNull();
    expect(screen.getByText('petrov_p')).toBeInTheDocument();
  });

  it('requests a capped matrix grid and explains truncated results', async () => {
    mockGetMatrixGrid.mockResolvedValueOnce({
      groups: [
        {
          dn: 'CN=Designers,OU=SPb,OU=Groups,DC=zsgp,DC=corp',
          cn: 'Designers',
          branch: 'SPb',
          folder_label: 'Designers',
          folder_path: 'Resources / Designers',
          access_level: 'member',
        },
      ],
      users: [{ login: 'petrov_p', display_name: 'Петров П.П.', access_count: 1 }],
      cells: [],
      summary: {
        group_count: 300,
        user_count: 800,
        cell_count: 0,
        returned_group_count: 1,
        returned_user_count: 1,
        group_limit: 250,
        user_limit: 500,
        truncated: true,
      },
    });

    renderPage();

    fireEvent.click(await screen.findByText('Матрица'));

    await waitFor(() => expect(mockGetMatrixGrid).toHaveBeenCalledWith({
      branch: '',
      folderQ: '',
      userQ: '',
      groupLimit: 250,
      userLimit: 500,
    }));
    expect(await screen.findByText(/Матрица ограничена для быстрого рендера/)).toBeInTheDocument();
  });

  it('loads the Excel exporter only after export is clicked', async () => {
    renderPage();

    await waitFor(() => expect(mockGetMatrix).toHaveBeenCalledTimes(1));
    expect(mockExportModuleLoaded).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Excel'));

    await waitFor(() => expect(mockGetExport).toHaveBeenCalledWith({
      branch: '',
      folderQ: '',
      userQ: '',
    }));
    await waitFor(() => expect(mockExportWorkbook).toHaveBeenCalled());
    expect(mockExportModuleLoaded).toHaveBeenCalledTimes(1);
  });

  it('exports selected folder members from the export mode', async () => {
    renderPage();

    await waitFor(() => expect(mockGetGroup).toHaveBeenCalled());
    fireEvent.click(await screen.findByText('Экспорт'));

    const folderExportButton = await screen.findByText('Папку с участниками');
    await waitFor(() => expect(folderExportButton).not.toBeDisabled());
    fireEvent.click(folderExportButton);

    await waitFor(() => expect(mockExportGroupMembersWorkbook).toHaveBeenCalledWith(expect.objectContaining({
      group: expect.objectContaining({ cn: 'Designers' }),
      members: [{ login: 'petrov_p', display_name: 'Петров П.П.' }],
      syncedAt: '2026-07-03T10:00:00Z',
    })));
  });
});
