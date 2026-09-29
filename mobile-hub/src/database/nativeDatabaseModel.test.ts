import {
  equipmentLocation,
  equipmentOwner,
  equipmentWorkKinds,
  filterConsumables,
  formatDatabaseDate,
  historyDate,
  historyDescription,
  isPrinterLikeEquipment,
  parseInventoryQrPayload,
  parseInventoryQrText,
} from './nativeDatabaseModel';

it('extracts an inventory number from the existing HUB QR payload', () => {
  expect(parseInventoryQrText('INV_NO: 1001\nSERIAL_NO: SN-1\nMODEL: OptiPlex')).toBe('1001');
  expect(parseInventoryQrText(' 1002 ')).toBe('1002');
  expect(parseInventoryQrText('SERIAL_NO: SN-1\nMODEL: OptiPlex')).toBe('');
});

it('extracts inventory and database scope from an equipment link', () => {
  const link = 'https://hubit.zsgp.ru/database?inv_no=INV%2F7&db_id=OBJ-ITINVENT';
  expect(parseInventoryQrPayload(link)).toEqual({
    kind: 'equipment',
    inventoryNumber: 'INV/7',
    databaseId: 'OBJ-ITINVENT',
  });
  expect(parseInventoryQrText(link)).toBe('INV/7');
  expect(parseInventoryQrPayload('https://example.com/tasks?inv_no=INV%2F7')).toBeNull();
});

it('extracts ITEMS.ID and database scope from a consumable link', () => {
  const link = 'https://hubit.zsgp.ru/database?consumable=4821&db_id=OBJ-ITINVENT';
  expect(parseInventoryQrPayload(link)).toEqual({
    kind: 'consumable',
    itemId: 4821,
    inventoryNumber: '',
    databaseId: 'OBJ-ITINVENT',
  });
  expect(parseInventoryQrText(link)).toBe('');
  expect(parseInventoryQrPayload('hubit://database?consumable=77&db_id=main')).toEqual({
    kind: 'consumable',
    itemId: 77,
    inventoryNumber: '',
    databaseId: 'main',
  });
  expect(parseInventoryQrPayload('https://hubit.zsgp.ru/database?consumable=abc')).toBeNull();
});

it('formats equipment owner and location without dangling separators', () => {
  const item = { employee_name: 'Иванов', employee_dept: 'ИТ', branch_name: 'HQ', location_name: '12' } as never;
  expect(equipmentOwner(item)).toBe('Иванов · ИТ');
  expect(equipmentLocation(item)).toBe('HQ · 12');
});

it('reads legacy movement history fields', () => {
  const row = {
    OLD_EMPLOYEE_NAME: 'Иванов',
    NEW_EMPLOYEE_NAME: 'Петров',
    CH_USER: 'operator',
    CH_DATE: '2026-08-24T10:00:00+05:00',
  };
  expect(historyDescription(row)).toBe('Иванов → Петров · Изменил: operator');
  expect(historyDate(row)).toBe(formatDatabaseDate(row.CH_DATE));
});

it('detects printer and MFP equipment for the QR cartridge picker', () => {
  expect(isPrinterLikeEquipment({ type_name: 'МФУ', model_name: 'M404', vendor_name: 'HP' } as never)).toBe(true);
  expect(isPrinterLikeEquipment({ type_name: 'Периферия', model_name: 'LaserJet Pro', vendor_name: '' } as never)).toBe(true);
  expect(isPrinterLikeEquipment({ type_name: 'Системный блок', model_name: 'OptiPlex', vendor_name: 'Dell' } as never)).toBe(false);
  expect(isPrinterLikeEquipment(null)).toBe(false);
});

it('matches the established web equipment capability rules', () => {
  expect(equipmentWorkKinds({ type_name: 'МФУ', model_name: 'LaserJet', vendor_name: 'HP' } as never)).toEqual(['cartridge', 'component']);
  expect(equipmentWorkKinds({ type_name: 'Системный блок', model_name: 'OptiPlex', vendor_name: 'Dell' } as never)).toEqual(['cleaning', 'component']);
  expect(equipmentWorkKinds({ type_name: 'ИБП', model_name: 'Smart UPS', vendor_name: 'APC' } as never)).toEqual(['battery']);
  expect(equipmentWorkKinds({ type_name: 'Сканер', model_name: 'IPC-200', vendor_name: 'Acme' } as never)).toEqual([]);
});

it('filters loaded consumables across identity and placement fields', () => {
  const items = [
    { id: 1, inv_no: 'C-1', type_name: 'Картридж', model_name: 'HP 12A', part_no: '', description: '', branch_name: 'Офис', location_name: 'Склад' },
    { id: 2, inv_no: 'C-2', type_name: 'Батарея', model_name: 'APC RBC', part_no: 'RBC-7', description: '', branch_name: 'ЦОД', location_name: 'Стеллаж' },
  ] as never;
  expect(filterConsumables(items, 'rbc-7')).toEqual([items[1]]);
  expect(filterConsumables(items, 'склад')).toEqual([items[0]]);
});
