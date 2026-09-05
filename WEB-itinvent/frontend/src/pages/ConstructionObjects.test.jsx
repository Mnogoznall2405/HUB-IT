import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';


const { mockGetObjects, mockHasPermission } = vi.hoisted(() => ({
  mockGetObjects: vi.fn(),
  mockHasPermission: vi.fn(() => false),
}));

vi.mock('../components/layout/MainLayout', () => ({
  default: ({ children }) => <div data-testid="main-layout">{children}</div>,
}));
vi.mock('../components/layout/PageShell', () => ({
  default: ({ children }) => <div data-testid="page-shell">{children}</div>,
}));
vi.mock('../api/construction', () => ({
  constructionAPI: { getObjects: mockGetObjects },
}));
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ hasPermission: mockHasPermission }),
}));

import ConstructionObjects from './ConstructionObjects';


const object = {
  object_ref: '11111111-1111-1111-1111-111111111111',
  name: 'ЕАСИ',
  kind: 'project',
  request_count: 17,
  requests_last_30_days: 4,
  posted_count: 16,
  latest_request_at: '2026-08-28T10:00:00',
  latest_request_number: 'ЕАСИ.-ОСУ/69',
  department_names: ['УМТО', 'ПТО'],
  responsible_names: ['Петров П.П.'],
  warehouse_names: ['Склад ЕАСИ'],
  recent_requests: [
    {
      request_ref: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      number: 'ЕАСИ.-ОСУ/69',
      date: '2026-08-28T10:00:00',
      warehouse_name: 'Склад ЕАСИ',
      responsible_name: 'Петров П.П.',
    },
  ],
};

const response = {
  items: [object],
  next_cursor: null,
  has_more: false,
  snapshot_changed: false,
  as_of: '2026-09-01T10:00:00Z',
  window_from: '2025-09-01',
  scanned_requests: 1000,
  scan_truncated: false,
  summary: {
    project_count: 52,
    request_count: 1000,
    requests_last_30_days: 310,
    general_request_count: 76,
    unassigned_request_count: 11,
  },
  cache: {
    state: 'fresh',
    age_seconds: 0,
    last_error: '',
    coalesced: false,
    refresh_suppressed: false,
  },
};

function renderPage(mode = 'light') {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={createTheme({ palette: { mode } })}>
        <ConstructionObjects />
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe('ConstructionObjects', () => {
  beforeEach(() => {
    mockGetObjects.mockReset();
    mockHasPermission.mockReset();
    mockHasPermission.mockReturnValue(false);
    mockGetObjects.mockResolvedValue(response);
  });

  it('loads real portfolio cards and expands recent requests without another request', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'ЕАСИ' })).toBeInTheDocument();
    expect(screen.getByText('ЕАСИ.-ОСУ/69 · 28.08.2026')).toBeInTheDocument();
    expect(screen.getAllByText('Не назначен')).toHaveLength(3);
    expect(screen.queryByText('Склад ЕАСИ · Петров П.П.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Последние заявки и склады' }));

    const recentRequests = screen.getByRole('list', { name: 'Последние заявки объекта' });
    expect(recentRequests).toHaveTextContent('Склад ЕАСИ');
    expect(recentRequests).toHaveTextContent('Петров П.П.');
    expect(mockGetObjects).toHaveBeenCalledTimes(1);
  });

  it('passes debounced search and card type to the API', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'ЕАСИ' });

    fireEvent.change(screen.getByLabelText('Поиск'), { target: { value: 'БГГ-287мех' } });
    fireEvent.mouseDown(screen.getByLabelText('Тип карточки'));
    fireEvent.click(await screen.findByRole('option', { name: 'Объекты' }));

    await waitFor(() => {
      expect(mockGetObjects).toHaveBeenLastCalledWith(expect.objectContaining({
        search: 'БГГ-287мех',
        kind: 'project',
        limit: 24,
      }));
    });
  });

  it('keeps the previous cards when manual refresh fails', async () => {
    mockGetObjects
      .mockResolvedValueOnce(response)
      .mockRejectedValueOnce(new Error('1С временно недоступна'));
    renderPage();
    await screen.findByRole('heading', { name: 'ЕАСИ' });

    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));

    expect(await screen.findByText(/Показаны данные предыдущей успешной загрузки/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'ЕАСИ' })).toBeInTheDocument();
    expect(mockGetObjects).toHaveBeenLastCalledWith(expect.objectContaining({ refresh: true }));
  });

  it('renders the portfolio in dark theme', async () => {
    renderPage('dark');

    expect(await screen.findByRole('heading', { name: 'Объекты строительства', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'ЕАСИ' })).toBeInTheDocument();
  });

  it('shows permanent team and management action only with construction.write', async () => {
    mockHasPermission.mockImplementation((permission) => permission === 'construction.write');
    mockGetObjects.mockResolvedValue({
      ...response,
      management_available: true,
      items: [{
        ...object,
        managed: true,
        managed_object_id: 'construction-easi',
        team: [{
          role_key: 'project_lead',
          employee_code: 'E-1',
          full_name: 'Иванов Иван Иванович',
          position: 'Руководитель проекта',
          department: 'Управление проектами',
        }],
      }],
    });
    renderPage();

    expect(await screen.findByText('Иванов Иван Иванович')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Настроить объект' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Создать объект' })).toBeInTheDocument();
  });
});
