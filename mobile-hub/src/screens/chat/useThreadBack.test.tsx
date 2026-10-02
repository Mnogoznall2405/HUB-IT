import { act, renderHook } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useThreadBack } from './useThreadBack';

jest.mock('../../api/chatApi', () => ({
  markConversationRead: jest.fn(async () => undefined),
}));

const mockedParams = useLocalSearchParams as jest.Mock;
const mockedCanGoBack = router.canGoBack as jest.Mock;

function buildParams() {
  const ref = <T,>(value: T) => ({ current: value });
  return {
    conversationId: 'conversation-1',
    userId: 1,
    offlineMode: false,
    mountedRef: ref(true),
    leaveInFlightRef: ref(false),
    requestLeave: (onAllowed: () => void) => onAllowed(),
    messagesRef: ref([]),
    actionMessage: null,
    setActionMessage: jest.fn(),
    voiceRecording: false,
    attachmentDraftClientMessageIdRef: ref(''),
    sheets: {
      profileMember: null,
      setProfileMember: jest.fn(),
      infoVisible: false,
      setInfoVisible: jest.fn(),
      renameVisible: false,
      setRenameVisible: jest.fn(),
      memberPickerVisible: false,
      setMemberPickerVisible: jest.fn(),
      taskPickerVisible: false,
      setTaskPickerVisible: jest.fn(),
      stickerPickerVisible: false,
      setStickerPickerVisible: jest.fn(),
      emojiPickerVisible: false,
      setEmojiPickerVisible: jest.fn(),
      pollCreateVisible: false,
      setPollCreateVisible: jest.fn(),
    },
    composer: {
      attachmentDraftFiles: [],
      setAttachmentDraftFiles: jest.fn(),
      setAttachmentDraftError: jest.fn(),
      attachmentPickerVisible: false,
      setAttachmentPickerVisible: jest.fn(),
      imageEditorFile: null,
      setImageEditorFile: jest.fn(),
      cancelVoiceRef: ref(null),
    },
    forward: {
      forwardSource: null,
      setForwardSource: jest.fn(),
      forwardInFlightRef: ref(false),
      setForwardProgress: jest.fn(),
      setForwardError: jest.fn(),
      setForwardQueue: jest.fn(),
    },
    selection: { selectedMessageIds: [], clearSelection: jest.fn() },
    search: {
      searchOpen: false,
      setSearchOpen: jest.fn(),
      setSearchResults: jest.fn(),
      setSearchCompleted: jest.fn(),
    },
    attachments: {
      attachmentActionTarget: null,
      setAttachmentActionTarget: jest.fn(),
      mediaViewer: null,
      closeMediaViewer: jest.fn(),
    },
  } as unknown as Parameters<typeof useThreadBack>[0];
}

describe('useThreadBack workspace-aware leave', () => {
  it('navigates to the ИИ inbox when the thread was opened with workspace=ai', async () => {
    mockedParams.mockReturnValue({ workspace: 'ai' });
    mockedCanGoBack.mockReturnValue(true);
    const view = await renderHook(() => useThreadBack(buildParams()));
    await act(async () => view.result.current.leaveThread());
    expect(router.navigate).toHaveBeenCalledWith('/(shell)/chat?workspace=ai');
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    await view.unmount();
  });

  it('replaces the route with the ИИ inbox when there is no stack to go back to', async () => {
    mockedParams.mockReturnValue({ workspace: 'ai' });
    mockedCanGoBack.mockReturnValue(false);
    const view = await renderHook(() => useThreadBack(buildParams()));
    await act(async () => view.result.current.leaveThread());
    expect(router.replace).toHaveBeenCalledWith('/(shell)/chat?workspace=ai');
    expect(router.navigate).not.toHaveBeenCalled();
    expect(router.back).not.toHaveBeenCalled();
    await view.unmount();
  });

  it.each([{}, { workspace: 'bogus' }, { workspace: ['bogus'] }])(
    'keeps the plain back navigation without a valid workspace: %j',
    async (params) => {
      mockedParams.mockReturnValue(params);
      mockedCanGoBack.mockReturnValue(true);
      const view = await renderHook(() => useThreadBack(buildParams()));
      await act(async () => view.result.current.leaveThread());
      expect(router.back).toHaveBeenCalledTimes(1);
      expect(router.navigate).not.toHaveBeenCalled();
      await view.unmount();
    },
  );

  it('uses the first workspace value when the param is an array', async () => {
    mockedParams.mockReturnValue({ workspace: ['ai', 'extra'] });
    mockedCanGoBack.mockReturnValue(true);
    const view = await renderHook(() => useThreadBack(buildParams()));
    await act(async () => view.result.current.leaveThread());
    expect(router.navigate).toHaveBeenCalledWith('/(shell)/chat?workspace=ai');
    await view.unmount();
  });
});
