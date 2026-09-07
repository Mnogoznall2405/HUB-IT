import type { ChatMessage } from '../api/types';
import {
  bumpNativeChatThreadHistoryGeneration,
  mergeNativeChatThreadHistory,
  scheduleNativeChatThreadSnapshotWrite,
  waitForNativeChatThreadSnapshotWrites,
} from './nativeChatThreadHistory';
import {
  readNativeEntitySnapshot,
  writeNativeEntitySnapshot,
} from '../cache/nativeSnapshotCache';

jest.mock('../cache/nativeSnapshotCache', () => ({
  readNativeEntitySnapshot: jest.fn(async () => null),
  writeNativeEntitySnapshot: jest.fn(async () => undefined),
}));

jest.mock('../diagnostics/diagnostics', () => ({
  recordDiagnosticEvent: jest.fn(async () => undefined),
}));

const readMock = readNativeEntitySnapshot as jest.MockedFunction<typeof readNativeEntitySnapshot>;
const writeMock = writeNativeEntitySnapshot as jest.MockedFunction<typeof writeNativeEntitySnapshot>;

function message(id: string, body = id): ChatMessage {
  return {
    id,
    conversation_id: 'c1',
    sender_user_id: 1,
    body_text: body,
    created_at: `2026-01-01T00:00:${id.padStart(2, '0')}.000Z`,
  };
}

beforeEach(() => {
  bumpNativeChatThreadHistoryGeneration();
  readMock.mockReset();
  writeMock.mockReset();
  readMock.mockResolvedValue(null);
  writeMock.mockResolvedValue(undefined);
});

describe('nativeChatThreadHistory', () => {
  it('merges display windows without dropping previously accumulated pages', () => {
    const page1 = Array.from({ length: 80 }, (_, index) => message(String(index + 1)));
    const page2 = Array.from({ length: 80 }, (_, index) => message(String(index + 81)));
    const focusWindow = [message('10'), message('11'), message('12')];
    const latestWindow = Array.from({ length: 80 }, (_, index) => message(String(index + 120)));

    let accumulated = mergeNativeChatThreadHistory([], page1, 1);
    accumulated = mergeNativeChatThreadHistory(accumulated, page2, 1);
    accumulated = mergeNativeChatThreadHistory(accumulated, focusWindow, 1);
    accumulated = mergeNativeChatThreadHistory(accumulated, latestWindow, 1);

    expect(accumulated.some((entry) => entry.id === '1')).toBe(true);
    expect(accumulated.some((entry) => entry.id === '80')).toBe(true);
    expect(accumulated.some((entry) => entry.id === '160')).toBe(true);
    expect(accumulated.length).toBeGreaterThan(150);
  });

  it('schedules a durable write that survives an immediate unmount flush', async () => {
    readMock.mockResolvedValue({
      data: {
        conversation: null,
        title: 'A',
        messages: [message('old')],
        hasOlder: false,
        olderCursor: null,
        hasNewer: false,
        newerCursor: null,
        unreadBoundaryId: null,
        focusAnchorId: null,
        pinnedMessageId: null,
      },
      savedAt: 1,
    } as never);

    const generation = bumpNativeChatThreadHistoryGeneration();
    const pending = scheduleNativeChatThreadSnapshotWrite(
      7,
      'c1',
      {
        conversation: null,
        title: 'A',
        messages: [message('new')],
        hasOlder: true,
        olderCursor: 'old',
        hasNewer: false,
        newerCursor: null,
        unreadBoundaryId: null,
        focusAnchorId: null,
        pinnedMessageId: null,
        historyMayHaveGaps: true,
      },
      { generation, currentUserId: 7 },
    );

    await pending;
    await waitForNativeChatThreadSnapshotWrites();

    expect(writeMock).toHaveBeenCalled();
    const written = writeMock.mock.calls[0]?.[3] as { messages: ChatMessage[] };
    expect(written.messages.map((entry) => entry.id)).toEqual(expect.arrayContaining(['old', 'new']));
  });

  it('ignores writes from a previous generation after logout bump', async () => {
    const staleGeneration = bumpNativeChatThreadHistoryGeneration();
    bumpNativeChatThreadHistoryGeneration();
    await scheduleNativeChatThreadSnapshotWrite(
      7,
      'c1',
      {
        conversation: null,
        title: 'stale',
        messages: [message('stale')],
        hasOlder: false,
        olderCursor: null,
        hasNewer: false,
        newerCursor: null,
        unreadBoundaryId: null,
        focusAnchorId: null,
        pinnedMessageId: null,
      },
      { generation: staleGeneration },
    );
    await waitForNativeChatThreadSnapshotWrites();
    expect(writeMock).not.toHaveBeenCalled();
  });
});
