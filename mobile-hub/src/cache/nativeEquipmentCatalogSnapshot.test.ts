import {
  readNativeEquipmentCatalogSnapshot,
  writeNativeEquipmentCatalogSnapshot,
} from './nativeEquipmentCatalogSnapshot';
import type { EquipmentRecord } from '../api/databaseApi';

const mockSnapshots = new Map<string, unknown>();
let mockBeforeSnapshotWrite: ((scope: string, data: unknown) => void) | null = null;

jest.mock('./nativeSnapshotCache', () => ({
  readNativeSnapshot: jest.fn(async (scope: string, userId: number) => {
    const data = mockSnapshots.get(`${userId}:${scope}`);
    return data === undefined ? null : { savedAt: 1, data };
  }),
  writeNativeSnapshot: jest.fn(async (scope: string, userId: number, data: unknown) => {
    const bytes = new TextEncoder().encode(JSON.stringify({
      version: 1,
      userId,
      savedAt: 1,
      data,
    })).byteLength;
    if (bytes > 2 * 1024 * 1024) return false;
    mockSnapshots.set(`${userId}:${scope}`, data);
    mockBeforeSnapshotWrite?.(scope, data);
    return true;
  }),
}));

jest.mock('./nativeSnapshotStorage', () => ({
  MAX_NATIVE_SNAPSHOT_BYTES: 2 * 1024 * 1024,
  deleteEncryptedNativeSnapshot: jest.fn(async (scope: string, userId: number) => {
    mockSnapshots.delete(`${userId}:${scope}`);
  }),
}));

function equipment(count: number, descriptionLength = 64): EquipmentRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    inv_no: `INV-${String(index).padStart(6, '0')}`,
    serial_no: '',
    hw_serial_no: '',
    part_no: '',
    model_name: `Model ${index}`,
    type_name: 'Компьютер',
    vendor_name: '',
    status_name: '',
    employee_name: '',
    employee_dept: '',
    employee_email: '',
    branch_name: '',
    location_name: '',
    ip_address: '',
    mac_address: '',
    network_name: '',
    domain_name: '',
    description: 'x'.repeat(descriptionLength),
    hub_db_id: '',
    hub_db_name: '',
    raw: {},
  }));
}

beforeEach(() => {
  mockSnapshots.clear();
  mockBeforeSnapshotWrite = null;
});

it('persists and restores a complete equipment catalog larger than one snapshot', async () => {
  const items = equipment(5_000, 512);

  await expect(writeNativeEquipmentCatalogSnapshot(17, 'ITINVENT', items, items.length)).resolves.toBe(true);
  await expect(readNativeEquipmentCatalogSnapshot(17, 'ITINVENT')).resolves.toEqual(
    expect.objectContaining({
      data: expect.objectContaining({ databaseId: 'ITINVENT', total: items.length, equipment: items }),
    }),
  );
});

it('keeps the previous complete catalog if a replacement item cannot be stored', async () => {
  const previous = equipment(3);
  await expect(writeNativeEquipmentCatalogSnapshot(17, 'ITINVENT', previous, previous.length)).resolves.toBe(true);

  const oversized = equipment(1, 2_200_000);
  await expect(writeNativeEquipmentCatalogSnapshot(17, 'ITINVENT', oversized, oversized.length)).resolves.toBe(false);
  await expect(readNativeEquipmentCatalogSnapshot(17, 'ITINVENT')).resolves.toEqual(
    expect.objectContaining({ data: expect.objectContaining({ equipment: previous }) }),
  );
});

it('yields to the UI before writing the first shard of a large catalog', async () => {
  const items = equipment(6_000, 512);
  let uiTurnReached = false;
  let uiTurnReachedBeforeFirstWrite: boolean | null = null;
  const timer = setTimeout(() => { uiTurnReached = true; }, 0);
  mockBeforeSnapshotWrite = () => {
    if (uiTurnReachedBeforeFirstWrite == null) uiTurnReachedBeforeFirstWrite = uiTurnReached;
  };

  await writeNativeEquipmentCatalogSnapshot(17, 'ITINVENT', items, items.length);
  clearTimeout(timer);

  expect(uiTurnReachedBeforeFirstWrite).toBe(true);
});

it('keeps encrypted catalog shards comfortably below the Android bridge limit', async () => {
  const items = equipment(5_000, 512);

  await expect(writeNativeEquipmentCatalogSnapshot(17, 'ITINVENT', items, items.length)).resolves.toBe(true);

  const shardSizes = [...mockSnapshots.entries()]
    .filter(([key, value]) => key.includes('database-catalog-shard-') && (value as { equipment?: unknown[] }).equipment)
    .map(([, value]) => new TextEncoder().encode(JSON.stringify(value)).byteLength);
  expect(shardSizes.length).toBeGreaterThan(1);
  expect(Math.max(...shardSizes)).toBeLessThanOrEqual(600 * 1024);
});

it('restores the previous complete catalog when committed shards fail read-back verification', async () => {
  const previous = equipment(3);
  await expect(writeNativeEquipmentCatalogSnapshot(17, 'ITINVENT', previous, previous.length)).resolves.toBe(true);

  let corruptNextManifest = true;
  mockBeforeSnapshotWrite = (_scope, data) => {
    const manifest = data as { kind?: string; shards?: Array<{ scope: string }> };
    if (!corruptNextManifest || manifest.kind !== 'equipment-catalog-shards-v1') return;
    corruptNextManifest = false;
    const firstShard = manifest.shards?.[0]?.scope;
    if (firstShard) mockSnapshots.delete(`17:${firstShard}`);
  };

  const replacement = equipment(10, 128);
  await expect(writeNativeEquipmentCatalogSnapshot(17, 'ITINVENT', replacement, replacement.length)).resolves.toBe(false);
  await expect(readNativeEquipmentCatalogSnapshot(17, 'ITINVENT')).resolves.toEqual(
    expect.objectContaining({ data: expect.objectContaining({ equipment: previous }) }),
  );
});
