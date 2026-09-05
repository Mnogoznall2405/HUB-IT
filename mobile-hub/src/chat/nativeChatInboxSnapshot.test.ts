import type { ChatConversationPage } from '../api/types';
import {
  readNativeCollectionSnapshot,
  readNativeSnapshot,
  writeNativeCollectionSnapshot,
} from '../cache/nativeSnapshotCache';
import {
  readNativeChatInboxSnapshot,
  writeNativeChatInboxSnapshot,
} from './nativeChatInboxSnapshot';

jest.mock('../cache/nativeSnapshotCache', () => ({
  readNativeCollectionSnapshot: jest.fn(async () => null),
  readNativeSnapshot: jest.fn(async () => null),
  writeNativeCollectionSnapshot: jest.fn(async () => true),
}));

const page = (hasMore: boolean): ChatConversationPage => ({
  items: [{ id: hasMore ? 'partial' : 'complete' } as never],
  has_more: hasMore,
  next_cursor: hasMore ? 'next' : null,
});

beforeEach(() => jest.clearAllMocks());

it('reads the legacy plain Chat snapshot during migration', async () => {
  jest.mocked(readNativeSnapshot).mockResolvedValueOnce({ savedAt: 10, data: page(false) });

  await expect(readNativeChatInboxSnapshot(17)).resolves.toEqual({ savedAt: 10, data: page(false) });
});

it('does not shrink a complete Chat snapshot to the first online page', async () => {
  jest.mocked(readNativeCollectionSnapshot).mockResolvedValueOnce({ savedAt: 10, data: page(false) });

  await expect(writeNativeChatInboxSnapshot(17, page(true))).resolves.toBe(true);
  expect(writeNativeCollectionSnapshot).not.toHaveBeenCalled();
});

it('commits a complete refreshed Chat catalog', async () => {
  jest.mocked(readNativeCollectionSnapshot).mockResolvedValueOnce({ savedAt: 10, data: page(false) });

  await expect(writeNativeChatInboxSnapshot(17, page(false))).resolves.toBe(true);
  expect(writeNativeCollectionSnapshot).toHaveBeenCalledWith('chat-inbox', 17, 'default', page(false));
});
