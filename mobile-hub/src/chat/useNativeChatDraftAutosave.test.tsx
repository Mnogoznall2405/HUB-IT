import { act, render } from '@testing-library/react-native';
import { clearAllNativeChatDrafts, getNativeChatDraft } from './chatDrafts';
import { useNativeChatDraftAutosave } from './useNativeChatDraftAutosave';
import * as drafts from './chatDrafts';
import { AppState, type AppStateStatus } from 'react-native';

let mockBlur: (() => void) | undefined;
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => (() => void)) => {
    require('react').useEffect(() => {
      mockBlur = callback();
      return mockBlur;
    }, [callback]);
  },
}));

let current: ReturnType<typeof useNativeChatDraftAutosave>;

function Editor({ text, id = 'chat-a', enabled = true }: { text: string; id?: string; enabled?: boolean }) {
  current = useNativeChatDraftAutosave(7, id, text, enabled, () => undefined);
  return null;
}

beforeEach(async () => {
  await clearAllNativeChatDrafts();
  jest.useFakeTimers();
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
});
afterEach(() => { jest.useRealTimers(); });

it('flushes the latest draft on blur without unmounting the editor', async () => {
  const view = await render(<Editor text="Before" />);
  await view.rerender(<Editor text="Latest" />);
  await act(async () => { mockBlur?.(); });
  expect(await getNativeChatDraft(7, 'chat-a')).toBe('Latest');
  await view.unmount();
});

it('flushes on background before the typing debounce expires and removes its listener', async () => {
  let change!: (state: AppStateStatus) => void;
  const remove = jest.fn();
  const subscription = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    change = listener;
    return { remove };
  });
  try {
    const view = await render(<Editor text="Latest background draft" />);
    await act(async () => { change('background'); });
    expect(await getNativeChatDraft(7, 'chat-a')).toBe('Latest background draft');
    await view.unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  } finally { subscription.mockRestore(); }
});

it('coalesces typing and flushes the latest revision when leaving', async () => {
  const view = await render(<Editor text="Первая" />);
  await view.rerender(<Editor text="Последняя" />);
  expect(await getNativeChatDraft(7, 'chat-a')).toBe('');
  await view.unmount();
  expect(await getNativeChatDraft(7, 'chat-a')).toBe('Последняя');
  await act(async () => { jest.advanceTimersByTime(500); });
  expect(await getNativeChatDraft(7, 'chat-a')).toBe('Последняя');
});

it('does not resurrect a pending draft when unmount follows logout cleanup', async () => {
  const view = await render(<Editor text="До выхода" />);
  await clearAllNativeChatDrafts();
  await view.unmount();
  expect(await getNativeChatDraft(7, 'chat-a')).toBe('');
  const next = await render(<Editor text="Новый сеанс" />);
  await next.unmount();
  expect(await getNativeChatDraft(7, 'chat-a')).toBe('Новый сеанс');
});

it('keeps the normal draft when leaving while editing an existing message', async () => {
  const view = await render(<Editor text="Обычный черновик" />);
  await view.rerender(<Editor text="Правка отправленного сообщения" enabled={false} />);
  await view.unmount();
  expect(await getNativeChatDraft(7, 'chat-a')).toBe('Обычный черновик');
});

it('flushes the previous scope separately when changing conversations', async () => {
  const view = await render(<Editor text="Диалог А" />);
  await view.rerender(<Editor id="chat-b" text="Диалог Б" />);
  await view.unmount();
  expect(await getNativeChatDraft(7, 'chat-a')).toBe('Диалог А');
  expect(await getNativeChatDraft(7, 'chat-b')).toBe('Диалог Б');
});

it('shares simultaneous retries and saves newer text after an older write finishes', async () => {
  let finish!: () => void;
  const write = jest.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }))
    .mockResolvedValue(undefined);
  const factory = jest.spyOn(drafts, 'createNativeChatDraftWriter').mockReturnValue(write);
  try {
    const view = await render(<Editor text="Первая" />);
    let first!: Promise<boolean>;
    await act(async () => {
      first = current.saveNow();
      expect(current.saveNow()).toBe(first);
    });
    expect(write).toHaveBeenCalledTimes(1);
    await view.rerender(<Editor text="Новая" />);
    await act(async () => { jest.advanceTimersByTime(400); });
    expect(write).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); await first; });
    expect(write.mock.calls.map(([text]) => text)).toEqual(['Первая', 'Новая']);
    expect(current.saved).toBe(true);
    await view.unmount();
  } finally { factory.mockRestore(); }
});

it('requires acknowledgement of the current revision even when text returns to an earlier value', async () => {
  const view = await render(<Editor text="А" />);
  await act(async () => { jest.advanceTimersByTime(400); });
  expect(current.saved).toBe(true);
  await view.rerender(<Editor text="Б" />);
  await view.rerender(<Editor text="А" />);
  expect(current.saved).toBe(false);
  await act(async () => { jest.advanceTimersByTime(400); });
  expect(current.saved).toBe(true);
  await view.unmount();
});
