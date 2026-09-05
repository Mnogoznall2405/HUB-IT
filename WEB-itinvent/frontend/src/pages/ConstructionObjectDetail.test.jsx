import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';


const { mockGetObject, mockGetObjectRequests, mockGetObjectRequest } = vi.hoisted(() => ({
  mockGetObject: vi.fn(),
  mockGetObjectRequests: vi.fn(),
  mockGetObjectRequest: vi.fn(),
}));

vi.mock('../components/layout/MainLayout', () => ({
  default: ({ children }) => <div data-testid="main-layout">{children}</div>,
}));
vi.mock('../components/layout/PageShell', () => ({
  default: ({ children }) => <div data-testid="page-shell">{children}</div>,
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
    { group_ref: '11111111-1111-1111-1111-111111111111', group_name: 'ЕАСИ' },
    { group_ref: '22222222-2222-2222-2222-222222222222', group_name: 'ЕАСИ доп.' },
  ],
  team: [
    {
      role_key: 'project_lead',
      employee_code: 'E-1',
      full_name: 'Иванов Иван Иванович',
      position: 'Руководитель проекта',
      department: 'Управление проектами',
    },
  ],
  role_history: [],
};

const request = {
  request_ref: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  request_number: 'ЕАСИ-ЭС-188утим',
  date: '2026-08-27T10:00:00',
  required_date: '2026-09-10T00:00:00',
  department_name: 'УМТО',
  initiator_name: 'Смирнов С.С.',
  responsible_name: 'Петров П.П.',
  warehouse_ref: '33333333-3333-3333-3333-333333333333',
  warehouse_name: 'Склад ЕАСИ',
  stage: { key: 'assigned', label: 'Назначен закупщик', rank: 2 },
  current_state: { label: 'Назначен закупщик', description: 'Закупщик: Сидоров С.С.' },
  is_active: true,
  overdue: false,
  attention_required: false,
  positions_total: 1,
  progress_label: '1 позиция в заявке',
  manager_names: ['Сидоров С.С.'],
  supplier_names: [],
  nomenclature_items: [{ name: 'Кабель силовой', quantity: 50, unit: 'м' }],
  journey: [
    { key: 'created', label: 'Заявка', reached: true, current: false, date: '2026-08-27T10:00:00' },
    { key: 'assigned', label: 'Закупщик', reached: true, current: true, date: '2026-08-28T10:00:00' },
    { key: 'ordered', label: 'Заказ / резерв', reached: false, current: false },
    { key: 'movement_planned', label: 'План перемещения', reached: false, current: false },
    { key: 'fulfilled', label: 'На складе', reached: false, current: false },
  ],
};

const listResponse = {
  items: [request],
  next_cursor: null,
  has_more: false,
  total: 1,
  snapshot_id: 'snapshot-1',
  snapshot_changed: false,
  as_of: '2026-09-01T10:00:00Z',
  window_from: '2025-09-01',
  truncated: false,
  source_groups: object.groups,
  warehouse_facets: [
    {
      ref: request.warehouse_ref,
      name: request.warehouse_name,
      count: 1,
      active_count: 1,
      history_count: 0,
      overdue_count: 0,
    },
  ],
  summary: { total: 1, active: 1, history: 0, overdue: 0 },
  overview: {
    buyers: [{ name: 'Сидоров С.С.', active_requests: 1 }],
    request_responsibles: [{ name: 'Петров П.П.', active_requests: 1 }],
    departments: [{ name: 'УМТО', active_requests: 1 }],
    warehouses: [{ name: 'Склад ЕАСИ', active_requests: 1 }],
    stages: [{ key: 'assigned', label: 'Назначен закупщик', count: 1 }],
  },
  cache: { state: 'fresh', stale: false, age_seconds: 0 },
};

const detailResponse = {
  ...request,
  item_groups: [
    {
      nomenclature_ref: '44444444-4444-4444-4444-444444444444',
      name: 'Кабель силовой',
      quantity: 50,
      unit: 'м',
      source_line_count: 1,
      cancelled: false,
    },
  ],
  timeline: [
    {
      type: 'assigned',
      label: 'Назначение закупщика',
      document_ref: '55555555-5555-5555-5555-555555555555',
      document_number: 'ЗП-188',
      date: '2026-08-28T10:00:00',
      manager_name: 'Сидоров С.С.',
      quantity: 50,
    },
  ],
};

function renderPage(initialPath = '/construction/objects/construction-easi', mode = 'light') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ThemeProvider theme={createTheme({ palette: { mode } })}>
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
    mockGetObject.mockResolvedValue(object);
    mockGetObjectRequests.mockResolvedValue(listResponse);
    mockGetObjectRequest.mockResolvedValue(detailResponse);
  });

  it('shows general contacts without request cards and opens a request with the same journey UX as IT', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'ЕАСИ — единый объект', level: 1 })).toBeInTheDocument();
    expect(screen.getByTestId('construction-object-header-row')).toContainElement(
      screen.getByRole('link', { name: 'К объектам' }),
    );
    expect(screen.getByRole('heading', { name: 'К кому обращаться' })).toBeInTheDocument();
    expect(screen.getByText('Иванов Иван Иванович')).toBeInTheDocument();
    expect(screen.getByText('Сидоров С.С.')).toBeInTheDocument();
    expect(screen.getByText('Петров П.П.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Открыть заявку ЕАСИ-ЭС-188утим' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Заявки' }));
    fireEvent.click(screen.getByRole('button', { name: 'Открыть заявку ЕАСИ-ЭС-188утим' }));

    expect(await screen.findByRole('heading', { name: 'ЕАСИ-ЭС-188утим', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Общий для всей номенклатуры')).toBeInTheDocument();
    expect(screen.getAllByText('Кабель силовой').length).toBeGreaterThan(0);
    expect(mockGetObjectRequest).toHaveBeenCalledWith(
      'construction-easi',
      request.request_ref,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('provides real scroll containers for overview and requests', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'ЕАСИ — единый объект', level: 1 });

    expect(screen.getByTestId('construction-overview-scroll')).toHaveStyle({ overflowY: 'auto' });

    fireEvent.click(screen.getByRole('tab', { name: 'Заявки' }));
    expect(screen.getByTestId('construction-request-list-scroll')).toHaveStyle({ overflowY: 'auto' });
  });

  it('explains every request journey stage on hover and keyboard focus', async () => {
    renderPage(`/construction/objects/construction-easi/requests/${request.request_ref}`);
    await screen.findByRole('heading', { name: 'ЕАСИ-ЭС-188утим', level: 1 });

    const assignedStep = screen.getByRole('listitem', { name: 'Закупщик: текущий этап' });
    expect(assignedStep).toHaveAttribute('tabindex', '0');
    fireEvent.mouseOver(assignedStep);

    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('Назначен закупщик, который ведёт заказ');
    expect(tooltip).toHaveTextContent('Сейчас заявка находится на этом этапе');
    expect(tooltip).toHaveTextContent('Дата: 28.08.2026');
  });

  it('passes view, stage, overdue and debounced search to the object request API', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'ЕАСИ — единый объект', level: 1 });
    fireEvent.click(screen.getByRole('tab', { name: 'Заявки' }));

    fireEvent.click(screen.getByRole('tab', { name: /История/ }));
    fireEvent.change(screen.getByLabelText('Поиск'), { target: { value: 'кабель' } });
    fireEvent.mouseDown(screen.getByLabelText('Этап заявки'));
    fireEvent.click(await screen.findByRole('option', { name: 'Доставлено на склад' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Только просроченные' }));

    await waitFor(() => {
      expect(mockGetObjectRequests).toHaveBeenLastCalledWith(
        'construction-easi',
        expect.objectContaining({
          view: 'history',
          search: 'кабель',
          stage: 'fulfilled',
          overdue: true,
          limit: 25,
        }),
      );
    });
  });

  it('keeps the previous object data when a manual refresh fails', async () => {
    mockGetObjectRequests
      .mockResolvedValueOnce(listResponse)
      .mockRejectedValueOnce(new Error('1С временно недоступна'));
    renderPage();
    await screen.findByRole('heading', { name: 'ЕАСИ — единый объект', level: 1 });

    fireEvent.click(screen.getByRole('button', { name: 'Обновить заявки и открытую карточку' }));

    expect(await screen.findByText(/Показаны ранее загруженные данные/)).toBeInTheDocument();
    expect(screen.getByText('Сидоров С.С.')).toBeInTheDocument();
  });

  it('renders the structure tab in dark theme', async () => {
    renderPage('/construction/objects/construction-easi', 'dark');
    await screen.findByRole('heading', { name: 'ЕАСИ — единый объект', level: 1 });

    fireEvent.click(screen.getByRole('tab', { name: 'Структура' }));

    expect(screen.getByRole('heading', { name: 'История назначений' })).toBeInTheDocument();
    expect(screen.getByText('Код ЗУП: E-1')).toBeInTheDocument();
  });
});
