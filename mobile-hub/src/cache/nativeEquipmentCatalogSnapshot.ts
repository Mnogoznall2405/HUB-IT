import type { EquipmentRecord } from '../api/databaseApi';
import {
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

let revisionSequence = 0;

function normalizedDatabaseId(databaseId: string): string {
  return String(databaseId || '').trim();
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

export async function readNativeEquipmentCatalogSnapshot(
  userId: number,
  databaseId: string,
  maxAgeMs = Number.MAX_SAFE_INTEGER,
): Promise<NativeSnapshot<NativeEquipmentCatalogSnapshot> | null> {
  const normalizedId = normalizedDatabaseId(databaseId);
  if (!normalizedId) return null;
  const root = await readNativeSnapshot<EquipmentCatalogManifest>(
    catalogScope(normalizedId) as NativeSnapshotScope,
    userId,
    maxAgeMs,
  );
  if (!root || !isCatalogManifest(root.data, normalizedId)) return null;

  const equipment: EquipmentRecord[] = [];
  for (let index = 0; index < root.data.shards.length; index += 1) {
    const descriptor = root.data.shards[index];
    const snapshot = await readNativeSnapshot<EquipmentCatalogShard>(
      descriptor.scope as NativeSnapshotScope,
      userId,
      maxAgeMs,
    );
    if (
      !snapshot
      || snapshot.data.kind !== EQUIPMENT_CATALOG_SHARD_KIND
      || snapshot.data.revision !== root.data.revision
      || snapshot.data.index !== index
      || !Array.isArray(snapshot.data.equipment)
      || snapshot.data.equipment.length !== descriptor.count
    ) return null;
    equipment.push(...snapshot.data.equipment);
    if (index < root.data.shards.length - 1) await yieldToEventLoop();
  }
  if (equipment.length !== root.data.itemCount) return null;
  return {
    savedAt: root.savedAt,
    data: {
      databaseId: normalizedId,
      equipment,
      total: root.data.total,
    },
  };
}

export async function writeNativeEquipmentCatalogSnapshot(
  userId: number,
  databaseId: string,
  equipment: EquipmentRecord[],
  total: number,
): Promise<boolean> {
  const normalizedId = normalizedDatabaseId(databaseId);
  if (!normalizedId || !Array.isArray(equipment)) return false;
  const itemShards = await splitEquipment(equipment);
  if (!itemShards) return false;

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
    return false;
  }

  const expectedTotal = Math.max(equipment.length, Number(total || 0));
  const verified = await readNativeEquipmentCatalogSnapshot(userId, normalizedId).catch(() => null);
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
    return false;
  }

  if (previous && isCatalogManifest(previous.data, normalizedId)) {
    await cleanupScopes(userId, previous.data.shards.map((shard) => shard.scope));
  }
  return true;
}
