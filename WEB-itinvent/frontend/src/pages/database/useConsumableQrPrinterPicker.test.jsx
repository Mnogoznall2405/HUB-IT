import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { equipmentAPI } from '../../api/client';
import jsonAPI from '../../api/json_client';
import { useConsumableCard } from './useConsumableCard';
import { useConsumableQrPrinterPicker } from './useConsumableQrPrinterPicker';

vi.mock('../../api/client', () => ({
  equipmentAPI: {
    consumeConsumable: vi.fn(async () => ({ qty_new: 6 })),
    getConsumableById: vi.fn(),
    searchUniversal: vi.fn(async () => ({ equipment: [], total: 0 })),
  },
}));

vi.mock('../../api/json_client', () => ({
  default: {
    getPrintersForCartridge: vi.fn(async () => ({ data: { printer_models: [] } })),
    addCartridgeReplacement: vi.fn(async () => ({})),
  },
}));

vi.mock('../../api/database', () => ({
  databaseAPI: { switchDatabase: vi.fn(async () => ({})) },
}));

const cartridgeItem = {
  ID: 42,
  INV_NO: 'C-7',
  MODEL_NAME: 'CF283A',
  TYPE_NAME: 'Картридж',
  BRANCH_NAME: 'Главный',
  LOCATION_NAME: 'Склад',
  QTY: 7,
};

const paperItem = {
  ID: 55,
  INV_NO: 'P-1',
  MODEL_NAME: 'A4 Paper',
  TYPE_NAME: 'Бумага',
  QTY: 30,
};

const mfu = {
  id: 900,
  inv_no: 'INV-100',
  serial_no: 'SN-42',
  model_name: 'HP LaserJet M404',
  vendor_name: 'HP',
  type_name: 'МФУ',
  employee_name: 'Иванов И.И.',
  branch_name: 'Главный',
  location_name: 'Каб. 12',
  hw_serial_no: 'HW-42',
};

const renderPicker = (options = {}) =>
  renderHook(() => useConsumableQrPrinterPicker({ open: true, item: cartridgeItem, ...options }));

describe('useConsumableQrPrinterPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    equipmentAPI.consumeConsumable.mockResolvedValue({ qty_new: 6 });
    equipmentAPI.searchUniversal.mockResolvedValue({ equipment: [], total: 0 });
    jsonAPI.getPrintersForCartridge.mockResolvedValue({ data: { printer_models: [] } });
    jsonAPI.addCartridgeReplacement.mockResolvedValue({});
  });

  it('resolves compatible printer models to inventory MFU rows, deduped and printer-only', async () => {
    jsonAPI.getPrintersForCartridge.mockResolvedValue({
      data: { printer_models: ['hp laserjet m404', 'hp laserjet m402'] },
    });
    equipmentAPI.searchUniversal
      .mockResolvedValueOnce({
        equipment: [
          mfu,
          { ...mfu, id: 901, inv_no: 'INV-100' }, // duplicate inv_no
          { id: 902, inv_no: 'INV-PC', model_name: 'Lenovo PC', type_name: 'Системный блок', serial_no: 'X' },
        ],
        total: 3,
      })
      .mockResolvedValueOnce({
        equipment: [{ ...mfu, id: 903, inv_no: 'INV-101', model_name: 'HP LaserJet M402' }],
        total: 1,
      });

    const { result } = renderPicker();

    await waitFor(() => expect(result.current.suggestedPrinters).toHaveLength(2));
    expect(equipmentAPI.searchUniversal).toHaveBeenCalledTimes(2);
    expect(equipmentAPI.searchUniversal).toHaveBeenCalledWith('hp laserjet m404', 1, 8, { field: 'model' });
    const invs = result.current.suggestedPrinters.map((p) => p.inv_no);
    expect(invs).toEqual(['INV-100', 'INV-101']);
  });

  it('puts MFU from the consumable branch/location first in suggestions', async () => {
    jsonAPI.getPrintersForCartridge.mockResolvedValue({
      data: { printer_models: ['hp laserjet m404'] },
    });
    equipmentAPI.searchUniversal.mockResolvedValueOnce({
      equipment: [
        { ...mfu, id: 910, inv_no: 'INV-REMOTE', branch_name: 'Филиал', location_name: 'Офис' },
        { ...mfu, id: 911, inv_no: 'INV-SAME-BRANCH', branch_name: 'Главный', location_name: 'Каб. 12' },
        { ...mfu, id: 912, inv_no: 'INV-SAME-BOTH', branch_name: 'Главный', location_name: 'Склад' },
      ],
      total: 3,
    });

    const { result } = renderPicker();

    await waitFor(() => expect(result.current.suggestedPrinters).toHaveLength(3));
    const invs = result.current.suggestedPrinters.map((p) => p.inv_no);
    expect(invs).toEqual(['INV-SAME-BOTH', 'INV-SAME-BRANCH', 'INV-REMOTE']);
  });

  it('free search returns printer-like rows only', async () => {
    equipmentAPI.searchUniversal.mockResolvedValue({
      equipment: [
        mfu,
        { id: 910, inv_no: 'INV-UPS', model_name: 'APC UPS', type_name: 'ИБП', serial_no: 'U' },
      ],
      total: 2,
    });

    const { result } = renderPicker();
    act(() => { result.current.setPrinterQuery('m404'); });

    await waitFor(() => expect(result.current.searchResults).toHaveLength(1), { timeout: 2000 });
    expect(result.current.searchResults[0].inv_no).toBe('INV-100');
  });

  it('selects and clears the target printer', async () => {
    const { result } = renderPicker();
    act(() => { result.current.selectPrinter(mfu); });
    expect(result.current.selectedPrinter).toBe(mfu);
    act(() => { result.current.clearPrinter(); });
    expect(result.current.selectedPrinter).toBeNull();
  });
});

const renderCard = (options = {}) =>
  renderHook(() => useConsumableCard({
    canDatabaseWrite: true,
    location: { pathname: '/database', search: '' },
    dbName: 'ITINVENT',
    notifyDatabaseSuccess: options.notifyDatabaseSuccess,
    notifyDatabaseError: options.notifyDatabaseError,
  }));

describe('useConsumableCard MFU write-off', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    equipmentAPI.consumeConsumable.mockResolvedValue({ qty_new: 6 });
    equipmentAPI.searchUniversal.mockResolvedValue({ equipment: [], total: 0 });
    jsonAPI.getPrintersForCartridge.mockResolvedValue({ data: { printer_models: [] } });
    jsonAPI.addCartridgeReplacement.mockResolvedValue({});
  });

  it('blocks cartridge-like write-off until an MFU is selected', async () => {
    const { result } = renderCard();
    act(() => { result.current.openConsumableCard(cartridgeItem); });

    await act(async () => { await result.current.handleConsumableConsume(1); });

    expect(equipmentAPI.consumeConsumable).not.toHaveBeenCalled();
    expect(result.current.consumeError).toContain('МФУ');
  });

  it('consumes stock and records cartridge replacement for the selected MFU', async () => {
    const notifyDatabaseSuccess = vi.fn();
    const { result } = renderCard({ notifyDatabaseSuccess });
    act(() => { result.current.openConsumableCard(cartridgeItem); });
    act(() => { result.current.consumableQrPrinterPicker.selectPrinter(mfu); });

    await act(async () => { await result.current.handleConsumableConsume(1); });

    expect(equipmentAPI.consumeConsumable).toHaveBeenCalledWith({
      item_id: 42,
      inv_no: 'C-7',
      qty: 1,
      reason: 'cartridge',
    });
    expect(jsonAPI.addCartridgeReplacement).toHaveBeenCalledTimes(1);
    const payload = jsonAPI.addCartridgeReplacement.mock.calls[0][0];
    expect(payload).toMatchObject({
      printer_model: 'HP LaserJet M404',
      component_type: 'cartridge',
      cartridge_model: 'CF283A',
      serial_number: 'SN-42',
      branch: 'Главный',
      location: 'Каб. 12',
      inv_no: 'INV-100',
      db_name: 'ITINVENT',
      equipment_id: 900,
    });
    expect(payload.additional_data).toMatchObject({
      consumable_item_id: 42,
      consumable_inv_no: 'C-7',
      consumable_model: 'CF283A',
      consumed_qty: 1,
      source: 'qr_scan',
    });
    expect(notifyDatabaseSuccess).toHaveBeenCalledWith(
      expect.stringContaining('HP LaserJet M404'),
    );
    expect(result.current.consumableCardModal.item.QTY).toBe(6);
  });

  it('keeps plain write-off for non-cartridge consumables', async () => {
    const { result } = renderCard();
    act(() => { result.current.openConsumableCard(paperItem); });

    await act(async () => { await result.current.handleConsumableConsume(2); });

    expect(equipmentAPI.consumeConsumable).toHaveBeenCalledWith(
      expect.objectContaining({ item_id: 55, qty: 2, reason: 'qr_scan' }),
    );
    expect(jsonAPI.addCartridgeReplacement).not.toHaveBeenCalled();
  });

  it('rejects MFU without serial before touching stock', async () => {
    const { result } = renderCard();
    act(() => { result.current.openConsumableCard(cartridgeItem); });
    act(() => {
      result.current.consumableQrPrinterPicker.selectPrinter({ ...mfu, serial_no: '  ' });
    });

    await act(async () => { await result.current.handleConsumableConsume(1); });

    expect(equipmentAPI.consumeConsumable).not.toHaveBeenCalled();
    expect(result.current.consumeError).toContain('серийный номер');
  });
});
