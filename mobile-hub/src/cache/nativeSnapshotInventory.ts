import {
  NATIVE_SNAPSHOT_SCOPES,
  hasNativeCollectionSnapshotManifest,
  readNativeCollectionSnapshots,
  readNativeSnapshot,
  type NativeCollectionSnapshotScope,
  type NativeSnapshot,
  type NativeSnapshotScope,
} from './nativeSnapshotCache';
import { readNativeAddressBookSnapshot } from './nativeAddressBookSnapshot';
import { readNativeEquipmentCatalogSnapshot } from './nativeEquipmentCatalogSnapshot';
import type { NativeDatabaseBootstrapSnapshot } from '../database/nativeDatabaseSnapshot';

type AddressBookSnapshotPayload = {
  items: unknown[];
  [key: string]: unknown;
};

export type NativeOfflineSnapshotScope = NativeSnapshotScope | 'database-catalog';

const PREPARED_SCOPE_BY_PERMISSION = [
  ['dashboard.read', 'dashboard'],
  ['dashboard.read', 'feed-inbox'],
  ['dashboard.read', 'notifications'],
  ['tasks.read', 'tasks-inbox'],
  ['tasks.read', 'notifications'],
  ['chat.read', 'chat-inbox'],
  ['chat.read', 'chat-folders'],
  ['chat.read', 'notifications'],
  ['mail.access', 'mail-inbox'],
  ['mail.access', 'notifications'],
  ['docflow.read', 'docflow-inbox'],
  ['address_book.read', 'address-book'],
  ['database.read', 'database-bootstrap'],
  ['database.read', 'database-inbox'],
  ['database.read', 'database-catalog'],
  ['my_files.read', 'my-files-inbox'],
  ['company_structure.read', 'company-structure-tree'],
] as const satisfies ReadonlyArray<readonly [string, NativeOfflineSnapshotScope]>;

export type NativeSnapshotInventory = {
  ready: boolean;
  scopes: NativeOfflineSnapshotScope[];
  missingScopes: NativeOfflineSnapshotScope[];
  lastSyncAt: number;
};

const COLLECTION_SCOPES = new Set<NativeSnapshotScope>([
  'feed-inbox',
  'tasks-inbox',
  'chat-inbox',
  'mail-inbox',
  'docflow-inbox',
  'database-inbox',
]);

function isCollectionScope(scope: NativeSnapshotScope): scope is NativeCollectionSnapshotScope {
  return COLLECTION_SCOPES.has(scope);
}

export function getRequiredNativeOfflineScopes(permissions: readonly string[] | null | undefined) {
  const allowed = new Set((permissions || []).map((permission) => String(permission || '').trim()));
  return [...new Set(PREPARED_SCOPE_BY_PERMISSION
    .filter(([permission]) => allowed.has(permission))
    .map(([, scope]) => scope))];
}

async function readVerifiedSnapshot(
  scope: NativeSnapshotScope,
  userId: number,
): Promise<NativeSnapshot<unknown> | null> {
  if (scope === 'address-book') {
    return readNativeAddressBookSnapshot<AddressBookSnapshotPayload>(userId);
  }
  return readNativeSnapshot<unknown>(scope, userId);
}

function snapshotPayloads(snapshot: NativeSnapshot<unknown>): Record<string, unknown>[] {
  const root = snapshot.data as Record<string, unknown> | null;
  if (!root || typeof root !== 'object') return [];
  if (!Array.isArray(root.entries)) return [root];
  return root.entries
    .map((entry) => (entry as { data?: unknown })?.data)
    .filter((value): value is Record<string, unknown> => Boolean(value && typeof value === 'object'));
}

function countItems(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): boolean {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0;
}

function isDatabaseListPayload(payload: Record<string, unknown>): boolean {
  return (
    typeof payload.signature === 'string'
    && payload.signature.length > 0
    && typeof payload.databaseId === 'string'
    && payload.databaseId.length > 0
    && payload.mode === 'equipment'
    && payload.query === ''
    && Array.isArray(payload.equipment)
    && Array.isArray(payload.consumables)
    && Array.isArray(payload.acts)
    && isNonNegativeInteger(payload.total)
    && isNonNegativeInteger(payload.page)
    && isNonNegativeInteger(payload.pages)
    && payload.truncated !== true
  );
}

function isPreparedScopeComplete(
  scope: NativeSnapshotScope,
  payloads: Record<string, unknown>[],
): boolean {
  if (payloads.length === 0) return false;
  return payloads.some((payload) => {
    if (scope === 'dashboard') {
      const counts = payload.communicationCounts;
      return isRecord(payload.payload)
        && isRecord(counts)
        && isNonNegativeInteger(counts.chat)
        && isNonNegativeInteger(counts.mail);
    }
    if (scope === 'notifications') {
      return Array.isArray(payload.hubItems)
        && Array.isArray(payload.mailItems)
        && isNonNegativeInteger(payload.hubUnread)
        && isNonNegativeInteger(payload.mailUnread);
    }
    if (scope === 'chat-folders') {
      return Array.isArray(payload.items) && isRecord(payload.conversation_ids_by_folder);
    }
    if (scope === 'chat-inbox') return Array.isArray(payload.items) && payload.has_more === false;
    if (scope === 'feed-inbox') {
      const total = Number(payload.total);
      return Array.isArray(payload.items) && isNonNegativeInteger(total) && countItems(payload.items) >= total;
    }
    if (scope === 'tasks-inbox') {
      const page = isRecord(payload.page) ? payload.page : null;
      const total = Number(page?.total);
      return Boolean(page && Array.isArray(page.items) && isNonNegativeInteger(total) && countItems(page.items) >= total);
    }
    if (scope === 'mail-inbox') {
      const total = Number(payload.total);
      return Array.isArray(payload.items)
        && payload.hasMore === false
        && isNonNegativeInteger(total)
        && countItems(payload.items) >= total;
    }
    if (scope === 'docflow-inbox') {
      const result = isRecord(payload.result) ? payload.result : null;
      if (!result || !Array.isArray(result.items) || result.truncated === true || result.has_more === true) return false;
      const total = result.total == null ? null : Number(result.total);
      return total == null || (isNonNegativeInteger(total) && countItems(result.items) >= total);
    }
    if (scope === 'database-bootstrap') {
      const currentDatabase = payload.currentDatabase;
      return Array.isArray(payload.databases)
        && isRecord(currentDatabase)
        && typeof currentDatabase.id === 'string'
        && currentDatabase.id.trim().length > 0;
    }
    if (scope === 'database-inbox') return isDatabaseListPayload(payload);
    if (scope === 'my-files-inbox') {
      return Array.isArray(payload.items) && (payload.quota === null || isRecord(payload.quota));
    }
    if (scope === 'company-structure-tree') {
      return Array.isArray(payload.items) && isNonNegativeInteger(payload.count);
    }
    return true;
  });
}

export async function getNativeSnapshotInventory(
  userId: number,
  requiredScopes: readonly NativeOfflineSnapshotScope[] = [],
): Promise<NativeSnapshotInventory> {
  const owner = Number(userId || 0);
  if (!Number.isInteger(owner) || owner <= 0) {
    return { ready: false, scopes: [], missingScopes: [...requiredScopes], lastSyncAt: 0 };
  }

  const snapshots: Array<{
    scope: NativeSnapshotScope;
    snapshot: NativeSnapshot<unknown> | null;
    payloads: Record<string, unknown>[];
  }> = [];
  for (const scope of NATIVE_SNAPSHOT_SCOPES) {
    const snapshot = await readVerifiedSnapshot(scope, owner);
    let payloads: Record<string, unknown>[];
    if (isCollectionScope(scope)) {
      const collections = (await readNativeCollectionSnapshots<Record<string, unknown>>(scope, owner))
        .map((entry) => entry.data)
        .filter((value): value is Record<string, unknown> => Boolean(value && typeof value === 'object'));
      payloads = collections.length > 0 || hasNativeCollectionSnapshotManifest(snapshot?.data)
        ? collections
        : snapshot
          ? snapshotPayloads(snapshot)
          : [];
    } else {
      payloads = snapshot ? snapshotPayloads(snapshot) : [];
    }
    snapshots.push({ scope, snapshot, payloads });
  }
  const available = snapshots.filter((item) => (
    item.snapshot && (!isCollectionScope(item.scope) || item.payloads.length > 0)
  ));
  const scopes: NativeOfflineSnapshotScope[] = available.map((item) => item.scope);
  const completeScopes = new Set<NativeOfflineSnapshotScope>(
    available
      .filter((item) => isPreparedScopeComplete(item.scope, item.payloads))
      .map((item) => item.scope),
  );
  const savedAtValues = available.map((item) => item.snapshot?.savedAt || 0);
  const savedAtByScope = new Map<NativeOfflineSnapshotScope, number>(
    available.map((item) => [item.scope, Number(item.snapshot?.savedAt || 0)]),
  );

  if (requiredScopes.includes('database-catalog')) {
    const bootstrap = available.find((item) => item.scope === 'database-bootstrap')
      ?.snapshot as NativeSnapshot<NativeDatabaseBootstrapSnapshot> | null | undefined;
    const databaseIds = [...new Set([
      String(bootstrap?.data?.currentDatabase?.id || '').trim(),
      ...(Array.isArray(bootstrap?.data?.databases)
        ? bootstrap.data.databases.map((database) => String(database?.id || '').trim())
        : []),
    ].filter(Boolean))];
    let catalogsReady = databaseIds.length > 0;
    const databaseLists = snapshots.find((item) => item.scope === 'database-inbox')?.payloads || [];
    const listsReady = databaseIds.length > 0 && databaseIds.every((databaseId) => (
      databaseLists.some((payload) => (
        isDatabaseListPayload(payload) && String(payload.databaseId).trim() === databaseId
      ))
    ));
    if (!listsReady) completeScopes.delete('database-inbox');
    const catalogSavedAtValues: number[] = [];
    for (const databaseId of databaseIds) {
      const catalog = await readNativeEquipmentCatalogSnapshot(owner, databaseId).catch(() => null);
      if (
        !catalog
        || catalog.data.databaseId !== databaseId
        || catalog.data.equipment.length !== Number(catalog.data.total || 0)
      ) {
        catalogsReady = false;
        break;
      }
      savedAtValues.push(catalog.savedAt);
      catalogSavedAtValues.push(catalog.savedAt);
    }
    if (catalogsReady) {
      scopes.push('database-catalog');
      completeScopes.add('database-catalog');
      savedAtByScope.set('database-catalog', Math.min(...catalogSavedAtValues));
    }
  }
  const required = [...new Set(requiredScopes)];
  const missingScopes = required.filter((scope) => !completeScopes.has(scope));
  const requiredSavedAt = required
    .map((scope) => Number(savedAtByScope.get(scope) || 0))
    .filter((savedAt) => savedAt > 0);

  return {
    ready: required.length > 0 ? missingScopes.length === 0 : available.length > 0,
    scopes,
    missingScopes,
    lastSyncAt: requiredSavedAt.length > 0
      ? Math.min(...requiredSavedAt)
      : savedAtValues.reduce((latest, savedAt) => Math.max(latest, savedAt), 0),
  };
}
