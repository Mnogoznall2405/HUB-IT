import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';


const {
  mockGetDirection,
  mockGetDirectionRequests,
  mockGetDirectionRequest,
  mockHasPermission,
} = vi.hoisted(() => ({
  mockGetDirection: vi.fn(),
  mockGetDirectionRequests: vi.fn(),
  mockGetDirectionRequest: vi.fn(),
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
    getDirection: mockGetDirection,
    getDirectionRequests: mockGetDirectionRequests,
    getDirectionRequest: mockGetDirectionRequest,
  },
}));

vi.mock('../api/constructionWork', () => ({
  constructionWorkAPI: {
    read: vi.fn(async () => ({ as_of: '2026-09-08', items: [], sections: [], directions: [], trend: [], summary: { total: 0, completed: 0, overdue: 0, percent: null } })),
    planning: vi.fn(async () => ({
      as_of: '2026-09-08',
      items: [],
      sections: [],
      directions: [],
      trend: [],
      summary: { total: 0, completed: 0, overdue: 0, percent: null },
      week_start: '2026-09-08',
      week_end: '2026-09-14',
      week_version: 0,
      crew_version: 0,
      recorded_ids: [],
      crew_day: {},
      allocated: {},
      month_plans: {},
      month_actual: {},
      month_totals: {},
      weekly_actual: {},
      plan: { targets: [], crews: [], comment: '' },
    })),
    saveWeek: vi.fn(),
    saveSummary: vi.fn(),
    planningHistory: vi.fn(async () => ({ items: [], next_cursor: null })),
  },
}));

import ConstructionDirectionDetail from './ConstructionDirectionDetail';


const GROUP = '11111111-1111-1111-1111-111111111111';

const direction = {
  object_id: 'construction-easi',
  object_name: 'ЕАСИ — единый объект',
  group_ref: GROUP,
  group_name: 'ЕАСИ',
  managed: true,
  object_team: [
    {
      role_key: 'chief_project_engineer',
      employee_code: 'E-2',
      full_name: 'ГИП Г.Г.',
    },
  ],
  role_history: [],
};

const request = {
  request_ref: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  request_number: 'ЕАСИ-ЭС-188утим',
  group_ref: GROUP,
  warehouse_ref: '33333333-3333-3333-3333-333333333333',
  warehouse_name: 'Склад ЕАСИ',
  stage: { key: 'assigned', label: 'Назначен закупщик' },
  is_active: true,
  overdue: false,
  manager_names: ['Сидоров С.С.'],
  responsible_name: 'Петров П.П.',
  nomenclature_items: [{ name: 'Кабель', quantity: 1, unit: 'шт' }],
  progress_label: '1 позиция',
  journey: [],
};

const listResponse = {
  items: [request],
  next_cursor: null,
  has_more: false,
  total: 1,
  snapshot_id: 'snapshot-1',
  as_of: '2026-09-01T10:00:00Z',
  window_from: '2025-09-01',
  truncated: false,
  warehouse_facets: [{ ref: request.warehouse_ref, name: request.warehouse_name, count: 1, active_count: 1, history_count: 0, overdue_count: 0 }],
  buyer_facets: [{ name: 'Сидоров С.С.', count: 1 }],
  responsible_facets: [{ name: 'Петров П.П.', count: 1 }],
  summary: { total: 1, active: 1, history: 0, overdue: 0 },
  overview: {
    departments: [],
    warehouses: [],
    stages: [{ key: 'assigned', label: 'Назначен закупщик', count: 1 }],
  },
  cache: { state: 'fresh', stale: false, age_seconds: 0 },
};

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="construction-location">{location.pathname}{location.search}</output>;
}

function renderPage(initialPath = `/construction/objects/construction-easi/directions/${GROUP}`) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ThemeProvider theme={createTheme()}>
        <LocationProbe />
        <Routes>
          <Route path="/construction/objects/:objectId/directions/:groupRef" element={<ConstructionDirectionDetail />} />
          <Route path="/construction/objects/:objectId/directions/:groupRef/requests/:requestRef" element={<ConstructionDirectionDetail />} />
        </Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe('ConstructionDirectionDetail', () => {
  beforeEach(() => {
    mockGetDirection.mockReset();
    mockGetDirectionRequests.mockReset();
    mockGetDirectionRequest.mockReset();
    mockHasPermission.mockReturnValue(false);
    mockGetDirection.mockResolvedValue(direction);
    mockGetDirectionRequests.mockResolvedValue(listResponse);
  });

  it('shows native work overview and separate documentation readiness', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'ЕАСИ' })).toBeInTheDocument();
    expect(screen.getByText('ГИП Г.Г.')).toBeInTheDocument();
    expect(screen.queryByText(/Начальник участка/i)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Заявки по этапам' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Распределение активных заявок по этапам: 1' })).toBeInTheDocument();
    expect(screen.queryByText(/Excel-данные пока не подключены/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ход выполненных работ' })).toBeInTheDocument();
    expect(screen.getByText('Ход формирования исполнительной документации')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Ход работ' })).toBeInTheDocument();
    expect(screen.queryByText('Закупщики по активным заявкам')).not.toBeInTheDocument();
    expect(screen.queryByText('Ответственные за заявки')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /импорт/i })).not.toBeInTheDocument();
  });

  it('opens requests tab with stage filter from chart click', async () => {
    renderPage();
    const stageButton = await screen.findByRole('button', { name: /Открыть заявки этапа Назначен закупщик/i });
    fireEvent.click(stageButton);

    expect(await screen.findByLabelText('Этап заявки')).toBeInTheDocument();
    expect(mockGetDirectionRequests).toHaveBeenCalled();
  });

  it('keeps advanced filters collapsed until requested and preserves their values when collapsed', async () => {
    renderPage(`/construction/objects/construction-easi/directions/${GROUP}?tab=requests`);
    const toggle = await screen.findByRole('button', { name: 'Фильтры' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Закупщик')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Поиск')).toBeVisible();
    expect(screen.getByLabelText('Этап заявки')).toBeVisible();
    fireEvent.click(toggle);
    expect(await screen.findByLabelText('Закупщик')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Только просроченные' }));
    const activeToggle = screen.getByRole('button', { name: 'Фильтры · 1' });
    fireEvent.click(activeToggle);
    await waitFor(() => expect(screen.queryByLabelText('Закупщик')).not.toBeInTheDocument());
    expect(screen.getByTestId('construction-location')).toHaveTextContent('overdue=1');
    fireEvent.click(activeToggle);
    expect(await screen.findByRole('checkbox', { name: 'Только просроченные' })).toBeChecked();
  });

  it('opens the work tab directly from a selected request', async () => {
    const matchMedia = vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: query.includes('min-width:1200px'), media: query, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    }));
    mockGetDirectionRequest.mockResolvedValue(request);
    try {
      renderPage(`/construction/objects/construction-easi/directions/${GROUP}/requests/${request.request_ref}`);
      const workTab = await screen.findByRole('tab', { name: 'Ход работ' });
      await waitFor(() => expect(mockGetDirectionRequest).toHaveBeenCalled());
      fireEvent.click(workTab);

      expect(await screen.findByRole('heading', { name: 'Ход работ', exact: true })).toBeVisible();
      expect(screen.getByRole('tab', { name: 'Ход работ' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.queryByRole('heading', { name: 'Ход выполненных работ' })).not.toBeInTheDocument();
    } finally {
      matchMedia.mockRestore();
    }
  });

  it('preserves all request filters when automatically selecting a request on a wide screen', async () => {
    const matchMedia = vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: query.includes('min-width:1200px'), media: query, onchange: null,
      addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    }));
    mockGetDirectionRequest.mockResolvedValue(request);
    const params = new URLSearchParams({ tab: 'requests', view: 'history', stage: 'assigned', buyer: 'Сидоров С.С.', responsible: 'Петров П.П.', warehouse: request.warehouse_ref, q: 'Кабель' });
    try {
      renderPage(`/construction/objects/construction-easi/directions/${GROUP}?${params.toString()}`);
      await waitFor(() => expect(screen.getByTestId('construction-location')).toHaveTextContent(`/requests/${request.request_ref}?`));
      const current = new URL(screen.getByTestId('construction-location').textContent, 'https://example.test');
      expect(Object.fromEntries(current.searchParams)).toEqual(Object.fromEntries(params));
    } finally {
      matchMedia.mockRestore();
    }
  });

  it('opens the selected warehouse as a filtered list of requests', async () => {
    renderPage(`/construction/objects/construction-easi/directions/${GROUP}?tab=supply`);
    fireEvent.click(await screen.findByRole('button', { name: 'Открыть заявки склада Склад ЕАСИ' }));
    await waitFor(() => {
      const current = new URL(screen.getByTestId('construction-location').textContent, 'https://example.test');
      expect(current.searchParams.get('tab')).toBe('requests');
      expect(current.searchParams.get('view')).toBe('all');
      expect(current.searchParams.get('warehouse')).toBe(request.warehouse_ref);
    });
    expect(await screen.findByLabelText('Склад назначения')).toBeInTheDocument();
  });

  it('loads requests with buyer and responsible filters from URL', async () => {
    renderPage(
      `/construction/objects/construction-easi/directions/${GROUP}?tab=requests&buyer=${encodeURIComponent('Сидоров С.С.')}&responsible=${encodeURIComponent('Петров П.П.')}`,
    );

    await waitFor(() => {
      expect(mockGetDirectionRequests.mock.calls.some((call) => (
        call[2]?.buyer === 'Сидоров С.С.' && call[2]?.responsible === 'Петров П.П.'
      ))).toBe(true);
    });
    expect(await screen.findByLabelText('Закупщик')).toBeInTheDocument();
    expect(screen.getByLabelText('Ответственный за заявку')).toBeInTheDocument();
  });
});
