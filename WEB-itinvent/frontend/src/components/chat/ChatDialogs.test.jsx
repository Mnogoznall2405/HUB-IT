import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

import ChatDialogs from './ChatDialogs';
import { buildAttachmentUrl } from './chatHelpers';

const theme = createTheme();
const ui = {
  borderSoft: 'rgba(148,163,184,0.2)',
  panelBg: '#0f172a',
  pageBg: '#020617',
  textSecondary: '#94a3b8',
};

const buildProps = (overrides = {}) => ({
  theme,
  ui,
  activeConversation: null,
  activeConversationId: '',
  threadMenuAnchor: null,
  onCloseThreadMenu: vi.fn(),
  threadInfoOpen: false,
  onOpenInfo: vi.fn(),
  messageMenuAnchor: null,
  messageMenuMessage: null,
  onCloseMessageMenu: vi.fn(),
  onReplyFromMessageMenu: vi.fn(),
  onCopyMessage: vi.fn(),
  onTogglePinMessageFromMenu: vi.fn(),
  messageMenuPinned: false,
  onCopyMessageLink: vi.fn(),
  onForwardMessageFromMenu: vi.fn(),
  onReportMessageFromMenu: vi.fn(),
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
  fileCaption: '',
  onFileCaptionChange: vi.fn(),
  preparingFiles: false,
  sendingFiles: false,
  fileUploadProgress: 0,
  fileSummary: null,
  onSendFiles: vi.fn(),
  onRemoveSelectedFile: vi.fn(),
  onClearSelectedFiles: vi.fn(),
  groupOpen: false,
  onCloseGroup: vi.fn(),
  groupTitle: '',
  onGroupTitleChange: vi.fn(),
  groupSearch: '',
  onGroupSearchChange: vi.fn(),
  groupUsers: [],
  groupUsersLoading: false,
  groupSelectedUsers: [],
  onAddGroupMember: vi.fn(),
  onRemoveGroupMember: vi.fn(),
  creatingConversation: false,
  groupCreateDisabled: false,
  onCreateGroup: vi.fn(),
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
  forwardMessage: null,
  forwardConversationQuery: '',
  onForwardConversationQueryChange: vi.fn(),
  forwardTargets: [],
  forwardTargetsLoading: false,
  forwardingConversationId: '',
  onForwardMessageToConversation: vi.fn(),
  onOpenAttachmentPreview: vi.fn(),
  attachmentPreview: null,
  onCloseAttachmentPreview: vi.fn(),
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
  ...overrides,
});

const renderWithTheme = (props) => render(
  <ThemeProvider theme={theme}>
    <ChatDialogs {...props} />
  </ThemeProvider>,
);

const installMobileMatchMediaMock = () => {
  const original = window.matchMedia;
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: query.includes('max-width'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  return {
    restore() {
      window.matchMedia = original;
    },
  };
};

describe('ChatDialogs attachment preview', () => {
  it('renders file caption input, focuses it, and propagates changes in the upload dialog', async () => {
    const onFileCaptionChange = vi.fn();

    renderWithTheme(buildProps({
      fileDialogOpen: true,
      selectedFiles: [new File(['demo'], 'report.pdf', { type: 'application/pdf' })],
      fileCaption: 'Текущая подпись',
      onFileCaptionChange,
    }));

    const captionInput = screen.getByRole('textbox');
    expect(captionInput).toHaveValue('Текущая подпись');
    await waitFor(() => expect(captionInput).toHaveFocus());
    expect(screen.getByTestId('chat-file-upload-panel')).toBeInTheDocument();
    expect(screen.getByText('Отправить как файл')).toBeInTheDocument();
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Добавить' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Отмена' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeInTheDocument();

    fireEvent.change(captionInput, { target: { value: 'Новая подпись' } });

    expect(onFileCaptionChange).toHaveBeenCalledWith('Новая подпись');
  });

  it('wires upload dialog add, cancel, send, and remove actions', () => {
    const fileInput = document.createElement('input');
    const clickFileInput = vi.spyOn(fileInput, 'click').mockImplementation(() => {});
    const onClearSelectedFiles = vi.fn();
    const onRemoveSelectedFile = vi.fn();
    const onSendFiles = vi.fn();

    renderWithTheme(buildProps({
      fileDialogOpen: true,
      fileInputRef: { current: fileInput },
      selectedFiles: [new File(['demo'], 'report.pdf', { type: 'application/pdf' })],
      onClearSelectedFiles,
      onRemoveSelectedFile,
      onSendFiles,
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
    expect(clickFileInput).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /Удалить report\.pdf/ }));
    expect(onRemoveSelectedFile).toHaveBeenCalledWith(0);

    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    expect(onSendFiles).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(onClearSelectedFiles).toHaveBeenCalledTimes(1);
  });

  it('renders the upload panel in light and dark themes', () => {
    const darkTheme = createTheme({ palette: { mode: 'dark' } });
    const lightProps = buildProps({
      fileDialogOpen: true,
      selectedFiles: [new File(['demo'], 'light.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })],
    });
    const darkProps = buildProps({
      theme: darkTheme,
      fileDialogOpen: true,
      selectedFiles: [new File(['demo'], 'dark.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })],
    });

    const { unmount } = renderWithTheme(lightProps);
    expect(screen.getByTestId('chat-file-upload-panel')).toBeInTheDocument();
    expect(screen.getByText('light.docx')).toBeInTheDocument();
    unmount();

    render(
      <ThemeProvider theme={darkTheme}>
        <ChatDialogs {...darkProps} />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('chat-file-upload-panel')).toBeInTheDocument();
    expect(screen.getByText('dark.docx')).toBeInTheDocument();
  });

  it('renders image preview modal with bottom actions, metadata, and closes from the button', async () => {
    const onCloseAttachmentPreview = vi.fn();
    const attachmentPreview = {
      messageId: 'msg-1',
      attachment: {
        id: 'att-1',
        file_name: 'photo.png',
        file_size: 4096,
      },
      fileUrl: buildAttachmentUrl('msg-1', 'att-1'),
      senderName: 'Максим',
      createdAt: '2026-03-21T14:59:00Z',
    };

    renderWithTheme(buildProps({ attachmentPreview, onCloseAttachmentPreview }));

    expect(screen.getByRole('img', { name: 'photo.png' })).toBeInTheDocument();
    expect(screen.queryByText('photo.png')).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-attachment-preview-content')).toBeInTheDocument();
    expect(screen.getByTestId('chat-attachment-preview-bottom-bar')).toBeVisible();
    expect(screen.getByText('Фотография 1 из 1')).toBeInTheDocument();
    expect(screen.getByTestId('chat-attachment-preview-meta')).toHaveTextContent('Максим');
    expect(screen.getByTestId('chat-attachment-preview-download')).toHaveAttribute('href', buildAttachmentUrl('msg-1', 'att-1'));
    expect(screen.getByTestId('chat-attachment-preview-download')).toHaveAttribute('download', 'photo.png');
    expect(screen.getByTestId('chat-attachment-preview-open')).toHaveAttribute('href', buildAttachmentUrl('msg-1', 'att-1'));

    const topbar = screen.getByTestId('chat-attachment-preview-topbar');
    fireEvent.click(screen.getByTestId('chat-attachment-preview-more'));

    const [downloadLink, externalLink] = await screen.findAllByRole('menuitem');
    expect(downloadLink.getAttribute('href')).toBe(buildAttachmentUrl('msg-1', 'att-1'));
    expect(downloadLink).toHaveAttribute('download', 'photo.png');
    expect(externalLink).toHaveAttribute('href', buildAttachmentUrl('msg-1', 'att-1'));

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape', code: 'Escape', keyCode: 27 });
    fireEvent.click(within(topbar).getByLabelText('Закрыть предпросмотр'));
    expect(onCloseAttachmentPreview).toHaveBeenCalledTimes(1);
  });

  it('supports stepping through media items inside the preview viewer', async () => {
    const attachmentPreview = {
      messageId: 'msg-3',
      attachment: {
        id: 'att-1',
        file_name: 'photo-1.png',
        file_size: 4096,
      },
      fileUrl: buildAttachmentUrl('msg-3', 'att-1'),
      items: [
        {
          id: 'att-1',
          file_name: 'photo-1.png',
          file_size: 4096,
          mime_type: 'image/png',
          fileUrl: buildAttachmentUrl('msg-3', 'att-1'),
        },
        {
          id: 'att-2',
          file_name: 'photo-2.png',
          file_size: 5120,
          mime_type: 'image/png',
          fileUrl: buildAttachmentUrl('msg-3', 'att-2'),
        },
      ],
      activeIndex: 0,
    };

    renderWithTheme(buildProps({ attachmentPreview }));

    const dialog = screen.getByRole('dialog');

    expect(screen.getByText('Фотография 1 из 2')).toBeInTheDocument();
    expect(within(dialog).getByRole('img')).toHaveAttribute('src', buildAttachmentUrl('msg-3', 'att-1'));

    fireEvent.click(screen.getByTestId('chat-attachment-preview-next'));

    await waitFor(() => expect(screen.getByText('Фотография 2 из 2')).toBeInTheDocument());
    await waitFor(() => expect(within(dialog).getByRole('img')).toHaveAttribute('src', buildAttachmentUrl('msg-3', 'att-2')));
  });

  it('supports touch swipe between media items in the preview viewer', async () => {
    const attachmentPreview = {
      messageId: 'msg-6',
      attachment: {
        id: 'att-1',
        file_name: 'photo-1.png',
        file_size: 4096,
      },
      fileUrl: buildAttachmentUrl('msg-6', 'att-1'),
      items: [
        {
          id: 'att-1',
          file_name: 'photo-1.png',
          file_size: 4096,
          mime_type: 'image/png',
          fileUrl: buildAttachmentUrl('msg-6', 'att-1'),
        },
        {
          id: 'att-2',
          file_name: 'photo-2.png',
          file_size: 5120,
          mime_type: 'image/png',
          fileUrl: buildAttachmentUrl('msg-6', 'att-2'),
        },
      ],
      activeIndex: 0,
    };

    renderWithTheme(buildProps({ attachmentPreview }));

    const dialogContent = screen.getByTestId('chat-attachment-preview-content');
    fireEvent.touchStart(dialogContent, { touches: [{ clientX: 240, clientY: 140 }] });
    fireEvent.touchMove(dialogContent, { touches: [{ clientX: 140, clientY: 144 }] });
    fireEvent.touchEnd(dialogContent, { changedTouches: [{ clientX: 132, clientY: 146 }] });

    await waitFor(() => expect(screen.getByText('Фотография 2 из 2')).toBeInTheDocument());
  });

  it('renders immersive preview chrome and toggles it on media tap', () => {
    const attachmentPreview = {
      messageId: 'msg-4',
      attachment: {
        id: 'att-1',
        file_name: 'preview-photo.png',
        file_size: 2048,
        mime_type: 'image/png',
      },
      fileUrl: buildAttachmentUrl('msg-4', 'att-1'),
    };

    renderWithTheme(buildProps({ attachmentPreview }));

    const topbar = screen.getByTestId('chat-attachment-preview-topbar');
    const bottomBar = screen.getByTestId('chat-attachment-preview-bottom-bar');
    const image = screen.getByRole('img', { name: 'preview-photo.png' });

    expect(topbar).toBeVisible();
    expect(bottomBar).toBeVisible();
    expect(screen.queryByText('preview-photo.png')).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-attachment-preview-actions')).toBeVisible();

    fireEvent.click(image);
    expect(topbar).not.toBeVisible();
    expect(bottomBar).not.toBeVisible();

    fireEvent.click(image);
    expect(topbar).toBeVisible();
    expect(screen.getByTestId('chat-attachment-preview-bottom-bar')).toBeVisible();
  });

  it('closes image preview when clicking the empty dimmed area', () => {
    const onCloseAttachmentPreview = vi.fn();
    const attachmentPreview = {
      messageId: 'msg-empty-click',
      attachment: {
        id: 'att-empty-click',
        file_name: 'empty-click.png',
        file_size: 2048,
        mime_type: 'image/png',
      },
      fileUrl: buildAttachmentUrl('msg-empty-click', 'att-empty-click'),
    };

    renderWithTheme(buildProps({ attachmentPreview, onCloseAttachmentPreview }));

    fireEvent.click(screen.getByTestId('chat-attachment-preview-content'));

    expect(onCloseAttachmentPreview).toHaveBeenCalledTimes(1);
  });

  it('renders videos inside the fullscreen media viewer', () => {
    const attachmentPreview = {
      messageId: 'msg-5',
      attachment: {
        id: 'att-1',
        file_name: 'clip.mp4',
        file_size: 512000,
        mime_type: 'video/mp4',
      },
      fileUrl: buildAttachmentUrl('msg-5', 'att-1'),
      kind: 'video',
    };

    renderWithTheme(buildProps({ attachmentPreview }));

    const video = document.querySelector('video');
    expect(video).toBeInTheDocument();
    expect(video).toHaveAttribute('src', buildAttachmentUrl('msg-5', 'att-1'));
    expect(screen.getByText('Видео 1 из 1')).toBeInTheDocument();
    expect(screen.getByTestId('chat-attachment-preview-actions')).toBeInTheDocument();
    expect(screen.queryByText('clip.mp4')).not.toBeInTheDocument();
  });

  it('closes image preview modal on Escape', async () => {
    const onCloseAttachmentPreview = vi.fn();
    const attachmentPreview = {
      messageId: 'msg-2',
      attachment: {
        id: 'att-2',
        file_name: 'diagram.jpg',
        file_size: 2048,
      },
      fileUrl: buildAttachmentUrl('msg-2', 'att-2'),
    };

    renderWithTheme(buildProps({ attachmentPreview, onCloseAttachmentPreview }));

    const dialog = screen.getByRole('dialog');

    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape', keyCode: 27 });

    await waitFor(() => expect(onCloseAttachmentPreview).toHaveBeenCalled());
  });

  it('allows removing queued files and opening the picker for more files', () => {
    const mobileMatchMedia = installMobileMatchMediaMock();
    const inputClick = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    const onRemoveSelectedFile = vi.fn();
    const fileInputRef = { current: document.createElement('input') };

    try {
      renderWithTheme(buildProps({
        fileDialogOpen: true,
        fileInputRef,
        selectedFiles: [
          new File(['one'], 'report.pdf', { type: 'application/pdf' }),
          new File(['two'], 'photo.png', { type: 'image/png' }),
        ],
        onRemoveSelectedFile,
      }));

      fireEvent.click(screen.getByTestId('file-dialog-remove-0'));
      expect(onRemoveSelectedFile).toHaveBeenCalledWith(0);

      fireEvent.click(screen.getByLabelText('Действия с файлами'));
      fireEvent.click(screen.getByTestId('file-dialog-add-more'));
      expect(inputClick).toHaveBeenCalledTimes(1);
    } finally {
      inputClick.mockRestore();
      mobileMatchMedia.restore();
    }
  });

  it('renders a telegram-like mobile attachment popup from the composer button', () => {
    const mobileMatchMedia = installMobileMatchMediaMock();
    const anchor = document.createElement('button');
    const onOpenFilePicker = vi.fn();
    const onOpenShare = vi.fn();

    try {
      renderWithTheme(buildProps({
        activeConversationId: 'conv-1',
        composerMenuAnchor: anchor,
        onOpenFilePicker,
        onOpenShare,
      }));

      expect(screen.getByTestId('chat-composer-attachment-popup')).toBeInTheDocument();
      expect(screen.queryByTestId('chat-composer-attachment-sheet')).not.toBeInTheDocument();
      expect(screen.getByText('Фото или видео')).toBeInTheDocument();
      expect(screen.getByText('Файл')).toBeInTheDocument();
      expect(screen.getByText('Задача')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('mobile-composer-attachment-file'));
      expect(onOpenFilePicker).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByTestId('mobile-composer-attachment-task'));
      expect(onOpenShare).toHaveBeenCalledTimes(1);
    } finally {
      mobileMatchMedia.restore();
    }
  });

  it('renders a telegram-like mobile file send dock and focuses the caption field', async () => {
    const mobileMatchMedia = installMobileMatchMediaMock();

    try {
      renderWithTheme(buildProps({
        fileDialogOpen: true,
        selectedFiles: [new File(['one'], 'report.pdf', { type: 'application/pdf' })],
      }));

      expect(screen.getByTestId('file-dialog-mobile-dock')).toBeInTheDocument();
      const captionInput = screen.getByPlaceholderText('Подпись');
      expect(captionInput).toBeInTheDocument();
      await waitFor(() => expect(captionInput).toHaveFocus());
      expect(screen.getByTestId('file-dialog-send')).toBeInTheDocument();
      fireEvent.click(screen.getByLabelText('Действия с файлами'));
      expect(screen.getByTestId('file-dialog-add-more')).toBeInTheDocument();
    } finally {
      mobileMatchMedia.restore();
    }
  });

  it('renders group search results and selected users as separate lists', () => {
    const onAddGroupMember = vi.fn();
    const onRemoveGroupMember = vi.fn();
    const users = [
      { id: 2, username: 'assignee', full_name: 'Task Assignee', presence: { is_online: true, status_text: 'В сети' } },
      { id: 3, username: 'reviewer', full_name: 'Task Reviewer', presence: { is_online: false, status_text: 'Не в сети' } },
    ];

    renderWithTheme(buildProps({
      groupOpen: true,
      groupUsers: users,
      groupSelectedUsers: [users[1]],
      onAddGroupMember,
      onRemoveGroupMember,
    }));

    expect(screen.getByTestId('group-dialog-desktop-layout')).toBeInTheDocument();
    const searchResults = screen.getByTestId('group-user-search-results');
    expect(searchResults).toBeInTheDocument();
    expect(screen.getByTestId('group-selected-users')).toBeInTheDocument();
    expect(screen.getByText('Выбранные участники')).toBeInTheDocument();

    expect(within(searchResults).getByRole('checkbox', { name: /Task Assignee/ })).toHaveAttribute('aria-checked', 'false');
    expect(within(searchResults).getByRole('checkbox', { name: /Task Reviewer/ })).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(within(searchResults).getByRole('checkbox', { name: /Task Assignee/ }));
    expect(onAddGroupMember).toHaveBeenCalledWith(users[0]);

    fireEvent.click(within(searchResults).getByRole('checkbox', { name: /Task Reviewer/ }));
    expect(onRemoveGroupMember).toHaveBeenCalledWith(3);
  });

  it('passes participant search changes through the unified picker input', () => {
    const onGroupSearchChange = vi.fn();

    renderWithTheme(buildProps({
      groupOpen: true,
      onGroupSearchChange,
    }));

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'reviewer' } });

    expect(onGroupSearchChange).toHaveBeenCalledWith('reviewer');
  });

  it('keeps create button disabled when the group form is incomplete', () => {
    renderWithTheme(buildProps({
      groupOpen: true,
      groupTitle: 'Новая группа',
      groupCreateDisabled: true,
      groupSelectedUsers: [{ id: 2, username: 'assignee', full_name: 'Task Assignee', presence: { is_online: true, status_text: 'В сети' } }],
    }));

    const disabledButton = screen.getAllByRole('button').find((button) => button.hasAttribute('disabled'));
    expect(disabledButton).toBeTruthy();
    expect(screen.getByText((content) => content.includes('2'))).toBeInTheDocument();
  });

  it('renders a telegram-like mobile member picker with check rows and a floating next action', () => {
    const mobileMatchMedia = installMobileMatchMediaMock();
    const onAddGroupMember = vi.fn();
    const onRemoveGroupMember = vi.fn();
    const users = [
      { id: 2, username: 'assignee', full_name: 'Task Assignee', presence: { is_online: true, status_text: 'В сети' } },
      { id: 3, username: 'reviewer', full_name: 'Task Reviewer', presence: { is_online: false, status_text: 'Был(а) недавно' } },
    ];

    try {
      renderWithTheme(buildProps({
        groupOpen: true,
        groupUsers: users,
        groupSelectedUsers: [users[1]],
        onAddGroupMember,
        onRemoveGroupMember,
      }));

      fireEvent.click(within(screen.getByTestId('group-user-search-results')).getByText('Task Assignee'));
      expect(onAddGroupMember).toHaveBeenCalledWith(users[0]);

      fireEvent.click(within(screen.getByTestId('group-user-search-results')).getByText('Task Reviewer'));
      expect(onRemoveGroupMember).toHaveBeenCalledWith(3);

      expect(screen.getByRole('button', { name: 'Next group step' })).toBeVisible();
    } finally {
      mobileMatchMedia.restore();
    }
  });

  it('shows thread actions menu and toggles chat settings', () => {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    const onOpenInfo = vi.fn();
    const onUpdateConversationSettings = vi.fn();

    renderWithTheme(buildProps({
      activeConversationId: 'conv-1',
      activeConversation: {
        id: 'conv-1',
        title: 'Проект',
        kind: 'group',
        is_pinned: false,
        is_muted: false,
        is_archived: false,
      },
      threadMenuAnchor: anchor,
      onOpenInfo,
      onUpdateConversationSettings,
    }));

    const threadMenuItems = screen.getAllByRole('menuitem');
    fireEvent.click(threadMenuItems[0]);
    expect(onOpenInfo).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getAllByRole('menuitem')[2]);
    expect(onUpdateConversationSettings).toHaveBeenCalledWith({ is_pinned: true });
  });

  it('shows Telegram-like message actions and forwards reply/share/report actions', () => {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    const onReplyFromMessageMenu = vi.fn();
    const onCopyMessage = vi.fn();
    const onTogglePinMessageFromMenu = vi.fn();
    const onCopyMessageLink = vi.fn();
    const onForwardMessageFromMenu = vi.fn();
    const onReportMessageFromMenu = vi.fn();
    const onSelectMessageFromMenu = vi.fn();

    renderWithTheme(buildProps({
      activeConversationId: 'conv-1',
      activeConversation: {
        id: 'conv-1',
        title: 'Проект',
        kind: 'direct',
      },
      messageMenuAnchor: anchor,
      messageMenuMessage: {
        id: 'msg-1',
        kind: 'text',
        body: 'Текст сообщения',
        is_own: false,
      },
      onReplyFromMessageMenu,
      onCopyMessage,
      onTogglePinMessageFromMenu,
      onCopyMessageLink,
      onForwardMessageFromMenu,
      onReportMessageFromMenu,
      onSelectMessageFromMenu,
    }));

    fireEvent.click(screen.getByRole('menuitem', { name: 'Ответить' }));
    expect(onReplyFromMessageMenu).toHaveBeenCalledWith(expect.objectContaining({ id: 'msg-1' }));

    fireEvent.click(screen.getByRole('menuitem', { name: 'Копировать' }));
    expect(onCopyMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 'msg-1' }));

    fireEvent.click(screen.getByRole('menuitem', { name: 'Закрепить' }));
    expect(onTogglePinMessageFromMenu).toHaveBeenCalledWith(expect.objectContaining({ id: 'msg-1' }));

    fireEvent.click(screen.getByRole('menuitem', { name: 'Копировать ссылку' }));
    expect(onCopyMessageLink).toHaveBeenCalledWith(expect.objectContaining({ id: 'msg-1' }));

    fireEvent.click(screen.getByRole('menuitem', { name: 'Переслать' }));
    expect(onForwardMessageFromMenu).toHaveBeenCalledWith(expect.objectContaining({ id: 'msg-1' }));

    fireEvent.click(screen.getByRole('menuitem', { name: 'Пожаловаться' }));
    expect(onReportMessageFromMenu).toHaveBeenCalledWith(expect.objectContaining({ id: 'msg-1' }));

    fireEvent.click(screen.getByRole('menuitem', { name: 'Выбрать' }));
    expect(onSelectMessageFromMenu).toHaveBeenCalledWith(expect.objectContaining({ id: 'msg-1' }));

    expect(screen.queryByRole('menuitem', { name: 'Перевести' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Удалить' })).not.toBeInTheDocument();
  });

  it('renders a forward-to-chat dialog and forwards the message into the выбранный chat', () => {
    const onForwardMessageToConversation = vi.fn();

    renderWithTheme(buildProps({
      forwardOpen: true,
      forwardMessage: {
        id: 'msg-forward-1',
        kind: 'text',
        body: 'Переслать это сообщение',
      },
      forwardTargets: [
        {
          id: 'conv-2',
          title: 'Команда проекта',
          kind: 'group',
          unread_count: 0,
          last_message_preview: 'Последнее сообщение',
        },
      ],
      onForwardMessageToConversation,
    }));

    expect(screen.getByRole('dialog', { name: 'Переслать в другой чат' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Переслать в чат Команда проекта/i }));
    expect(onForwardMessageToConversation).toHaveBeenCalledWith('conv-2');
  });

  it('filters forward targets with the inline picker search', () => {
    renderWithTheme(buildProps({
      forwardOpen: true,
      forwardTargets: [
        {
          id: 'conv-2',
          title: 'Команда проекта',
          kind: 'group',
          unread_count: 0,
          member_count: 3,
          members: [],
          last_message_preview: 'Последнее сообщение',
        },
        {
          id: 'conv-3',
          title: 'Андрей',
          kind: 'direct',
          direct_peer: {
            id: 'user-2',
            full_name: 'Андрей',
            presence: { is_online: true, status_text: 'В сети' },
          },
          unread_count: 0,
          last_message_preview: 'Привет',
        },
      ],
      forwardConversationQuery: 'Команда',
    }));

    expect(screen.getByRole('button', { name: /Переслать в чат Команда проекта/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Переслать в чат Андрей/i })).not.toBeInTheDocument();
  });
});
