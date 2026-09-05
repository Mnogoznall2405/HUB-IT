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

const ADDRESS_BOOK_MANIFEST_KIND = 'address-book-shards-v1';
const ADDRESS_BOOK_SHARD_KIND = 'address-book-shard-v1';
// Keep native AES/base64 and file-system bridge calls comfortably below their
// generic 2 MiB ceiling. The Android bridge has to hold both plaintext and the
// encoded ciphertext while a shard is written, so a near-limit shard is risky.
const ADDRESS_BOOK_SHARD_TARGET_BYTES = 512 * 1024;
const ADDRESS_BOOK_OVERSIZED_ITEM_LIMIT_BYTES = MAX_NATIVE_SNAPSHOT_BYTES - 256 * 1024;
const ADDRESS_BOOK_SPLIT_SLICE_ITEMS = 128;
const ADDRESS_BOOK_SPLIT_SLICE_BYTES = 256 * 1024;

type AddressBookPayload = {
  items: unknown[];
  [key: string]: unknown;
};

type AddressBookShardManifestEntry = {
  scope: string;
  count: number;
};

type AddressBookManifest = {
  kind: typeof ADDRESS_BOOK_MANIFEST_KIND;
  revision: string;
  metadata: Record<string, unknown>;
  itemCount: number;
  shards: AddressBookShardManifestEntry[];
};

type AddressBookShard = {
  kind: typeof ADDRESS_BOOK_SHARD_KIND;
  revision: string;
  index: number;
  items: unknown[];
};

let revisionSequence = 0;

function isAddressBookManifest(value: unknown): value is AddressBookManifest {
  const candidate = value as Partial<AddressBookManifest> | null;
  return Boolean(
    candidate
    && candidate.kind === ADDRESS_BOOK_MANIFEST_KIND
    && typeof candidate.revision === 'string'
    && candidate.metadata
    && typeof candidate.metadata === 'object'
    && Number.isInteger(candidate.itemCount)
    && Array.isArray(candidate.shards),
  );
}

function isCompleteAddressBookPayload(value: unknown): value is AddressBookPayload {
  const candidate = value as Partial<AddressBookPayload> | null;
  if (!candidate || !Array.isArray(candidate.items) || candidate.has_more === true) return false;
  if (candidate.total == null) return true;
  const total = Number(candidate.total);
  return Number.isInteger(total) && total >= 0 && total === candidate.items.length;
}

function shardScope(revision: string, index: number): string {
  return `address-book-shard-${revision}-${index}`;
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function splitItems(items: unknown[]): Promise<unknown[][] | null> {
  const shards: unknown[][] = [];
  let current: unknown[] = [];
  let currentBytes = 2;
  let sliceItems = 0;
  let sliceBytes = 0;

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const itemBytes = byteLength(item) + (current.length > 0 ? 1 : 0);
    if (itemBytes > ADDRESS_BOOK_OVERSIZED_ITEM_LIMIT_BYTES) return null;
    if (current.length > 0 && currentBytes + itemBytes > ADDRESS_BOOK_SHARD_TARGET_BYTES) {
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
        sliceItems >= ADDRESS_BOOK_SPLIT_SLICE_ITEMS
        || sliceBytes >= ADDRESS_BOOK_SPLIT_SLICE_BYTES
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

function metadataFromPayload(payload: AddressBookPayload): Record<string, unknown> {
  return Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'items'));
}

async function cleanupScopes(userId: number, scopes: string[]): Promise<void> {
  await Promise.allSettled(scopes.map((scope) => deleteEncryptedNativeSnapshot(scope, userId)));
}

export async function readNativeAddressBookSnapshot<T extends AddressBookPayload>(
  userId: number,
): Promise<NativeSnapshot<T> | null> {
  const root = await readNativeSnapshot<T | AddressBookManifest>('address-book', userId);
  if (!root) return null;
  if (!isAddressBookManifest(root.data)) {
    return isCompleteAddressBookPayload(root.data) ? root as NativeSnapshot<T> : null;
  }

  const items: unknown[] = [];
  for (let index = 0; index < root.data.shards.length; index += 1) {
    const descriptor = root.data.shards[index];
    const snapshot = await readNativeSnapshot<AddressBookShard>(
      descriptor.scope as NativeSnapshotScope,
      userId,
    );
    if (
      !snapshot
      || snapshot.data.kind !== ADDRESS_BOOK_SHARD_KIND
      || snapshot.data.revision !== root.data.revision
      || snapshot.data.index !== index
      || !Array.isArray(snapshot.data.items)
      || snapshot.data.items.length !== descriptor.count
    ) return null;
    items.push(...snapshot.data.items);
    if (index < root.data.shards.length - 1) await yieldToEventLoop();
  }
  if (items.length !== root.data.itemCount) return null;
  const data = { ...root.data.metadata, items };
  if (!isCompleteAddressBookPayload(data)) return null;
  return {
    savedAt: root.savedAt,
    data: data as T,
  };
}

export async function writeNativeAddressBookSnapshot<T extends AddressBookPayload>(
  userId: number,
  payload: T,
): Promise<boolean> {
  if (!isCompleteAddressBookPayload(payload)) return false;
  const itemShards = await splitItems(payload.items);
  if (!itemShards) return false;

  const previous = await readNativeSnapshot<T | AddressBookManifest>('address-book', userId);
  revisionSequence += 1;
  const revision = `${Date.now().toString(36)}-${revisionSequence.toString(36)}`;
  const writtenScopes: string[] = [];
  const shards: AddressBookShardManifestEntry[] = [];

  for (let index = 0; index < itemShards.length; index += 1) {
    const scope = shardScope(revision, index);
    const stored = await writeNativeSnapshot(
      scope as NativeSnapshotScope,
      userId,
      {
        kind: ADDRESS_BOOK_SHARD_KIND,
        revision,
        index,
        items: itemShards[index],
      } satisfies AddressBookShard,
    );
    if (!stored) {
      await cleanupScopes(userId, writtenScopes);
      return false;
    }
    writtenScopes.push(scope);
    shards.push({ scope, count: itemShards[index].length });
  }

  const committed = await writeNativeSnapshot('address-book', userId, {
    kind: ADDRESS_BOOK_MANIFEST_KIND,
    revision,
    metadata: metadataFromPayload(payload),
    itemCount: payload.items.length,
    shards,
  } satisfies AddressBookManifest);
  if (!committed) {
    await cleanupScopes(userId, writtenScopes);
    return false;
  }

  const verified = await readNativeAddressBookSnapshot<T>(userId).catch(() => null);
  if (
    !verified
    || verified.data.items.length !== payload.items.length
    || Number(verified.data.total ?? payload.items.length) !== Number(payload.total ?? payload.items.length)
  ) {
    const restored = previous
      ? await writeNativeSnapshot('address-book', userId, previous.data).catch(() => false)
      : false;
    if (!restored) {
      await deleteEncryptedNativeSnapshot('address-book', userId).catch(() => undefined);
    }
    await cleanupScopes(userId, writtenScopes);
    return false;
  }

  if (previous && isAddressBookManifest(previous.data)) {
    await cleanupScopes(userId, previous.data.shards.map((shard) => shard.scope));
  }
  return true;
}
