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
  getAgentComputersByInvNos,
} = vi.hoisted(() => ({
  downloadEquipmentActFile: vi.fn(),
  getEmployeeEquipment: vi.fn(),
  getEmployeeWarehouse: vi.fn(),
  getWarehouseMovements: vi.fn(),
  exportEmployeeEquipmentWorkbook: vi.fn(),
  getAgentComputersByInvNos: vi.fn(),
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

vi.mock('../../api/equipmentComputers', () => ({
  equipmentComputersAPI: { getAgentComputersByInvNos },
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

const setMatchMedia = (matches = false) => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: typeof matches === 'function' ? matches(query) : matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
};

const renderDialog = (allowCrossDatabase, canViewWarehouse1C = false, extraProps = {}) => render(
  <MemoryRouter>
    <EmployeeEquipmentDialog
      open
      ownerNo={42}
      employeeName="Иванова Екатерина Юрьевна"
      allowCrossDatabase={allowCrossDatabase}
      canViewWarehouse1C={canViewWarehouse1C}
      onClose={() => {}}
      {...extraProps}
    />
  </MemoryRouter>,
);

const matchedWarehouse = {
  status: 'matched',
  warehouse: { ref: 'wh-1', name: 'Иванова Е.Ю.' },
  balances: [],
};

const balancesPayload = (balances, meta = { status: 'ok' }) => ({
  status: 'matched',
  warehouse: { ref: 'wh-1', name: 'Иванова Е.Ю.' },
  balances,
  balances_meta: meta,
});

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
    getAgentComputersByInvNos.mockReset();
    getAgentComputersByInvNos.mockResolvedValue({ items: {} });
    setMatchMedia(false);
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

  it('marks equipment in use with a live agent chip', async () => {
    getEmployeeEquipment.mockResolvedValue({
      equipment: [
        { INV_NO: 'INV-1', MODEL_NAME: 'ThinkPad' },
        { INV_NO: 'INV-2', MODEL_NAME: 'Monitor' },
      ],
    });
    getAgentComputersByInvNos.mockResolvedValue({
      items: {
        'INV-1': {
          hostname: 'PC-01',
          status: 'online',
          user_login: 'CORP\\ivanova',
          last_seen_at: 1710003000,
        },
      },
    });

    renderDialog(false);

    await waitFor(() => {
      expect(getAgentComputersByInvNos).toHaveBeenCalledWith(['INV-1', 'INV-2'], {});
    });
    expect(await screen.findByText('В работе: PC-01')).toBeInTheDocument();
    expect(screen.getAllByText(/В работе:/)).toHaveLength(1);
  });

  it('marks a monitor item with the PC it is attached to', async () => {
    getEmployeeEquipment.mockResolvedValue({
      equipment: [
        { INV_NO: 'INV-1', MODEL_NAME: 'ThinkPad' },
        { INV_NO: 'INV-2', MODEL_NAME: 'Dell 24' },
      ],
    });
    getAgentComputersByInvNos.mockResolvedValue({
      items: {
        'INV-1': {
          hostname: 'PC-01',
          status: 'online',
          kind: 'computer',
          user_login: 'CORP\\ivanova',
        },
        'INV-2': {
          hostname: 'PC-01',
          status: 'online',
          kind: 'monitor',
          monitor_manufacturer: 'Dell',
          monitor_product_code: 'U2422H',
        },
      },
    });

    renderDialog(false);

    expect(await screen.findByText('В работе: PC-01')).toBeInTheDocument();
    expect(await screen.findByText('Подключён: PC-01')).toBeInTheDocument();
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

  it('makes the Hub scope explicit', async () => {
    getEmployeeWarehouse.mockResolvedValue(matchedWarehouse);
    const currentScope = renderDialog(false, true);
    expect(await screen.findByText(/текущая база/i)).toBeInTheDocument();
    expect(screen.queryByText(/все базы/i)).not.toBeInTheDocument();
    currentScope.unmount();

    renderDialog(true, true);
    expect(await screen.findByText(/все базы/i)).toBeInTheDocument();
  });

  it('never compares before the Hub equipment finishes loading', async () => {
    let resolveHub;
    getEmployeeEquipment.mockImplementation(() => new Promise((resolve) => {
      resolveHub = resolve;
    }));
    getEmployeeWarehouse
      .mockResolvedValueOnce(matchedWarehouse)
      .mockResolvedValueOnce(balancesPayload([
        { nomenclature_code: '10', nomenclature_name: 'Ноутбук', qty_balance: 1 },
      ]));

    renderDialog(false, true);

    expect(await screen.findByText('Ноутбук')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-compare-status]')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Скопировать расхождения' })).toBeDisabled();

    await act(async () => {
      resolveHub({ equipment: [{ INV_NO: 'INV-1', MODEL_NAME: 'ThinkPad', PART_NO: '10' }] });
    });

    await waitFor(() => {
      expect(document.querySelectorAll('[data-compare-status="match"]').length).toBeGreaterThan(0);
    });
    expect(screen.getByRole('button', { name: 'Скопировать расхождения' })).not.toBeDisabled();
  });

  it('suppresses comparison and actions when the Hub lookup fails', async () => {
    getEmployeeEquipment.mockRejectedValue(new Error('boom'));
    getEmployeeWarehouse
      .mockResolvedValueOnce(matchedWarehouse)
      .mockResolvedValueOnce(balancesPayload([
        { nomenclature_code: '10', nomenclature_name: 'Ноутбук', qty_balance: 1 },
      ]));

    renderDialog(false, true);

    expect(await screen.findByText('Ноутбук')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-compare-status]')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Скопировать расхождения' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Задача на инвентаризацию' })).toBeDisabled();
  });

  it('suppresses comparison when a cross-database lookup reports partial errors', async () => {
    getEmployeeEquipment.mockResolvedValue({
      equipment: [{ INV_NO: 'INV-1', MODEL_NAME: 'ThinkPad', PART_NO: '10' }],
      db_errors: ['archive'],
    });
    getEmployeeWarehouse
      .mockResolvedValueOnce(matchedWarehouse)
      .mockResolvedValueOnce(balancesPayload([
        { nomenclature_code: '10', nomenclature_name: 'Ноутбук', qty_balance: 1 },
      ]));

    renderDialog(true, true);

    expect(await screen.findByText(/список может быть неполным/i)).toBeInTheDocument();
    expect(document.querySelectorAll('[data-compare-status]')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Скопировать расхождения' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Задача на инвентаризацию' })).toBeDisabled();
  });

  it('treats balances meta without a status as unavailable', async () => {
    getEmployeeEquipment.mockResolvedValue({
      equipment: [{ INV_NO: 'INV-1', MODEL_NAME: 'ThinkPad', PART_NO: '10' }],
    });
    getEmployeeWarehouse
      .mockResolvedValueOnce(matchedWarehouse)
      .mockResolvedValueOnce(balancesPayload(
        [{ nomenclature_code: '10', nomenclature_name: 'Ноутбук', qty_balance: 1 }],
        {},
      ));

    renderDialog(false, true);

    expect(await screen.findByText('Ноутбук')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-compare-status]')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Скопировать расхождения' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Задача на инвентаризацию' })).toBeDisabled();
  });

  it.each([
    [{ unexpected: true }, 'object without equipment'],
    [null, 'null'],
  ])('suppresses comparison when the Hub response is malformed (%s)', async (response) => {
    getEmployeeEquipment.mockResolvedValue(response);
    getEmployeeWarehouse
      .mockResolvedValueOnce(matchedWarehouse)
      .mockResolvedValueOnce(balancesPayload([
        { nomenclature_code: '10', nomenclature_name: 'Ноутбук', qty_balance: 1 },
      ]));

    renderDialog(false, true);

    expect(await screen.findByText('Ноутбук')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-compare-status]')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Скопировать расхождения' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Задача на инвентаризацию' })).toBeDisabled();
  });

  it.each([
    ['', 'empty string'],
    ['abc', 'non-numeric'],
    [-1, 'negative'],
    [null, 'missing'],
    [true, 'boolean'],
    [[1], 'array'],
  ])('suppresses comparison for a %s qty_balance (%s)', async (qty) => {
    getEmployeeEquipment.mockResolvedValue({
      equipment: [{ INV_NO: 'INV-1', MODEL_NAME: 'ThinkPad', PART_NO: '10' }],
    });
    getEmployeeWarehouse
      .mockResolvedValueOnce(matchedWarehouse)
      .mockResolvedValueOnce(balancesPayload([
        { nomenclature_code: '10', nomenclature_name: 'Ноутбук', qty_balance: qty },
      ]));

    renderDialog(false, true);

    expect(await screen.findByText('Ноутбук')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-compare-status]')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Скопировать расхождения' })).toBeDisabled();
  });

  it('publishes a fresh owner summary once both sources are complete', async () => {
    const onComparisonChange = vi.fn();
    getEmployeeEquipment.mockResolvedValue({
      equipment: [
        { INV_NO: '100021', MODEL_NAME: 'Philips 243V', PART_NO: 'ЦБ-00195776' },
        { INV_NO: '100022', MODEL_NAME: 'Philips 243V', PART_NO: 'ЦБ-00195776' },
      ],
    });
    getEmployeeWarehouse
      .mockResolvedValueOnce(matchedWarehouse)
      .mockResolvedValueOnce(balancesPayload(
        [{ nomenclature_code: 'ЦБ-00195776', nomenclature_name: 'Монитор', qty_balance: 1 }],
        { status: 'ok', as_of: '2026-05-27T12:00:00.000Z' },
      ));

    renderDialog(false, true, { onComparisonChange });

    await waitFor(() => {
      expect(onComparisonChange).toHaveBeenCalledWith(expect.objectContaining({
        ownerNo: 42,
        summary: expect.objectContaining({
          status: 'diff',
          part_quantities: {
            'цб-00195776': { hub_count: 2, qty_1c: 1 },
          },
        }),
      }));
    });
    const summary = onComparisonChange.mock.calls.at(-1)[0].summary;
    expect(summary.as_of).toBe('2026-05-27T12:00:00.000Z');
    expect(summary.counts.hub_items).toBe(2);
  });

  it('does not publish a current-DB summary from a cross-database dialog', async () => {
    const onComparisonChange = vi.fn();
    getEmployeeEquipment.mockResolvedValue({
      equipment: [{ INV_NO: 'INV-1', MODEL_NAME: 'ThinkPad', PART_NO: '10' }],
    });
    getEmployeeWarehouse
      .mockResolvedValueOnce(matchedWarehouse)
      .mockResolvedValueOnce(balancesPayload([
        { nomenclature_code: '10', nomenclature_name: 'Ноутбук', qty_balance: 1 },
      ]));

    renderDialog(true, true, { onComparisonChange });

    expect(await screen.findByText('Ноутбук')).toBeInTheDocument();
    await waitFor(() => {
      expect(document.querySelectorAll('[data-compare-status="match"]').length).toBeGreaterThan(0);
    });
    expect(onComparisonChange).not.toHaveBeenCalled();
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

  it('expands each of several matched warehouses in place and loads only that warehouse', async () => {
    getEmployeeEquipment.mockResolvedValue({ equipment: [] });
    getEmployeeWarehouse.mockImplementation(async ({ warehouseRef, loadBalances }) => {
      if (!warehouseRef) {
        return {
          status: 'ambiguous',
          warehouse: null,
          candidates: [
            { ref: 'wh-a', name: 'Иванова Е.Ю. (офис)' },
            { ref: 'wh-b', name: 'Иванова Е.Ю. (выезд)' },
          ],
          balances: [],
        };
      }
      return {
        status: 'matched',
        warehouse: { ref: warehouseRef },
        balances: loadBalances
          ? [{ nomenclature_ref: 'n1', nomenclature_code: '10', nomenclature_name: 'Кабель HDMI', qty_balance: 3 }]
          : [],
        balances_meta: { status: 'ok' },
      };
    });

    renderDialog(false, true);

    const office = await screen.findByRole('button', { name: /Иванова Е\.Ю\. \(офис\)/ });
    expect(screen.queryByText('Кабель HDMI')).not.toBeInTheDocument();

    fireEvent.click(office);
    expect(await screen.findByText('Кабель HDMI')).toBeInTheDocument();
    // Balances of every candidate are loaded once (for the summed comparison); expanding does not refetch.
    await waitFor(() => expect(getEmployeeWarehouse).toHaveBeenCalledTimes(3));
    expect(getEmployeeWarehouse).toHaveBeenCalledWith(
      expect.objectContaining({ warehouseRef: 'wh-a', loadBalances: true }),
    );
    expect(getEmployeeWarehouse).toHaveBeenCalledWith(
      expect.objectContaining({ warehouseRef: 'wh-b', loadBalances: true }),
    );

    fireEvent.click(office);
    await waitFor(() => expect(screen.queryByText('Кабель HDMI')).not.toBeInTheDocument());
  });

  describe('several warehouses of one person', () => {
    const candidatesPayload = (count = 2) => ({
      status: 'ambiguous',
      warehouse: null,
      candidates: Array.from({ length: count }, (_, index) => ({ ref: `wh-${index}`, name: `Склад объекта ${index}` })),
      balances: [],
    });
    const balancesByRef = (map, failRef = '') => async ({ warehouseRef }) => {
      if (!warehouseRef) return candidatesPayload(Object.keys(map).length);
      if (warehouseRef === failRef) throw new Error('1C is busy');
      return {
        status: 'matched',
        warehouse: { ref: warehouseRef },
        balances: map[warehouseRef] || [],
        balances_meta: { status: 'ok' },
      };
    };
    const monitorRow = (qty) => ({
      nomenclature_ref: 'n1', nomenclature_code: '10', nomenclature_name: 'Монитор Dell', qty_balance: qty,
    });

    it('compares the Hub with the sum of all candidate warehouses', async () => {
      getEmployeeEquipment.mockResolvedValue({
        equipment: [
          { INV_NO: 'INV-1', MODEL_NAME: 'Dell E2720H', PART_NO: '10' },
          { INV_NO: 'INV-2', MODEL_NAME: 'Dell E2720H', PART_NO: '10' },
        ],
      });
      // One monitor on each of two object warehouses: 1 + 1 matches the two Hub items.
      getEmployeeWarehouse.mockImplementation(balancesByRef({ 'wh-0': [monitorRow(1)], 'wh-1': [monitorRow(1)] }));

      renderDialog(false, true);

      await waitFor(() => expect(document.querySelectorAll('[data-compare-status="match"]')).toHaveLength(2));
      expect(document.querySelectorAll('[data-compare-status="diff"]')).toHaveLength(0);
    });

    it('shows no comparison while one of the warehouses failed to load', async () => {
      getEmployeeEquipment.mockResolvedValue({
        equipment: [{ INV_NO: 'INV-1', MODEL_NAME: 'Dell E2720H', PART_NO: '10' }],
      });
      getEmployeeWarehouse.mockImplementation(
        balancesByRef({ 'wh-0': [monitorRow(1)], 'wh-1': [] }, 'wh-1'),
      );

      renderDialog(false, true);

      await waitFor(() => expect(getEmployeeWarehouse).toHaveBeenCalledWith(
        expect.objectContaining({ warehouseRef: 'wh-1', loadBalances: true }),
      ));
      await screen.findByText('INV-1');
      expect(document.querySelectorAll('[data-compare-status]')).toHaveLength(0);
    });

    it('does not sum a candidate list that may be truncated', async () => {
      getEmployeeEquipment.mockResolvedValue({
        equipment: [{ INV_NO: 'INV-1', MODEL_NAME: 'Dell E2720H', PART_NO: '10' }],
      });
      getEmployeeWarehouse.mockImplementation(async () => candidatesPayload(20));

      renderDialog(false, true);

      await screen.findByText('INV-1');
      expect(getEmployeeWarehouse).toHaveBeenCalledTimes(1);
      expect(document.querySelectorAll('[data-compare-status]')).toHaveLength(0);
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

  it('on mobile shows one panel behind Hub/1C tabs and collapsible filters', async () => {
    setMatchMedia((query) => query.includes('max-width'));
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
        balances: [
          { nomenclature_code: '10', nomenclature_name: 'Ноутбук', qty_balance: 1 },
        ],
        balances_meta: { status: 'ok' },
      });

    renderDialog(false, true);

    // Фильтры свёрнуты: поле поиска недоступно до раскрытия.
    expect(screen.queryByLabelText('Поиск')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Фильтры/ }));
    expect(await screen.findByLabelText('Поиск')).toBeInTheDocument();

    // По умолчанию видна панель Хаба, склад 1С за табом.
    expect(await screen.findByText('INV-1')).toBeInTheDocument();
    expect(screen.queryByTestId('employee-warehouse-name')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Склад 1С' }));

    expect(await screen.findByTestId('employee-warehouse-name')).toBeInTheDocument();
    expect(await screen.findByText('Ноутбук')).toBeInTheDocument();
    expect(screen.queryByText('INV-1')).not.toBeInTheDocument();
  });
});
