import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { clearSWRCache } from '../lib/swrCache';
import { writeMailRecentMessageDetail } from '../lib/mailRecentCache';

const {
  mockGetBootstrap,
  mockGetMyConfig,
  mockUpdateMyConfig,
  mockSaveMyCredentials,
  mockGetTemplates,
  mockCreateTemplate,
  mockUpdateTemplate,
  mockDeleteTemplate,
  mockSendItRequest,
  mockSendMessage,
  mockGetFolderSummary,
  mockGetFolderTree,
  mockDeleteFolder,
  mockCreateFolder,
  mockRenameFolder,
  mockSetFolderFavorite,
  mockGetPreferences,
  mockGetMessages,
  mockGetMessage,
  mockDownloadAttachment,
  mockMarkAsRead,
  mockMarkAsUnread,
  mockMoveMessage,
  mockGetConversations,
  mockGetConversation,
  mockMarkConversationAsRead,
  mockMarkConversationAsUnread,
  mockGetUnreadCount,
  mockBulkMessageAction,
  mockRenderStats,
} = vi.hoisted(() => ({
  mockGetBootstrap: vi.fn(),
  mockGetMyConfig: vi.fn(),
  mockUpdateMyConfig: vi.fn(),
  mockSaveMyCredentials: vi.fn(),
  mockGetTemplates: vi.fn(),
  mockCreateTemplate: vi.fn(),
  mockUpdateTemplate: vi.fn(),
  mockDeleteTemplate: vi.fn(),
  mockSendItRequest: vi.fn(),
  mockSendMessage: vi.fn(),
  mockGetFolderSummary: vi.fn(),
  mockGetFolderTree: vi.fn(),
  mockDeleteFolder: vi.fn(),
  mockCreateFolder: vi.fn(),
  mockRenameFolder: vi.fn(),
  mockSetFolderFavorite: vi.fn(),
  mockGetPreferences: vi.fn(),
  mockGetMessages: vi.fn(),
  mockGetMessage: vi.fn(),
  mockDownloadAttachment: vi.fn(),
  mockMarkAsRead: vi.fn(),
  mockMarkAsUnread: vi.fn(),
  mockMoveMessage: vi.fn(),
  mockGetConversations: vi.fn(),
  mockGetConversation: vi.fn(),
  mockMarkConversationAsRead: vi.fn(),
  mockMarkConversationAsUnread: vi.fn(),
  mockGetUnreadCount: vi.fn(),
  mockBulkMessageAction: vi.fn(),
  mockRenderStats: {
    folderRail: 0,
    messageList: 0,
    reset() {
      this.folderRail = 0;
      this.messageList = 0;
    },
  },
}));

function installMatchMedia({ mobile = false } = {}) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: mobile ? query.includes('max-width:599.95px') : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

vi.mock('../components/layout/MainLayout', () => ({
  default: ({ children, headerMode = 'default', contentMode = 'default' }) => (
    <div data-testid="layout" data-header-mode={headerMode} data-content-mode={contentMode}>
      {children}
    </div>
  ),
}));

vi.mock('../components/layout/PageShell', () => ({
  default: ({ children, fullHeight, sx }) => (
    <div
      data-testid="page-shell"
      data-full-height={fullHeight ? 'true' : 'false'}
      data-mail-ui-font={sx?.['--mail-ui-font'] || ''}
      data-mail-message-font={sx?.['--mail-message-font'] || ''}
      data-mail-mono-font={sx?.['--mail-mono-font'] || ''}
      data-mail-radius-md={sx?.['--mail-radius-md'] || ''}
      data-mail-radius-lg={sx?.['--mail-radius-lg'] || ''}
    >
      {children}
    </div>
  ),
}));

vi.mock('../components/mail/MailAttachmentPreviewDialog', () => ({ default: () => null }));
vi.mock('../components/mail/MailAdvancedSearchDialog', () => ({
  default: ({
    open,
    filters,
    onChange,
    onApply,
    onReset,
    onApplyRecent,
    recentSearches,
  }) => (open ? (
    <div data-testid="mail-advanced-search-dialog">
      <input
        data-testid="advanced-from-filter"
        value={filters?.from_filter || ''}
        onChange={(event) => onChange?.('from_filter', event.target.value)}
      />
      <input
        data-testid="advanced-subject-filter"
        value={filters?.subject_filter || ''}
        onChange={(event) => onChange?.('subject_filter', event.target.value)}
      />
      <input
        data-testid="advanced-query-filter"
        value={filters?.q || ''}
        onChange={(event) => onChange?.('q', event.target.value)}
      />
      <button type="button" data-testid="advanced-scope-all" onClick={() => onChange?.('folder_scope', 'all')}>
        scope-all
      </button>
      <button type="button" data-testid="advanced-apply" onClick={() => onApply?.()}>
        apply-advanced
      </button>
      <button type="button" data-testid="advanced-reset" onClick={() => onReset?.()}>
        reset-advanced
      </button>
      {(Array.isArray(recentSearches) ? recentSearches : []).map((item, index) => (
        <button
          key={`recent-${index}`}
          type="button"
          data-testid={`advanced-recent-${index}`}
          onClick={() => onApplyRecent?.(item)}
        >
          recent
        </button>
      ))}
    </div>
  ) : null),
}));
vi.mock('../components/mail/MailBulkActionBar', () => ({
  default: ({ count, isMobile, onClear, onMarkRead, onMarkUnread, onDelete, onArchive }) => (
    <div data-testid="mail-bulk-action-bar" data-count={String(count || 0)} data-mobile={isMobile ? 'true' : 'false'}>
      <button type="button" data-testid="mail-bulk-mark-read" onClick={() => onMarkRead?.()}>
        mark-read
      </button>
      <button type="button" data-testid="mail-bulk-mark-unread" onClick={() => onMarkUnread?.()}>
        mark-unread
      </button>
      <button type="button" data-testid="mail-bulk-archive" onClick={() => onArchive?.()}>
        archive
      </button>
      <button type="button" data-testid="mail-bulk-delete" onClick={() => onDelete?.()}>
        delete
      </button>
      <button type="button" data-testid="mail-bulk-clear" onClick={() => onClear?.()}>
        clear-bulk
      </button>
    </div>
  ),
}));
vi.mock('../components/mail/MailComposeDialog', () => ({
  default: ({
    open,
    layoutMode,
    composeFromMailboxId,
    composeToValues,
    onComposeToValuesChange,
    composeSubject,
    onComposeSubjectChange,
    composeBody,
    onComposeBodyChange,
    onOpenSignatureEditor,
    onClose,
  }) => (open ? (
    <div data-testid={layoutMode === 'desktop-inline' ? 'mail-compose-inline-pane' : 'mail-compose-dialog'}>
      <div data-testid="mail-compose-mailbox">{composeFromMailboxId || 'default-mailbox'}</div>
      <input
        data-testid="mail-compose-to-field"
        value={Array.isArray(composeToValues) ? composeToValues.join(', ') : ''}
        onChange={(event) => onComposeToValuesChange?.(event.target.value ? [event.target.value] : [])}
      />
      <input
        data-testid="mail-compose-subject-field"
        value={composeSubject || ''}
        onChange={(event) => onComposeSubjectChange?.(event.target.value)}
      />
      <textarea
        data-testid="mail-compose-body-field"
        value={composeBody || ''}
        onChange={(event) => onComposeBodyChange?.(event.target.value)}
      />
      <button type="button" data-testid="mail-compose-close-action" onClick={() => onClose?.()}>
        close-compose
      </button>
      <button type="button" data-testid="mail-compose-open-signature" onClick={() => onOpenSignatureEditor?.()}>
        open-signature
      </button>
    </div>
  ) : null),
}));
vi.mock('../components/mail/MailFolderRail', () => ({
  default: ({
    onViewModeChange,
    onFolderChange,
    folderTreeItems,
    utilityItems,
    onCreateFolderRequest,
    onRenameFolderRequest,
    onDeleteFolderRequest,
    onToggleFavorite,
    onDropMessagesToFolder,
  }) => {
    mockRenderStats.folderRail += 1;
    return (
    <div data-testid="mail-folder-rail">
      <button type="button" data-testid="switch-messages" onClick={() => onViewModeChange?.('messages')}>messages</button>
      <button type="button" data-testid="switch-conversations" onClick={() => onViewModeChange?.('conversations')}>conversations</button>
      <button type="button" data-testid="switch-sent" onClick={() => onFolderChange?.('sent')}>sent</button>
      {(Array.isArray(folderTreeItems) ? folderTreeItems : []).map((item) => (
        <div key={`folder-${String(item?.id || '')}`}>
          <button
            type="button"
            data-testid={`folder-${String(item?.id || '')}`}
            onClick={() => onFolderChange?.(item?.id)}
          >
            {String(item?.label || item?.id || '')}
          </button>
          <button
            type="button"
            data-testid={`create-folder-${String(item?.id || '')}`}
            onClick={() => onCreateFolderRequest?.(item?.id)}
          >
            create-{String(item?.id || '')}
          </button>
          <button
            type="button"
            data-testid={`rename-folder-${String(item?.id || '')}`}
            onClick={() => onRenameFolderRequest?.(item)}
          >
            rename-{String(item?.id || '')}
          </button>
          <button
            type="button"
            data-testid={`favorite-folder-${String(item?.id || '')}`}
            onClick={() => onToggleFavorite?.(item)}
          >
            favorite-{String(item?.id || '')}
          </button>
          {!item?.well_known_key ? (
            <button
              type="button"
              data-testid={`delete-folder-${String(item?.id || '')}`}
              onClick={() => onDeleteFolderRequest?.(item)}
            >
              delete-{String(item?.id || '')}
            </button>
          ) : null}
          <button
            type="button"
            data-testid={`drop-folder-${String(item?.id || '')}`}
            onClick={() => onDropMessagesToFolder?.(item?.id)}
          >
            drop-{String(item?.id || '')}
          </button>
        </div>
      ))}
      {(Array.isArray(utilityItems) ? utilityItems : []).map((item) => (
        <button
          key={`utility-${String(item?.id || '')}`}
          type="button"
          data-testid={`utility-${String(item?.id || '')}`}
          onClick={() => item?.onClick?.()}
        >
          {String(item?.label || item?.id || '')}
        </button>
      ))}
    </div>
    );
  },
}));
vi.mock('../components/mail/MailHeadersDialog', () => ({ default: () => null }));
vi.mock('../components/mail/MailSignatureDialog', () => ({
  default: ({ open, signatureHtml, onSignatureChange, onSave, onClear }) => (open ? (
    <div data-testid="mail-signature-dialog">
      <textarea
        data-testid="mail-signature-html"
        value={signatureHtml || ''}
        onChange={(event) => onSignatureChange?.(event.target.value)}
      />
      <button type="button" data-testid="mail-signature-clear" onClick={() => onClear?.()}>
        clear-signature
      </button>
      <button type="button" data-testid="mail-signature-save" onClick={() => onSave?.()}>
        save-signature
      </button>
    </div>
  ) : null),
}));
vi.mock('../components/mail/MailShortcutHelpDialog', () => ({ default: () => null }));
vi.mock('../components/mail/MailTemplatesDialog', () => ({
  default: ({
    open,
    templates,
    startCreateTemplate,
    templateEditId,
    startEditTemplate,
    templateCode,
    setTemplateCode,
    templateTitle,
    setTemplateTitle,
    templateCategory,
    setTemplateCategory,
    templateSubject,
    setTemplateSubject,
    templateBody,
    setTemplateBody,
    addTemplateField,
    templateFields,
    updateTemplateField,
    saveTemplate,
    deleteTemplate,
  }) => (open ? (
    <div data-testid="mail-templates-dialog">
      <div data-testid="mail-template-edit-id">{templateEditId || 'new'}</div>
      {(Array.isArray(templates) ? templates : []).map((template) => (
        <button
          key={String(template?.id || template?.code || '')}
          type="button"
          data-testid={`mail-template-select-${String(template?.id || '')}`}
          onClick={() => startEditTemplate?.(template)}
        >
          {String(template?.title || template?.code || '')}
        </button>
      ))}
      <button type="button" data-testid="mail-template-new" onClick={() => startCreateTemplate?.()}>
        new-template
      </button>
      <input
        data-testid="mail-template-code"
        value={templateCode || ''}
        onChange={(event) => setTemplateCode?.(event.target.value)}
      />
      <input
        data-testid="mail-template-title"
        value={templateTitle || ''}
        onChange={(event) => setTemplateTitle?.(event.target.value)}
      />
      <input
        data-testid="mail-template-category"
        value={templateCategory || ''}
        onChange={(event) => setTemplateCategory?.(event.target.value)}
      />
      <input
        data-testid="mail-template-subject"
        value={templateSubject || ''}
        onChange={(event) => setTemplateSubject?.(event.target.value)}
      />
      <textarea
        data-testid="mail-template-body"
        value={templateBody || ''}
        onChange={(event) => setTemplateBody?.(event.target.value)}
      />
      <button type="button" data-testid="mail-template-add-field" onClick={() => addTemplateField?.()}>
        add-field
      </button>
      {(Array.isArray(templateFields) ? templateFields : []).map((field, index) => (
        <div key={`field-${index}`} data-testid={`mail-template-field-${index}`}>
          <input
            data-testid={`mail-template-field-key-${index}`}
            value={field?.key || ''}
            onChange={(event) => updateTemplateField?.(index, { key: event.target.value })}
          />
          <input
            data-testid={`mail-template-field-label-${index}`}
            value={field?.label || ''}
            onChange={(event) => updateTemplateField?.(index, { label: event.target.value })}
          />
          <input
            data-testid={`mail-template-field-default-${index}`}
            value={field?.default_value || ''}
            onChange={(event) => updateTemplateField?.(index, { default_value: event.target.value })}
          />
        </div>
      ))}
      <button type="button" data-testid="mail-template-save" onClick={() => saveTemplate?.()}>
        save-template
      </button>
      <button type="button" data-testid="mail-template-delete" onClick={() => deleteTemplate?.()}>
        delete-template
      </button>
    </div>
  ) : null),
}));
vi.mock('../components/mail/MailToolbar', () => ({
  default: ({ mobile, currentFolderLabel, onOpenNavigation, onOpenMailboxList, onOpenAdvancedSearch }) => (
    <div data-testid="mail-toolbar" data-mobile={mobile ? 'true' : 'false'}>
      <span data-testid="toolbar-current-folder">{currentFolderLabel}</span>
      <button type="button" data-testid="mail-toolbar-open-mailboxes" onClick={() => onOpenMailboxList?.()}>
        open-mailboxes
      </button>
      <button type="button" data-testid="mail-toolbar-open-advanced-search" onClick={() => onOpenAdvancedSearch?.()}>
        open-advanced-search
      </button>
      {mobile ? (
        <button type="button" data-testid="mail-list-open-navigation" onClick={() => onOpenNavigation?.()}>
          open-navigation
        </button>
      ) : null}
    </div>
  ),
}));
vi.mock('../components/mail/MailToolsMenu', () => ({ default: () => null }));
vi.mock('../components/mail/MailViewSettingsDialog', () => ({ default: () => null }));

vi.mock('../components/mail/MailMessageList', () => ({
  default: ({ listData, viewMode, selectedItems, onSelectId, onToggleSelectedListItem, messageListRef, onLoadMoreMessages, bottomInset }) => {
    mockRenderStats.messageList += 1;
    return (
    <div data-testid="mail-list" data-scroll-root="true" data-bottom-inset={String(bottomInset || '')} ref={messageListRef}>
      {(Array.isArray(listData?.items) ? listData.items : []).map((item) => {
        const rowId = String(viewMode === 'conversations' ? (item?.conversation_id || item?.id || '') : (item?.id || ''));
        return (
          <div key={rowId}>
            <button type="button" data-testid={`mail-item-${rowId}`} onClick={() => onSelectId(rowId, item)}>
              {rowId}
            </button>
            <button type="button" data-testid={`mail-item-select-${rowId}`} onClick={() => onToggleSelectedListItem?.(rowId)}>
              {Array.isArray(selectedItems) && selectedItems.includes(rowId) ? 'selected' : 'select'}
            </button>
          </div>
        );
      })}
      {onLoadMoreMessages ? (
        <button type="button" data-testid="mail-load-more" onClick={() => onLoadMoreMessages()}>
          load-more
        </button>
      ) : null}
    </div>
    );
  },
}));

vi.mock('../components/mail/MailPreviewHeader', () => ({
  default: ({ selectedMessage, selectedConversation, viewMode, onToggleReadState, showBackButton, onBackToList, onOpenComposeFromMessage }) => {
    if (!selectedMessage) return null;
    return (
      <div data-testid="mail-preview-header">
        {showBackButton ? (
          <button type="button" data-testid="preview-back" onClick={onBackToList}>back</button>
        ) : null}
        <div data-testid="preview-read-state">
          {viewMode === 'conversations'
            ? `conversation:${Number(selectedConversation?.unread_count || 0)}`
            : (selectedMessage?.is_read ? 'read' : 'unread')}
        </div>
        <button type="button" data-testid="toggle-read" onClick={onToggleReadState}>toggle-read</button>
        <button type="button" data-testid="preview-reply" onClick={() => onOpenComposeFromMessage?.('reply')}>reply</button>
        <button type="button" data-testid="preview-reply-all" onClick={() => onOpenComposeFromMessage?.('reply_all')}>reply-all</button>
        <button type="button" data-testid="preview-forward" onClick={() => onOpenComposeFromMessage?.('forward')}>forward</button>
      </div>
    );
  },
}));

vi.mock('../api/client', () => ({
  mailAPI: {
    getBootstrap: mockGetBootstrap,
    getMyConfig: mockGetMyConfig,
    updateMyConfig: mockUpdateMyConfig,
    saveMyCredentials: mockSaveMyCredentials,
    getTemplates: mockGetTemplates,
    createTemplate: mockCreateTemplate,
    updateTemplate: mockUpdateTemplate,
    deleteTemplate: mockDeleteTemplate,
    sendItRequest: mockSendItRequest,
    sendMessage: mockSendMessage,
    getFolderSummary: mockGetFolderSummary,
    getFolderTree: mockGetFolderTree,
    deleteFolder: mockDeleteFolder,
    createFolder: mockCreateFolder,
    renameFolder: mockRenameFolder,
    setFolderFavorite: mockSetFolderFavorite,
    getPreferences: mockGetPreferences,
    getMessages: mockGetMessages,
    getMessage: mockGetMessage,
    downloadAttachment: mockDownloadAttachment,
    markAsRead: mockMarkAsRead,
    markAsUnread: mockMarkAsUnread,
    moveMessage: mockMoveMessage,
    getConversations: mockGetConversations,
    getConversation: mockGetConversation,
    markConversationAsRead: mockMarkConversationAsRead,
    markConversationAsUnread: mockMarkConversationAsUnread,
    getUnreadCount: mockGetUnreadCount,
    bulkMessageAction: mockBulkMessageAction,
    searchContacts: vi.fn(async () => []),
  },
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    hasPermission: (permission) => permission === 'settings.users.manage',
    user: { id: 100, username: 'mail-user' },
  }),
}));

vi.mock('../hooks/useDebounce', () => ({
  default: (value) => value,
}));

import Mail from './Mail';

function buildMessage(overrides = {}) {
  return {
    id: 'msg-42',
    subject: 'Deep linked message',
    sender: 'boss@example.com',
    sender_email: 'boss@example.com',
    sender_display: 'Boss Name',
    received_at: '2026-03-21T11:05:00Z',
    is_read: false,
    body_html: '<p>Hello</p>',
    attachments: [],
    ...overrides,
  };
}

function buildMessagePage(ids = [], overrides = {}) {
  const limit = Number(overrides?.limit || 50);
  const offset = Number(overrides?.offset || 0);
  const items = ids.map((id, index) => buildMessage({
    id: String(id),
    subject: `Subject ${id}`,
    sender: `Sender ${id}`,
    received_at: new Date(Date.UTC(2026, 2, 21, 11, 5, 0 + index)).toISOString(),
    is_read: true,
  }));
  return {
    items,
    total: Number(overrides?.total || items.length || 0),
    offset,
    limit,
    has_more: Boolean(overrides?.has_more),
    next_offset: overrides?.next_offset ?? null,
    search_limited: false,
    searched_window: 0,
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function buildConversationSummary(overrides = {}) {
  return {
    conversation_id: 'conv-1',
    subject: 'Conversation 1',
    participants: ['boss@example.com'],
    messages_count: 2,
    unread_count: 2,
    last_received_at: '2026-03-21T11:05:00Z',
    has_attachments: false,
    attachments_count: 0,
    preview: 'Preview',
    ...overrides,
  };
}

function buildConversationDetail(overrides = {}) {
  return {
    conversation_id: 'conv-1',
    subject: 'Conversation 1',
    participants: ['boss@example.com'],
    messages_count: 2,
    unread_count: 2,
    last_received_at: '2026-03-21T11:05:00Z',
    items: [
      buildMessage({ id: 'msg-1', conversation_id: 'conv-1', is_read: false }),
      buildMessage({ id: 'msg-2', conversation_id: 'conv-1', is_read: false }),
    ],
    ...overrides,
  };
}

function buildBootstrapPayload(overrides = {}) {
  const mailboxInfo = {
    mailbox_email: 'user@example.com',
    mailbox_login: 'user@zsgp.corp',
    effective_mailbox_login: 'user@zsgp.corp',
    mail_requires_password: false,
    mail_requires_relogin: false,
    mail_is_configured: true,
    ...(overrides?.mailboxInfo || {}),
  };
  return {
    mailboxInfo,
    selected_mailbox: mailboxInfo,
    mailboxes: overrides?.mailboxes,
    preferences: {
      preferences: {
        reading_pane: 'right',
        density: 'comfortable',
        show_preview_snippets: true,
        show_favorites_first: true,
        ...(overrides?.preferences?.preferences || {}),
      },
    },
    unread_count: overrides?.unread_count ?? 1,
    folder_summary: overrides?.folder_summary || {
      inbox: { total: 1, unread: 1 },
      sent: { total: 1, unread: 0 },
    },
    folder_tree: overrides?.folder_tree || {
      items: [
        { id: 'inbox', label: 'Входящие', well_known_key: 'inbox' },
        { id: 'sent', label: 'Отправленные', well_known_key: 'sent' },
      ],
    },
    messages: overrides?.messages || {
      items: [buildMessage()],
      total: 1,
      offset: 0,
      limit: 20,
      has_more: false,
      next_offset: null,
      search_limited: false,
      searched_window: 0,
    },
  };
}

describe('Mail read-state behavior', () => {
  beforeEach(() => {
    installMatchMedia();
    clearSWRCache();
    window.sessionStorage.clear();
    window.localStorage.clear();
    mockRenderStats.reset();

    mockGetBootstrap.mockReset();
    mockGetMyConfig.mockReset();
    mockUpdateMyConfig.mockReset();
    mockSaveMyCredentials.mockReset();
    mockGetTemplates.mockReset();
    mockCreateTemplate.mockReset();
    mockUpdateTemplate.mockReset();
    mockDeleteTemplate.mockReset();
    mockSendItRequest.mockReset();
    mockSendMessage.mockReset();
    mockGetFolderSummary.mockReset();
    mockGetFolderTree.mockReset();
    mockDeleteFolder.mockReset();
    mockCreateFolder.mockReset();
    mockRenameFolder.mockReset();
    mockSetFolderFavorite.mockReset();
    mockGetPreferences.mockReset();
    mockGetMessages.mockReset();
    mockGetMessage.mockReset();
    mockDownloadAttachment.mockReset();
    mockMarkAsRead.mockReset();
    mockMarkAsUnread.mockReset();
    mockMoveMessage.mockReset();
    mockGetConversations.mockReset();
    mockGetConversation.mockReset();
    mockMarkConversationAsRead.mockReset();
    mockMarkConversationAsUnread.mockReset();
    mockGetUnreadCount.mockReset();
    mockBulkMessageAction.mockReset();

    mockGetBootstrap.mockResolvedValue(buildBootstrapPayload());
    mockGetMyConfig.mockResolvedValue({
      mailbox_email: 'user@example.com',
      mailbox_login: 'user@zsgp.corp',
      effective_mailbox_login: 'user@zsgp.corp',
      mail_requires_password: false,
      mail_requires_relogin: false,
      mail_is_configured: true,
    });
    mockUpdateMyConfig.mockResolvedValue({
      mailbox_email: 'user@example.com',
      mailbox_login: 'user@zsgp.corp',
      effective_mailbox_login: 'user@zsgp.corp',
      mail_requires_password: false,
      mail_requires_relogin: false,
      mail_is_configured: true,
      mail_signature_html: '<p>New signature</p>',
    });
    mockSaveMyCredentials.mockResolvedValue({
      mailbox_email: 'user@example.com',
      mailbox_login: 'user@zsgp.corp',
      effective_mailbox_login: 'user@zsgp.corp',
      mail_requires_password: false,
      mail_requires_relogin: false,
      mail_is_configured: true,
    });
    mockGetTemplates.mockResolvedValue({ items: [] });
    mockCreateTemplate.mockResolvedValue({
      id: 'tpl-created',
      code: 'created',
      title: 'Created template',
      subject_template: 'Created subject',
      body_template_md: 'Created body',
      fields: [],
    });
    mockUpdateTemplate.mockResolvedValue({
      id: 'tpl-existing',
      code: 'existing',
      title: 'Updated template',
      subject_template: 'Updated subject',
      body_template_md: 'Updated body',
      fields: [],
    });
    mockDeleteTemplate.mockResolvedValue({ ok: true });
    mockSendItRequest.mockResolvedValue({ ok: true });
    mockSendMessage.mockResolvedValue({ ok: true });
    mockGetFolderSummary.mockResolvedValue({ items: { inbox: { total: 1, unread: 1 }, sent: { total: 1, unread: 0 } } });
    mockGetFolderTree.mockResolvedValue({
      items: [
        { id: 'inbox', label: 'Входящие', well_known_key: 'inbox' },
        { id: 'sent', label: 'Отправленные', well_known_key: 'sent' },
      ],
    });
    mockGetPreferences.mockResolvedValue({
      preferences: {
        reading_pane: 'right',
        density: 'comfortable',
        show_preview_snippets: true,
        show_favorites_first: true,
      },
    });
    mockGetMessages.mockResolvedValue({
      items: [buildMessage()],
      total: 1,
      offset: 0,
      limit: 50,
      has_more: false,
      next_offset: null,
      search_limited: false,
      searched_window: 0,
    });
    mockGetMessage.mockResolvedValue(buildMessage());
    mockDownloadAttachment.mockResolvedValue({
      data: new TextEncoder().encode('attachment body'),
      headers: {
        'content-disposition': 'attachment; filename=\"report.txt\"',
        'content-type': 'text/plain',
      },
    });
    mockMarkAsRead.mockResolvedValue({ ok: true });
    mockMarkAsUnread.mockResolvedValue({ ok: true });
    mockMoveMessage.mockResolvedValue({ ok: true });
    mockGetConversations.mockResolvedValue({
      items: [buildConversationSummary()],
      total: 1,
      offset: 0,
      limit: 50,
      has_more: false,
    });
    mockGetConversation.mockResolvedValue(buildConversationDetail());
    mockMarkConversationAsRead.mockResolvedValue({ ok: true, changed: 2 });
    mockMarkConversationAsUnread.mockResolvedValue({ ok: true, changed: 2 });
    mockGetUnreadCount.mockResolvedValue({ unread_count: 0 });
    mockBulkMessageAction.mockResolvedValue({ ok: true });
    mockDeleteFolder.mockResolvedValue({ ok: true, folder_id: 'deleted-folder' });
    mockCreateFolder.mockResolvedValue({ ok: true, folder_id: 'created-folder' });
    mockRenameFolder.mockResolvedValue({ ok: true, folder_id: 'renamed-folder' });
    mockSetFolderFavorite.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
    clearSWRCache();
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it('scopes Office-native typography variables to the mail shell', async () => {
    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mail-list-panel')).toBeTruthy();
    });

    const shell = screen.getByTestId('page-shell');
    expect(shell.getAttribute('data-mail-ui-font')).toContain('Segoe UI Variable');
    expect(shell.getAttribute('data-mail-message-font')).toContain('Aptos');
    expect(shell.getAttribute('data-mail-mono-font')).toContain('Cascadia Mono');
    expect(shell.getAttribute('data-mail-radius-md')).toBe('10px');
    expect(shell.getAttribute('data-mail-radius-lg')).toBe('12px');
  });

  it('marks an unread deep-linked message as read on open', async () => {
    render(
      <MemoryRouter initialEntries={['/mail?folder=inbox&message=msg-42']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockGetMessage).toHaveBeenCalledWith('msg-42', expect.any(Object));
    });

    await waitFor(() => {
      expect(mockMarkAsRead).toHaveBeenCalledWith('msg-42');
    });

    await waitFor(() => {
      expect(screen.getByTestId('preview-read-state').textContent).toBe('read');
    });

    expect(
      mockGetMessages.mock.calls.some(
        ([params]) => String(params?.folder || '') === 'inbox'
      )
    ).toBe(false);
  });

  it('clears a stale deep-linked message selection when the backend reports message not found', async () => {
    mockGetMessage.mockRejectedValue({
      response: {
        status: 400,
        data: { detail: 'Message not found: missing-exchange-id' },
      },
    });

    render(
      <MemoryRouter initialEntries={['/mail?folder=inbox&message=msg-42&mailbox_id=legacy-38']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mockGetMessage).toHaveBeenCalledWith('msg-42', expect.any(Object));
    });

    await waitFor(() => {
      expect(screen.getByText('Выбранное письмо больше недоступно. Список обновлен.')).toBeTruthy();
    });

    expect(screen.queryByTestId('mail-preview-header')).toBeNull();
  });

  it('keeps the expanded inbox list after load more and background refresh', async () => {
    const firstPageIds = Array.from({ length: 50 }, (_, index) => `msg-${index + 1}`);
    const secondPageIds = Array.from({ length: 50 }, (_, index) => `msg-${index + 51}`);
    const thirdPageIds = Array.from({ length: 20 }, (_, index) => `msg-${index + 101}`);

    mockGetBootstrap.mockResolvedValue(buildBootstrapPayload({
      messages: buildMessagePage(firstPageIds, {
        total: 120,
        offset: 0,
        has_more: true,
        next_offset: 50,
      }),
    }));
    mockGetMessages.mockImplementation(async (params = {}) => {
      const folderId = String(params?.folder || 'inbox');
      const offset = Number(params?.offset || 0);
      if (folderId !== 'inbox') {
        return buildMessagePage([], { total: 0, offset: 0, has_more: false, next_offset: null });
      }
      if (offset === 50) {
        return buildMessagePage(secondPageIds, {
          total: 120,
          offset: 50,
          has_more: true,
          next_offset: 100,
        });
      }
      if (offset === 100) {
        return buildMessagePage(thirdPageIds, {
          total: 121,
          offset: 100,
          has_more: false,
          next_offset: null,
        });
      }
      return buildMessagePage(['msg-new', ...firstPageIds.slice(0, 49)], {
        total: 121,
        offset: 0,
        has_more: true,
        next_offset: 50,
      });
    });

    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mail-item-msg-1')).toBeTruthy();
      expect(screen.getByTestId('mail-item-msg-50')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('mail-load-more'));

    await waitFor(() => {
      expect(screen.getByTestId('mail-item-msg-100')).toBeTruthy();
    });

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });

    await act(async () => {
      window.dispatchEvent(new CustomEvent('mail-needs-refresh'));
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId('mail-item-msg-new')).toBeTruthy();
      expect(screen.getByTestId('mail-item-msg-1')).toBeTruthy();
      expect(screen.getByTestId('mail-item-msg-100')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('mail-load-more'));

    await waitFor(() => {
      expect(screen.getByTestId('mail-item-msg-120')).toBeTruthy();
    });

    const renderedIds = Array.from(document.querySelectorAll('[data-testid^="mail-item-"]'))
      .map((node) => node.getAttribute('data-testid'))
      .filter((id) => id && !id.startsWith('mail-item-select-'));
    expect(renderedIds.length).toBe(121);
  });

  it('keeps the current list visible and suppresses transient errors during silent background refresh', async () => {
    mockGetBootstrap.mockResolvedValue(buildBootstrapPayload({
      messages: buildMessagePage(['msg-42'], {
        total: 1,
        offset: 0,
        has_more: false,
        next_offset: null,
      }),
    }));
    mockGetMessages.mockRejectedValue({
      response: {
        status: 503,
        data: { detail: 'Temporary mail backend issue' },
      },
      message: 'Request failed with status code 503',
    });

    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mail-item-msg-42')).toBeTruthy();
    });

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });

    await act(async () => {
      window.dispatchEvent(new CustomEvent('mail-needs-refresh'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId('mail-item-msg-42')).toBeTruthy();
    expect(screen.queryByText(/Не удалось загрузить список писем/i)).toBeNull();
    expect(screen.queryByText(/Temporary mail backend issue/i)).toBeNull();
  });

  it('does not keep inbox messages visible when switching to an uncached empty custom folder', async () => {
    const customFolderDeferred = createDeferred();
    const customFolderTree = {
      items: [
        { id: 'inbox', label: 'Входящие', well_known_key: 'inbox' },
        { id: 'sent', label: 'Отправленные', well_known_key: 'sent' },
        { id: 'custom-empty', label: 'Пустая папка', well_known_key: null, total: 0, unread: 0 },
      ],
    };

    mockGetBootstrap.mockResolvedValue(buildBootstrapPayload({
      folder_tree: customFolderTree,
      messages: buildMessagePage(['msg-inbox'], {
        total: 1,
        offset: 0,
        has_more: false,
        next_offset: null,
      }),
    }));
    mockGetFolderTree.mockResolvedValue(customFolderTree);
    mockGetMessages.mockImplementation((params = {}) => {
      const folderId = String(params?.folder || 'inbox');
      if (folderId === 'custom-empty') {
        return customFolderDeferred.promise;
      }
      return Promise.resolve(buildMessagePage(['msg-inbox'], {
        total: 1,
        offset: 0,
        has_more: false,
        next_offset: null,
      }));
    });

    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mail-item-msg-inbox')).toBeTruthy();
    });

    fireEvent.click(screen.getAllByTestId('folder-custom-empty')[0]);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByTestId('mail-item-msg-inbox')).toBeNull();

    await act(async () => {
      customFolderDeferred.resolve(buildMessagePage([], {
        total: 0,
        offset: 0,
        has_more: false,
        next_offset: null,
      }));
      await customFolderDeferred.promise;
      await Promise.resolve();
    });

    expect(screen.queryByTestId('mail-item-msg-inbox')).toBeNull();
    expect(mockGetMessages).toHaveBeenCalledWith(expect.objectContaining({ folder: 'custom-empty' }));
  });

  it('shows animated first-load state only when bootstrap has no cached payload yet', async () => {
    let resolveBootstrap;
    mockGetBootstrap.mockReset();
    mockGetBootstrap.mockReturnValueOnce(new Promise((resolve) => {
      resolveBootstrap = resolve;
    }));

    const firstRender = render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mail-initial-loading')).toBeTruthy();
    });
    expect(screen.queryByTestId('mail-toolbar')).toBeNull();

    await act(async () => {
      resolveBootstrap(buildBootstrapPayload());
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.queryByTestId('mail-initial-loading')).toBeNull();
    });

    firstRender.unmount();

    mockGetBootstrap.mockReset();
    mockGetBootstrap.mockReturnValueOnce(new Promise(() => {}));

    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('toolbar-current-folder').textContent).toBe('Входящие');
    });
    expect(screen.queryByTestId('mail-initial-loading')).toBeNull();
  });

  it('requests bootstrap with the reduced default limit', async () => {
    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mail-toolbar')).toBeTruthy();
    });

    expect(mockGetBootstrap).toHaveBeenCalledWith(expect.objectContaining({ limit: 20 }));
  });

  it('loads unread counts lazily for deferred and stale non-active mailboxes when mailbox list opens', async () => {
    mockGetBootstrap.mockResolvedValue(buildBootstrapPayload({
      mailboxInfo: {
        mailbox_id: 'mbox-1',
      },
      mailboxes: [
        {
          id: 'mbox-1',
          mailbox_id: 'mbox-1',
          label: 'Primary',
          mailbox_email: 'user@example.com',
          is_active: true,
          is_primary: true,
          unread_count: 2,
          unread_count_state: 'fresh',
        },
        {
          id: 'mbox-2',
          mailbox_id: 'mbox-2',
          label: 'Ops',
          mailbox_email: 'ops@example.com',
          is_active: true,
          unread_count: 0,
          unread_count_state: 'deferred',
        },
        {
          id: 'mbox-3',
          mailbox_id: 'mbox-3',
          label: 'Sales',
          mailbox_email: 'sales@example.com',
          is_active: true,
          unread_count: 1,
          unread_count_state: 'stale',
        },
      ],
    }));
    mockGetUnreadCount.mockImplementation(async ({ mailboxId }) => ({
      unread_count: mailboxId === 'mbox-2' ? 7 : 3,
    }));

    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mail-toolbar')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('mail-toolbar-open-mailboxes'));

    await waitFor(() => {
      expect(mockGetUnreadCount).toHaveBeenCalledTimes(2);
    });

    expect(mockGetUnreadCount).toHaveBeenCalledWith({ mailboxId: 'mbox-2' });
    expect(mockGetUnreadCount).toHaveBeenCalledWith({ mailboxId: 'mbox-3' });
    expect(mockGetUnreadCount).not.toHaveBeenCalledWith({ mailboxId: 'mbox-1' });
  });

  it('refreshes the folder tree from the network after deleting a folder even when the cache is fresh', async () => {
    const customFolderTree = {
      items: [
        { id: 'inbox', label: 'Inbox', well_known_key: 'inbox' },
        { id: 'custom-deleted', label: 'Projects', well_known_key: null, parent_id: 'inbox', scope: 'mailbox' },
      ],
    };
    const treeAfterDelete = {
      items: [
        { id: 'inbox', label: 'Inbox', well_known_key: 'inbox' },
      ],
    };
    let deleted = false;
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    mockGetBootstrap.mockResolvedValue(buildBootstrapPayload({
      folder_tree: customFolderTree,
    }));
    mockGetFolderTree.mockImplementation(async () => (deleted ? treeAfterDelete : customFolderTree));
    mockDeleteFolder.mockImplementation(async () => {
      deleted = true;
      return { ok: true, folder_id: 'custom-deleted' };
    });

    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getAllByTestId('folder-custom-deleted').length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByTestId('delete-folder-custom-deleted')[0]);

    await waitFor(() => {
      expect(screen.queryAllByTestId('folder-custom-deleted')).toHaveLength(0);
    });

    expect(mockDeleteFolder).toHaveBeenCalledWith('custom-deleted', '');
    expect(mockGetFolderTree).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('does not start the background refresh interval while the document is hidden', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });

    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mail-toolbar')).toBeTruthy();
    });

    expect(setIntervalSpy.mock.calls.some(([, delay]) => delay === 90000)).toBe(false);

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(setIntervalSpy.mock.calls.some(([, delay]) => delay === 90000)).toBe(true);
    setIntervalSpy.mockRestore();
  });

  it('marks an unread conversation as read on open in conversations mode', async () => {
    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(within(screen.getByTestId('page-shell')).getByTestId('switch-conversations')).toBeTruthy();
    });

    fireEvent.click(within(screen.getByTestId('page-shell')).getByTestId('switch-conversations'));

    await waitFor(() => {
      expect(mockGetConversations).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByTestId('mail-item-conv-1'));

    await waitFor(() => {
      expect(mockGetConversation).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({ folder: 'inbox' }),
        expect.any(Object),
      );
    });

    await waitFor(() => {
      expect(mockMarkConversationAsRead).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({ folder: 'inbox', folder_scope: 'current' }),
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('preview-read-state').textContent).toBe('conversation:0');
    });
  });

  it('prompts for saved corporate credentials before loading mailbox', async () => {
    mockGetBootstrap.mockReset();
    mockGetBootstrap
      .mockResolvedValueOnce(buildBootstrapPayload({
        mailboxInfo: {
          mailbox_email: 'user@example.com',
          mailbox_login: null,
          effective_mailbox_login: 'user@zsgp.corp',
          mail_requires_password: true,
          mail_requires_relogin: false,
          mail_is_configured: false,
        },
        unread_count: 0,
        folder_summary: {},
        folder_tree: { items: [] },
        messages: {
          items: [],
          total: 0,
          offset: 0,
          limit: 50,
          has_more: false,
          next_offset: null,
          search_limited: false,
          searched_window: 0,
        },
      }))
      .mockResolvedValueOnce(buildBootstrapPayload());

    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Требуется корпоративный пароль')).toBeTruthy();
    });

    expect(mockGetBootstrap).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText('Логин Exchange'), { target: { value: 'user@zsgp.corp' } });
    fireEvent.change(screen.getByLabelText('Корпоративный пароль'), { target: { value: 'Secret123!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить и открыть почту' }));

    await waitFor(() => {
      expect(mockSaveMyCredentials).toHaveBeenCalledWith({
        mailbox_login: 'user@zsgp.corp',
        mailbox_password: 'Secret123!',
        mailbox_email: 'user@example.com',
      });
    });

    await waitFor(() => {
      expect(mockGetBootstrap).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      expect(screen.queryByText('Требуется корпоративный пароль')).toBeNull();
    });

    expect(screen.getByTestId('mail-list-panel')).toBeTruthy();
  });

  it('allows saving primary LDAP mailbox credentials for all devices from relogin state', async () => {
    mockGetBootstrap.mockReset();
    mockGetBootstrap
      .mockResolvedValueOnce(buildBootstrapPayload({
        mailboxInfo: {
          mailbox_id: 'primary-ldap',
          auth_mode: 'primary_session',
          mail_auth_mode: 'ad_auto',
          mail_requires_password: false,
          mail_requires_relogin: true,
          mail_is_configured: false,
        },
      }))
      .mockResolvedValueOnce(buildBootstrapPayload({
        mailboxInfo: {
          mailbox_id: 'primary-ldap',
          auth_mode: 'primary_session',
          mail_auth_mode: 'ad_auto',
          mail_requires_password: false,
          mail_requires_relogin: true,
          mail_is_configured: false,
        },
      }))
      .mockResolvedValueOnce(buildBootstrapPayload({
        mailboxInfo: {
          mailbox_id: 'primary-ldap',
          auth_mode: 'stored_credentials',
          mail_auth_mode: 'manual',
          mail_requires_password: false,
          mail_requires_relogin: false,
          mail_is_configured: true,
        },
      }));
    mockGetMyConfig.mockResolvedValueOnce({
      mailbox_id: 'primary-ldap',
      mailbox_email: 'user@example.com',
      mailbox_login: 'user@zsgp.corp',
      effective_mailbox_login: 'user@zsgp.corp',
      auth_mode: 'primary_session',
      mail_auth_mode: 'ad_auto',
      mail_requires_password: false,
      mail_requires_relogin: true,
      mail_is_configured: false,
    });
    mockSaveMyCredentials.mockResolvedValueOnce({
      mailbox_id: 'primary-ldap',
      mailbox_email: 'user@example.com',
      mailbox_login: 'user@zsgp.corp',
      effective_mailbox_login: 'user@zsgp.corp',
      auth_mode: 'stored_credentials',
      mail_auth_mode: 'manual',
      mail_requires_password: false,
      mail_requires_relogin: false,
      mail_is_configured: true,
    });

    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    const saveForAllDevicesButton = await screen.findByRole('button', { name: 'Сохранить пароль для всех устройств' });
    fireEvent.click(saveForAllDevicesButton);

    await waitFor(() => {
      expect(screen.getByLabelText('Корпоративный пароль')).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText('Корпоративный пароль'), { target: { value: 'SharedPass123!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить и открыть почту' }));

    await waitFor(() => {
      expect(mockSaveMyCredentials).toHaveBeenCalledWith({
        mailbox_id: 'primary-ldap',
        mailbox_login: 'user@zsgp.corp',
        mailbox_password: 'SharedPass123!',
        mailbox_email: 'user@example.com',
      });
    });

    await waitFor(() => {
      expect(mockGetBootstrap).toHaveBeenCalledTimes(3);
    });

    await waitFor(() => {
      expect(screen.queryByLabelText('Корпоративный пароль')).toBeNull();
    });
  });

  it('uses the fullscreen mobile preview shell and restores the list view', async () => {
    installMatchMedia({ mobile: true });

    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mail-toolbar')).toHaveAttribute('data-mobile', 'true');
    });

    expect(screen.getByTestId('layout')).toHaveAttribute('data-header-mode', 'notifications-only');
    expect(screen.getByTestId('layout')).toHaveAttribute('data-content-mode', 'edge-to-edge-mobile');
    expect(screen.getByTestId('page-shell')).toHaveAttribute('data-full-height', 'false');
    expect(screen.getByTestId('mail-toolbar')).toBeTruthy();
    expect(within(screen.getByTestId('page-shell')).queryByTestId('mail-folder-rail')).toBeNull();
    expect(screen.getByTestId('mail-list-panel')).toBeTruthy();
    expect(screen.getByTestId('mail-list-open-navigation')).toBeTruthy();
    expect(screen.queryByTestId('mail-mobile-preview-screen')).toBeNull();
    expect(screen.getByTestId('mail-mobile-navigation-drawer')).not.toBeVisible();

    fireEvent.click(screen.getByTestId('mail-list-open-navigation'));

    await waitFor(() => {
      expect(screen.getByTestId('mail-mobile-navigation-drawer')).toBeVisible();
    });

    fireEvent.click(screen.getByTestId('mail-mobile-navigation-close'));

    await waitFor(() => {
      expect(screen.getByTestId('mail-mobile-navigation-drawer')).not.toBeVisible();
    });

    fireEvent.click(screen.getByTestId('mail-list-open-navigation'));

    await waitFor(() => {
      expect(screen.getByTestId('mail-mobile-navigation-drawer')).toBeVisible();
    });

    fireEvent.click(within(screen.getByTestId('mail-mobile-navigation-drawer')).getByTestId('switch-sent'));

    await waitFor(() => {
      expect(screen.getByTestId('mail-mobile-navigation-drawer')).not.toBeVisible();
    });

    expect(screen.getByTestId('mail-list-current-folder').textContent).toBe('Отправленные');

    fireEvent.click(screen.getByTestId('mail-item-msg-42'));

    await waitFor(() => {
      expect(mockGetMessage).toHaveBeenCalledWith('msg-42', expect.any(Object));
    });

    expect(screen.getByTestId('layout')).toHaveAttribute('data-header-mode', 'hidden');
    expect(screen.getByTestId('layout')).toHaveAttribute('data-content-mode', 'edge-to-edge-mobile');
    expect(screen.getByTestId('page-shell')).toHaveAttribute('data-full-height', 'false');
    expect(screen.queryByTestId('mail-toolbar')).toBeNull();
    expect(screen.getByTestId('mail-mobile-preview-screen')).toBeTruthy();
    expect(screen.getByTestId('mail-preview-panel')).toBeVisible();
    expect(screen.getByTestId('preview-back')).toBeTruthy();
    expect(screen.getByText('Hello')).toBeTruthy();
    expect(screen.getByTestId('mail-mobile-navigation-drawer')).not.toBeVisible();
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', {
        state: {
          __hubMailMobileShell: true,
          __hubMailMobileShellView: 'list',
          __hubMailMobileShellDrawer: false,
          __hubMailMobileShellMessageId: '',
          __hubMailMobileShellMode: 'messages',
        },
      }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('layout')).toHaveAttribute('data-header-mode', 'notifications-only');
      expect(screen.getByTestId('layout')).toHaveAttribute('data-content-mode', 'edge-to-edge-mobile');
      expect(screen.getByTestId('page-shell')).toHaveAttribute('data-full-height', 'false');
      expect(screen.queryByTestId('mail-mobile-preview-screen')).toBeNull();
    });

    expect(screen.getByTestId('mail-toolbar')).toBeTruthy();
    expect(screen.getByTestId('mail-list-panel')).toBeVisible();
  });

  it('does not open mobile navigation from a left-edge swipe on the list screen', async () => {
    installMatchMedia({ mobile: true });

    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mail-list-panel')).toBeVisible();
    });

    fireEvent.touchStart(screen.getByTestId('mail-mobile-list-screen'), {
      touches: [{ clientX: 12, clientY: 180 }],
    });
    fireEvent.touchMove(screen.getByTestId('mail-mobile-list-screen'), {
      touches: [{ clientX: 96, clientY: 184 }],
    });
    fireEvent.touchEnd(screen.getByTestId('mail-mobile-list-screen'), {
      changedTouches: [{ clientX: 104, clientY: 186 }],
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId('mail-mobile-navigation-drawer')).not.toBeVisible();
  });

  it('passes mobile bulk selection mode to the action bar and lifts the compose fab', async () => {
    installMatchMedia({ mobile: true });
    mockGetBootstrap.mockResolvedValue(buildBootstrapPayload({
      messages: {
        items: [
          buildMessage({ id: 'msg-1', subject: 'First' }),
          buildMessage({ id: 'msg-2', subject: 'Second' }),
        ],
        total: 2,
        offset: 0,
        limit: 20,
        has_more: false,
        next_offset: null,
        search_limited: false,
        searched_window: 0,
      },
    }));

    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mail-list-panel')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('mail-item-select-msg-1'));

    await waitFor(() => {
      expect(screen.getByTestId('mail-bulk-action-bar')).toHaveAttribute('data-mobile', 'true');
    });
    expect(screen.getByTestId('mail-bulk-action-bar')).toHaveAttribute('data-count', '1');
    expect(screen.getByTestId('mail-list')).toHaveAttribute('data-bottom-inset', 'calc(78px + env(safe-area-inset-bottom, 0px))');
    expect(screen.getByTestId('mail-compose-fab')).toHaveAttribute('data-mobile-bulk-offset', 'true');

    fireEvent.click(screen.getByTestId('mail-item-msg-2'));

    await waitFor(() => {
      expect(screen.getByTestId('mail-bulk-action-bar')).toHaveAttribute('data-count', '2');
    });
    expect(screen.queryByTestId('mail-mobile-preview-screen')).toBeNull();
    expect(mockGetMessage).not.toHaveBeenCalledWith('msg-2', expect.any(Object));
  });

  it('keeps vertical scrolling gestures on the mobile list from opening navigation', async () => {
    installMatchMedia({ mobile: true });

    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mail-list-panel')).toBeVisible();
    });

    fireEvent.touchStart(screen.getByTestId('mail-mobile-list-screen'), {
      touches: [{ clientX: 12, clientY: 180 }],
    });
    fireEvent.touchMove(screen.getByTestId('mail-mobile-list-screen'), {
      touches: [{ clientX: 14, clientY: 96 }],
    });
    fireEvent.touchEnd(screen.getByTestId('mail-mobile-list-screen'), {
      changedTouches: [{ clientX: 15, clientY: 72 }],
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId('mail-mobile-navigation-drawer')).not.toBeVisible();
  });

  it('routes a mobile browser back action from the open preview back to the list', async () => {
    installMatchMedia({ mobile: true });

    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mail-list-panel')).toBeVisible();
    });

    fireEvent.click(screen.getByTestId('mail-item-msg-42'));

    await waitFor(() => {
      expect(screen.getByTestId('mail-mobile-preview-screen')).toBeTruthy();
    });

    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', {
        state: {
          __hubMailMobileShell: true,
          __hubMailMobileShellView: 'list',
          __hubMailMobileShellDrawer: false,
          __hubMailMobileShellMessageId: '',
          __hubMailMobileShellMode: 'messages',
        },
      }));
    });

    await waitFor(() => {
      expect(screen.queryByTestId('mail-mobile-preview-screen')).toBeNull();
      expect(screen.getByTestId('mail-list-panel')).toBeVisible();
    });
  });

  it('restores mobile message list scroll position after an edge-swipe back', async () => {
    installMatchMedia({ mobile: true });

    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mail-list-panel')).toBeVisible();
    });

    const listScrollRoot = screen.getByTestId('mail-list');
    listScrollRoot.scrollTop = 320;

    fireEvent.click(screen.getByTestId('mail-item-msg-42'));

    await waitFor(() => {
      expect(screen.getByTestId('mail-preview-panel')).toBeVisible();
    });

    fireEvent.touchStart(screen.getByTestId('mail-mobile-preview-screen'), {
      touches: [{ clientX: 10, clientY: 160 }],
    });
    fireEvent.touchMove(screen.getByTestId('mail-mobile-preview-screen'), {
      touches: [{ clientX: 110, clientY: 164 }],
    });
    fireEvent.touchEnd(screen.getByTestId('mail-mobile-preview-screen'), {
      changedTouches: [{ clientX: 128, clientY: 168 }],
    });

    await waitFor(() => {
      expect(screen.queryByTestId('mail-mobile-preview-screen')).toBeNull();
      expect(screen.getByTestId('mail-list').scrollTop).toBe(320);
    });
  });

  it('does not close the mobile preview when the swipe does not start from the edge', async () => {
    installMatchMedia({ mobile: true });

    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mail-list-panel')).toBeVisible();
    });

    fireEvent.click(screen.getByTestId('mail-item-msg-42'));

    await waitFor(() => {
      expect(screen.getByTestId('mail-mobile-preview-screen')).toBeTruthy();
    });

    fireEvent.touchStart(screen.getByTestId('mail-mobile-preview-screen'), {
      touches: [{ clientX: 48, clientY: 190 }],
    });
    fireEvent.touchMove(screen.getByTestId('mail-mobile-preview-screen'), {
      touches: [{ clientX: 146, clientY: 194 }],
    });
    fireEvent.touchEnd(screen.getByTestId('mail-mobile-preview-screen'), {
      changedTouches: [{ clientX: 160, clientY: 198 }],
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId('mail-mobile-preview-screen')).toBeTruthy();
    expect(screen.getByTestId('layout')).toHaveAttribute('data-header-mode', 'hidden');
  });

  it('keeps vertical scrolling gestures on the mobile preview from closing it', async () => {
    installMatchMedia({ mobile: true });

    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mail-list-panel')).toBeVisible();
    });

    fireEvent.click(screen.getByTestId('mail-item-msg-42'));

    await waitFor(() => {
      expect(screen.getByTestId('mail-mobile-preview-screen')).toBeTruthy();
    });

    fireEvent.touchStart(screen.getByTestId('mail-mobile-preview-screen'), {
      touches: [{ clientX: 10, clientY: 190 }],
    });
    fireEvent.touchMove(screen.getByTestId('mail-mobile-preview-screen'), {
      touches: [{ clientX: 12, clientY: 94 }],
    });
    fireEvent.touchEnd(screen.getByTestId('mail-mobile-preview-screen'), {
      changedTouches: [{ clientX: 12, clientY: 72 }],
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId('mail-mobile-preview-screen')).toBeTruthy();
    expect(screen.getByTestId('layout')).toHaveAttribute('data-header-mode', 'hidden');
  });

  it('does not close the mobile preview when the swipe starts inside a horizontal mail scroller', async () => {
    installMatchMedia({ mobile: true });
    mockGetMessage.mockResolvedValue(buildMessage({
      id: 'msg-42',
      is_read: true,
      body_html: '<div data-mail-table-scroll=\"true\">Wide content</div>',
      body_text: 'Wide content',
    }));

    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mail-list-panel')).toBeVisible();
    });

    fireEvent.click(screen.getByTestId('mail-item-msg-42'));

    const horizontalScroller = await screen.findByText('Wide content');
    expect(screen.getByTestId('mail-mobile-preview-screen')).toBeTruthy();

    fireEvent.touchStart(horizontalScroller, {
      touches: [{ clientX: 8, clientY: 210 }],
    });
    fireEvent.touchMove(horizontalScroller, {
      touches: [{ clientX: 132, clientY: 212 }],
    });
    fireEvent.touchEnd(horizontalScroller, {
      changedTouches: [{ clientX: 148, clientY: 214 }],
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId('mail-mobile-preview-screen')).toBeTruthy();
    expect(screen.getByText('Wide content')).toBeTruthy();
  });

  it('keeps conversation bodies visible inside the fullscreen mobile preview shell', async () => {
    installMatchMedia({ mobile: true });
    mockGetConversation.mockResolvedValue(buildConversationDetail({
      items: [
        buildMessage({
          id: 'msg-1',
          conversation_id: 'conv-1',
          is_read: false,
          body_html: '<p>Conversation body</p>',
        }),
        buildMessage({
          id: 'msg-2',
          conversation_id: 'conv-1',
          is_read: false,
          body_html: '<p>Follow-up body</p>',
        }),
      ],
    }));

    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mail-list-panel')).toBeVisible();
    });

    fireEvent.click(screen.getByTestId('switch-conversations'));

    await waitFor(() => {
      expect(screen.getByTestId('mail-item-conv-1')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('mail-item-conv-1'));

    await waitFor(() => {
      expect(mockGetConversation).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({ folder: 'inbox', folder_scope: 'current' }),
        expect.any(Object),
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('mail-mobile-preview-screen')).toBeTruthy();
      expect(screen.getByText('Conversation body')).toBeTruthy();
      expect(screen.getByText('Follow-up body')).toBeTruthy();
    });

    expect(screen.getByTestId('layout')).toHaveAttribute('data-header-mode', 'hidden');
    expect(screen.getByTestId('layout')).toHaveAttribute('data-content-mode', 'edge-to-edge-mobile');
    expect(screen.getByTestId('page-shell')).toHaveAttribute('data-full-height', 'false');
  });

  it('falls back to getMessages when inbox bootstrap does not include visible items', async () => {
    installMatchMedia({ mobile: true });
    mockGetBootstrap.mockResolvedValue(buildBootstrapPayload({
      messages: {
        items: [],
        total: 0,
        offset: 0,
        limit: 20,
        has_more: false,
        next_offset: null,
        search_limited: false,
        searched_window: 0,
      },
    }));
    mockGetMessages.mockResolvedValue(buildMessagePage(['msg-live-1']));

    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mockGetMessages).toHaveBeenCalledWith(expect.objectContaining({ folder: 'inbox' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('mail-item-msg-live-1')).toBeTruthy();
    });
  });

  it('opens a message from recent detail cache before the live detail refresh completes', async () => {
    let resolveMessageRequest;
    const pendingMessageRequest = new Promise((resolve) => {
      resolveMessageRequest = resolve;
    });
    writeMailRecentMessageDetail({
      scope: '100',
      message: buildMessage({
        id: 'msg-42',
        is_read: true,
        body_html: '<p>Cached body</p>',
        body_text: 'Cached body',
      }),
    });
    mockGetMessage.mockImplementation(() => pendingMessageRequest);

    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mail-list-panel')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('mail-item-msg-42'));

    await waitFor(() => {
      expect(screen.getByText('Cached body')).toBeTruthy();
    });

    act(() => {
      resolveMessageRequest(buildMessage({
        id: 'msg-42',
        is_read: true,
        body_html: '<p>Fresh body</p>',
        body_text: 'Fresh body',
      }));
    });

    await waitFor(() => {
      expect(screen.getByText('Fresh body')).toBeTruthy();
    });
  });

  it('keeps a cached selected message visible when the live detail refresh fails transiently', async () => {
    writeMailRecentMessageDetail({
      scope: '100',
      message: buildMessage({
        id: 'msg-42',
        is_read: true,
        body_html: '<p>Cached body</p>',
        body_text: 'Cached body',
      }),
    });
    mockGetMessage.mockRejectedValue({
      code: 'ERR_NETWORK',
      message: 'Network Error',
    });

    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mail-list-panel')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('mail-item-msg-42'));

    await waitFor(() => {
      expect(screen.getByText('Cached body')).toBeTruthy();
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByText(/Не удалось загрузить письмо/i)).toBeNull();
    expect(screen.queryByText(/Network Error/i)).toBeNull();
  });

  it('renders plain text message bodies when html body is empty', async () => {
    mockGetMessage.mockResolvedValue(buildMessage({
      id: 'msg-42',
      is_read: true,
      body_html: '',
      body_text: 'Plain text body\nSecond line',
    }));

    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mail-list-panel')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('mail-item-msg-42'));

    await waitFor(() => {
      expect(screen.getByText(/Plain text body/)).toBeTruthy();
      expect(screen.getByText(/Second line/)).toBeTruthy();
    });
  });

  it('does not replace a loaded selected message with the preview shell when the row is clicked again', async () => {
    mockGetMessage.mockResolvedValue(buildMessage({
      id: 'msg-42',
      is_read: true,
      body_html: '<p>Loaded full body</p>',
      body_text: 'Loaded full body',
    }));

    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mail-list-panel')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('mail-item-msg-42'));

    await waitFor(() => {
      expect(screen.getByText('Loaded full body')).toBeTruthy();
    });

    mockGetMessage.mockClear();
    fireEvent.click(screen.getByTestId('mail-item-msg-42'));

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText('Loaded full body')).toBeTruthy();
    expect(mockGetMessage).not.toHaveBeenCalled();
  });

  it('does not refetch the selected message on focus while detail cache is still fresh', async () => {
    installMatchMedia({ mobile: true });
    mockGetMessage.mockResolvedValue(buildMessage({
      id: 'msg-42',
      is_read: true,
      body_html: '<p>Fresh body</p>',
      body_text: 'Fresh body',
    }));

    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mail-list-panel')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('mail-item-msg-42'));

    await waitFor(() => {
      expect(screen.getByText('Fresh body')).toBeTruthy();
      expect(mockGetMessage).toHaveBeenCalledTimes(1);
    });

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockGetMessage).toHaveBeenCalledTimes(1);
  });

  it.skip('renders inline cid images inside the message body and hides them from attachment chips', async () => {
    const inlineAttachment = {
      id: 'att-inline',
      download_token: 'mailatt-YXR0LWlubGluZQ',
      name: 'logo.png',
      content_type: 'image/png',
      size: 128,
      content_id: 'logo123',
      is_inline: true,
      inline_src: '/api/v1/mail/messages/msg-42/attachments/mailatt-YXR0LWlubGluZQ?disposition=inline',
    };
    const fileAttachment = {
      id: 'att-file',
      download_token: 'mailatt-YXR0LWZpbGU',
      name: 'report.pdf',
      content_type: 'application/pdf',
      size: 512,
      content_id: '',
      is_inline: false,
      inline_src: null,
    };
    mockGetMessage.mockResolvedValue(
      buildMessage({
        body_html: '<p>Hello</p><p><img src="cid:logo123" alt="Inline logo" /></p>',
        attachments: [inlineAttachment, fileAttachment],
      })
    );

    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mail-list-panel')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('mail-item-msg-42'));

    await waitFor(() => {
      expect(mockGetMessage).toHaveBeenCalledWith('msg-42', expect.any(Object));
    });

    const previewPanel = screen.getByTestId('mail-preview-panel');
    const inlineImage = within(previewPanel).getByAltText('Inline logo');

    expect(inlineImage.getAttribute('src')).toBe(inlineAttachment.inline_src);
    expect(within(previewPanel).queryByText(/logo\.png/i)).toBeNull();
    expect(within(previewPanel).getByText(/report\.pdf/i)).toBeTruthy();
  });

  it('requests attachment content through the shared attachment helper when a chip is opened', async () => {
    mockGetMessage.mockResolvedValue(buildMessage({
      attachments: [
        {
          id: 'att-file',
          download_token: 'att2_ZGVtbw',
          downloadable: true,
          name: 'report.txt',
          content_type: 'text/plain',
          size: 64,
          content_id: '',
          is_inline: false,
          inline_src: null,
        },
      ],
    }));

    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mail-list-panel')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('mail-item-msg-42'));

    await waitFor(() => {
      expect(screen.getByText(/report\.txt/i)).toBeTruthy();
    });

    fireEvent.click(screen.getByText(/report\.txt/i));

    await waitFor(() => {
      expect(mockDownloadAttachment).toHaveBeenCalledWith('msg-42', 'att2_ZGVtbw', expect.any(Object));
    });
  });

  it('shows a specific error when attachment payload is missing a download reference', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockGetMessage.mockResolvedValue(buildMessage({
      attachments: [
        {
          id: '',
          download_token: '',
          downloadable: false,
          name: 'broken.txt',
          content_type: 'text/plain',
          size: 64,
          content_id: '',
          is_inline: false,
          inline_src: null,
        },
      ],
    }));

    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mail-list-panel')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('mail-item-msg-42'));

    await waitFor(() => {
      expect(screen.getByText(/broken\.txt/i)).toBeTruthy();
    });

    fireEvent.click(screen.getByText(/broken\.txt/i));

    await waitFor(() => {
      expect(screen.getByText('Вложение "broken.txt" пришло без идентификатора для скачивания.')).toBeTruthy();
    });

    expect(mockDownloadAttachment).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('shows backend attachment detail from blob error responses instead of the generic axios 400 text', async () => {
    mockGetMessage.mockResolvedValue(buildMessage({
      attachments: [
        {
          id: 'att-file',
          download_token: 'att2_ZGVtbw',
          downloadable: true,
          name: 'report.txt',
          content_type: 'text/plain',
          size: 64,
          content_id: '',
          is_inline: false,
          inline_src: null,
        },
      ],
    }));
    mockDownloadAttachment.mockRejectedValue({
      message: 'Request failed with status code 400',
      response: {
        status: 400,
        headers: {
          'content-type': 'application/json',
        },
        data: new Blob(
          [JSON.stringify({ detail: 'Вложение недоступно для выбранного ящика.' })],
          { type: 'application/json' }
        ),
      },
    });

    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mail-list-panel')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('mail-item-msg-42'));

    await waitFor(() => {
      expect(screen.getByText(/report\.txt/i)).toBeTruthy();
    });

    fireEvent.click(screen.getByText(/report\.txt/i));

    await waitFor(() => {
      expect(screen.getByText('Вложение недоступно для выбранного ящика.')).toBeTruthy();
    });
    expect(screen.queryByText('Request failed with status code 400')).toBeNull();
  });

  it.skip('keeps remote images blocked until the user explicitly reveals them', async () => {
    mockGetMessage.mockResolvedValue(
      buildMessage({
        body_html: '<p><img src="https://cdn.example.com/logo.png" alt="Remote logo" /></p>',
        attachments: [],
      })
    );

    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mail-list-panel')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('mail-item-msg-42'));

    await waitFor(() => {
      expect(mockGetMessage).toHaveBeenCalledWith('msg-42', expect.any(Object));
    });

    const previewPanel = screen.getByTestId('mail-preview-panel');

    expect(within(previewPanel).queryByAltText('Remote logo')).toBeNull();
    expect(within(previewPanel).getByText('В письме есть внешние изображения. Они скрыты до вашего разрешения.')).toBeTruthy();

    fireEvent.click(within(previewPanel).getByRole('button', { name: 'Показать изображения' }));

    await waitFor(() => {
      expect(within(previewPanel).getByAltText('Remote logo').getAttribute('src')).toBe('https://cdn.example.com/logo.png');
    });
  });

  it('restores the last folder from session storage and recent local cache before live refresh completes', async () => {
    const sentMessage = buildMessage({ id: 'msg-sent-1', subject: 'Sent item', is_read: true });
    mockGetMessages.mockResolvedValue({
      items: [sentMessage],
      total: 1,
      offset: 0,
      limit: 50,
      has_more: false,
      next_offset: null,
      search_limited: false,
      searched_window: 0,
    });

    const firstRender = render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('toolbar-current-folder').textContent).toBe('Входящие');
    });

    fireEvent.click(within(screen.getByTestId('page-shell')).getByTestId('switch-sent'));

    await waitFor(() => {
      expect(mockGetMessages).toHaveBeenCalledWith(expect.objectContaining({ folder: 'sent' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('toolbar-current-folder').textContent).toBe('Отправленные');
    });

    firstRender.unmount();
    clearSWRCache();
    mockGetMessages.mockClear();
    mockGetMessages.mockImplementationOnce(() => new Promise(() => {}));

    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('toolbar-current-folder').textContent).toBe('Отправленные');
    });

    expect(screen.getByTestId('mail-item-msg-sent-1')).toBeTruthy();
    await waitFor(() => {
      expect(mockGetMessages).toHaveBeenCalledWith(expect.objectContaining({ folder: 'sent' }));
    });
  });

  it('opens desktop compose inline in the preview pane from the floating action button', async () => {
    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mail-list-panel')).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText('Написать письмо'));

    await waitFor(() => {
      expect(screen.getByTestId('mail-compose-inline-pane')).toBeTruthy();
    });
  });

  it('saves the active mailbox signature from the compose flow', async () => {
    mockGetBootstrap.mockResolvedValue(buildBootstrapPayload({
      mailboxInfo: {
        mailbox_id: 'primary',
        mail_signature_html: '<p>Old signature</p>',
      },
    }));

    render(
      <MemoryRouter initialEntries={['/mail?mailbox_id=primary']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mail-list-panel')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('mail-compose-fab'));

    await waitFor(() => {
      expect(screen.getByTestId('mail-compose-inline-pane')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('mail-compose-open-signature'));

    await waitFor(() => {
      expect(screen.getByTestId('mail-signature-dialog')).toBeTruthy();
    });
    expect(screen.getByTestId('mail-signature-html').value).toBe('<p>Old signature</p>');

    fireEvent.change(screen.getByTestId('mail-signature-html'), {
      target: { value: '<p>New signature</p>' },
    });
    fireEvent.click(screen.getByTestId('mail-signature-save'));

    await waitFor(() => {
      expect(mockUpdateMyConfig).toHaveBeenCalledWith({
        mailbox_id: 'primary',
        mail_signature_html: '<p>New signature</p>',
      });
    });
  });

  it('keeps the mobile compose flow in the dialog path', async () => {
    installMatchMedia({ mobile: true });

    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mail-list-panel')).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText(/Написать письмо/i));

    await waitFor(() => {
      expect(screen.getByTestId('mail-compose-dialog')).toBeTruthy();
    });

    expect(screen.queryByTestId('mail-compose-inline-pane')).toBeNull();
  });

  it('opens reply actions inline and restores the preview after compose closes', async () => {
    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mail-item-msg-42')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('mail-item-msg-42'));

    await waitFor(() => {
      expect(screen.getByTestId('mail-preview-header')).toBeTruthy();
    });

    for (const actionId of ['preview-reply', 'preview-reply-all', 'preview-forward']) {
      fireEvent.click(screen.getByTestId(actionId));

      await waitFor(() => {
        expect(screen.getByTestId('mail-compose-inline-pane')).toBeTruthy();
      });

      fireEvent.click(screen.getByTestId('mail-compose-close-action'));

      await waitFor(() => {
        expect(screen.getByTestId('mail-preview-header')).toBeTruthy();
      });
    }
  });

  it('sends a quick reply from the preview and refreshes mail data', async () => {
    const selectedMessage = buildMessage({
      id: 'msg-reply',
      conversation_id: 'conv-reply',
      subject: 'Budget review',
      sender: 'Fallback Sender <fallback@example.com>',
      sender_email: 'fallback@example.com',
      is_read: true,
      mailbox_id: 'mb-message',
      compose_context: {
        reply: {
          mailbox_id: 'mb-reply',
          to: ['Boss Name <boss@example.com>', { email: ' team@example.com ' }],
          cc: ['Copy Person <copy@example.com>'],
          subject: 'Re: Budget review',
        },
      },
    });
    mockGetBootstrap.mockResolvedValue(buildBootstrapPayload({
      mailboxInfo: {
        mailbox_id: 'mb-primary',
        mailbox_email: 'user@example.com',
      },
    }));
    mockGetConversations.mockResolvedValue({
      items: [buildConversationSummary({
        conversation_id: 'conv-reply',
        subject: 'Budget review',
        unread_count: 0,
        messages_count: 1,
      })],
      total: 1,
      offset: 0,
      limit: 50,
      has_more: false,
    });
    mockGetConversation.mockResolvedValue(buildConversationDetail({
      conversation_id: 'conv-reply',
      subject: 'Budget review',
      unread_count: 0,
      messages_count: 1,
      items: [selectedMessage],
    }));
    mockGetMessages.mockResolvedValue({
      items: [buildMessage({
        id: 'msg-inbox',
        subject: 'Inbox message',
        is_read: true,
      })],
      total: 1,
      offset: 0,
      limit: 50,
      has_more: false,
      next_offset: null,
      search_limited: false,
      searched_window: 0,
    });
    mockGetMessage.mockResolvedValue(buildMessage({
      id: 'msg-inbox',
      subject: 'Inbox message',
      is_read: true,
    }));

    render(
      <MemoryRouter initialEntries={['/mail?mailbox_id=mb-primary']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getAllByTestId('switch-conversations').length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByTestId('switch-conversations')[0]);

    await waitFor(() => {
      expect(screen.getByTestId('mail-item-conv-reply')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('mail-item-conv-reply'));

    await waitFor(() => {
      expect(within(screen.getByTestId('mail-preview-panel')).getByTestId('mail-quick-reply-body')).toBeTruthy();
    });

    mockGetConversations.mockClear();
    mockGetFolderSummary.mockClear();

    const previewPanel = screen.getByTestId('mail-preview-panel');
    fireEvent.change(within(previewPanel).getByTestId('mail-quick-reply-body'), {
      target: { value: 'Line <one>\nLine two >' },
    });
    fireEvent.click(within(previewPanel).getByTestId('mail-quick-reply-send'));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith({
        from_mailbox_id: 'mb-reply',
        to: ['boss@example.com', 'team@example.com'],
        cc: ['copy@example.com'],
        bcc: [],
        subject: 'Re: Budget review',
        body: '<p>Line &lt;one&gt;<br/>Line two &gt;</p>',
        is_html: true,
        reply_to_message_id: 'msg-reply',
      });
    });
    await waitFor(() => {
      expect(mockGetConversations).toHaveBeenCalled();
      expect(mockGetFolderSummary).toHaveBeenCalledWith({ mailbox_id: 'mb-primary' });
    });
    expect(within(previewPanel).getByTestId('mail-quick-reply-body').value).toBe('');
  });

  it('applies advanced search filters to the next message list request', async () => {
    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mail-list-panel')).toBeTruthy();
    });

    mockGetMessages.mockClear();

    fireEvent.click(screen.getByTestId('mail-toolbar-open-advanced-search'));

    await waitFor(() => {
      expect(screen.getByTestId('mail-advanced-search-dialog')).toBeTruthy();
    });

    fireEvent.change(screen.getByTestId('advanced-from-filter'), {
      target: { value: 'sender@example.com' },
    });
    fireEvent.change(screen.getByTestId('advanced-subject-filter'), {
      target: { value: 'Budget' },
    });
    fireEvent.change(screen.getByTestId('advanced-query-filter'), {
      target: { value: 'quarterly' },
    });
    fireEvent.click(screen.getByTestId('advanced-scope-all'));
    fireEvent.click(screen.getByTestId('advanced-apply'));

    await waitFor(() => {
      expect(mockGetMessages).toHaveBeenCalledWith(expect.objectContaining({
        q: 'quarterly',
        from_filter: 'sender@example.com',
        subject_filter: 'Budget',
        folder_scope: 'all',
        offset: 0,
      }));
    });

    expect(JSON.parse(window.localStorage.getItem('mail_recent_searches_v1'))[0]).toMatchObject({
      q: 'quarterly',
      from_filter: 'sender@example.com',
      subject_filter: 'Budget',
      folder_scope: 'all',
    });
  });

  it('applies recent advanced search entries and resets the draft filters', async () => {
    window.localStorage.setItem('mail_recent_searches_v1', JSON.stringify([
      {
        q: 'router',
        from_filter: 'ops@example.com',
        subject_filter: 'incident',
        folder_scope: 'all',
        label: 'router',
      },
    ]));

    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mail-list-panel')).toBeTruthy();
    });

    mockGetMessages.mockClear();

    fireEvent.click(screen.getByTestId('mail-toolbar-open-advanced-search'));
    await waitFor(() => {
      expect(screen.getByTestId('advanced-recent-0')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('advanced-recent-0'));

    await waitFor(() => {
      expect(mockGetMessages).toHaveBeenCalledWith(expect.objectContaining({
        q: 'router',
        from_filter: 'ops@example.com',
        subject_filter: 'incident',
        folder_scope: 'all',
      }));
    });

    fireEvent.click(screen.getByTestId('mail-toolbar-open-advanced-search'));
    await waitFor(() => {
      expect(screen.getByTestId('advanced-query-filter').value).toBe('router');
    });
    fireEvent.click(screen.getByTestId('advanced-reset'));

    await waitFor(() => {
      expect(screen.getByTestId('advanced-query-filter').value).toBe('');
      expect(screen.getByTestId('advanced-from-filter').value).toBe('');
      expect(screen.getByTestId('advanced-subject-filter').value).toBe('');
    });
  });

  it('runs bulk message actions with the selected message ids and mailbox scope', async () => {
    const listPage = buildMessagePage(['msg-1', 'msg-2'], { total: 2 });
    mockGetBootstrap.mockResolvedValue(buildBootstrapPayload({ messages: listPage }));
    mockGetMessages.mockResolvedValue(listPage);

    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mail-item-msg-1')).toBeTruthy();
      expect(screen.getByTestId('mail-item-msg-2')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('mail-item-select-msg-1'));
    fireEvent.click(screen.getByTestId('mail-item-select-msg-2'));

    await waitFor(() => {
      expect(screen.getByTestId('mail-bulk-action-bar').getAttribute('data-count')).toBe('2');
    });

    fireEvent.click(screen.getByTestId('mail-bulk-mark-read'));

    await waitFor(() => {
      expect(mockBulkMessageAction).toHaveBeenCalledWith({
        mailbox_id: undefined,
        message_ids: ['msg-1', 'msg-2'],
        action: 'mark_read',
        target_folder: undefined,
        permanent: false,
      });
    });
  });

  it('moves selected messages to a dropped folder with a bulk action', async () => {
    const listPage = buildMessagePage(['msg-1', 'msg-2'], { total: 2 });
    const folderTreeItems = [
      { id: 'inbox', label: 'Inbox', well_known_key: 'inbox' },
      { id: 'archive', label: 'Archive', well_known_key: 'archive' },
    ];
    mockGetBootstrap.mockResolvedValue(buildBootstrapPayload({
      messages: listPage,
      folder_tree: { items: folderTreeItems },
    }));
    mockGetMessages.mockResolvedValue(listPage);
    mockGetFolderTree.mockResolvedValue({ items: folderTreeItems });

    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mail-item-msg-1')).toBeTruthy();
      expect(screen.getByTestId('mail-item-msg-2')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('mail-item-select-msg-1'));
    fireEvent.click(screen.getByTestId('mail-item-select-msg-2'));

    await waitFor(() => {
      expect(screen.getByTestId('mail-bulk-action-bar').getAttribute('data-count')).toBe('2');
    });

    fireEvent.click(screen.getAllByTestId('drop-folder-archive')[0]);

    await waitFor(() => {
      expect(mockBulkMessageAction).toHaveBeenCalledWith({
        mailbox_id: undefined,
        message_ids: ['msg-1', 'msg-2'],
        action: 'move',
        target_folder: 'archive',
      });
    });
    expect(mockMoveMessage).not.toHaveBeenCalled();
  });

  it('creates a child folder from the folder rail with the expected parent scope', async () => {
    const folderTreeItems = [
      { id: 'inbox', label: 'Inbox', well_known_key: 'inbox' },
      { id: 'team', label: 'Team', scope: 'mailbox', is_favorite: false },
    ];
    mockGetBootstrap.mockResolvedValue(buildBootstrapPayload({
      folder_tree: { items: folderTreeItems },
    }));
    mockGetFolderTree.mockResolvedValue({ items: folderTreeItems });

    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getAllByTestId('folder-team').length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByTestId('create-folder-team')[0]);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Child folder' } });
    fireEvent.click(screen.getByRole('button', { name: '\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c' }));

    await waitFor(() => {
      expect(mockCreateFolder).toHaveBeenCalledWith({
        mailbox_id: undefined,
        name: 'Child folder',
        parent_folder_id: 'team',
        scope: 'mailbox',
      });
    });
  });

  it('renames and favorites folders from the folder rail', async () => {
    const folderTreeItems = [
      { id: 'inbox', label: 'Inbox', well_known_key: 'inbox' },
      { id: 'team', label: 'Team', scope: 'mailbox', is_favorite: false },
    ];
    mockGetBootstrap.mockResolvedValue(buildBootstrapPayload({
      folder_tree: { items: folderTreeItems },
    }));
    mockGetFolderTree.mockResolvedValue({ items: folderTreeItems });

    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getAllByTestId('folder-team').length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByTestId('rename-folder-team')[0]);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Renamed Team' } });
    fireEvent.click(screen.getByRole('button', { name: '\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c' }));

    await waitFor(() => {
      expect(mockRenameFolder).toHaveBeenCalledWith('team', {
        name: 'Renamed Team',
        mailbox_id: undefined,
      });
    });

    fireEvent.click(screen.getAllByTestId('favorite-folder-team')[0]);

    await waitFor(() => {
      expect(mockSetFolderFavorite).toHaveBeenCalledWith('team', true, '');
    });
  });

  it('deletes the active folder and returns the mail view to inbox', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const folderTreeItems = [
      { id: 'inbox', label: 'Inbox', well_known_key: 'inbox' },
      { id: 'team', label: 'Team', scope: 'mailbox', is_favorite: false },
    ];
    mockGetBootstrap.mockResolvedValue(buildBootstrapPayload({
      folder_tree: { items: folderTreeItems },
    }));
    mockGetFolderTree.mockResolvedValue({ items: folderTreeItems });

    render(
      <MemoryRouter initialEntries={['/mail?folder=team']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getAllByTestId('folder-team').length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByTestId('delete-folder-team')[0]);

    await waitFor(() => {
      expect(mockDeleteFolder).toHaveBeenCalledWith('team', '');
    });
    await waitFor(() => {
      expect(screen.getAllByTestId('toolbar-current-folder')[0].textContent).toBe('Inbox');
    });

    confirmSpy.mockRestore();
  });

  it('does not rerender the folder rail or message list while typing in desktop compose fields', async () => {
    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mail-list-panel')).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText(/Написать письмо/i));

    await waitFor(() => {
      expect(screen.getByTestId('mail-compose-inline-pane')).toBeTruthy();
    });

    const folderRailRendersBeforeTyping = mockRenderStats.folderRail;
    const messageListRendersBeforeTyping = mockRenderStats.messageList;

    fireEvent.change(screen.getByTestId('mail-compose-to-field'), {
      target: { value: 'inline@example.com' },
    });
    fireEvent.change(screen.getByTestId('mail-compose-body-field'), {
      target: { value: '<p>Typed inline body</p>' },
    });

    expect(mockRenderStats.folderRail).toBe(folderRailRendersBeforeTyping);
    expect(mockRenderStats.messageList).toBe(messageListRendersBeforeTyping);
  });

  it('opens rail utility tools outside the overflow menu', async () => {
    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mail-folder-rail')).toBeTruthy();
    });

    fireEvent.click(screen.getAllByTestId('utility-it-request')[0]);
    await waitFor(() => {
      expect(screen.getByText('Заявка в IT')).toBeTruthy();
    });

    fireEvent.click(screen.getAllByTestId('utility-templates')[0]);
    await waitFor(() => {
      expect(screen.getByTestId('mail-templates-dialog')).toBeTruthy();
    });
  });

  it('creates a mail template from the templates dialog', async () => {
    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mail-folder-rail')).toBeTruthy();
    });

    fireEvent.click(screen.getAllByTestId('utility-templates')[0]);

    await waitFor(() => {
      expect(screen.getByTestId('mail-templates-dialog')).toBeTruthy();
    });

    fireEvent.change(screen.getByTestId('mail-template-code'), {
      target: { value: 'Hardware.Access' },
    });
    fireEvent.change(screen.getByTestId('mail-template-title'), {
      target: { value: 'Hardware access' },
    });
    fireEvent.change(screen.getByTestId('mail-template-category'), {
      target: { value: 'IT' },
    });
    fireEvent.change(screen.getByTestId('mail-template-subject'), {
      target: { value: 'Access for {{ inventory_number }}' },
    });
    fireEvent.change(screen.getByTestId('mail-template-body'), {
      target: { value: 'Please grant access for {{ inventory_number }}.' },
    });
    fireEvent.click(screen.getByTestId('mail-template-add-field'));

    await waitFor(() => {
      expect(screen.getByTestId('mail-template-field-0')).toBeTruthy();
    });

    fireEvent.change(screen.getByTestId('mail-template-field-key-0'), {
      target: { value: 'Inventory Number' },
    });
    fireEvent.change(screen.getByTestId('mail-template-field-label-0'), {
      target: { value: 'Inventory number' },
    });
    fireEvent.change(screen.getByTestId('mail-template-field-default-0'), {
      target: { value: '101795' },
    });
    fireEvent.click(screen.getByTestId('mail-template-save'));

    await waitFor(() => {
      expect(mockCreateTemplate).toHaveBeenCalledWith({
        code: 'hardware.access',
        title: 'Hardware access',
        category: 'IT',
        subject_template: 'Access for {{ inventory_number }}',
        body_template_md: 'Please grant access for {{ inventory_number }}.',
        fields: [
          {
            key: 'inventory_number',
            label: 'Inventory number',
            type: 'text',
            required: true,
            placeholder: '',
            default_value: '101795',
            options: [],
          },
        ],
      });
    });
  });

  it('updates and deletes a mail template from the templates dialog', async () => {
    mockGetTemplates.mockResolvedValue({
      items: [
        {
          id: 'tpl-existing',
          code: 'access',
          title: 'Access request',
          category: 'IT',
          subject_template: 'Old access subject',
          body_template_md: 'Old access body',
          fields: [
            {
              key: 'inventory_number',
              label: 'Inventory number',
              type: 'text',
              required: true,
              placeholder: '',
              default_value: '101795',
              options: [],
            },
          ],
        },
      ],
    });

    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mail-folder-rail')).toBeTruthy();
    });

    fireEvent.click(screen.getAllByTestId('utility-templates')[0]);

    await waitFor(() => {
      expect(screen.getByTestId('mail-template-edit-id').textContent).toBe('tpl-existing');
    });

    fireEvent.change(screen.getByTestId('mail-template-title'), {
      target: { value: 'Access request updated' },
    });
    fireEvent.change(screen.getByTestId('mail-template-subject'), {
      target: { value: 'Updated access subject' },
    });
    fireEvent.change(screen.getByTestId('mail-template-body'), {
      target: { value: 'Updated access body' },
    });
    fireEvent.click(screen.getByTestId('mail-template-save'));

    await waitFor(() => {
      expect(mockUpdateTemplate).toHaveBeenCalledWith('tpl-existing', {
        code: 'access',
        title: 'Access request updated',
        category: 'IT',
        subject_template: 'Updated access subject',
        body_template_md: 'Updated access body',
        fields: [
          {
            key: 'inventory_number',
            label: 'Inventory number',
            type: 'text',
            required: true,
            placeholder: '',
            default_value: '101795',
            options: [],
          },
        ],
      });
    });

    fireEvent.click(screen.getByTestId('mail-template-delete'));

    await waitFor(() => {
      expect(mockDeleteTemplate).toHaveBeenCalledWith('tpl-existing');
    });
  });

  it('loads templates and sends an IT request from the rail utility', async () => {
    mockGetTemplates.mockResolvedValue({
      items: [
        {
          id: 'tpl-access',
          code: 'access',
          title: 'Access request',
          fields: [
            { key: 'inventory_number', label: 'Inventory number', default_value: '101795' },
            { key: 'comment', label: 'Comment', default_value: '' },
          ],
        },
      ],
    });

    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mail-folder-rail')).toBeTruthy();
    });

    fireEvent.click(screen.getAllByTestId('utility-it-request')[0]);

    await waitFor(() => {
      expect(mockGetTemplates).toHaveBeenCalledWith({ include_inactive: true });
    });
    await waitFor(() => {
      expect(screen.getByTestId('mail-it-request-dialog')).toBeTruthy();
    });

    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: 'Access request' }));

    await waitFor(() => {
      expect(screen.getByTestId('mail-it-field-inventory_number')).toBeTruthy();
    });

    expect(screen.getByTestId('mail-it-field-inventory_number').value).toBe('101795');
    fireEvent.change(screen.getByTestId('mail-it-field-comment'), {
      target: { value: 'Need VPN access' },
    });
    fireEvent.click(screen.getByTestId('mail-it-submit'));

    await waitFor(() => {
      expect(mockSendItRequest).toHaveBeenCalledWith({
        template_id: 'tpl-access',
        fields: {
          inventory_number: '101795',
          comment: 'Need VPN access',
        },
      });
    });
  });

  it('does not send an IT request without a selected template', async () => {
    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mail-folder-rail')).toBeTruthy();
    });

    fireEvent.click(screen.getAllByTestId('utility-it-request')[0]);
    await waitFor(() => {
      expect(screen.getByTestId('mail-it-request-dialog')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('mail-it-submit'));

    await waitFor(() => {
      expect(mockSendItRequest).not.toHaveBeenCalled();
    });
  });

  it('renders quoted history behind a separate disclosure when the message body can be split', async () => {
    mockGetMessage.mockResolvedValue(buildMessage({
      id: 'msg-42',
      is_read: true,
      body_html: '<p>Fresh body</p><blockquote><p>Quoted history</p></blockquote>',
      body_text: 'Fresh body',
    }));

    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mail-list-panel')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('mail-item-msg-42'));

    await waitFor(() => {
      expect(screen.getByText('Fresh body')).toBeTruthy();
    });

    expect(screen.queryByText('Quoted history')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Показать историю переписки' }));

    await waitFor(() => {
      expect(screen.getByText('Quoted history')).toBeTruthy();
    });
  });

  it('shows the full message immediately when quoted-history heuristics would otherwise hide the whole body', async () => {
    mockGetMessage.mockResolvedValue(buildMessage({
      id: 'msg-42',
      is_read: true,
      body_html: '<div>From: support@example.com\nDate: 08.04.2026\nSubject: Status update</div><p>Main body stays visible</p>',
      body_text: 'Main body stays visible',
    }));

    render(
      <MemoryRouter initialEntries={['/mail']}>
        <Routes>
          <Route path="/mail" element={<Mail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mail-list-panel')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('mail-item-msg-42'));

    await waitFor(() => {
      expect(screen.getByText('Main body stays visible')).toBeTruthy();
    });

    expect(screen.queryByRole('button', { name: 'Показать историю переписки' })).toBeNull();
  });
});
