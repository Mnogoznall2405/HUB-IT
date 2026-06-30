import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import useChatSidebarSection from './useChatSidebarSection';

vi.mock('./buildChatPagePanesBags', () => ({
  __esModule: true,
  default: vi.fn(() => ({
    shell: { theme: { palette: { mode: 'light' } }, ui: {}, isMobile: false, isPhone: false, mobileMotionDisabled: false },
    sidebar: { activeConversationId: 'conv-1', health: {}, user: {}, unreadTotal: 0, sidebarQuery: '', setSidebarQuery: vi.fn(), sidebarSearchActive: false, searchingSidebar: false, searchPeople: [], searchChats: [], searchResultEmpty: false, openingPeerId: '', handleOpenPeer: vi.fn(), openConversation: vi.fn(), prefetchThreadBootstrap: vi.fn(), conversationsLoading: false, filteredConversations: [], openGroupDialog: vi.fn(), sidebarScrollRef: { current: null }, conversationFilter: 'all', handleActiveFolderChange: vi.fn(), customFolders: [], conversationFilterCounts: {}, conversationIdsByFolder: {}, handleOpenFolderManager: vi.fn(), handleOpenArchiveFolder: vi.fn(), handleToggleConversationInFolder: vi.fn(), draftsByConversation: {}, updateConversationSettings: vi.fn(), requestDeleteConversation: vi.fn(), requestLeaveConversation: vi.fn(), conversationActionPendingId: '', aiSidebarRows: [], aiBotsLoading: false, aiBotsError: '', canUseAiChat: false, handleOpenAiBot: vi.fn(), openingAiBotId: '' },
  })),
}));

describe('useChatSidebarSection', () => {
  it('smoke: returns a sidebar pane element', () => {
    const { result } = renderHook(() => useChatSidebarSection({}));
    expect(result.current).toBeTruthy();
    expect(result.current.type).toBeTruthy();
  });
});
