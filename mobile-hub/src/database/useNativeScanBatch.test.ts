import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { EquipmentRecord } from '../api/databaseApi';
import * as snapshotCache from '../cache/nativeSnapshotCache';
import type { InventoryQrPayload } from './nativeDatabaseModel';
import { SCAN_BATCH_LIMIT, scanBatchSnapshotKey, useNativeScanBatch, type ScanBatchItem } from './useNativeScanBatch';

jest.mock('../cache/nativeSnapshotCache', () => ({
  readNativeEntitySnapshot: jest.fn(async () => null),
  writeNativeEntitySnapshot: jest.fn(async () => undefined),
}));

const equipment: EquipmentRecord = {
  inv_no: 'INV-1',
  serial_no: 'SN-1',
  hw_serial_no: '',
  part_no: '',
  type_name: 'Системный блок',
  model_name: 'OptiPlex',
  vendor_name: 'Dell',
  status_name: 'В работе',
  employee_name: 'Иванов И.И.',
  employee_dept: 'ИТ',
  employee_email: '',
  branch_name: 'Главный офис',
  location_name: 'Кабинет 12',
  ip_address: '',
  mac_address: '',
  network_name: '',
  domain_name: '',
  description: '',
  hub_db_id: '',
  hub_db_name: '',
  raw: { INV_NO: 'INV-1' },
} as EquipmentRecord;

const qr = (invNo: string, databaseId = 'ITINVENT'): InventoryQrPayload => ({
  kind: 'equipment',
  inventoryNumber: invNo,
  databaseId,
});

const hookProps = (overrides: Partial<Parameters<typeof useNativeScanBatch>[0]> = {}) => ({
  userId: 17,
  databaseId: 'ITINVENT',
  offlineMode: false,
  resolveEquipment: jest.fn(async (invNo: string) => ({ ...equipment, inv_no: invNo })),
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
});

it('adds a scanned item, dedupes the same number and stores a snapshot per user and database', async () => {
  const props = hookProps();
  const { result } = await renderHook(() => useNativeScanBatch(props));

  await act(async () => {
    expect((await result.current.add(qr('INV-1'))).kind).toBe('added');
  });
  expect(result.current.items).toHaveLength(1);
  expect(result.current.items[0].status).toBe('ready');
  expect(result.current.items[0].databaseId).toBe('ITINVENT');

  await act(async () => {
    const dup = await result.current.add(qr('inv-1'));
    expect(dup).toEqual({ kind: 'duplicate', invNo: 'inv-1' });
  });
  expect(result.current.items).toHaveLength(1);

  await waitFor(() => expect(snapshotCache.writeNativeEntitySnapshot).toHaveBeenCalledWith(
    'database-item-details',
    17,
    scanBatchSnapshotKey('ITINVENT'),
    expect.objectContaining({ items: [expect.objectContaining({ invNo: 'INV-1' })] }),
  ));
});

it('rejects equipment from a different database than the first scanned item', async () => {
  const props = hookProps();
  const { result } = await renderHook(() => useNativeScanBatch(props));

  await act(async () => { await result.current.add(qr('INV-1', 'ITINVENT')); });
  await act(async () => {
    const foreign = await result.current.add(qr('INV-9', 'OBJ-ITINVENT'));
    expect(foreign).toEqual({ kind: 'different-database', databaseId: 'OBJ-ITINVENT' });
  });
  expect(result.current.items).toHaveLength(1);
  expect(props.resolveEquipment).toHaveBeenCalledTimes(1);
});

it('returns consumable payloads untouched so the caller keeps the single-scan flow', async () => {
  const { result } = await renderHook(() => useNativeScanBatch(hookProps()));
  await act(async () => {
    const consumable = await result.current.add({ kind: 'consumable', itemId: 4821, inventoryNumber: '', databaseId: 'ITINVENT' });
    expect(consumable.kind).toBe('consumable');
  });
  expect(result.current.items).toHaveLength(0);
});

it('marks unresolved scans as missing offline rows and keeps them out of readyItems', async () => {
  const { result } = await renderHook(() => useNativeScanBatch(hookProps({
    offlineMode: true,
    resolveEquipment: jest.fn(async () => null),
  })));

  await act(async () => {
    const added = await result.current.add(qr('INV-404'));
    expect(added).toEqual({
      kind: 'added',
      item: expect.objectContaining({ invNo: 'INV-404', status: 'offline-missing' }),
    });
  });
  expect(result.current.items).toHaveLength(1);
  expect(result.current.readyItems).toHaveLength(0);
});

it('enforces the 100 item limit', async () => {
  const props = hookProps();
  const { result } = await renderHook(() => useNativeScanBatch(props));

  for (let index = 0; index < SCAN_BATCH_LIMIT; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await result.current.add(qr(`INV-${index}`)); });
  }
  expect(result.current.items).toHaveLength(SCAN_BATCH_LIMIT);

  await act(async () => {
    expect((await result.current.add(qr('INV-over'))).kind).toBe('limit');
  });
  expect(result.current.items).toHaveLength(SCAN_BATCH_LIMIT);
});

it('removes rows, keeps retry inv_nos after a partial error and clears on success', async () => {
  const { result } = await renderHook(() => useNativeScanBatch(hookProps()));
  await act(async () => { await result.current.add(qr('INV-1')); });
  await act(async () => { await result.current.add(qr('INV-2')); });
  await act(async () => { await result.current.add(qr('INV-3')); });
  expect(result.current.items.map((item) => item.invNo)).toEqual(['INV-3', 'INV-2', 'INV-1']);

  await act(async () => { result.current.remove('INV-3'); });
  expect(result.current.items.map((item) => item.invNo)).toEqual(['INV-2', 'INV-1']);

  await act(async () => { result.current.keepOnly(['inv-2']); });
  expect(result.current.items.map((item) => item.invNo)).toEqual(['INV-2']);

  await act(async () => { result.current.clear(); });
  expect(result.current.items).toHaveLength(0);
});

it('returns error (not missing) when the resolver fails and lets the same code rescan', async () => {
  const resolveEquipment = jest.fn()
    .mockRejectedValueOnce(new Error('network down'))
    .mockImplementation(async (invNo: string) => ({ ...equipment, inv_no: invNo }));
  const { result } = await renderHook(() => useNativeScanBatch(hookProps({ resolveEquipment })));

  await act(async () => {
    expect((await result.current.add(qr('INV-1'))).kind).toBe('error');
  });
  expect(result.current.items).toHaveLength(0);

  await act(async () => {
    expect((await result.current.add(qr('INV-1'))).kind).toBe('added');
  });
  expect(result.current.items).toHaveLength(1);
  expect(result.current.items[0].status).toBe('ready');
});

it('re-resolves non-ready rows when connectivity returns (Ш5-2)', async () => {
  let online = false;
  const resolveEquipment = jest.fn(async (invNo: string): Promise<EquipmentRecord | null> => (
    online ? { ...equipment, inv_no: invNo } : null
  ));
  const props = hookProps({ offlineMode: true, resolveEquipment });
  const { result, rerender } = await renderHook(
    (hookArgs: typeof props) => useNativeScanBatch(hookArgs),
    { initialProps: props },
  );

  await act(async () => { await result.current.add(qr('INV-404')); });
  expect(result.current.items[0].status).toBe('offline-missing');

  online = true;
  await act(async () => { rerender({ ...props, offlineMode: false, resolveEquipment }); });

  await waitFor(() => expect(result.current.items[0].status).toBe('ready'));
  expect(result.current.items[0].equipment?.inv_no).toBe('INV-404');
  expect(result.current.readyItems).toHaveLength(1);
});

it('re-resolves all rows when the resolver reference changes while going online (Ш5-5)', async () => {
  const props = hookProps({ offlineMode: true, resolveEquipment: jest.fn(async () => null) });
  const { result, rerender } = await renderHook(
    (hookArgs: typeof props) => useNativeScanBatch(hookArgs),
    { initialProps: props },
  );

  await act(async () => { await result.current.add(qr('INV-404')); });
  await act(async () => { await result.current.add(qr('INV-405')); });
  expect(result.current.items.map((item) => item.status)).toEqual(['offline-missing', 'offline-missing']);

  const onlineResolve = jest.fn(async (invNo: string): Promise<EquipmentRecord | null> => ({ ...equipment, inv_no: invNo }));
  await act(async () => { rerender({ ...props, offlineMode: false, resolveEquipment: onlineResolve }); });

  await waitFor(() => expect(result.current.items.every((item) => item.status === 'ready')).toBe(true));
  expect(onlineResolve).toHaveBeenCalledWith('INV-404', 'ITINVENT');
  expect(onlineResolve).toHaveBeenCalledWith('INV-405', 'ITINVENT');
  expect(result.current.readyItems).toHaveLength(2);
});

it('is not cancelled when the resolver identity changes mid-refresh (Ш5-5)', async () => {
  const props = hookProps({ offlineMode: true, resolveEquipment: jest.fn(async () => null) });
  const { result, rerender } = await renderHook(
    (hookArgs: typeof props) => useNativeScanBatch(hookArgs),
    { initialProps: props },
  );

  await act(async () => { await result.current.add(qr('INV-404')); });
  await act(async () => { await result.current.add(qr('INV-405')); });

  const releases: Array<() => void> = [];
  const pendingResolve = jest.fn((invNo: string) => new Promise<EquipmentRecord | null>((done) => {
    releases.push(() => done({ ...equipment, inv_no: invNo }));
  }));
  const fastResolve = jest.fn(async (invNo: string): Promise<EquipmentRecord | null> => ({ ...equipment, inv_no: invNo }));

  await act(async () => { rerender({ ...props, offlineMode: false, resolveEquipment: pendingResolve }); });
  // первый запрос висит в releases; теперь прилетает новая ссылка на резолвер —
  // перезапрос не должен отменяться
  await act(async () => { rerender({ ...props, offlineMode: false, resolveEquipment: fastResolve }); });
  await act(async () => { releases.splice(0).forEach((release) => release()); });

  await waitFor(() => expect(result.current.items.every((item) => item.status === 'ready')).toBe(true));
  expect(result.current.items.map((item) => item.invNo)).toEqual(['INV-405', 'INV-404']);
});

it('does not restore a stale batch snapshot on mount (Ш5-8)', async () => {
  const stored: ScanBatchItem[] = [
    { invNo: 'INV-7', databaseId: 'ITINVENT', equipment: { ...equipment, inv_no: 'INV-7' }, status: 'ready' },
    { invNo: 'INV-8', databaseId: 'ITINVENT', equipment: null, status: 'missing' },
  ];
  (snapshotCache.readNativeEntitySnapshot as jest.Mock).mockImplementation(
    async (_scope: string, _userId: number, key: string) => (
      key === scanBatchSnapshotKey('ITINVENT') ? { savedAt: 1, data: { items: stored } } : null
    ),
  );

  const { result } = await renderHook(() => useNativeScanBatch(hookProps()));
  await waitFor(() => expect(result.current.items).toEqual([]));
  expect(snapshotCache.readNativeEntitySnapshot).not.toHaveBeenCalled();
});

it('persists an empty snapshot after clear so nothing lingers between sessions (Ш5-8)', async () => {
  const { result } = await renderHook(() => useNativeScanBatch(hookProps()));

  await act(async () => { await result.current.add(qr('INV-1')); });
  await waitFor(() => expect(snapshotCache.writeNativeEntitySnapshot).toHaveBeenCalledWith(
    'database-item-details',
    17,
    scanBatchSnapshotKey('ITINVENT'),
    expect.objectContaining({ items: [expect.objectContaining({ invNo: 'INV-1' })] }),
  ));

  await act(async () => { result.current.clear(); });
  await waitFor(() => expect(snapshotCache.writeNativeEntitySnapshot).toHaveBeenLastCalledWith(
    'database-item-details',
    17,
    scanBatchSnapshotKey('ITINVENT'),
    { items: [] },
  ));
});
