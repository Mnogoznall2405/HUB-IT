import { getCompleteAddressBook, type AddressBookSearchResponse } from '../api/addressBookApi';
import { recordSnapshotFailure } from '../diagnostics/diagnostics';
import {
  getCurrentDatabase,
  listAvailableDatabases,
  listEquipment,
  type EquipmentRecord,
} from '../api/databaseApi';
import { getConversationPage, listChatFolders } from '../api/chatApi';
import { getMailNotificationFeed, pollHubNotifications } from '../api/notificationApi';
import {
  readNativeAddressBookSnapshot,
  writeNativeAddressBookSnapshot,
} from '../cache/nativeAddressBookSnapshot';
import {
  readNativeEquipmentCatalogSnapshot,
  writeNativeEquipmentCatalogSnapshot,
} from '../cache/nativeEquipmentCatalogSnapshot';
import { readNativeSnapshot, writeNativeCollectionSnapshot, writeNativeSnapshot } from '../cache/nativeSnapshotCache';
import {
  nativeDatabaseListSignature,
  type NativeDatabaseBootstrapSnapshot,
  type NativeDatabaseListSnapshot,
} from '../database/nativeDatabaseSnapshot';
import { readNativeChatInboxSnapshot, writeNativeChatInboxSnapshot } from '../chat/nativeChatInboxSnapshot';
import {
  recordNativeOfflineCoverageFailure,
  recordNativeOfflineCoverageSuccess,
} from './nativeOfflineCoverage';

const EQUIPMENT_CATALOG_PAGE_SIZE = 200;
const DATABASE_SCREEN_PAGE_SIZE = 50;
const CHAT_PAGE_SIZE = 200;
export const NATIVE_READ_CACHE_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

type RefreshNativeReadCachesOptions = {
  userId: number;
  permissions: readonly string[];
  force?: boolean;
};

export type NativeReadCacheRefreshResult = {
  refreshed: string[];
  failed: string[];
};

type RefreshMetric = {
  loaded: number;
  total: number | null;
  unit: string;
  status?: 'complete' | 'partial';
  savedAt?: string;
};

const refreshRequests = new Map<number, Promise<NativeReadCacheRefreshResult>>();

function isFresh(savedAt: number): boolean {
  return Number.isFinite(savedAt)
    && savedAt > 0
    && Date.now() - savedAt < NATIVE_READ_CACHE_REFRESH_INTERVAL_MS;
}

function normalizeInventoryNumber(value: unknown): string {
  return String(value || '').trim().toLocaleUpperCase('ru-RU');
}

function uniqueEquipment(items: EquipmentRecord[]): EquipmentRecord[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = normalizeInventoryNumber(item.inv_no);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function refreshAddressBook(userId: number, force: boolean): Promise<RefreshMetric> {
  const existing = await readNativeAddressBookSnapshot<AddressBookSearchResponse>(userId);
  if (!force && existing && isFresh(existing.savedAt)) {
    const loaded = Array.isArray(existing.data.items) ? existing.data.items.length : 0;
    return {
      loaded,
      total: Number(existing.data.total ?? loaded),
      unit: 'сотрудников',
      savedAt: new Date(existing.savedAt).toISOString(),
    };
  }
  const directory = await getCompleteAddressBook();
  const stored = await writeNativeAddressBookSnapshot(userId, directory);
  if (!stored) throw new Error('Не удалось сохранить полную адресную книгу');
  return {
    loaded: directory.items.length,
    total: Number(directory.total ?? directory.items.length),
    unit: 'сотрудников',
    status: directory.has_more ? 'partial' : 'complete',
  };
}

async function refreshChat(userId: number, force: boolean): Promise<RefreshMetric> {
  const [inbox, folders] = await Promise.all([
    readNativeChatInboxSnapshot(userId),
    readNativeSnapshot('chat-folders', userId),
  ]);
  if (!force && inbox && folders && isFresh(Math.min(inbox.savedAt, folders.savedAt))) {
    return {
      loaded: inbox.data.items.length,
      total: inbox.data.has_more ? null : inbox.data.items.length,
      unit: 'диалогов',
      status: inbox.data.has_more ? 'partial' : 'complete',
      savedAt: new Date(Math.min(inbox.savedAt, folders.savedAt)).toISOString(),
    };
  }
  const [firstPage, folderList] = await Promise.all([
    getConversationPage({ limit: CHAT_PAGE_SIZE }),
    listChatFolders(),
  ]);
  let page = firstPage;
  const seenCursors = new Set<string>();
  while (page.has_more && page.next_cursor) {
    const cursor = String(page.next_cursor);
    if (seenCursors.has(cursor)) break;
    seenCursors.add(cursor);
    const nextPage = await getConversationPage({ cursor, limit: CHAT_PAGE_SIZE });
    const byId = new Map(page.items.map((item) => [String(item.id), item]));
    nextPage.items.forEach((item) => byId.set(String(item.id), item));
    if (byId.size <= page.items.length) break;
    page = { ...nextPage, items: [...byId.values()] };
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  const [inboxStored, foldersStored] = await Promise.all([
    writeNativeChatInboxSnapshot(userId, page),
    writeNativeSnapshot('chat-folders', userId, folderList),
  ]);
  if (!inboxStored || !foldersStored) throw new Error('Не удалось сохранить список чатов');
  return {
    loaded: page.items.length,
    total: page.has_more ? null : page.items.length,
    unit: 'диалогов',
    status: page.has_more ? 'partial' : 'complete',
  };
}

async function refreshNotifications(userId: number, force: boolean, includeMail: boolean): Promise<RefreshMetric> {
  const existing = await readNativeSnapshot('notifications', userId);
  if (!force && existing && isFresh(existing.savedAt)) {
    const data = existing.data as { hubItems?: unknown[]; mailItems?: unknown[] };
    const loaded = (data.hubItems?.length || 0) + (data.mailItems?.length || 0);
    return {
      loaded,
      total: loaded,
      unit: 'уведомлений',
      savedAt: new Date(existing.savedAt).toISOString(),
    };
  }
  const [hub, mail] = await Promise.all([
    pollHubNotifications({ limit: 200, unreadOnly: false }),
    includeMail ? getMailNotificationFeed(50) : Promise.resolve(null),
  ]);
  const stored = await writeNativeSnapshot('notifications', userId, {
    hubItems: hub.items,
    mailItems: mail?.items || [],
    hubUnread: Math.max(0, Number(hub.unread_counts?.notifications_unread_total || 0)),
    mailUnread: Math.max(0, Number(mail?.total_unread || 0)),
  });
  if (!stored) throw new Error('Не удалось сохранить уведомления');
  const loaded = hub.items.length + (mail?.items.length || 0);
  return { loaded, total: loaded, unit: 'уведомлений' };
}

async function loadCompleteEquipmentCatalog(databaseId: string): Promise<{
  equipment: EquipmentRecord[];
  total: number;
}> {
  const firstPage = await listEquipment(1, EQUIPMENT_CATALOG_PAGE_SIZE, databaseId);
  const pages = Math.max(1, Number(firstPage.pages || 1));
  const collected = [...firstPage.equipment];
  let expectedTotal = Math.max(Number(firstPage.total || 0), collected.length);

  for (let page = 2; page <= pages; page += 1) {
    const nextPage = await listEquipment(page, EQUIPMENT_CATALOG_PAGE_SIZE, databaseId);
    collected.push(...nextPage.equipment);
    expectedTotal = Math.max(expectedTotal, Number(nextPage.total || 0));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  const equipment = uniqueEquipment(collected);
  if (equipment.length < expectedTotal) {
    throw new Error(`Получен неполный каталог оборудования ${databaseId}: ${equipment.length} из ${expectedTotal}`);
  }
  return { equipment, total: expectedTotal };
}

async function refreshEquipment(userId: number, force: boolean): Promise<RefreshMetric> {
  const [databases, currentDatabase] = await Promise.all([
    listAvailableDatabases(),
    getCurrentDatabase(),
  ]);
  const targets = [currentDatabase, ...databases]
    .filter((database, index, items) => Boolean(database?.id) && (
      items.findIndex((candidate) => candidate.id === database.id) === index
    ));
  const bootstrapStored = await writeNativeSnapshot<NativeDatabaseBootstrapSnapshot>(
    'database-bootstrap',
    userId,
    { databases, currentDatabase },
  );
  if (!bootstrapStored) throw new Error('Не удалось сохранить список доступных баз');

  const failedDatabases: string[] = [];
  let loaded = 0;
  const catalogSavedAtValues: number[] = [];
  for (const database of targets) {
    try {
      const existing = await readNativeEquipmentCatalogSnapshot(userId, database.id);
      if (!force && existing && isFresh(existing.savedAt)) {
        loaded += existing.data.equipment.length;
        catalogSavedAtValues.push(existing.savedAt);
        continue;
      }

      const catalog = await loadCompleteEquipmentCatalog(database.id);
      const stored = await writeNativeEquipmentCatalogSnapshot(
        userId,
        database.id,
        catalog.equipment,
        catalog.total,
      );
      if (!stored) throw new Error('catalog snapshot was not committed');
      loaded += catalog.equipment.length;
      catalogSavedAtValues.push(Date.now());

      const signature = nativeDatabaseListSignature(database.id, 'equipment', '');
      const firstScreenPage = catalog.equipment.slice(0, DATABASE_SCREEN_PAGE_SIZE);
      const listStored = await writeNativeCollectionSnapshot<NativeDatabaseListSnapshot>(
        'database-inbox',
        userId,
        signature,
        {
          signature,
          databaseId: database.id,
          mode: 'equipment',
          query: '',
          equipment: firstScreenPage,
          consumables: [],
          acts: [],
          total: catalog.total,
          page: 1,
          pages: Math.max(1, Math.ceil(catalog.total / DATABASE_SCREEN_PAGE_SIZE)),
        },
      );
      if (!listStored) throw new Error('quick list snapshot was not committed');
    } catch (error) {
      await recordSnapshotFailure('database', 'catalog-refresh', error);
      failedDatabases.push(database.name || database.id);
    }
  }
  if (failedDatabases.length > 0) {
    throw new Error(`Не удалось обновить базы: ${failedDatabases.join(', ')}`);
  }
  return {
    loaded,
    total: loaded,
    unit: 'карточек',
    savedAt: catalogSavedAtValues.length > 0
      ? new Date(Math.min(...catalogSavedAtValues)).toISOString()
      : undefined,
  };
}

async function runRefresh(options: RefreshNativeReadCachesOptions): Promise<NativeReadCacheRefreshResult> {
  const allowed = new Set(options.permissions.map((permission) => String(permission || '').trim()));
  const requested: Array<readonly [string, string, () => Promise<RefreshMetric>]> = [];
  if (allowed.has('chat.read')) {
    requested.push(['chat', 'Chat', () => refreshChat(options.userId, options.force === true)]);
  }
  if (['dashboard.read', 'tasks.read', 'chat.read', 'mail.access'].some((permission) => allowed.has(permission))) {
    requested.push(['notifications', 'Уведомления', () => refreshNotifications(
      options.userId,
      options.force === true,
      allowed.has('mail.access'),
    )]);
  }
  if (allowed.has('address_book.read')) {
    requested.push(['addressBook', 'Адресная книга', () => refreshAddressBook(options.userId, options.force === true)]);
  }
  if (allowed.has('database.read')) {
    requested.push(['database', 'Инвентарь', () => refreshEquipment(options.userId, options.force === true)]);
  }
  const result: NativeReadCacheRefreshResult = { refreshed: [], failed: [] };
  // Large encrypted snapshots share the Android crypto/file-system bridge.
  // Serialize them to avoid address-book and Inventory allocations competing.
  for (const [moduleId, label, refresh] of requested) {
    try {
      const metric = await refresh();
      const coverageStored = await recordNativeOfflineCoverageSuccess(options.userId, moduleId, {
        status: metric.status || 'complete',
        loaded: metric.loaded,
        total: metric.total,
        unit: metric.unit,
        savedAt: metric.savedAt,
      });
      if (!coverageStored) throw new Error('Offline coverage manifest write failed');
      result.refreshed.push(label);
    } catch (error) {
      await recordSnapshotFailure(moduleId, 'refresh', error);
      await recordNativeOfflineCoverageFailure(options.userId, moduleId, {
        errorCode: `${moduleId}-refresh-failed`,
        errorMessage: error instanceof Error ? error.message : `Не удалось обновить раздел «${label}»`,
      });
      result.failed.push(label);
    }
  }
  return result;
}

export async function refreshNativeReadCaches(
  options: RefreshNativeReadCachesOptions,
): Promise<NativeReadCacheRefreshResult> {
  const userId = Number(options.userId || 0);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error('Authenticated user is required');
  }
  const pending = refreshRequests.get(userId);
  if (pending) return pending;
  const request = runRefresh({ ...options, userId }).finally(() => {
    if (refreshRequests.get(userId) === request) refreshRequests.delete(userId);
  });
  refreshRequests.set(userId, request);
  return request;
}
