import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import EmployeeEquipmentDialog from './EmployeeEquipmentDialog';

const {
  downloadEquipmentActFile,
  getEmployeeEquipment,
  getEmployeeWarehouse,
  getWarehouseMovements,
  exportEmployeeEquipmentWorkbook,
} = vi.hoisted(() => ({
  downloadEquipmentActFile: vi.fn(),
  getEmployeeEquipment: vi.fn(),
  getEmployeeWarehouse: vi.fn(),
  getWarehouseMovements: vi.fn(),
  exportEmployeeEquipmentWorkbook: vi.fn(),
}));

vi.mock('../../api/equipmentSearch', () => ({
  equipmentSearchAPI: { getEmployeeEquipment },
}));

vi.mock('../../api/warehouse1c', () => ({
  warehouse1cAPI: { getEmployeeWarehouse, getWarehouseMovements },
  isMeaningful1cRef: (value) => Boolean(value),
}));

vi.mock('../../api/equipmentTransferActs', () => ({
  equipmentTransferActsAPI: { downloadEquipmentActFile },
}));

vi.mock('../../api/equipmentRecords', () => ({
  equipmentRecordsAPI: { getEquipmentHistory: vi.fn(async () => ({ history: [] })) },
}));

vi.mock('../../components/documentPreview/DocumentPreviewDialog', () => ({
  default: ({ open, title }) => (open ? <div role="dialog" aria-label={title} /> : null),
  isDocumentPreviewKind: () => false,
}));

vi.mock('../../components/mail/MailAttachmentPreviewDialog', () => ({
  default: () => null,
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
    getWarehouseMovements.mockReset();
    getWarehouseMovements.mockResolvedValue({ items: [], has_more: false, status: 'ok' });
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

  it('colors rows by compare status on both sides', async () => {
    getEmployeeEquipment.mockResolvedValue({
      equipment: [
        { INV_NO: 'INV-1', MODEL_NAME: 'ThinkPad', PART_NO: '10' },
        { INV_NO: 'INV-2', MODEL_NAME: 'Monitor', PART_NO: '11' },
        { INV_NO: 'INV-3', MODEL_NAME: 'Keyboard', PART_NO: '30' },
      ],
    });
    getEmployeeWarehouse
      .mockResolvedValueOnce({
        status: 'matched',
        warehouse: { ref: 'wh-1', name: 'Иванова Е.Ю.' },
        balances: [],
      })
      .mockResolvedValueOnce({
        status: 'matched',
        warehouse: { ref: 'wh-1', name: 'Иванова Е.Ю.' },
        balances: [
          { nomenclature_ref: 'n1', nomenclature_code: '10', nomenclature_name: 'Ноутбук', qty_balance: 1 },
          { nomenclature_ref: 'n2', nomenclature_code: '20', nomenclature_name: 'Кабель', qty_balance: 2 },
          { nomenclature_ref: 'n3', nomenclature_code: '30', nomenclature_name: 'Клавиатура', qty_balance: 2 },
        ],
        balances_meta: { status: 'ok' },
      });

    renderDialog(false, true);

    expect(await screen.findByText('Ноутбук')).toBeInTheDocument();
    // Совпало: INV-1 (Парт. № 10) и строка 1С «10» — зелёные.
    expect(document.querySelectorAll('[data-compare-status="match"]')).toHaveLength(2);
    // Кол-во ≠: INV-3 (Парт. № 30, 1 шт) и строка 1С «30» (2 шт) — оранжевые.
    expect(document.querySelectorAll('[data-compare-status="diff"]')).toHaveLength(2);
    // Только в Хабе: INV-2 (Парт. № 11) — красная.
    expect(document.querySelectorAll('[data-compare-status="only_hub"]')).toHaveLength(1);
    // Только в 1С: «Кабель» (код 20) — синяя.
    expect(document.querySelectorAll('[data-compare-status="only_1c"]')).toHaveLength(1);
  });

  it('filters both lists by compare status', async () => {
    getEmployeeEquipment.mockResolvedValue({
      equipment: [
        { INV_NO: 'INV-1', MODEL_NAME: 'ThinkPad', PART_NO: '10' },
        { INV_NO: 'INV-2', MODEL_NAME: 'Monitor', PART_NO: '11' },
      ],
    });
    getEmployeeWarehouse
      .mockResolvedValueOnce({
        status: 'matched',
        warehouse: { ref: 'wh-1', name: 'Иванова Е.Ю.' },
        balances: [],
      })
      .mockResolvedValueOnce({
        status: 'matched',
        warehouse: { ref: 'wh-1', name: 'Иванова Е.Ю.' },
        balances: [
          { nomenclature_ref: 'n1', nomenclature_code: '10', nomenclature_name: 'Ноутбук', qty_balance: 1 },
          { nomenclature_ref: 'n2', nomenclature_code: '20', nomenclature_name: 'Кабель', qty_balance: 2 },
        ],
        balances_meta: { status: 'ok' },
      });

    renderDialog(false, true);

    expect(await screen.findByText('Ноутбук')).toBeInTheDocument();
    expect(screen.getByText('INV-1')).toBeInTheDocument();
    expect(screen.getByText('INV-2')).toBeInTheDocument();
    expect(screen.getByText('Кабель')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByLabelText('Статус сверки'));
    fireEvent.click(await screen.findByRole('option', { name: 'Только в Хабе' }));

    await waitFor(() => expect(screen.queryByText('INV-1')).not.toBeInTheDocument());
    expect(screen.getByText('INV-2')).toBeInTheDocument();
    // На стороне 1С под фильтр «Только в Хабе» ничего не подходит.
    expect(screen.queryByText('Ноутбук')).not.toBeInTheDocument();
    expect(screen.queryByText('Кабель')).not.toBeInTheDocument();
    expect(screen.getByText('По фильтру в 1С ничего не найдено.')).toBeInTheDocument();
  });

  it('filters hub equipment by type and narrows the 1C list to matching codes', async () => {
    getEmployeeEquipment.mockResolvedValue({
      equipment: [
        { INV_NO: 'INV-1', MODEL_NAME: 'ThinkPad', PART_NO: '10', TYPE_NAME: 'Ноутбук' },
        { INV_NO: 'INV-2', MODEL_NAME: 'Dell 24', PART_NO: '11', TYPE_NAME: 'Монитор' },
      ],
    });
    getEmployeeWarehouse
      .mockResolvedValueOnce({
        status: 'matched',
        warehouse: { ref: 'wh-1', name: 'Иванова Е.Ю.' },
        balances: [],
      })
      .mockResolvedValueOnce({
        status: 'matched',
        warehouse: { ref: 'wh-1', name: 'Иванова Е.Ю.' },
        balances: [
          { nomenclature_ref: 'n1', nomenclature_code: '10', nomenclature_name: 'Ноутбук', qty_balance: 1 },
          { nomenclature_ref: 'n2', nomenclature_code: '20', nomenclature_name: 'Кабель', qty_balance: 2 },
        ],
        balances_meta: { status: 'ok' },
      });

    renderDialog(false, true);

    expect(await screen.findByText('Ноутбук')).toBeInTheDocument();
    expect(screen.getByText('INV-1')).toBeInTheDocument();
    expect(screen.getByText('INV-2')).toBeInTheDocument();
    expect(screen.getByText('Кабель')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByLabelText('Тип оборудования'));
    fireEvent.click(await screen.findByRole('option', { name: 'Ноутбук' }));

    // В Хабе остаются только ноутбуки.
    await waitFor(() => expect(screen.queryByText('INV-2')).not.toBeInTheDocument());
    expect(screen.getByText('INV-1')).toBeInTheDocument();
    // В 1С — только код, встречающийся среди парт. № ноутбуков.
    // «Ноутбук» совпадает и с выбранным значением в селекте, поэтому ≥1.
    expect(screen.getAllByText('Ноутбук').length).toBeGreaterThan(0);
    expect(screen.queryByText('Кабель')).not.toBeInTheDocument();
  });

  it('fails closed when the 1C balances snapshot is incomplete', async () => {
    getEmployeeEquipment.mockResolvedValue({
      equipment: [
        { INV_NO: 'INV-1', MODEL_NAME: 'ThinkPad', PART_NO: '10' },
      ],
    });
    getEmployeeWarehouse
      .mockResolvedValueOnce({
        status: 'matched',
        warehouse: { ref: 'wh-1', name: 'Иванова Е.Ю.' },
        balances: [],
      })
      .mockResolvedValueOnce({
        status: 'matched',
        warehouse: { ref: 'wh-1', name: 'Иванова Е.Ю.' },
        balances: [
          { nomenclature_ref: 'n1', nomenclature_code: '10', nomenclature_name: 'Ноутбук', qty_balance: 1 },
        ],
        balances_meta: { status: 'unknown' },
      });

    renderDialog(false, true);

    expect(await screen.findByText('Ноутбук')).toBeInTheDocument();
    expect(screen.getByText(/Остатки 1С загружены не полностью/i)).toBeInTheDocument();
    expect(document.querySelectorAll('[data-compare-status]')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Скопировать расхождения' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Задача на инвентаризацию' })).toBeDisabled();
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
        balances_meta: { status: 'ok' },
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
        statusFilter: '',
        typeFilter: '',
        compareMaps: expect.objectContaining({
          qty1cByCode: expect.any(Map),
          countByPartNo: expect.any(Map),
        }),
        movements: [],
      });
    });
  });

  it('shows warehouse movements grouped by document in the Перемещения tab', async () => {
    getEmployeeEquipment.mockResolvedValue({
      equipment: [{ INV_NO: 'INV-1', MODEL_NAME: 'ThinkPad', PART_NO: '10' }],
    });
    getEmployeeWarehouse
      .mockResolvedValueOnce({
        status: 'matched',
        warehouse: { ref: 'wh-1', name: 'Иванова Е.Ю.' },
        balances: [],
      })
      .mockResolvedValueOnce({
        status: 'matched',
        warehouse: { ref: 'wh-1', name: 'Иванова Е.Ю.' },
        balances: [],
        balances_meta: { status: 'ok' },
      });
    getWarehouseMovements.mockResolvedValue({
      items: [
        {
          registrar_ref: 'doc-1',
          registrar_number: '000123',
          registrar_name: 'Перемещение МПЗ между складами 000123',
          period: '2025-03-12T10:00:00',
          document_type: 'transfer',
          direction: 'out',
          positions: 2,
          transfer_from_warehouse_name: 'Иванова Е.Ю.',
          transfer_to_warehouse_name: 'Центральный склад',
          items: [
            { nomenclature_code: '10', nomenclature_name: 'Ноутбук', qty_out: 1 },
            { nomenclature_code: '20', nomenclature_name: 'Кабель', qty_out: 2 },
          ],
        },
      ],
      has_more: false,
      status: 'ok',
    });

    renderDialog(false, true);

    const tab = await screen.findByRole('tab', { name: 'Перемещения' });
    fireEvent.click(tab);

    await waitFor(() => {
      expect(getWarehouseMovements).toHaveBeenCalledWith({
        warehouseRef: 'wh-1',
        limit: 100,
        cursor: '',
        dateFrom: '',
        dateTo: '',
      });
    });
    expect(await screen.findByText(/Перемещение №000123/)).toBeInTheDocument();
    expect(screen.getByText('Иванова Е.Ю. → Центральный склад')).toBeInTheDocument();
    expect(screen.getByText('2 поз.')).toBeInTheDocument();
    // «Расход» — чип фильтра и чип направления документа.
    expect(screen.getAllByText('Расход').length).toBeGreaterThanOrEqual(2);

    // Позиции раскрываются по клику на документ.
    fireEvent.click(screen.getByRole('button', { name: 'Показать позиции' }));
    expect(await screen.findByText(/Ноутбук/)).toBeInTheDocument();
    expect(screen.getByText(/Кабель/)).toBeInTheDocument();
  });
});
