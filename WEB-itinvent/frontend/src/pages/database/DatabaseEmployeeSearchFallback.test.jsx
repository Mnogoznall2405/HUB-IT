import { act, fireEvent, render, screen } from '@testing-library/react';
import { createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

import DatabaseEmployeeSearchFallback from './DatabaseEmployeeSearchFallback';

const theme = createTheme();

const renderPanel = (overrides = {}) => {
  const onOpenEmployee = vi.fn();
  render(
    <DatabaseEmployeeSearchFallback
      active
      query="Иванов"
      loading={false}
      employees={[]}
      warehouseStatus="not_found"
      warehouseCandidates={[]}
      warehouseQuantity={null}
      employeeWarehouseResults={{}}
      onOpenEmployee={onOpenEmployee}
      onRetry={() => {}}
      theme={theme}
      ui={{}}
      {...overrides}
    />,
  );
  return { onOpenEmployee };
};

describe('DatabaseEmployeeSearchFallback', () => {
  it('opens a matched 1C warehouse when Hub has no employee', () => {
    const { onOpenEmployee } = renderPanel({
      warehouseStatus: 'matched',
      warehouse: { ref: 'wh-1', name: 'Иванов И.И.' },
      warehouseQuantity: 4,
    });

    fireEvent.click(screen.getByRole('button', { name: /Открыть склад и остатки/i }));

    expect(onOpenEmployee).toHaveBeenCalledWith({
      ownerNo: null,
      employeeName: 'Иванов И.И.',
      warehouseRef: 'wh-1',
    });
    expect(screen.getByText(/В 1С: 4 единицы/i)).toBeInTheDocument();
  });

  it('shows multiple Hub employees as keyboard-operable choices', () => {
    const { onOpenEmployee } = renderPanel({
      employees: [
        { owner_no: 1, name: 'Иванов Иван', department: 'ИТ', equipment_count: 0 },
        { owner_no: 2, name: 'Иванов Пётр', department: 'АСУ', equipment_count: 3 },
      ],
      warehouseStatus: '',
      employeeWarehouseResults: {
        1: {
          status: 'matched',
          warehouse: { ref: 'wh-1', name: 'Иванов Иван' },
          quantity: 2,
        },
        2: {
          status: 'matched',
          warehouse: { ref: 'wh-2', name: 'Иванов Пётр' },
          quantity: 5,
        },
      },
    });

    const choice = screen.getByRole('button', { name: /Иванов Пётр.*В 1С: 5 единиц/i });
    act(() => choice.focus());
    fireEvent.keyDown(choice, { key: 'Enter' });
    fireEvent.click(choice);

    expect(choice).toHaveFocus();
    expect(onOpenEmployee).toHaveBeenCalledWith({
      ownerNo: 2,
      employeeName: 'Иванов Пётр',
      warehouseRef: 'wh-2',
    });
    expect(screen.queryByText(/В Хабе:/i)).not.toBeInTheDocument();
  });

  it('passes an explicit warehouse candidate for an unambiguous dialog load', () => {
    const { onOpenEmployee } = renderPanel({
      warehouseStatus: 'ambiguous',
      warehouseCandidates: [{ ref: 'wh-2', name: 'Иванов П.П.' }],
    });

    fireEvent.click(screen.getByRole('button', { name: /Иванов П\.П\./i }));

    expect(onOpenEmployee).toHaveBeenCalledWith({
      ownerNo: null,
      employeeName: 'Иванов П.П.',
      warehouseRef: 'wh-2',
    });
  });

  it('keeps the live status region present while loading', () => {
    renderPanel({ loading: true, warehouseStatus: '' });

    expect(screen.getByRole('status')).toHaveTextContent('Идёт поиск сотрудника');
    expect(screen.getByTestId('database-employee-fallback')).toHaveAttribute('aria-busy', 'true');
  });
});
