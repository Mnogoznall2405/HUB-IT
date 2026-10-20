import type { EquipmentRecord } from '../api/databaseApi';
import { getSessionGeneration } from '../auth/tokenStore';
import {
  addNativeSnapshotClearListener,
  readNativeSnapshot,
  writeNativeSnapshot,
  type NativeSnapshot,
  type NativeSnapshotScope,
} from './nativeSnapshotCache';
import {
  deleteEncryptedNativeSnapshot,
  MAX_NATIVE_SNAPSHOT_BYTES,
} from './nativeSnapshotStorage';

const EQUIPMENT_CATALOG_MANIFEST_KIND = 'equipment-catalog-shards-v1';
const EQUIPMENT_CATALOG_SHARD_KIND = 'equipment-catalog-shard-v1';
// Keep AES/base64 and file-system bridge calls well below the generic 2 MiB
// ceiling. Android briefly holds plaintext and ciphertext at the same time.
const EQUIPMENT_CATALOG_SHARD_TARGET_BYTES = 512 * 1024;
const EQUIPMENT_CATALOG_OVERSIZED_ITEM_LIMIT_BYTES = MAX_NATIVE_SNAPSHOT_BYTES - 256 * 1024;
const EQUIPMENT_CATALOG_SPLIT_SLICE_ITEMS = 128;
const EQUIPMENT_CATALOG_SPLIT_SLICE_BYTES = 256 * 1024;
const EQUIPMENT_CATALOG_MEMORY_BUDGET_BYTES = 8 * 1024 * 1024;

export type NativeEquipmentCatalogSnapshot = {
  databaseId: string;
  equipment: EquipmentRecord[];
  total: number;
};

type EquipmentCatalogShardManifestEntry = {
  scope: string;
  count: number;
};

type EquipmentCatalogManifest = {
  kind: typeof EQUIPMENT_CATALOG_MANIFEST_KIND;
  revision: string;
  databaseId: string;
  itemCount: number;
  total: number;
  shards: EquipmentCatalogShardManifestEntry[];
};

type EquipmentCatalogShard = {
  kind: typeof EQUIPMENT_CATALOG_SHARD_KIND;
  revision: string;
  index: number;
  equipment: EquipmentRecord[];
};

type EquipmentCatalogMemorySlot = {
  userId: number;
  databaseId: string;
  generation: number;
  revision: string;
  rootSavedAt: number;
  oldestSavedAt: number;
  itemCount: number;
  total: number;
  shards: EquipmentCatalogShardManifestEntry[];
  snapshot: NativeSnapshot<NativeEquipmentCatalogSnapshot>;
  index: Map<string, EquipmentRecord>;
  serveSeq: number;
};

let revisionSequence = 0;
let memorySlot: EquipmentCatalogMemorySlot | null = null;
let globalCacheEpoch = 0;
const userCacheEpochs = new Map<number, number>();
let memorySlotActivity = 0;
const inFlightReads = new Map<string, Promise<NativeSnapshot<NativeEquipmentCatalogSnapshot> | null>>();

function normalizedDatabaseId(databaseId: string): string {
  return String(databaseId || '').trim();
}

function normalizedInventoryNumber(invNo: string): string {
  return String(invNo || '').trim().toLocaleUpperCase('ru-RU');
}

function cacheEpochToken(userId: number): string {
  return `${globalCacheEpoch}:${userCacheEpochs.get(userId) || 0}`;
}

function hashScopePart(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(36);
}

function catalogScope(databaseId: string): string {
  return `database-catalog-${hashScopePart(databaseId)}`;
}

function shardScope(databaseId: string, revision: string, index: number): string {
  return `database-catalog-shard-${hashScopePart(databaseId)}-${revision}-${index}`;
}

function isCatalogManifest(value: unknown, databaseId: string): value is EquipmentCatalogManifest {
  const candidate = value as Partial<EquipmentCatalogManifest> | null;
  return Boolean(
    candidate
    && candidate.kind === EQUIPMENT_CATALOG_MANIFEST_KIND
    && candidate.databaseId === databaseId
    && typeof candidate.revision === 'string'
    && Number.isInteger(candidate.itemCount)
    && Number.isFinite(candidate.total)
    && Array.isArray(candidate.shards),
  );
}

function shardDescriptorsEqual(
  left: EquipmentCatalogShardManifestEntry[],
  right: EquipmentCatalogShardManifestEntry[],
): boolean {
  return left.length === right.length
    && left.every((entry, index) => (
      entry.scope === right[index]?.scope && entry.count === right[index]?.count
    ));
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function splitEquipment(items: EquipmentRecord[]): Promise<EquipmentRecord[][] | null> {
  const shards: EquipmentRecord[][] = [];
  let current: EquipmentRecord[] = [];
  let currentBytes = 2;
  let sliceItems = 0;
  let sliceBytes = 0;

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const itemBytes = byteLength(item) + (current.length > 0 ? 1 : 0);
    if (itemBytes > EQUIPMENT_CATALOG_OVERSIZED_ITEM_LIMIT_BYTES) return null;
    if (current.length > 0 && currentBytes + itemBytes > EQUIPMENT_CATALOG_SHARD_TARGET_BYTES) {
      shards.push(current);
      current = [];
      currentBytes = 2;
    }
    current.push(item);
    currentBytes += itemBytes;
    sliceItems += 1;
    sliceBytes += itemBytes;
    if (
      index < items.length - 1
      && (
        sliceItems >= EQUIPMENT_CATALOG_SPLIT_SLICE_ITEMS
        || sliceBytes >= EQUIPMENT_CATALOG_SPLIT_SLICE_BYTES
      )
    ) {
      await yieldToEventLoop();
      sliceItems = 0;
      sliceBytes = 0;
    }
  }
  if (current.length > 0) shards.push(current);
  return shards;
}

async function cleanupScopes(userId: number, scopes: string[]): Promise<void> {
  await Promise.allSettled(scopes.map((scope) => deleteEncryptedNativeSnapshot(scope, userId)));
}

export function invalidateNativeEquipmentCatalogCache(userId?: number): void {
  if (userId === undefined) {
    memorySlot = null;
    globalCacheEpoch += 1;
    return;
  }
  if (memorySlot?.userId === userId) memorySlot = null;
  userCacheEpochs.set(userId, (userCacheEpochs.get(userId) || 0) + 1);
}

if (typeof addNativeSnapshotClearListener === 'function') {
  addNativeSnapshotClearListener(invalidateNativeEquipmentCatalogCache);
}

type CatalogReadContext = {
  generation: number;
  epoch: string;
  serveSeqAtStart: number;
  useMemory: boolean;
  populateMemory: boolean;
  dropStaleResults: boolean;
};

function evictMatchingSlot(userId: number, databaseId: string): void {
  if (memorySlot?.userId === userId && memorySlot.databaseId === databaseId) {
    memorySlot = null;
  }
}

async function readCatalogFromDisk(
  userId: number,
  normalizedId: string,
  maxAgeMs: number,
  context: CatalogReadContext,
): Promise<NativeSnapshot<NativeEquipmentCatalogSnapshot> | null> {
  const stillCurrent = () => (
    context.epoch === cacheEpochToken(userId)
    && context.generation === getSessionGeneration()
  );

  const root = await readNativeSnapshot<EquipmentCatalogManifest>(
    catalogScope(normalizedId) as NativeSnapshotScope,
    userId,
    maxAgeMs,
  );
  if (context.dropStaleResults && !stillCurrent()) return null;
  if (!root || !isCatalogManifest(root.data, normalizedId)) {
    evictMatchingSlot(userId, normalizedId);
    return null;
  }
  const manifest = root.data;

  const slot = memorySlot;
  if (
    context.useMemory
    && slot
    && slot.userId === userId
    && slot.databaseId === normalizedId
    && slot.generation === context.generation
    && slot.revision === manifest.revision
    && slot.rootSavedAt === root.savedAt
    && slot.itemCount === manifest.itemCount
    && slot.total === manifest.total
    && shardDescriptorsEqual(slot.shards, manifest.shards)
    && Date.now() - slot.oldestSavedAt <= maxAgeMs
  ) {
    memorySlotActivity += 1;
    slot.serveSeq = memorySlotActivity;
    return slot.snapshot;
  }

  const equipment: EquipmentRecord[] = [];
  let oldestSavedAt = root.savedAt;
  let shardPayloadBytes = 0;
  for (let index = 0; index < manifest.shards.length; index += 1) {
    const descriptor = manifest.shards[index];
    const snapshot = await readNativeSnapshot<EquipmentCatalogShard>(
      descriptor.scope as NativeSnapshotScope,
      userId,
      maxAgeMs,
    );
    if (context.dropStaleResults && !stillCurrent()) return null;
    if (
      !snapshot
      || snapshot.data.kind !== EQUIPMENT_CATALOG_SHARD_KIND
      || snapshot.data.revision !== manifest.revision
      || snapshot.data.index !== index
      || !Array.isArray(snapshot.data.equipment)
      || snapshot.data.equipment.length !== descriptor.count
    ) {
      evictMatchingSlot(userId, normalizedId);
      return null;
    }
    equipment.push(...snapshot.data.equipment);
    oldestSavedAt = Math.min(oldestSavedAt, snapshot.savedAt);
    shardPayloadBytes += byteLength(snapshot.data);
    if (index < manifest.shards.length - 1) await yieldToEventLoop();
  }
  if (equipment.length !== manifest.itemCount) {
    evictMatchingSlot(userId, normalizedId);
    return null;
  }

  const result: NativeSnapshot<NativeEquipmentCatalogSnapshot> = {
    savedAt: root.savedAt,
    data: {
      databaseId: normalizedId,
      equipment,
      total: manifest.total,
    },
  };

  const newerScopeServed = Boolean(
    memorySlot
    && memorySlot.serveSeq > context.serveSeqAtStart
    && (memorySlot.userId !== userId || memorySlot.databaseId !== normalizedId),
  );
  if (
    context.populateMemory
    && stillCurrent()
    && !newerScopeServed
    && shardPayloadBytes <= EQUIPMENT_CATALOG_MEMORY_BUDGET_BYTES
  ) {
    const index = new Map<string, EquipmentRecord>();
    for (const record of equipment) {
      const key = normalizedInventoryNumber(record.inv_no);
      if (key && !index.has(key)) index.set(key, record);
    }
    memorySlot = {
      userId,
      databaseId: normalizedId,
      generation: context.generation,
      revision: manifest.revision,
      rootSavedAt: root.savedAt,
      oldestSavedAt,
      itemCount: manifest.itemCount,
      total: manifest.total,
      shards: manifest.shards.map((shard) => ({ scope: shard.scope, count: shard.count })),
      snapshot: result,
      index,
      serveSeq: memorySlotActivity + 1,
    };
    memorySlotActivity += 1;
  }
  return result;
}

export function readNativeEquipmentCatalogSnapshot(
  userId: number,
  databaseId: string,
  maxAgeMs = Number.MAX_SAFE_INTEGER,
  options: { bypassMemory?: boolean } = {},
): Promise<NativeSnapshot<NativeEquipmentCatalogSnapshot> | null> {
  const normalizedId = normalizedDatabaseId(databaseId);
  if (!normalizedId) return Promise.resolve(null);
  const generation = getSessionGeneration();
  if (
    memorySlot
    && (
      memorySlot.generation !== generation
      || memorySlot.userId !== userId
      || memorySlot.databaseId !== normalizedId
    )
  ) memorySlot = null;
  const context: CatalogReadContext = {
    generation,
    epoch: cacheEpochToken(userId),
    serveSeqAtStart: memorySlotActivity,
    useMemory: !options.bypassMemory,
    populateMemory: true,
    dropStaleResults: !options.bypassMemory,
  };
  if (options.bypassMemory) {
    return readCatalogFromDisk(userId, normalizedId, maxAgeMs, context);
  }
  const key = `${userId}|${normalizedId}|${maxAgeMs}|${context.generation}|${context.epoch}`;
  const pending = inFlightReads.get(key);
  if (pending) return pending;
  const request = readCatalogFromDisk(userId, normalizedId, maxAgeMs, context);
  inFlightReads.set(key, request);
  const removePending = () => {
    if (inFlightReads.get(key) === request) inFlightReads.delete(key);
  };
  request.then(removePending, removePending);
  return request;
}

export async function findNativeEquipmentCatalogItem(
  userId: number,
  databaseId: string,
  invNo: string,
  maxAgeMs = Number.MAX_SAFE_INTEGER,
): Promise<EquipmentRecord | null> {
  const normalized = normalizedInventoryNumber(invNo);
  if (!normalized) return null;
  const snapshot = await readNativeEquipmentCatalogSnapshot(userId, databaseId, maxAgeMs);
  if (!snapshot) return null;
  const slot = memorySlot;
  if (slot?.index && slot.snapshot === snapshot) {
    return slot.index.get(normalized) ?? null;
  }
  return snapshot.data.equipment.find(
    (item) => normalizedInventoryNumber(item.inv_no) === normalized,
  ) ?? null;
}

export async function writeNativeEquipmentCatalogSnapshot(
  userId: number,
  databaseId: string,
  equipment: EquipmentRecord[],
  total: number,
): Promise<boolean> {
  const normalizedId = normalizedDatabaseId(databaseId);
  if (!normalizedId || !Array.isArray(equipment)) return false;
  invalidateNativeEquipmentCatalogCache(userId);
  const itemShards = await splitEquipment(equipment);
  if (!itemShards) {
    invalidateNativeEquipmentCatalogCache(userId);
    return false;
  }

  const rootScope = catalogScope(normalizedId);
  const previous = await readNativeSnapshot<EquipmentCatalogManifest>(
    rootScope as NativeSnapshotScope,
    userId,
  );
  revisionSequence += 1;
  const revision = `${Date.now().toString(36)}-${revisionSequence.toString(36)}`;
  const writtenScopes: string[] = [];
  const shards: EquipmentCatalogShardManifestEntry[] = [];

  for (let index = 0; index < itemShards.length; index += 1) {
    const scope = shardScope(normalizedId, revision, index);
    const stored = await writeNativeSnapshot(
      scope as NativeSnapshotScope,
      userId,
      {
        kind: EQUIPMENT_CATALOG_SHARD_KIND,
        revision,
        index,
        equipment: itemShards[index],
      } satisfies EquipmentCatalogShard,
    );
    if (!stored) {
      await cleanupScopes(userId, writtenScopes);
      invalidateNativeEquipmentCatalogCache(userId);
      return false;
    }
    writtenScopes.push(scope);
    shards.push({ scope, count: itemShards[index].length });
  }

  const committed = await writeNativeSnapshot(
    rootScope as NativeSnapshotScope,
    userId,
    {
      kind: EQUIPMENT_CATALOG_MANIFEST_KIND,
      revision,
      databaseId: normalizedId,
      itemCount: equipment.length,
      total: Math.max(equipment.length, Number(total || 0)),
      shards,
    } satisfies EquipmentCatalogManifest,
  );
  if (!committed) {
    await cleanupScopes(userId, writtenScopes);
    invalidateNativeEquipmentCatalogCache(userId);
    return false;
  }
  invalidateNativeEquipmentCatalogCache(userId);

  const expectedTotal = Math.max(equipment.length, Number(total || 0));
  const verified = await readNativeEquipmentCatalogSnapshot(
    userId,
    normalizedId,
    Number.MAX_SAFE_INTEGER,
    { bypassMemory: true },
  ).catch(() => null);
  if (
    !verified
    || verified.data.databaseId !== normalizedId
    || verified.data.equipment.length !== equipment.length
    || Number(verified.data.total) !== expectedTotal
  ) {
    const restored = previous && isCatalogManifest(previous.data, normalizedId)
      ? await writeNativeSnapshot(rootScope as NativeSnapshotScope, userId, previous.data).catch(() => false)
      : false;
    if (!restored) {
      await deleteEncryptedNativeSnapshot(rootScope, userId).catch(() => undefined);
    }
    await cleanupScopes(userId, writtenScopes);
    invalidateNativeEquipmentCatalogCache(userId);
    return false;
  }

  if (previous && isCatalogManifest(previous.data, normalizedId)) {
    await cleanupScopes(userId, previous.data.shards.map((shard) => shard.scope));
  }
  return true;
}
