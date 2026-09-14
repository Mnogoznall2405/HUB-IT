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

it('merges a fresh incomplete page into a complete Chat snapshot without shrinking it', async () => {
  jest.mocked(readNativeCollectionSnapshot).mockResolvedValueOnce({ savedAt: 10, data: page(false) });

  await expect(writeNativeChatInboxSnapshot(17, page(true))).resolves.toBe(true);
  expect(writeNativeCollectionSnapshot).toHaveBeenCalledWith(
    'chat-inbox',
    17,
    'default',
    expect.objectContaining({
      has_more: false,
      next_cursor: null,
      items: expect.arrayContaining([
        expect.objectContaining({ id: 'complete' }),
        expect.objectContaining({ id: 'partial' }),
      ]),
    }),
  );
});

it('commits a complete refreshed Chat catalog', async () => {
  jest.mocked(readNativeCollectionSnapshot).mockResolvedValueOnce({ savedAt: 10, data: page(false) });

  await expect(writeNativeChatInboxSnapshot(17, page(false))).resolves.toBe(true);
  expect(writeNativeCollectionSnapshot).toHaveBeenCalledWith('chat-inbox', 17, 'default', page(false));
});

it('removes conversations from a complete cached catalog while merging a partial page', async () => {
  jest.mocked(readNativeCollectionSnapshot).mockResolvedValueOnce({
    savedAt: 10,
    data: { ...page(false), items: [{ id: 'removed' }, { id: 'retained' }] },
  });
  await writeNativeChatInboxSnapshot(17, page(true), { removedConversationIds: ['removed'] });
  expect(writeNativeCollectionSnapshot).toHaveBeenLastCalledWith('chat-inbox', 17, 'default', {
    has_more: false, next_cursor: null, items: [{ id: 'retained' }, { id: 'partial' }],
  });
});

it('serializes read-merge-write operations so an older snapshot cannot commit last', async () => {
  let finishFirst!: (value: boolean) => void;
  jest.mocked(writeNativeCollectionSnapshot).mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }));
  const first = writeNativeChatInboxSnapshot(17, page(false));
  for (let i = 0; i < 10; i++) await Promise.resolve();
  const second = writeNativeChatInboxSnapshot(17, page(true));
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(writeNativeCollectionSnapshot).toHaveBeenCalledTimes(1);
  finishFirst(true);
  await Promise.all([first, second]);
  expect(writeNativeCollectionSnapshot).toHaveBeenCalledTimes(2);
});

it('skips a stale owner write after asynchronous snapshot reading', async () => {
  let current = true;
  jest.mocked(readNativeCollectionSnapshot).mockImplementationOnce(async () => {
    current = false;
    return null;
  });
  await expect(writeNativeChatInboxSnapshot(17, page(false), { isCurrent: () => current })).resolves.toBe(false);
  expect(writeNativeCollectionSnapshot).not.toHaveBeenCalled();
});
