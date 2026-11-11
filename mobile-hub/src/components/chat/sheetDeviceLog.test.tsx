import { act, fireEvent, render } from '@testing-library/react-native';
import { BackHandler } from 'react-native';
import type { ChatConversationSummary, ChatMessage, ChatUserSummary } from '../../api/types';
import type { ChatCustomFolder } from '../../chat/chatFolders';
import { getChatDeviceLogSnapshot, resetChatDeviceLog } from '../../diagnostics/chatDeviceLog';
import { ChatFolderManagerSheet } from './ChatFolderManagerSheet';
import { ChatMemberPickerSheet } from './ChatGroupEditSheets';
import { ForwardMessageSheet } from './ForwardMessageSheet';
import { NewChatSheet } from './NewChatSheet';

const eventsOf = (name: string) => getChatDeviceLogSnapshot()
  .filter((entry) => entry.e === name)
  .map((entry) => entry.f);

const newChatProps = {
  bots: [],
  onDirect: jest.fn(),
  onGroup: jest.fn(),
  onBot: jest.fn(),
};

beforeEach(async () => {
  await resetChatDeviceLog();
  jest.clearAllMocks();
});

afterEach(async () => {
  jest.restoreAllMocks();
  // Also cancels the pending journal flush timer, so Jest can exit.
  await resetChatDeviceLog();
});

describe('sheet device journal', () => {
  it('reports the backdrop close of the new-chat sheet with its open duration', async () => {
    const onClose = jest.fn();
    const view = await render(<NewChatSheet {...newChatProps} visible users={[]} onClose={onClose} />);
    await fireEvent.press(view.getByLabelText('Закрыть создание диалога'));
    expect(onClose).toHaveBeenCalledTimes(1);

    await view.rerender(<NewChatSheet {...newChatProps} visible={false} users={[]} onClose={onClose} />);
    expect(eventsOf('sheet_open')).toEqual([{ sheet: 'new_chat' }]);
    expect(eventsOf('sheet_close')).toEqual([
      { sheet: 'new_chat', reason: 'backdrop', ms: expect.any(Number) },
    ]);
  });

  it('does not report a close while the new-chat sheet is busy creating a chat', async () => {
    let finish: () => void = () => {};
    const onDirect = jest.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const user = { id: 1, username: 'anna', full_name: 'Анна' } as ChatUserSummary;
    const onClose = jest.fn();
    const view = await render(
      <NewChatSheet {...newChatProps} visible users={[user]} onDirect={onDirect} onClose={onClose} />,
    );
    await fireEvent.press(view.getByLabelText('Открыть диалог с Анна'));
    await fireEvent.press(view.getByLabelText('Закрыть создание диалога'));
    expect(onClose).not.toHaveBeenCalled();

    // The owner closes the sheet after the chat opens: the refused backdrop tap
    // must not leave a mark behind, so the close is reported as the owner's ('done').
    await view.rerender(<NewChatSheet {...newChatProps} visible={false} users={[user]} onClose={onClose} />);
    expect(eventsOf('sheet_close')).toEqual([
      { sheet: 'new_chat', reason: 'done', ms: expect.any(Number) },
    ]);
    await act(async () => { finish(); });
  });

  it('reports the Android back close of the folder manager, but not a back press inside its rename prompt', async () => {
    let backPress: (() => boolean) | undefined;
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
      backPress = handler as () => boolean;
      return { remove: jest.fn() };
    });
    const onClose = jest.fn();
    const folders = [{ id: 'f1', name: 'Проекты' }] as ChatCustomFolder[];
    const props = { folders, onClose, onCreate: jest.fn(), onRename: jest.fn(), onDelete: jest.fn() };
    const view = await render(<ChatFolderManagerSheet {...props} visible />);

    await fireEvent.press(view.getByLabelText('Создать папку'));
    await act(async () => { backPress?.(); });
    expect(onClose).not.toHaveBeenCalled();
    expect(eventsOf('sheet_close')).toEqual([]);

    await act(async () => { backPress?.(); });
    expect(onClose).toHaveBeenCalledTimes(1);
    await view.rerender(<ChatFolderManagerSheet {...props} visible={false} />);
    expect(eventsOf('sheet_open')).toEqual([{ sheet: 'folders' }]);
    expect(eventsOf('sheet_close')).toEqual([
      { sheet: 'folders', reason: 'back', ms: expect.any(Number) },
    ]);
  });

  it('reports the cancel button of the member picker as the button close', async () => {
    const onClose = jest.fn();
    const props = { users: [], excludedUserIds: [], onAdd: jest.fn() };
    const view = await render(<ChatMemberPickerSheet {...props} visible onClose={onClose} />);
    await fireEvent.press(view.getByLabelText('Отмена'));
    expect(onClose).toHaveBeenCalledTimes(1);

    await view.rerender(<ChatMemberPickerSheet {...props} visible={false} onClose={onClose} />);
    expect(eventsOf('sheet_close')).toEqual([
      { sheet: 'group_edit', reason: 'button', ms: expect.any(Number) },
    ]);
  });

  it('reports the cancel button of the forward sheet as the button close', async () => {
    const message = { id: 'synthetic', body_text: 'Текст' } as ChatMessage;
    const conversations = [{ id: 'one', title: 'Анна' }] as ChatConversationSummary[];
    const onClose = jest.fn();
    const props = { conversations, busy: false, onForward: jest.fn() };
    const view = await render(<ForwardMessageSheet {...props} message={message} onClose={onClose} />);
    await fireEvent.press(view.getByLabelText('Отмена'));
    expect(onClose).toHaveBeenCalledTimes(1);

    await view.rerender(<ForwardMessageSheet {...props} message={null} onClose={onClose} />);
    expect(eventsOf('sheet_close')).toEqual([
      { sheet: 'forward', reason: 'button', ms: expect.any(Number) },
    ]);
  });
});
