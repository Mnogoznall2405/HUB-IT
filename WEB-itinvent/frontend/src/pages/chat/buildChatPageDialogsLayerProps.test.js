import { describe, expect, it, vi } from 'vitest';

import buildChatPageDialogsLayerProps from './buildChatPageDialogsLayerProps';

describe('buildChatPageDialogsLayerProps', () => {
  it('maps dialog layer inputs to ChatDialogs prop names', () => {
    const onCloseThreadMenu = vi.fn();
    const onForwardMessageToConversation = vi.fn();
    const onApplyImageEdit = vi.fn();
    const onResetImageEdit = vi.fn();
    const onOpenPollDialog = vi.fn();
    const onOpenContactDialog = vi.fn();
    const onSendLocation = vi.fn();
    const onCloseStructuredDialog = vi.fn();
    const onSendPoll = vi.fn();
    const onSendContact = vi.fn();

    const props = buildChatPageDialogsLayerProps({
      theme: {},
      ui: {},
      activeConversation: { id: 'c1' },
      activeConversationId: 'c1',
      currentUser: { id: 'u1' },
      threadMenuAnchor: null,
      onCloseThreadMenu,
      threadInfoOpen: false,
      onOpenInfo: vi.fn(),
      messageMenuAnchor: null,
      messageMenuMessage: null,
      onCloseMessageMenu: vi.fn(),
      onToggleReactionFromMenu: vi.fn(),
      onReplyFromMessageMenu: vi.fn(),
      onCopyMessage: vi.fn(),
      onTogglePinMessageFromMenu: vi.fn(),
      messageMenuPinned: false,
      onCopyMessageLink: vi.fn(),
      onForwardMessageFromMenu: vi.fn(),
      onReportMessageFromMenu: vi.fn(),
      onDeleteMessageFromMenu: vi.fn(),
      onEditMessageFromMenu: vi.fn(),
      onSelectMessageFromMenu: vi.fn(),
      onOpenReadsFromMessageMenu: vi.fn(),
      onOpenAttachmentFromMessageMenu: vi.fn(),
      onOpenTaskFromMessageMenu: vi.fn(),
      messages: [],
      composerMenuAnchor: null,
      onCloseComposerMenu: vi.fn(),
      onOpenSearch: vi.fn(),
      onOpenShare: vi.fn(),
      onOpenFilePicker: vi.fn(),
      onOpenMediaPicker: vi.fn(),
      emojiPickerOpen: false,
      emojiAnchorEl: null,
      onCloseEmojiPicker: vi.fn(),
      onInsertEmoji: vi.fn(),
      fileInputRef: { current: null },
      mediaFileInputRef: { current: null },
      onSelectFiles: vi.fn(),
      fileDialogOpen: false,
      onCloseFileDialog: vi.fn(),
      selectedFiles: [],
      imageEdits: [],
      onApplyImageEdit,
      onResetImageEdit,
      fileCaption: '',
      onFileCaptionChange: vi.fn(),
      preparingFiles: false,
      sendingFiles: false,
      fileUploadProgress: 0,
      fileSummary: null,
      onSendFiles: vi.fn(),
      onRemoveSelectedFile: vi.fn(),
      onClearSelectedFiles: vi.fn(),

      shareOpen: false,
      onCloseShare: vi.fn(),
      taskSearch: '',
      onTaskSearchChange: vi.fn(),
      shareableTasks: [],
      shareableLoading: false,
      sharingTaskId: '',
      onShareTask: vi.fn(),
      forwardOpen: false,
      onCloseForward: vi.fn(),
      forwardSelectionCount: 0,
      forwardConversationQuery: '',
      onForwardConversationQueryChange: vi.fn(),
      forwardTargets: [],
      forwardTargetsLoading: false,
      forwardingConversationId: '',
      onForwardMessageToConversation,
      onOpenAttachmentPreview: vi.fn(),
      attachmentPreview: null,
      onCloseAttachmentPreview: vi.fn(),
      documentPreview: null,
      onCloseDocumentPreview: vi.fn(),
      onDownloadDocumentPreview: vi.fn(),
      onDownloadDocumentPreviewPdf: vi.fn(),
      messageReadsOpen: false,
      onCloseMessageReads: vi.fn(),
      messageReadsMessage: null,
      messageReadsLoading: false,
      messageReadsItems: [],
      infoOpen: false,
      onCloseInfo: vi.fn(),
      conversationHeaderSubtitle: '',
      settingsUpdating: false,
      onUpdateConversationSettings: vi.fn(),
      onRequestDeleteConversation: vi.fn(),
      onAddGroupMembers: vi.fn(),
      onRemoveGroupParticipant: vi.fn(),
      onUpdateGroupMemberRole: vi.fn(),
      onTransferGroupOwnership: vi.fn(),
      onLeaveGroup: vi.fn(),
      onUpdateGroupProfile: vi.fn(),
      onOpenTask: vi.fn(),
      searchOpen: false,
      onCloseSearch: vi.fn(),
      messageSearch: '',
      onMessageSearchChange: vi.fn(),
      messageSearchResults: [],
      messageSearchLoading: false,
      messageSearchHasMore: false,
      onLoadMoreSearchResults: vi.fn(),
      onOpenSearchResult: vi.fn(),
      structuredDialog: 'poll',
      onOpenPollDialog,
      onOpenContactDialog,
      onSendLocation,
      locationSending: true,
      onCloseStructuredDialog,
      onSendPoll,
      onSendContact,
    });

    expect(props.structuredDialog).toBe('poll');
    expect(props.onOpenPollDialog).toBe(onOpenPollDialog);
    expect(props.onOpenContactDialog).toBe(onOpenContactDialog);
    expect(props.onSendLocation).toBe(onSendLocation);
    expect(props.locationSending).toBe(true);
    expect(props.onCloseStructuredDialog).toBe(onCloseStructuredDialog);
    expect(props.onSendPoll).toBe(onSendPoll);
    expect(props.onSendContact).toBe(onSendContact);
    expect(props.activeConversationId).toBe('c1');
    expect(props.onCloseThreadMenu).toBe(onCloseThreadMenu);
    expect(props.onForwardMessageToConversation).toBe(onForwardMessageToConversation);
    expect(props.forwardSelectionCount).toBe(0);
    expect(props.onApplyImageEdit).toBe(onApplyImageEdit);
    expect(props.onResetImageEdit).toBe(onResetImageEdit);
  });
});
