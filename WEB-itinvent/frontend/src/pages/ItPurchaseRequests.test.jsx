import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetRequest, mockGetRequests } = vi.hoisted(() => ({
  mockGetRequest: vi.fn(),
  mockGetRequests: vi.fn(),
}));

vi.mock('@mui/material/useMediaQuery', () => ({ default: () => false }));
vi.mock('../components/layout/MainLayout', () => ({
  default: ({ children }) => <div data-testid="main-layout">{children}</div>,
}));
vi.mock('../components/layout/PageShell', () => ({
  default: ({ children }) => <div data-testid="page-shell">{children}</div>,
}));
vi.mock('../api/warehouse1cItRequests', () => ({
  warehouse1cItRequestsAPI: {
    getRequests: mockGetRequests,
    getRequest: mockGetRequest,
  },
}));

import ItPurchaseRequests from './ItPurchaseRequests';

const requestRef = '11111111-1111-1111-1111-111111111111';
const summary = {
  request_ref: requestRef,
  request_number: '00ЦБ-000174-ИТ',
  required_date: '2026-08-30T00:00:00',
  stage: { key: 'assigned', label: 'Назначен закупщик', rank: 2 },
  positions_total: 4,
  positions_completed: 1,
  progress_label: '4 позиции в заявке',
  overdue: false,
  warehouse_ref: 'warehouse-it',
  warehouse_name: 'Склад ИТ',
  current_state: {
    key: 'assigned',
    label: 'Назначен закупщик',
    description: 'Закупщик: Петров П.П.',
    date: '2026-08-27T11:00:00',
  },
  journey: [
    { key: 'created', label: 'Заявка', reached: true, current: false, date: '2026-08-27T10:00:00' },
    { key: 'assigned', label: 'Закупщик', reached: true, current: true, date: '2026-08-27T11:00:00' },
    { key: 'ordered', label: 'Заказ / резерв', reached: false, current: false },
    { key: 'movement_planned', label: 'План', reached: false, current: false },
    { key: 'fulfilled', label: 'На складе', reached: false, current: false },
  ],
  nomenclature_items: [
    { name: 'Аккумулятор Ippon IP 12-9', quantity: 30, unit: 'шт' },
    { name: 'Кабель питания', quantity: 2, unit: 'шт' },
    { name: 'ИБП', quantity: 1, unit: 'шт' },
    { name: 'Коммутатор', quantity: 1, unit: 'шт' },
  ],
};

const detail = {
  ...summary,
  date: '2026-08-27T10:00:00',
  department_name: 'ИТ',
  responsible_name: 'Иванов И.И.',
  manager_names: ['Петров П.П.'],
  warehouse_name: 'Склад ИТ',
  item_groups: [
    {
      nomenclature_ref: 'nom-battery',
      name: 'Аккумулятор Ippon IP 12-9',
      quantity: 30,
      unit: 'шт',
      source_line_count: 1,
      cancelled: false,
    },
  ],
  positions: [
    {
      line_key: 'line-1',
      nomenclature_name: 'Аккумулятор Ippon IP 12-9',
      quantity: 30,
      unit_name: 'шт',
      stage: { key: 'assigned', label: 'Назначен закупщик', rank: 2 },
      quantities: { requested: 30, ordered: 0, reserved: 0, received: 0, fulfilled: 0 },
      manager_names: ['Петров П.П.'],
    },
  ],
  timeline: [
    {
      type: 'assigned',
      label: 'Назначение закупщика',
      document_ref: 'doc-1',
      document_number: '00ЦБ-000001',
      date: '2026-08-27T11:00:00',
      quantity: 30,
      manager_name: 'Петров П.П.',
    },
  ],
  as_of: '2026-08-28T10:00:00Z',
};

const listResponse = {
  items: [summary],
  next_cursor: null,
  has_more: false,
  as_of: '2026-08-28T10:00:00Z',
  snapshot_id: 'snapshot-1',
  warehouse_facets: [
    { ref: 'warehouse-it', name: 'Склад ИТ', count: 1, active_count: 1, history_count: 1 },
  ],
  cache: { stale: false, age_seconds: 2 },
};

function renderPage(initialEntry = '/it/requests', mode = 'light') {
  return render(
    <ThemeProvider theme={createTheme({ palette: { mode } })}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/it/requests/:requestRef?" element={<ItPurchaseRequests />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe('ItPurchaseRequests', () => {
  beforeEach(() => {
    mockGetRequests.mockReset();
    mockGetRequest.mockReset();
    mockGetRequests.mockResolvedValue(listResponse);
    mockGetRequest.mockResolvedValue(detail);
  });

  it('loads active requests, expands nomenclature and opens the mobile detail route', async () => {
    renderPage();

    expect(await screen.findByText('00ЦБ-000174-ИТ')).toBeInTheDocument();
    expect(mockGetRequests).toHaveBeenCalledWith(expect.objectContaining({ view: 'active', limit: 25 }));
    expect(screen.queryByText('Коммутатор')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё 1' }));
    expect(screen.getByText(/Коммутатор/)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Открыть заявку 00ЦБ-000174-ИТ'));

    expect(await screen.findByRole('heading', { name: 'Номенклатура' })).toBeInTheDocument();
    expect(screen.getByText('Закупщик: 1 док.')).toBeInTheDocument();
    expect(screen.getByText(/00ЦБ-000001/)).toBeInTheDocument();
    expect(screen.getByLabelText('Путь заявки. Текущий этап: Назначен закупщик')).toBeInTheDocument();
    expect(screen.getByLabelText('Закупщик: текущий этап, 27.08.2026')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('Общий для всей номенклатуры')).toBeInTheDocument();
    expect(screen.getByText('Закупщик: Петров П.П.')).toBeInTheDocument();
    expect(mockGetRequest).toHaveBeenCalledWith(requestRef, expect.objectContaining({ signal: expect.anything() }));
  });

  it('passes warehouse, history, stage, overdue and debounced search filters to the API', async () => {
    renderPage();
    await screen.findByText('00ЦБ-000174-ИТ');
    expect(screen.getByLabelText('Этап заявки')).toHaveTextContent('Все этапы');

    fireEvent.click(screen.getByRole('tab', { name: 'История' }));
    fireEvent.mouseDown(screen.getByLabelText('Этап заявки'));
    fireEvent.click(await screen.findByRole('option', { name: 'Доставлено на склад' }));
    fireEvent.mouseDown(screen.getByLabelText('Склад назначения'));
    fireEvent.click(await screen.findByRole('option', { name: 'Склад ИТ · 1' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Только просроченные' }));
    fireEvent.change(screen.getByLabelText('Поиск'), { target: { value: 'аккумулятор' } });

    await waitFor(() => {
      expect(mockGetRequests).toHaveBeenCalledWith(expect.objectContaining({
        view: 'history',
        stage: 'fulfilled',
        overdue: true,
        search: 'аккумулятор',
        warehouseRef: 'warehouse-it',
      }));
    });
  });

  it('keeps the previous list when a manual refresh fails', async () => {
    mockGetRequests
      .mockResolvedValueOnce(listResponse)
      .mockRejectedValueOnce(new Error('1С временно недоступна'));
    renderPage();
    await screen.findByText('00ЦБ-000174-ИТ');

    fireEvent.click(screen.getByRole('button', { name: 'Обновить список и открытую заявку' }));

    expect(await screen.findByText(/Показаны данные предыдущей успешной загрузки/)).toBeInTheDocument();
    expect(screen.getByText('00ЦБ-000174-ИТ')).toBeInTheDocument();
    expect(mockGetRequests).toHaveBeenLastCalledWith(expect.objectContaining({ refresh: true }));
  });

  it('renders the request list with the dark theme', async () => {
    renderPage('/it/requests', 'dark');

    expect(await screen.findByText('00ЦБ-000174-ИТ')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Заявки на МПЗ', level: 1 })).toBeInTheDocument();
  });
});
