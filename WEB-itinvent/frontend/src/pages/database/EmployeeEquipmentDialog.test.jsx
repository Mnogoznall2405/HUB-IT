import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import EmployeeEquipmentDialog from './EmployeeEquipmentDialog';

const { getEmployeeEquipment, getEmployeeWarehouse } = vi.hoisted(() => ({
  getEmployeeEquipment: vi.fn(),
  getEmployeeWarehouse: vi.fn(),
}));

vi.mock('../../api/equipmentSearch', () => ({
  equipmentSearchAPI: { getEmployeeEquipment },
}));

vi.mock('../../api/warehouse1c', () => ({
  warehouse1cAPI: { getEmployeeWarehouse },
}));

vi.mock('./HubNomenclatureMatchDialog', () => ({
  default: () => null,
}));

const renderDialog = (allowCrossDatabase, canViewWarehouse1C = false) => render(
  <MemoryRouter>
    <EmployeeEquipmentDialog
      open
      ownerNo={42}
      employeeName="Иванова Екатерина Юрьевна"
      allowCrossDatabase={allowCrossDatabase}
      canViewWarehouse1C={canViewWarehouse1C}
      onClose={() => {}}
    />
  </MemoryRouter>,
);

describe('EmployeeEquipmentDialog', () => {
  beforeEach(() => {
    getEmployeeEquipment.mockReset();
    getEmployeeEquipment.mockResolvedValue({ equipment: [] });
    getEmployeeWarehouse.mockReset();
  });

  it('keeps a non-admin lookup within the current Hub database', async () => {
    renderDialog(false);

    await waitFor(() => {
      expect(getEmployeeEquipment).toHaveBeenCalledWith(42, {
        employeeName: 'Иванова Екатерина Юрьевна',
        allDatabases: false,
      });
    });
  });

  it('uses cross-database lookup only when explicitly allowed', async () => {
    renderDialog(true);

    await waitFor(() => {
      expect(getEmployeeEquipment).toHaveBeenCalledWith(42, {
        employeeName: 'Иванова Екатерина Юрьевна',
        allDatabases: true,
      });
    });
  });

  it('shows the matched warehouse before its live 1C balances finish loading', async () => {
    let resolveBalances;
    const balancesPending = new Promise((resolve) => {
      resolveBalances = resolve;
    });
    getEmployeeWarehouse
      .mockResolvedValueOnce({
        status: 'matched',
        warehouse: { ref: 'wh-1', name: 'Иванова Екатерина Юрьевна' },
        balances: [],
      })
      .mockReturnValueOnce(balancesPending);

    renderDialog(false, true);

    expect(await screen.findByTestId('employee-warehouse-name')).toHaveTextContent(
      'Иванова Екатерина Юрьевна',
    );
    expect(getEmployeeWarehouse).toHaveBeenNthCalledWith(1, {
      employeeName: 'Иванова Екатерина Юрьевна',
      warehouseRef: '',
      loadBalances: false,
    });
    expect(getEmployeeWarehouse).toHaveBeenNthCalledWith(2, {
      employeeName: 'Иванова Екатерина Юрьевна',
      warehouseRef: 'wh-1',
      loadBalances: true,
    });

    await act(async () => {
      resolveBalances({
        status: 'matched',
        warehouse: { ref: 'wh-1', name: 'Иванова Екатерина Юрьевна' },
        balances: [],
      });
      await balancesPending;
    });
  });

  it('loads an explicit 1C warehouse without calling Hub when ownerNo is absent', async () => {
    getEmployeeWarehouse
      .mockResolvedValueOnce({
        status: 'matched',
        warehouse: { ref: 'wh-1', name: 'Иванов И.И.' },
        balances: [],
      })
      .mockResolvedValueOnce({
        status: 'matched',
        warehouse: { ref: 'wh-1', name: 'Иванов И.И.' },
        balances: [{ nomenclature_ref: 'nom-1', nomenclature_name: 'Ноутбук', qty_balance: 1 }],
      });

    render(
      <MemoryRouter>
        <EmployeeEquipmentDialog
          open
          ownerNo={null}
          employeeName="Иванов И.И."
          warehouseRef="wh-1"
          canViewWarehouse1C
          onClose={() => {}}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Сотрудник не найден в справочнике Хаба.')).toBeInTheDocument();
    await waitFor(() => expect(getEmployeeWarehouse).toHaveBeenCalledTimes(2));

    expect(getEmployeeEquipment).not.toHaveBeenCalled();
    expect(getEmployeeWarehouse).toHaveBeenNthCalledWith(1, {
      employeeName: 'Иванов И.И.',
      warehouseRef: 'wh-1',
      loadBalances: false,
    });
    expect(getEmployeeWarehouse).toHaveBeenNthCalledWith(2, {
      employeeName: 'Иванов И.И.',
      warehouseRef: 'wh-1',
      loadBalances: true,
    });
  });
});
