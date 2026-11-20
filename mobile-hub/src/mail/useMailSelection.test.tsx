import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useRef, useState } from 'react';
import { Alert, Pressable } from 'react-native';
import {
  bulkMailMessageAction,
  getMailConversation,
  getMailMessages,
  markAllMailMessagesRead,
  type MailMessagePreview,
} from '../api/mailApi';
import type { NativeMailUndo } from './nativeMailUndo';
import { useMailSelection } from './useMailSelection';
import type { MailListItem, MailViewMode } from './useMailList';

jest.mock('../api/mailApi', () => ({
  bulkMailMessageAction: jest.fn(),
  getMailConversation: jest.fn(),
  getMailMessages: jest.fn(),
  markAllMailMessagesRead: jest.fn(),
}));

const mockedBulk = bulkMailMessageAction as jest.Mock;
const mockedConversation = getMailConversation as jest.Mock;
const mockedMarkAll = markAllMailMessagesRead as jest.Mock;
const mockedPage = getMailMessages as jest.Mock;

const mockApplyUnreadDelta = jest.fn();
const mockLoad = jest.fn(async () => undefined);
const mockSetError = jest.fn();
const mockSetUndo = jest.fn();
let latestUndo: NativeMailUndo | null = null;

function message(id: string, folder: string, is_read = true): MailMessagePreview {
  return { id, folder, is_read, subject: id, sender: 'a@b.c' } as MailMessagePreview;
}

function Harness({
  items,
  view = 'messages',
  folder = 'inbox',
  folderScope = 'current',
  selectedKeys,
}: {
  items: MailListItem[];
  view?: MailViewMode;
  folder?: string;
  folderScope?: string;
  selectedKeys?: string[];
}) {
  const [selected, setSelected] = useState<Set<string>>(
    new Set(selectedKeys ?? items.map((item) => item.kind === 'message' ? item.value.id : item.value.conversation_id)),
  );
  const generationRef = useRef(0);
  const selection = useMailSelection({
    items,
    selected,
    setSelected,
    view,
    folder,
    folderScope,
    mailboxId: 'box-1',
    offlineMode: false,
    listScope: 'scope-1',
    listGeneration: 0,
    listGenerationRef: generationRef,
    applyUnreadDelta: mockApplyUnreadDelta,
    load: mockLoad,
    setError: mockSetError,
    setUndo: (value) => { latestUndo = value; mockSetUndo(value); },
  });
  return (
    <>
      <Pressable testID="confirm-delete" onPress={selection.confirmDelete} />
      <Pressable testID="move-archive" onPress={() => { void selection.runBulk('move', 'archive'); }} />
      <Pressable testID="mark-all" onPress={() => { void selection.markAllRead(3); }} />
    </>
  );
}

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  latestUndo = null;
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockedBulk.mockResolvedValue({ ok: true, results: [] });
  mockedConversation.mockResolvedValue({ conversation_id: 'c1', items: [] });
  mockedPage.mockResolvedValue({ items: [], has_more: false, total: 0 });
});

afterEach(() => {
  alertSpy.mockRestore();
});

describe('confirmDelete', () => {
  it('warns about permanent deletion for all-folder conversation selections', async () => {
    await render(
      <Harness
        items={[{ kind: 'conversation', key: 'c:c1', value: { conversation_id: 'c1' } as never }]}
        view="conversations"
        folderScope="all"
      />,
    );
    fireEvent.press(screen.getByTestId('confirm-delete'));
    const [title, body] = alertSpy.mock.calls[0];
    expect(title).not.toContain('навсегда');
    expect(String(body)).toContain('будут удалены навсегда');
  });

  it('keeps a soft-delete message for same-folder conversation selections', async () => {
    await render(
      <Harness
        items={[{ kind: 'conversation', key: 'c:c1', value: { conversation_id: 'c1' } as never }]}
        view="conversations"
        folder="inbox"
        folderScope="current"
      />,
    );
    fireEvent.press(screen.getByTestId('confirm-delete'));
    const [title, body] = alertSpy.mock.calls[0];
    expect(title).not.toContain('навсегда');
    expect(String(body)).toBe('Письма будут перемещены в папку «Удалённые».');
  });

  it('asks for explicit permanent deletion only inside the trash folder', async () => {
    await render(
      <Harness
        items={[{ kind: 'conversation', key: 'c:c1', value: { conversation_id: 'c1' } as never }]}
        view="conversations"
        folder="trash"
      />,
    );
    fireEvent.press(screen.getByTestId('confirm-delete'));
    const [title, , buttons] = alertSpy.mock.calls[0];
    expect(String(title)).toContain('навсегда');
    const destructive = (buttons as { text: string; onPress?: () => void }[]).find((button) => button.text === 'Удалить навсегда');
    expect(destructive?.onPress).toBeDefined();
    mockedConversation.mockResolvedValue({ conversation_id: 'c1', conversation_complete: true, items: [message('m1', 'trash')] });
    mockedBulk.mockResolvedValue({ ok: true, results: [{ message_id: 'm1', result: { ok: true } }] });
    destructive!.onPress!();
    await waitFor(() => expect(mockedBulk).toHaveBeenCalledWith(expect.objectContaining({ permanent: true })));
  });
});

describe('runBulk', () => {
  it('records the original folder of every moved message for undo', async () => {
    const items: MailListItem[] = [
      { kind: 'message', key: 'm:m1', value: message('m1', 'inbox', false) },
      { kind: 'message', key: 'm:m2', value: message('m2', 'archive') },
    ];
    mockedBulk.mockResolvedValue({
      ok: true,
      results: [
        { message_id: 'm1', result: { message_id: 'new-m1' } },
        { message_id: 'm2', result: { message_id: 'new-m2' } },
      ],
    });
    await render(<Harness items={items} folder="archive" folderScope="all" />);
    fireEvent.press(screen.getByTestId('move-archive'));
    await waitFor(() => expect(latestUndo?.kind).toBe('bulk'));
    if (latestUndo?.kind !== 'bulk') return;
    expect(latestUndo.undoEntries).toEqual([
      { id: 'new-m1', sourceFolder: 'inbox' },
      { id: 'new-m2', sourceFolder: 'archive' },
    ]);
    expect(mockApplyUnreadDelta).toHaveBeenCalledWith(-1, 'box-1', 'inbox');
    expect(mockApplyUnreadDelta).not.toHaveBeenCalledWith(-1, 'box-1', 'archive');
  });

  it('expands conversation selections using the list folder scope', async () => {
    mockedConversation.mockResolvedValue({
      conversation_id: 'c1',
      conversation_complete: true,
      items: [message('m1', 'archive')],
    });
    await render(
      <Harness
        items={[{ kind: 'conversation', key: 'c:c1', value: { conversation_id: 'c1' } as never }]}
        view="conversations"
        folder="archive"
        folderScope="all"
      />,
    );
    fireEvent.press(screen.getByTestId('move-archive'));
    await waitFor(() => expect(mockedConversation).toHaveBeenCalledWith('c1', { mailboxId: 'box-1', folder: 'archive', folderScope: 'all' }));
  });
});

describe('markAllRead', () => {
  it('reports server-side failures instead of silently succeeding', async () => {
    mockedMarkAll.mockResolvedValue({ ok: false, changed: 0, failed: 3 });
    await render(
      <Harness items={[{ kind: 'message', key: 'm:m1', value: message('m1', 'inbox') }]} />,
    );
    fireEvent.press(screen.getByTestId('mark-all'));
    await waitFor(() => expect(mockSetError).toHaveBeenCalledWith(expect.stringContaining('3')));
    expect(mockApplyUnreadDelta).not.toHaveBeenCalled();
  });
});
