import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { EquipmentPhotoFile, EquipmentRecord } from '../api/databaseApi';
import type { InventoryQrPayload } from './nativeDatabaseModel';
import { useNativeScanPhotoSession } from './useNativeScanPhotoSession';

const record = (invNo: string, id: number | null): EquipmentRecord => ({
  id,
  inv_no: invNo,
  type_name: 'Системный блок',
  model_name: `Model ${invNo}`,
} as EquipmentRecord);

const qr = (invNo: string, databaseId = 'main'): InventoryQrPayload => ({
  kind: 'equipment',
  inventoryNumber: invNo,
  databaseId,
});

const shot = (name: string): EquipmentPhotoFile => ({ uri: `file:///${name}`, name, mimeType: 'image/jpeg' });

function setup(overrides: {
  upload?: jest.Mock;
  resolve?: jest.Mock;
  offlineMode?: boolean;
} = {}) {
  const upload = overrides.upload || jest.fn(async () => 1);
  const resolve = overrides.resolve || jest.fn(async (invNo: string) => record(invNo, invNo === 'A' ? 101 : 202));
  const hook = renderHook(() => useNativeScanPhotoSession({
    databaseId: 'main',
    offlineMode: overrides.offlineMode ?? false,
    resolveEquipment: resolve,
    uploadPhoto: upload,
  }));
  return { upload, resolve, hook };
}

describe('useNativeScanPhotoSession', () => {
  it('uploads a burst sequentially to the scanned item and counts it per item', async () => {
    const order: string[] = [];
    let release: (() => void) | null = null;
    const upload = jest.fn(async (_itemId: number, file: EquipmentPhotoFile) => {
      order.push(`start:${file.name}`);
      if (file.name === 'a1.jpg') await new Promise<void>((resolve) => { release = resolve; });
      order.push(`end:${file.name}`);
      return 1;
    });
    const { hook } = setup({ upload });
    const { result } = await hook;

    await act(async () => { result.current.start(); });
    await act(async () => { await result.current.selectTarget(qr('A')); });
    await act(async () => {
      result.current.enqueue(shot('a1.jpg'));
      result.current.enqueue(shot('a2.jpg'));
    });

    // Второй кадр ждёт первый: FILE_NO на сервере — MAX+1, параллельно нельзя.
    expect(order).toEqual(['start:a1.jpg']);
    expect(result.current.pendingCount).toBe(2);

    await act(async () => { release?.(); });
    await waitFor(() => expect(result.current.uploadedCount).toBe(2));
    expect(order).toEqual(['start:a1.jpg', 'end:a1.jpg', 'start:a2.jpg', 'end:a2.jpg']);
    expect(upload).toHaveBeenNthCalledWith(1, 101, expect.objectContaining({ name: 'a1.jpg' }), 'main');
    expect(result.current.pendingCount).toBe(0);
  });

  it('keeps the shot with the item that was targeted when the shutter was pressed', async () => {
    const { upload, hook } = setup();
    const { result } = await hook;

    await act(async () => { await result.current.selectTarget(qr('A')); });
    const targetAtShot = result.current.target;
    await act(async () => { await result.current.selectTarget(qr('B')); });
    expect(result.current.target?.invNo).toBe('B');

    await act(async () => { result.current.enqueue(shot('late.jpg'), targetAtShot); });
    await waitFor(() => expect(upload).toHaveBeenCalledWith(101, expect.anything(), 'main'));
    expect(result.current.uploadedCount).toBe(0); // счётчик показывает только текущую технику (B)
  });

  it('ignores a slow resolve that finished after another item was scanned', async () => {
    let finishSlow: ((value: EquipmentRecord) => void) | null = null;
    const resolve = jest.fn((invNo: string) => (invNo === 'A'
      ? new Promise<EquipmentRecord>((done) => { finishSlow = done; })
      : Promise.resolve(record(invNo, 202))));
    const { hook } = setup({ resolve });
    const { result } = await hook;

    let slow: Promise<unknown> | null = null;
    await act(async () => { slow = result.current.selectTarget(qr('A')); });
    await act(async () => { await result.current.selectTarget(qr('B')); });
    await act(async () => { finishSlow?.(record('A', 101)); await slow; });

    expect(result.current.target?.invNo).toBe('B');
  });

  it('keeps failed shots for retry and reports them separately', async () => {
    const upload = jest.fn()
      .mockRejectedValueOnce(new Error('Нет связи'))
      .mockResolvedValue(1);
    const { hook } = setup({ upload });
    const { result } = await hook;

    await act(async () => { await result.current.selectTarget(qr('A')); });
    await act(async () => { result.current.enqueue(shot('a1.jpg')); });
    await waitFor(() => expect(result.current.failedCount).toBe(1));
    expect(result.current.uploadedCount).toBe(0);
    expect(result.current.totalFailed).toBe(1);

    await act(async () => { result.current.retryFailed(); });
    await waitFor(() => expect(result.current.uploadedCount).toBe(1));
    expect(result.current.failedCount).toBe(0);
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it('refuses consumables, unknown items and offline mode without changing the target', async () => {
    const resolve = jest.fn(async (invNo: string) => (invNo === 'NONE' ? null : record(invNo, null)));
    const online = await setup({ resolve }).hook;

    await act(async () => { await online.result.current.selectTarget(qr('A')); });
    expect(online.result.current.target).toBeNull(); // запись без id — снимать некуда

    let outcome: { kind: string } | null = null;
    await act(async () => { outcome = await online.result.current.selectTarget(qr('NONE')); });
    expect(outcome).toEqual({ kind: 'missing', invNo: 'NONE' });

    await act(async () => {
      outcome = await online.result.current.selectTarget({
        kind: 'consumable', itemId: 5, inventoryNumber: '', databaseId: 'main',
      });
    });
    expect(outcome).toEqual({ kind: 'consumable' });

    const offline = await setup({ offlineMode: true }).hook;
    await act(async () => { outcome = await offline.result.current.selectTarget(qr('A')); });
    expect(outcome).toEqual({ kind: 'offline' });
    expect(offline.result.current.enqueue(shot('x.jpg'))).toBe(false);
  });
});
