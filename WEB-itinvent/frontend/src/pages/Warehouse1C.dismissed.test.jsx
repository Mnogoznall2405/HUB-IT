import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DismissedWarehousesPanel } from './Warehouse1C';

const row = {
  warehouse: { ref: 'wh-1', name: 'Склад Иванов И.И.' },
  employee_name: 'Иванов Иван Иванович',
  city: 'Тюмень',
  employment_status: 'dismissed',
  totals: {
    positions: 1,
    qty: 2,
    cost: 100,
    cost_accounting: 90,
  },
  balances_meta: {
    status: 'ok',
    truncated: false,
    has_more: false,
  },
  balances: [
    {
      nomenclature_ref: 'nom-1',
      nomenclature_code: 'PN-1',
      nomenclature_name: 'Монитор',
      qty_balance: 2,
      cost_balance: 100,
      cost_accounting_balance: 90,
    },
  ],
};

describe('DismissedWarehousesPanel', () => {
  it('shows the employee and warehouse and expands the equipment balance', () => {
    render(
      <DismissedWarehousesPanel
        rows={[row]}
        meta={{ status: 'ok', returned: 1, total: 1 }}
        loading={false}
        error=""
        searched
        onReload={vi.fn()}
        isMobile={false}
      />,
    );

    expect(screen.getByText('Иванов Иван Иванович')).toBeInTheDocument();
    expect(screen.getByText('Тюмень')).toBeInTheDocument();
    expect(screen.getByText('Склад Иванов И.И.')).toBeInTheDocument();
    expect(screen.queryByText('Монитор')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Показать технику на складе Склад Иванов И.И.' }));

    expect(screen.getByText('Монитор')).toBeInTheDocument();
    expect(screen.getByText('PN-1')).toBeInTheDocument();
  });

  it('explains ambiguous warehouse matches without suggesting pagination', () => {
    render(
      <DismissedWarehousesPanel
        rows={[row]}
        meta={{
          status: 'incomplete',
          incompleteReason: 'ambiguous_warehouse_match',
          ambiguousWarehouses: 4,
        }}
        loading={false}
        error=""
        searched
        onReload={vi.fn()}
        isMobile={false}
      />,
    );

    expect(screen.getByText(/Показано складов с неоднозначным совпадением: 4/)).toBeInTheDocument();
    expect(screen.queryByText(/загрузите следующую страницу/)).not.toBeInTheDocument();
  });

  it('shows an ambiguous warehouse without falsely selecting an employee', () => {
    const ambiguousRow = {
      warehouse: { ref: 'wh-2', name: 'Склад Иванов И.И.' },
      employee_name: null,
      city: null,
      employment_status: 'ambiguous',
      employment_label: 'Нужно уточнить',
      ambiguous: true,
      employee_candidates: [
        {
          employee_name: 'Иванов Иван Иванович',
          employee_code: 'E-1',
          city: 'Тюмень',
          department: 'ИТ',
          position: 'Инженер',
          dismissal_date: '2026-08-01',
        },
        {
          employee_name: 'Иванов Илья Игоревич',
          employee_code: 'E-2',
          city: 'Москва',
          department: 'ИТ',
          position: 'Инженер',
          dismissal_date: '2026-08-02',
        },
      ],
      totals: {
        positions: 1,
        qty: 1,
        cost: 50,
        cost_accounting: 45,
      },
      balances_meta: {
        status: 'ok',
        truncated: false,
        has_more: false,
      },
      balances: [
        {
          nomenclature_ref: 'nom-1',
          nomenclature_code: 'PN-1',
          nomenclature_name: 'Монитор',
          qty_balance: 1,
          cost_balance: 50,
          cost_accounting_balance: 45,
        },
      ],
    };

    render(
      <DismissedWarehousesPanel
        rows={[ambiguousRow]}
        meta={{ status: 'ok', returned: 1, total: 1 }}
        loading={false}
        error=""
        searched
        onReload={vi.fn()}
        isMobile={false}
      />,
    );

    expect(screen.getByText('Владелец не определён (2)')).toBeInTheDocument();
    expect(screen.getByText('Нужно уточнить')).toBeInTheDocument();
    expect(screen.queryByText('Иванов Иван Иванович')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Показать технику на складе Склад Иванов И.И.' }));

    expect(screen.getByText('Возможные сотрудники:')).toBeInTheDocument();
    expect(screen.getByText(/Иванов Иван Иванович/)).toBeInTheDocument();
    expect(screen.getByText(/Иванов Илья Игоревич/)).toBeInTheDocument();
    expect(screen.getByText('Монитор')).toBeInTheDocument();
  });

  it('filters warehouses by city and sorts by quantity descending', () => {
    const rows = [
      {
        warehouse: { ref: 'wh-1', name: 'Склад Иванов И.И.' },
        employee_name: 'Иванов Иван Иванович',
        city: 'Тюмень',
        employment_status: 'dismissed',
        totals: { positions: 1, qty: 2, cost: 100, cost_accounting: 90 },
        balances_meta: { status: 'ok', truncated: false, has_more: false },
        balances: [{ nomenclature_name: 'Монитор' }],
      },
      {
        warehouse: { ref: 'wh-2', name: 'Склад Петров П.П.' },
        employee_name: 'Петров Петр Петрович',
        city: 'Москва',
        employment_status: 'dismissed',
        totals: { positions: 1, qty: 5, cost: 250, cost_accounting: 200 },
        balances_meta: { status: 'ok', truncated: false, has_more: false },
        balances: [{ nomenclature_name: 'Ноутбук' }],
      },
      {
        warehouse: { ref: 'wh-3', name: 'Склад Сидоров С.С.' },
        employee_name: 'Сидоров Сидор Сидорович',
        city: 'Тюмень',
        employment_status: 'dismissed',
        totals: { positions: 1, qty: 3, cost: 150, cost_accounting: 120 },
        balances_meta: { status: 'ok', truncated: false, has_more: false },
        balances: [{ nomenclature_name: 'Клавиатура' }],
      },
    ];

    render(
      <DismissedWarehousesPanel
        rows={rows}
        meta={{ status: 'ok', returned: 3, total: 3 }}
        loading={false}
        error=""
        searched
        onReload={vi.fn()}
        isMobile={false}
      />,
    );

    expect(screen.getByText('Показано складов с техникой: 3')).toBeInTheDocument();

    const citySelect = screen.getByLabelText('Город');
    fireEvent.mouseDown(citySelect);
    fireEvent.click(screen.getByRole('option', { name: 'Тюмень' }));

    expect(screen.getByText('Показано складов с техникой: 2 из 3')).toBeInTheDocument();
    expect(screen.queryByText('Петров Петр Петрович')).not.toBeInTheDocument();

    const sortSelect = screen.getByLabelText('Сортировка');
    fireEvent.mouseDown(sortSelect);
    fireEvent.click(screen.getByRole('option', { name: 'Количество' }));

    const descButton = screen.getByRole('button', { name: 'По убыванию' });
    fireEvent.click(descButton);

    const displayedRows = screen.getAllByText(/Склад .*\./);
    expect(displayedRows[0].textContent).toBe('Склад Сидоров С.С.');
    expect(displayedRows[1].textContent).toBe('Склад Иванов И.И.');
  });

  it('shows candidate city in the city filter for ambiguous warehouses', () => {
    const ambiguousRow = {
      warehouse: { ref: 'wh-2', name: 'Склад Иванов И.И.' },
      employee_name: null,
      city: null,
      employment_status: 'ambiguous',
      employment_label: 'Нужно уточнить',
      ambiguous: true,
      employee_candidates: [
        { employee_name: 'Иванов Иван Иванович', city: 'Тюмень', department: 'ИТ' },
        { employee_name: 'Иванов Илья Игоревич', city: 'Москва', department: 'ИТ' },
      ],
      totals: { positions: 1, qty: 1, cost: 50, cost_accounting: 45 },
      balances_meta: { status: 'ok', truncated: false, has_more: false },
      balances: [{ nomenclature_name: 'Монитор' }],
    };

    render(
      <DismissedWarehousesPanel
        rows={[ambiguousRow]}
        meta={{ status: 'ok', returned: 1, total: 1 }}
        loading={false}
        error=""
        searched
        onReload={vi.fn()}
        isMobile={false}
      />,
    );

    const citySelect = screen.getByLabelText('Город');
    fireEvent.mouseDown(citySelect);
    fireEvent.click(screen.getByRole('option', { name: 'Тюмень' }));

    expect(screen.getByText('Владелец не определён (2)')).toBeInTheDocument();
  });

  it('deduplicates city names with locality prefixes', () => {
    const rows = [
      {
        warehouse: { ref: 'wh-1', name: 'Склад Иванов И.И.' },
        employee_name: 'Иванов Иван Иванович',
        city: 'г.Тюмень',
        employment_status: 'dismissed',
        totals: { positions: 1, qty: 2, cost: 100, cost_accounting: 90 },
        balances_meta: { status: 'ok', truncated: false, has_more: false },
        balances: [{ nomenclature_name: 'Монитор' }],
      },
      {
        warehouse: { ref: 'wh-2', name: 'Склад Петров П.П.' },
        employee_name: 'Петров Петр Петрович',
        city: 'Тюмень',
        employment_status: 'dismissed',
        totals: { positions: 1, qty: 5, cost: 250, cost_accounting: 200 },
        balances_meta: { status: 'ok', truncated: false, has_more: false },
        balances: [{ nomenclature_name: 'Ноутбук' }],
      },
      {
        warehouse: { ref: 'wh-3', name: 'Склад Сидоров С.С.' },
        employee_name: 'Сидоров Сидор Сидорович',
        city: 'г. Санкт-Петербург',
        employment_status: 'dismissed',
        totals: { positions: 1, qty: 3, cost: 150, cost_accounting: 120 },
        balances_meta: { status: 'ok', truncated: false, has_more: false },
        balances: [{ nomenclature_name: 'Клавиатура' }],
      },
    ];

    render(
      <DismissedWarehousesPanel
        rows={rows}
        meta={{ status: 'ok', returned: 3, total: 3 }}
        loading={false}
        error=""
        searched
        onReload={vi.fn()}
        isMobile={false}
      />,
    );

    const citySelect = screen.getByLabelText('Город');
    fireEvent.mouseDown(citySelect);

    const tyumenOptions = screen.getAllByRole('option', { name: 'Тюмень' });
    expect(tyumenOptions).toHaveLength(1);
    expect(screen.getByRole('option', { name: 'Санкт-Петербург' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'г.Тюмень' })).not.toBeInTheDocument();

    fireEvent.click(tyumenOptions[0]);

    expect(screen.getByText('Показано складов с техникой: 2 из 3')).toBeInTheDocument();
    expect(screen.getByText('Иванов Иван Иванович')).toBeInTheDocument();
    expect(screen.getByText('Петров Петр Петрович')).toBeInTheDocument();
    expect(screen.queryByText('Сидоров Сидор Сидорович')).not.toBeInTheDocument();
  });

  it('does not present an unknown source as a confirmed empty result', () => {
    render(
      <DismissedWarehousesPanel
        rows={[]}
        meta={{ status: 'unknown', truncated: true }}
        loading={false}
        error=""
        searched
        onReload={vi.fn()}
        isMobile={false}
      />,
    );

    expect(screen.getByText(/Не удалось подтвердить полноту данных/)).toBeInTheDocument();
    expect(screen.queryByText('На складах уволенных сотрудников техника не числится')).not.toBeInTheDocument();
  });
});
