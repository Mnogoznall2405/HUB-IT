import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import useChatFoldersController from './useChatFoldersController';

vi.mock('../../api/chatFolders', () => ({
  default: {
    listFolders: vi.fn(),
  },
}));

vi.mock('../../lib/chatFeature', () => ({
  CHAT_FEATURE_ENABLED: true,
}));

import chatFoldersAPI from '../../api/chatFolders';

describe('useChatFoldersController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loadChatFolders applies payload to state setters', async () => {
    chatFoldersAPI.listFolders.mockResolvedValue({
      items: [{ id: 'f1', name: 'Work' }],
      conversation_ids_by_folder: { f1: ['c1'] },
    });
    const setCustomFolders = vi.fn();
    const setConversationIdsByFolder = vi.fn();
    const setFoldersLoading = vi.fn();

    const { result } = renderHook(() => useChatFoldersController({
      notifyApiError: vi.fn(),
      setCustomFolders,
      setConversationIdsByFolder,
      setFoldersLoading,
      setConversationFilter: vi.fn(),
    }));

    await waitFor(async () => {
      const items = await result.current.loadChatFolders();
      expect(items).toHaveLength(1);
    });

    expect(setCustomFolders).toHaveBeenCalled();
    expect(setConversationIdsByFolder).toHaveBeenCalled();
    expect(setFoldersLoading).toHaveBeenCalledWith(true);
    expect(setFoldersLoading).toHaveBeenCalledWith(false);
  });

  it('handleActiveFolderChange normalizes folder key', () => {
    const setConversationFilter = vi.fn();
    const { result } = renderHook(() => useChatFoldersController({
      notifyApiError: vi.fn(),
      setCustomFolders: vi.fn(),
      setConversationIdsByFolder: vi.fn(),
      setFoldersLoading: vi.fn(),
      setConversationFilter,
    }));

    result.current.handleActiveFolderChange('archived');
    expect(setConversationFilter).toHaveBeenCalledWith('archived');
  });
});
