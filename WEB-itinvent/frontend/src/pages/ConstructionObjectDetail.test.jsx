import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';


const {
  mockGetObject,
  mockGetObjectRequests,
  mockGetObjectRequest,
  mockHasPermission,
} = vi.hoisted(() => ({
  mockGetObject: vi.fn(),
  mockGetObjectRequests: vi.fn(),
  mockGetObjectRequest: vi.fn(),
  mockHasPermission: vi.fn(() => false),
}));

vi.mock('../components/layout/MainLayout', () => ({
  default: ({ children }) => <div data-testid="main-layout">{children}</div>,
}));
vi.mock('../components/layout/PageShell', () => ({
  default: ({ children }) => <div data-testid="page-shell">{children}</div>,
}));
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ hasPermission: mockHasPermission }),
}));
vi.mock('../api/construction', () => ({
  constructionAPI: {
    getObject: mockGetObject,
    getObjectRequests: mockGetObjectRequests,
    getObjectRequest: mockGetObjectRequest,
  },
}));

import ConstructionObjectDetail from './ConstructionObjectDetail';


const object = {
  id: 'construction-easi',
  name: 'ЕАСИ — единый объект',
  managed: true,
  groups: [
    {
      group_ref: '11111111-1111-1111-1111-111111111111',
      group_name: 'ЕАСИ',
    },
    {
      group_ref: '22222222-2222-2222-2222-222222222222',
      group_name: 'ЕАСИ доп.',
    },
  ],
  team: [
    {
      role_key: 'project_lead',
      employee_code: 'E-1',
      full_name: 'Иванов Иван Иванович',
      position: 'Руководитель проекта',
      department: 'Управление проектами',
    },
    {
      role_key: 'chief_project_engineer',
      employee_code: 'E-2',
      full_name: 'ГИП Г.Г.',
      position: 'Главный инженер проекта',
      department: 'ПТО',
    },
  ],
  role_history: [],
};

const listResponse = {
  items: [],
  next_cursor: null,
  has_more: false,
  total: 0,
  snapshot_id: 'snapshot-1',
  as_of: '2026-09-01T10:00:00Z',
  window_from: '2025-09-01',
  truncated: false,
  direction_stats: [
    { group_ref: '11111111-1111-1111-1111-111111111111', group_name: 'ЕАСИ', active: 3, overdue: 1 },
    { group_ref: '22222222-2222-2222-2222-222222222222', group_name: 'ЕАСИ доп.', active: 0, overdue: 0 },
  ],
  summary: { total: 3, active: 3, history: 0, overdue: 1 },
  overview: { departments: [], warehouses: [], stages: [] },
  cache: { state: 'fresh', stale: false, age_seconds: 0 },
};

function renderPage(initialPath = '/construction/objects/construction-easi') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ThemeProvider theme={createTheme()}>
        <Routes>
          <Route path="/construction/objects/:objectId" element={<ConstructionObjectDetail />} />
          <Route path="/construction/objects/:objectId/requests/:requestRef" element={<ConstructionObjectDetail />} />
        </Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe('ConstructionObjectDetail', () => {
  beforeEach(() => {
    mockGetObject.mockReset();
    mockGetObjectRequests.mockReset();
    mockGetObjectRequest.mockReset();
    mockHasPermission.mockReset();
    mockHasPermission.mockReturnValue(false);
    mockGetObject.mockResolvedValue(object);
    mockGetObjectRequests.mockResolvedValue(listResponse);
  });

  it('shows direction cards including empty direction and does not invent zero readiness', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'ЕАСИ — единый объект' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Направление ЕАСИ$/ })).toHaveAttribute(
      'href',
      '/construction/objects/construction-easi/directions/11111111-1111-1111-1111-111111111111',
    );
    expect(screen.getByRole('link', { name: /Направление ЕАСИ доп\./ })).toBeInTheDocument();
    expect(screen.getByText('Активных: 3')).toBeInTheDocument();
    expect(screen.getByText('Активных: 0')).toBeInTheDocument();
    expect(screen.queryByText(/готовност/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Закупщики по активным заявкам')).not.toBeInTheDocument();
  });

  it('keeps HUB structure when 1C counters fail', async () => {
    mockGetObjectRequests.mockRejectedValue({ response: { data: { detail: '1С недоступна' } } });
    renderPage();

    expect(await screen.findByRole('link', { name: /Направление ЕАСИ$/ })).toBeInTheDocument();
    expect(screen.getAllByText(/Счётчики заявок временно недоступны/).length).toBeGreaterThan(0);
    expect(screen.queryByText('Активных: 0')).not.toBeInTheDocument();
  });

  it('redirects legacy request URL to the request direction', async () => {
    mockGetObjectRequest.mockResolvedValue({
      request_ref: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      group_ref: '22222222-2222-2222-2222-222222222222',
    });
    renderPage('/construction/objects/construction-easi/requests/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

    await waitFor(() => {
      expect(mockGetObjectRequest).toHaveBeenCalled();
    });
  });
});
