import { getCompleteAddressBook } from '../api/addressBookApi';
import { getCurrentDatabase, listAvailableDatabases, listEquipment } from '../api/databaseApi';
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
import { refreshNativeReadCaches } from './nativeReadCacheRefresh';
import { readNativeChatInboxSnapshot, writeNativeChatInboxSnapshot } from '../chat/nativeChatInboxSnapshot';
import {
  recordNativeOfflineCoverageFailure,
  recordNativeOfflineCoverageSuccess,
} from './nativeOfflineCoverage';

jest.mock('../api/addressBookApi', () => ({ getCompleteAddressBook: jest.fn() }));
jest.mock('../api/databaseApi', () => ({
  getCurrentDatabase: jest.fn(),
  listAvailableDatabases: jest.fn(),
  listEquipment: jest.fn(),
}));
jest.mock('../api/chatApi', () => ({
  getConversationPage: jest.fn(),
  listChatFolders: jest.fn(),
}));
jest.mock('../api/notificationApi', () => ({
  getMailNotificationFeed: jest.fn(),
  pollHubNotifications: jest.fn(),
}));
jest.mock('../cache/nativeAddressBookSnapshot', () => ({
  readNativeAddressBookSnapshot: jest.fn(async () => null),
  writeNativeAddressBookSnapshot: jest.fn(async () => true),
}));
jest.mock('../cache/nativeEquipmentCatalogSnapshot', () => ({
  readNativeEquipmentCatalogSnapshot: jest.fn(async () => null),
  writeNativeEquipmentCatalogSnapshot: jest.fn(async () => true),
}));
jest.mock('../cache/nativeSnapshotCache', () => ({
  readNativeSnapshot: jest.fn(async () => null),
  writeNativeCollectionSnapshot: jest.fn(async () => true),
  writeNativeSnapshot: jest.fn(async () => true),
}));
jest.mock('../chat/nativeChatInboxSnapshot', () => ({
  readNativeChatInboxSnapshot: jest.fn(async () => null),
  writeNativeChatInboxSnapshot: jest.fn(async () => true),
}));
jest.mock('./nativeOfflineCoverage', () => ({
  recordNativeOfflineCoverageSuccess: jest.fn(async () => true),
  recordNativeOfflineCoverageFailure: jest.fn(async () => true),
}));

const mockAddressBook = jest.mocked(getCompleteAddressBook);
const mockCurrentDatabase = jest.mocked(getCurrentDatabase);
const mockAvailableDatabases = jest.mocked(listAvailableDatabases);
const mockEquipment = jest.mocked(listEquipment);
const mockConversationPage = jest.mocked(getConversationPage);
const mockChatFolders = jest.mocked(listChatFolders);
const mockHubNotifications = jest.mocked(pollHubNotifications);
const mockMailNotifications = jest.mocked(getMailNotificationFeed);
const mockReadSnapshot = jest.mocked(readNativeSnapshot);
const mockReadAddressBook = jest.mocked(readNativeAddressBookSnapshot);
const mockWriteAddressBook = jest.mocked(writeNativeAddressBookSnapshot);
const mockReadCatalog = jest.mocked(readNativeEquipmentCatalogSnapshot);
const mockWriteCatalog = jest.mocked(writeNativeEquipmentCatalogSnapshot);
const mockWriteCollection = jest.mocked(writeNativeCollectionSnapshot);
const mockWriteSnapshot = jest.mocked(writeNativeSnapshot);
const mockReadChatInbox = jest.mocked(readNativeChatInboxSnapshot);
const mockWriteChatInbox = jest.mocked(writeNativeChatInboxSnapshot);
const mockCoverageSuccess = jest.mocked(recordNativeOfflineCoverageSuccess);
const mockCoverageFailure = jest.mocked(recordNativeOfflineCoverageFailure);

it('fails refresh when the coverage status could not be committed', async () => {
  mockCoverageSuccess.mockResolvedValueOnce(false);
  const result = await refreshNativeReadCaches({ userId: 17, permissions: ['address_book.read'], force: true });
  expect(result.refreshed).toEqual([]);
  expect(result.failed).toEqual(['Адресная книга']);
});

beforeEach(() => {
  jest.clearAllMocks();
  mockReadAddressBook.mockResolvedValue(null);
  mockReadCatalog.mockResolvedValue(null);
  mockReadSnapshot.mockResolvedValue(null);
  mockReadChatInbox.mockResolvedValue(null);
  mockConversationPage.mockResolvedValue({ items: [], has_more: false, next_cursor: null });
  mockChatFolders.mockResolvedValue({ items: [], conversation_ids_by_folder: {}, folder_unread_counts: {} });
  mockHubNotifications.mockResolvedValue({ items: [], unread_counts: {}, limit: 200, unread_only: false });
  mockMailNotifications.mockResolvedValue({ items: [], total_unread: 0, limit: 50 });
  mockAddressBook.mockResolvedValue({
    items: [{ full_name: 'Иванов Иван' }],
    total: 1,
    has_more: false,
  });
  mockCurrentDatabase.mockResolvedValue({ id: 'ITINVENT', name: 'Основная', locked: false });
  mockAvailableDatabases.mockResolvedValue([
    { id: 'ITINVENT', name: 'Основная' },
    { id: 'MSK', name: 'Москва' },
  ]);
  mockEquipment.mockImplementation(async (page, _limit, databaseId) => {
    if (databaseId === 'ITINVENT' && page === 1) {
      return {
        equipment: [{ inv_no: 'INV-1' } as never, { inv_no: 'INV-2' } as never],
        total: 3,
        page: 1,
        pages: 2,
      };
    }
    if (databaseId === 'ITINVENT') {
      return { equipment: [{ inv_no: 'INV-3' } as never], total: 3, page: 2, pages: 2 };
    }
    return { equipment: [{ inv_no: 'MSK-1' } as never], total: 1, page: 1, pages: 1 };
  });
});

it('downloads every equipment page for every available database and commits complete catalogs', async () => {
  const result = await refreshNativeReadCaches({
    userId: 17,
    permissions: ['address_book.read', 'database.read'],
    force: true,
  });

  expect(result).toEqual({ refreshed: ['Адресная книга', 'Инвентарь'], failed: [] });
  expect(mockEquipment).toHaveBeenNthCalledWith(1, 1, 200, 'ITINVENT');
  expect(mockEquipment).toHaveBeenNthCalledWith(2, 2, 200, 'ITINVENT');
  expect(mockEquipment).toHaveBeenNthCalledWith(3, 1, 200, 'MSK');
  expect(mockWriteCatalog).toHaveBeenCalledWith(
    17,
    'ITINVENT',
    [expect.objectContaining({ inv_no: 'INV-1' }), expect.objectContaining({ inv_no: 'INV-2' }), expect.objectContaining({ inv_no: 'INV-3' })],
    3,
  );
  expect(mockWriteCatalog).toHaveBeenCalledWith(
    17,
    'MSK',
    [expect.objectContaining({ inv_no: 'MSK-1' })],
    1,
  );
  expect(mockWriteAddressBook).toHaveBeenCalledWith(17, expect.objectContaining({ total: 1 }));
  expect(mockWriteSnapshot).toHaveBeenCalledWith('database-bootstrap', 17, expect.objectContaining({
    databases: expect.arrayContaining([expect.objectContaining({ id: 'MSK' })]),
  }));
  expect(mockWriteCollection).toHaveBeenCalledTimes(2);
  expect(mockCoverageSuccess).toHaveBeenCalledWith(
    17,
    'addressBook',
    expect.objectContaining({ loaded: 1, total: 1 }),
  );
  expect(mockCoverageSuccess).toHaveBeenCalledWith(
    17,
    'database',
    expect.objectContaining({ loaded: 4, total: 4 }),
  );
});

it('finishes the address-book snapshot before starting the heavy Inventory refresh', async () => {
  let finishAddressBook: ((value: { items: never[]; total: number; has_more: boolean }) => void) | undefined;
  mockAddressBook.mockImplementationOnce(() => new Promise((resolve) => {
    finishAddressBook = resolve;
  }));

  const refresh = refreshNativeReadCaches({
    userId: 17,
    permissions: ['address_book.read', 'database.read'],
    force: true,
  });
  await Promise.resolve();
  await Promise.resolve();

  expect(mockCurrentDatabase).not.toHaveBeenCalled();
  finishAddressBook?.({ items: [], total: 0, has_more: false });
  await refresh;
  expect(mockCurrentDatabase).toHaveBeenCalledTimes(1);
});

it('keeps fresh local copies without downloading the large datasets again', async () => {
  const fresh = Date.now();
  mockReadAddressBook.mockResolvedValue({ savedAt: fresh, data: { items: [], total: 0 } });
  mockReadCatalog.mockResolvedValue({
    savedAt: fresh,
    data: { databaseId: 'ITINVENT', equipment: [], total: 0 },
  });
  mockAvailableDatabases.mockResolvedValue([{ id: 'ITINVENT', name: 'Основная' }]);

  await refreshNativeReadCaches({
    userId: 17,
    permissions: ['address_book.read', 'database.read'],
  });

  expect(mockAddressBook).not.toHaveBeenCalled();
  expect(mockEquipment).not.toHaveBeenCalled();
});

it('continues caching later databases when one database fails', async () => {
  mockEquipment.mockImplementation(async (_page, _limit, databaseId) => {
    if (databaseId === 'ITINVENT') throw new Error('temporary database failure');
    return { equipment: [{ inv_no: 'MSK-1' } as never], total: 1, page: 1, pages: 1 };
  });

  const result = await refreshNativeReadCaches({
    userId: 17,
    permissions: ['database.read'],
    force: true,
  });

  expect(result).toEqual({ refreshed: [], failed: ['Инвентарь'] });
  expect(mockWriteCatalog).toHaveBeenCalledWith(
    17,
    'MSK',
    [expect.objectContaining({ inv_no: 'MSK-1' })],
    1,
  );
  expect(mockCoverageFailure).toHaveBeenCalledWith(
    17,
    'database',
    expect.objectContaining({ errorCode: 'database-refresh-failed' }),
  );
});

it('does not call APIs for modules the user cannot read', async () => {
  await expect(refreshNativeReadCaches({ userId: 17, permissions: [] })).resolves.toEqual({
    refreshed: [],
    failed: [],
  });
  expect(mockAddressBook).not.toHaveBeenCalled();
  expect(mockAvailableDatabases).not.toHaveBeenCalled();
});

it('refreshes chat folders and notifications in the background cache', async () => {
  const result = await refreshNativeReadCaches({
    userId: 17,
    permissions: ['chat.read', 'mail.access'],
    force: true,
  });

  expect(result).toEqual({ refreshed: ['Chat', 'Уведомления'], failed: [] });
  expect(mockConversationPage).toHaveBeenCalledWith({ limit: 200 });
  expect(mockHubNotifications).toHaveBeenCalledWith({ limit: 200, unreadOnly: false });
  expect(mockMailNotifications).toHaveBeenCalledWith(50);
  expect(mockWriteChatInbox).toHaveBeenCalledWith(17, expect.any(Object));
  expect(mockWriteSnapshot).toHaveBeenCalledWith('chat-folders', 17, expect.any(Object));
  expect(mockWriteSnapshot).toHaveBeenCalledWith('notifications', 17, expect.any(Object));
});
