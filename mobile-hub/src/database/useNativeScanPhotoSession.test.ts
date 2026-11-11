import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import type { EquipmentPhotoFile, EquipmentRecord } from '../api/databaseApi';
import type { InventoryQrPayload } from './nativeDatabaseModel';
import { loadPendingPhotos, persistPendingPhoto, removePendingPhoto } from './pendingPhotoStore';
import { useNativeScanPhotoSession } from './useNativeScanPhotoSession';

jest.mock('./pendingPhotoStore', () => ({
  loadPendingPhotos: jest.fn(async () => []),
  persistPendingPhoto: jest.fn(async () => null),
  removePendingPhoto: jest.fn(async () => undefined),
}));

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
    userId: 15,
    offlineMode: overrides.offlineMode ?? false,
    resolveEquipment: resolve,
    uploadPhoto: upload,
  }));
  return { upload, resolve, hook };
}

describe('useNativeScanPhotoSession', () => {
  beforeEach(() => {
    (persistPendingPhoto as jest.Mock).mockClear();
    (removePendingPhoto as jest.Mock).mockClear();
  });

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
  it('keeps a disk copy of every shot until it reaches the server', async () => {
    let release: (() => void) | null = null;
    const upload = jest.fn(async () => { await new Promise<void>((resolve) => { release = resolve; }); return 1; });
    const { hook } = setup({ upload });
    const { result } = await hook;

    await act(async () => { await result.current.selectTarget(qr('A')); });
    await act(async () => { result.current.enqueue(shot('a1.jpg')); });
    expect(persistPendingPhoto).toHaveBeenCalledWith(expect.objectContaining({ itemId: 101, invNo: 'A' }));
    expect(removePendingPhoto).not.toHaveBeenCalled();

    await act(async () => { release?.(); });
    await waitFor(() => expect(removePendingPhoto).toHaveBeenCalledTimes(1));
  });

  it('after an app restart uploads the shots that never left the device and then forgets them', async () => {
    (loadPendingPhotos as jest.Mock).mockResolvedValueOnce([
      { id: 'ph-1', userId: 15, itemId: 101, databaseId: 'main', invNo: 'A', file: shot('lost.jpg') },
    ]);
    const { upload, hook } = setup();
    const { result } = await hook;

    // Ключ загрузки — id записи на диске, а не путь к копии: повтор после перезапуска не создаст дубль.
    await waitFor(() => expect(upload).toHaveBeenCalledWith(101, expect.objectContaining({ name: 'lost.jpg', uploadKey: 'ph-1' }), 'main'));
    await waitFor(() => expect(removePendingPhoto).toHaveBeenCalledWith('ph-1'));
    expect(result.current.totalPending).toBe(0);
  });

  it('asks the store only for the signed-in user and does not restore without one', async () => {
    const { upload, hook } = setup();
    await hook;
    await waitFor(() => expect(loadPendingPhotos).toHaveBeenCalledWith(15));
    expect(upload).not.toHaveBeenCalled();
  });

  it('gives a shot the same upload key as its disk copy', async () => {
    const { upload, hook } = setup();
    const { result } = await hook;

    await act(async () => { await result.current.selectTarget(qr('A')); });
    await act(async () => { result.current.enqueue(shot('a1.jpg')); });
    await waitFor(() => expect(upload).toHaveBeenCalled());
    const pendingId = (persistPendingPhoto as jest.Mock).mock.calls.at(-1)[0].id;
    expect(upload).toHaveBeenCalledWith(101, expect.objectContaining({ uploadKey: pendingId }), 'main');
  });

  it('drops the disk copy of a failed shot only when the user discards it', async () => {
    const upload = jest.fn(async () => { throw new Error('Network Error'); });
    const { hook } = setup({ upload });
    const { result } = await hook;

    await act(async () => { await result.current.selectTarget(qr('A')); });
    await act(async () => { result.current.enqueue(shot('a1.jpg')); });
    await waitFor(() => expect(result.current.failedCount).toBe(1));
    expect(removePendingPhoto).not.toHaveBeenCalled();

    await act(async () => { result.current.discardFailed(); });
    await waitFor(() => expect(removePendingPhoto).toHaveBeenCalledTimes(1));
  });

  describe('automatic retry', () => {
    const renderOnline = (upload: jest.Mock) => renderHook(
      ({ offline }: { offline: boolean }) => useNativeScanPhotoSession({
        databaseId: 'main',
        userId: 15,
        offlineMode: offline,
        resolveEquipment: jest.fn(async (invNo: string) => record(invNo, 101)),
        uploadPhoto: upload,
      }),
      { initialProps: { offline: false } },
    );

    it('resends shots lost to a dropped connection when the network returns, but not server refusals', async () => {
      const upload = jest.fn(async (_itemId: number, file: EquipmentPhotoFile) => {
        if (file.name === 'bad.jpg') throw Object.assign(new Error('Unprocessable'), { response: { status: 422 } });
        if (upload.mock.calls.filter(([, f]) => f.name === file.name).length === 1) throw new Error('Network Error');
        return 1;
      });
      const hook = await renderOnline(upload as unknown as jest.Mock);
      const { result } = hook;

      await act(async () => { await result.current.selectTarget(qr('A')); });
      await act(async () => {
        result.current.enqueue(shot('net.jpg'));
        result.current.enqueue(shot('bad.jpg'));
      });
      await waitFor(() => expect(result.current.failedCount).toBe(2));

      await act(async () => { hook.rerender({ offline: true }); });
      await act(async () => { hook.rerender({ offline: false }); });

      await waitFor(() => expect(result.current.uploadedCount).toBe(1));
      expect(result.current.failedCount).toBe(1);
      expect(upload.mock.calls.filter(([, f]) => f.name === 'bad.jpg')).toHaveLength(1);
    });

    it('resends a shot that failed on a hung connection when the app returns to the foreground', async () => {
      let stateListener: ((state: AppStateStatus) => void) | undefined;
      jest.spyOn(AppState, 'addEventListener').mockImplementation((_, listener) => {
        stateListener = listener;
        return { remove: jest.fn() };
      });
      const upload = jest.fn()
        .mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }))
        .mockResolvedValue(1);
      const { result } = await renderOnline(upload);

      await act(async () => { await result.current.selectTarget(qr('A')); });
      await act(async () => { result.current.enqueue(shot('a1.jpg')); });
      await waitFor(() => expect(result.current.failedCount).toBe(1));

      await act(async () => { stateListener?.('active'); });
      await waitFor(() => expect(result.current.uploadedCount).toBe(1));
      jest.restoreAllMocks();
    });
  });
});
