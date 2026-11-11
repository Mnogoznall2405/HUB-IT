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


let mockGeneration = 0;
jest.mock('../auth/tokenStore', () => ({ getSessionGeneration: () => mockGeneration }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  jest.clearAllMocks();
  mockGeneration += 1;
  mockReadAddressBook.mockResolvedValue(null);
  mockReadCatalog.mockResolvedValue(null);
  mockReadSnapshot.mockResolvedValue(null);
  mockCurrentDatabase.mockResolvedValue({ id: 'db', name: 'Audit', locked: false });
  mockAvailableDatabases.mockResolvedValue([{ id: 'db', name: 'Audit' }]);
});
it('does not persist a late address-book response or coverage after logout', async () => {
  const response = deferred<Awaited<ReturnType<typeof getCompleteAddressBook>>>();
  mockAddressBook.mockReturnValue(response.promise);
  const result = refreshNativeReadCaches({ userId: 7, permissions: ['address_book.read'], force: true });
  await Promise.resolve(); await Promise.resolve();
  expect(mockAddressBook).toHaveBeenCalledTimes(1);
  mockGeneration += 1;
  response.resolve({ items: [], total: 0 });
  expect(await result).toEqual({ refreshed: [], failed: [] });
  expect(mockWriteAddressBook).not.toHaveBeenCalled();
  expect(mockCoverageSuccess).not.toHaveBeenCalled();
  expect(mockCoverageFailure).not.toHaveBeenCalled();
});
it('stops equipment pagination and does not write a catalog from the previous session', async () => {
  const response = deferred<Awaited<ReturnType<typeof listEquipment>>>();
  mockEquipment.mockReturnValue(response.promise);
  const result = refreshNativeReadCaches({ userId: 7, permissions: ['database.read'], force: true });
  for (let i = 0; i < 12; i++) await Promise.resolve();
  expect(mockEquipment).toHaveBeenCalledTimes(1);
  mockGeneration += 1;
  response.resolve({ equipment: [{ inv_no: 'A' } as never], total: 2, page: 1, pages: 2 });
  expect(await result).toEqual({ refreshed: [], failed: [] });
  expect(mockEquipment).toHaveBeenCalledTimes(1);
  expect(mockWriteCatalog).not.toHaveBeenCalled();
  expect(mockWriteCollection).not.toHaveBeenCalled();
  expect(mockCoverageSuccess).not.toHaveBeenCalled();
  expect(mockCoverageFailure).not.toHaveBeenCalled();
});
it('does not write notifications or failure coverage after session switch', async () => {
  const response = deferred<Awaited<ReturnType<typeof pollHubNotifications>>>();
  mockHubNotifications.mockReturnValue(response.promise);
  const result = refreshNativeReadCaches({ userId: 7, permissions: ['dashboard.read'], force: true });
  await Promise.resolve(); await Promise.resolve();
  mockGeneration += 1;
  response.resolve({ items: [], unread_counts: {}, limit: 200, unread_only: false });
  await result;
  expect(mockWriteSnapshot).not.toHaveBeenCalled();
  expect(mockCoverageSuccess).not.toHaveBeenCalled();
  expect(mockCoverageFailure).not.toHaveBeenCalled();
});
it('does not reuse a pending refresh across session, permissions or force changes', async () => {
  const old = deferred<Awaited<ReturnType<typeof getCompleteAddressBook>>>();
  mockAddressBook.mockReturnValueOnce(old.promise).mockResolvedValue({ items: [], total: 0 });
  const first = refreshNativeReadCaches({ userId: 7, permissions: ['address_book.read'] });
  await Promise.resolve(); await Promise.resolve();
  mockGeneration += 1;
  await refreshNativeReadCaches({ userId: 7, permissions: ['address_book.read'] });
  expect(mockAddressBook).toHaveBeenCalledTimes(2);
  old.resolve({ items: [], total: 0 }); await first;
  expect(mockWriteAddressBook).toHaveBeenCalledTimes(1);
  const paused = deferred<Awaited<ReturnType<typeof getCompleteAddressBook>>>();
  mockAddressBook.mockReturnValueOnce(paused.promise);
  const pending = refreshNativeReadCaches({ userId: 7, permissions: ['address_book.read'] });
  await Promise.resolve(); await Promise.resolve();
  await refreshNativeReadCaches({ userId: 7, permissions: ['address_book.read'], force: true });
  await refreshNativeReadCaches({ userId: 7, permissions: [] });
  expect(mockAddressBook).toHaveBeenCalledTimes(4);
  paused.resolve({ items: [], total: 0 }); await pending;
});
