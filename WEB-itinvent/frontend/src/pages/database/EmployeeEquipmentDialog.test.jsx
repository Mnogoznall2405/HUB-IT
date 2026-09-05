import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import EmployeeEquipmentDialog from './EmployeeEquipmentDialog';

const {
  downloadEquipmentActFile,
  getEmployeeEquipment,
  getEmployeeWarehouse,
  exportEmployeeEquipmentWorkbook,
} = vi.hoisted(() => ({
  downloadEquipmentActFile: vi.fn(),
  getEmployeeEquipment: vi.fn(),
  getEmployeeWarehouse: vi.fn(),
  exportEmployeeEquipmentWorkbook: vi.fn(),
}));

vi.mock('../../api/equipmentSearch', () => ({
  equipmentSearchAPI: { getEmployeeEquipment },
}));

vi.mock('../../api/warehouse1c', () => ({
  warehouse1cAPI: { getEmployeeWarehouse },
}));

vi.mock('../../api/equipmentTransferActs', () => ({
  equipmentTransferActsAPI: { downloadEquipmentActFile },
}));

vi.mock('../../components/documentPreview/DocumentPreviewDialog', () => ({
  default: ({ open, title }) => (open ? <div role="dialog" aria-label={title} /> : null),
}));

vi.mock('./employeeEquipmentExcel', () => ({
  exportEmployeeEquipmentWorkbook,
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
    downloadEquipmentActFile.mockReset();
    downloadEquipmentActFile.mockResolvedValue({
      data: new Blob(['%PDF-1.4'], { type: 'application/pdf' }),
      headers: { 'content-type': 'application/pdf' },
    });
    exportEmployeeEquipmentWorkbook.mockReset();
    exportEmployeeEquipmentWorkbook.mockResolvedValue('оборудование.xlsx');
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

  it('shows and opens the current act from the employee equipment table', async () => {
    getEmployeeEquipment.mockResolvedValue({
      equipment: [
        {
          inv_no: 'INV-1',
          model_name: 'ThinkPad',
          hub_db_id: 'archive',
          current_act_available: true,
          current_act_doc_no: 77,
          current_act_doc_number: 'ACT-77',
          current_act_doc_date: '2026-09-04T08:30:00',
        },
        {
          inv_no: 'INV-2',
          model_name: 'Monitor',
          current_act_available: false,
        },
      ],
    });

    renderDialog(true);

    const openActButton = await screen.findByRole('button', { name: /Открыть актуальный акт ACT-77/ });
    fireEvent.click(openActButton);

    await waitFor(() => {
      expect(downloadEquipmentActFile).toHaveBeenCalledWith('77', expect.objectContaining({
        inv_no: 'INV-1',
        db_id: 'archive',
      }));
    });
    expect(screen.getByLabelText('Актуального акта нет для оборудования INV-2')).toBeInTheDocument();
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

  it('exports both visible tables to Excel after they finish loading', async () => {
    getEmployeeEquipment.mockResolvedValue({
      equipment: [{ INV_NO: 'INV-1', MODEL_NAME: 'ThinkPad', SERIAL_NO: 'SN-1', PART_NO: 'PN-1' }],
    });
    getEmployeeWarehouse
      .mockResolvedValueOnce({
        status: 'matched',
        warehouse: { ref: 'wh-1', name: 'Иванова Екатерина Юрьевна' },
        balances: [],
      })
      .mockResolvedValueOnce({
        status: 'matched',
        warehouse: { ref: 'wh-1', name: 'Иванова Екатерина Юрьевна' },
        balances: [{ nomenclature_code: '10', nomenclature_name: 'Кабель', qty_balance: 2 }],
      });

    renderDialog(false, true);

    const exportButton = await screen.findByRole('button', { name: 'Выгрузить в Excel' });
    await waitFor(() => expect(exportButton).not.toBeDisabled());
    expect(await screen.findByText('INV-1')).toBeInTheDocument();
    expect(await screen.findByText('Кабель')).toBeInTheDocument();

    fireEvent.click(exportButton);

    await waitFor(() => {
      expect(exportEmployeeEquipmentWorkbook).toHaveBeenCalledWith({
        employeeName: 'Иванова Екатерина Юрьевна',
        hubItems: [
          { INV_NO: 'INV-1', MODEL_NAME: 'ThinkPad', SERIAL_NO: 'SN-1', PART_NO: 'PN-1' },
        ],
        warehouseBalances: [
          { nomenclature_code: '10', nomenclature_name: 'Кабель', qty_balance: 2 },
        ],
        warehouseName: 'Иванова Екатерина Юрьевна',
        warehouseStatus: 'matched',
        includeWarehouse: true,
        filterText: '',
      });
    });
  });
});
