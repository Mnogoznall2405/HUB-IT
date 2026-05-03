import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

import EquipmentTable from './EquipmentTable';
import { DATA_MODE_CONSUMABLES, DATA_MODE_EQUIPMENT } from './equipmentModel';

vi.mock('../../components/common', () => ({
  ActionMenu: ({ onAction, actions, item, label }) => (
    <button type="button" aria-label={label} onClick={() => onAction?.(actions?.[0], item)}>
      actions
    </button>
  ),
  StatusChip: ({ status }) => <span data-testid="status-chip">{status}</span>,
}));

const theme = createTheme();

const renderTable = (props = {}) => render(
  <EquipmentTable
    items={[]}
    isMobile={false}
    theme={theme}
    selectedItemsSet={new Set()}
    tableSort={{ field: 'employee', direction: 'asc' }}
    onTableSort={() => {}}
    onSelectAll={() => {}}
    isAllSelected={() => false}
    isSomeSelected={() => false}
    onSelect={() => {}}
    onAction={() => {}}
    dataMode={DATA_MODE_EQUIPMENT}
    {...props}
  />
);

describe('EquipmentTable', () => {
  it('renders equipment rows and wires selection, sorting, and actions', () => {
    const onSelect = vi.fn();
    const onAction = vi.fn();
    const onTableSort = vi.fn();

    renderTable({
      items: [{
        INV_NO: '1001',
        ID: 7,
        SERIAL_NO: 'SN-1',
        PART_NO: 'PN-1',
        TYPE_NAME: 'PC',
        MODEL_NAME: 'OptiPlex',
        OWNER_DISPLAY_NAME: 'Ivan Petrov',
        OWNER_DEPT: 'IT',
        DESCR: 'Active',
      }],
      selectedItemsSet: new Set(['1001']),
      onSelect,
      onAction,
      onTableSort,
      canWrite: true,
      isAdmin: true,
    });

    expect(screen.getByText('1001')).toBeInTheDocument();
    expect(screen.getByText('Ivan Petrov')).toBeInTheDocument();
    expect(screen.getByTestId('status-chip')).toHaveTextContent('Active');

    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    expect(onSelect).toHaveBeenCalledWith('1001');

    fireEvent.click(screen.getByText(/\u0418\u043d\u0432/));
    expect(onTableSort).toHaveBeenCalledWith('inv');

    fireEvent.click(screen.getByRole('button', { name: 'Actions for 1001' }));
    expect(onAction).toHaveBeenCalledWith('view', expect.objectContaining({ INV_NO: '1001' }));
  });

  it('renders consumable rows and exposes quantity editing', () => {
    const onEditConsumableQty = vi.fn();

    renderTable({
      dataMode: DATA_MODE_CONSUMABLES,
      tableSort: { field: 'model', direction: 'asc' },
      items: [{
        INV_NO: 'C-1',
        ID: 9,
        TYPE_NAME: 'Toner',
        MODEL_NAME: 'HP 12A',
        QTY: '12',
      }],
      onEditConsumableQty,
    });

    expect(screen.getByText('C-1')).toBeInTheDocument();
    expect(screen.getByText('HP 12A')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('\u0418\u0437\u043c\u0435\u043d\u0438\u0442\u044c \u043a\u043e\u043b\u0438\u0447\u0435\u0441\u0442\u0432\u043e'));

    expect(onEditConsumableQty).toHaveBeenCalledWith(expect.objectContaining({ INV_NO: 'C-1' }));
  });
});
