import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import useChatThreadSection from './useChatThreadSection';

const noop = vi.fn();
const ref = { current: null };

const threadBag = {
  activeConversation: { id: 'conv-thread' },
  activeConversationId: 'conv-thread',
  navigate: noop,
  threadWallpaperSx: {},
  messages: [],
  messagesLoading: false,
  effectiveLastReadMessageId: '',
  showOlderHistoryControl: false,
  loadingOlder: false,
  prependScrollRestoreRef: ref,
  loadOlderMessages: noop,
  threadScrollRef: ref,
  threadContentRef: ref,
  handleThreadScroll: noop,
  bottomRef: ref,
  openMobileInboxView: noop,
  handleOpenInfo: noop,
  openTaskFromChat: noop,
  openSearchDialog: noop,
  handleOpenMenu: noop,
  openMessageReads: noop,
  openMediaViewer: noop,
  handleReplyMessage: noop,
  openMessageMenu: noop,
  confirmAiAction: noop,
  cancelAiAction: noop,
  editAiAction: noop,
  selectedVisibleMessageIds: [],
  selectedMessageCount: 0,
  canCopySelectedMessages: false,
  toggleMessageSelection: noop,
  startMessageSelection: noop,
  clearSelectedMessages: noop,
  selectedReplyToSelectedMessage: noop,
  selectedCopySelectedMessages: noop,
  selectedOpenForwardSelectedMessages: noop,
  handleOpenComposerMenu: noop,
  composerRef: ref,
  messageText: '',
  setMessageText: noop,
  handleComposerKeyDown: noop,
  syncComposerSelection: noop,
  handleOpenEmojiPicker: noop,
  handleCloseEmojiPicker: noop,
  handleComposerFocusChange: noop,
  handleComposerSend: noop,
  handleComposerPaste: noop,
  handleComposerDrop: noop,
  handleComposerDragOver: noop,
  handleComposerDragLeave: noop,
  mentionCandidates: [],
  searchMentionPeople: noop,
  fileDragActive: false,
  showJumpToLatest: false,
  jumpToLatest: noop,
  replyMessage: null,
  clearReplyMessage: noop,
  editingMessage: null,
  clearEditingMessage: noop,
  aiTypingStatus: null,
  activeAiStatus: null,
  pinnedMessage: null,
  handleOpenPinnedMessage: noop,
  handleUnpinPinnedMessage: noop,
  highlightedMessageId: '',
  conversationMetaSubtitle: '',
  aiAwareTypingLine: '',
  renderDesktopRightPanel: false,
  selectedFiles: [],
  fileCaption: '',
  openFilePicker: noop,
  clearSelectedFiles: noop,
  preparingFiles: false,
  sendingFiles: false,
  fileUploadProgress: null,
  selectedFilesSummary: '',
  getReadTargetRef: () => ref,
  handleToggleReaction: noop,
  scrollToMessage: noop,
  emojiPickerOpen: false,
  insertEmojiAtSelection: noop,
  handleSendGif: noop,
  voiceRecording: false,
  voiceRecordingDuration: 0,
  voiceRecordingLevelRef: ref,
  startVoiceRecording: noop,
  stopVoiceRecording: noop,
  cancelVoiceRecording: noop,
  bindPinnedScroll: noop,
};

vi.mock('../../components/chat/useChatComposerTextBridge', () => ({
  __esModule: true,
  default: vi.fn(() => ({
    subscribe: () => () => {},
    getSnapshot: () => '',
    setMessageText: noop,
    onComposerKeyDown: noop,
    onComposerSelectionSync: noop,
  })),
}));

vi.mock('./ChatPageRightPanelContent', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('./buildChatPagePanesBags', () => ({
  __esModule: true,
  default: vi.fn(() => ({
    shell: { theme: { palette: { mode: 'light' } }, ui: {}, isMobile: false, isPhone: false, mobileMotionDisabled: false },
    thread: threadBag,
    rightPanel: {
      showTaskPanel: false,
      showContextPanel: false,
      taskPanelTaskId: '',
      closeTaskPanel: noop,
      openTaskInTasks: noop,
      handleTaskPanelUpdated: noop,
      setContextPanelOpen: noop,
      openShareDialog: noop,
      handleAddGroupMembers: noop,
      handleRemoveGroupMember: noop,
      handleUpdateGroupMemberRole: noop,
      handleTransferGroupOwnership: noop,
      handleLeaveGroup: noop,
      handleUpdateGroupProfile: noop,
      settingsUpdating: false,
      socketStatus: 'connected',
      user: { id: 1 },
      updateConversationSettings: noop,
    },
  })),
}));

describe('useChatThreadSection', () => {
  it('smoke: returns thread and desktop panel sections', () => {
    const { result } = renderHook(() => useChatThreadSection({}));
    expect(result.current.threadPane).toBeTruthy();
    expect(result.current).toHaveProperty('desktopRightPanelContent');
  });
});
