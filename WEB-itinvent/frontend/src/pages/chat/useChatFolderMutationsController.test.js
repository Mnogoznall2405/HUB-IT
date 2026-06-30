import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import useChatFolderMutationsController from './useChatFolderMutationsController';

vi.mock('../../api/chatFolders', () => ({
  default: {
    createFolder: vi.fn(),
    updateFolder: vi.fn(),
    deleteFolder: vi.fn(),
    removeFolderConversation: vi.fn(),
    addFolderConversation: vi.fn(),
  },
}));

import chatFoldersAPI from '../../api/chatFolders';

function buildArgs(overrides = {}) {
  return {
    conversationFilter: 'all',
    customFolders: [{ id: 'f1' }, { id: 'f2' }],
    handleActiveFolderChange: vi.fn(),
    loadChatFolders: vi.fn().mockResolvedValue([]),
    notifyApiError: vi.fn(),
    setFolderManagerCreateMode: vi.fn(),
    setFolderManagerOpen: vi.fn(),
    setFolderSaving: vi.fn(),
    ...overrides,
  };
}

describe('useChatFolderMutationsController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handleOpenFolderManager opens manager and optional create mode', () => {
    const setFolderManagerCreateMode = vi.fn();
    const setFolderManagerOpen = vi.fn();
    const { result } = renderHook(() => useChatFolderMutationsController(buildArgs({
      setFolderManagerCreateMode,
      setFolderManagerOpen,
    })));

    act(() => {
      result.current.handleOpenFolderManager({ create: true });
    });

    expect(setFolderManagerCreateMode).toHaveBeenCalledWith(true);
    expect(setFolderManagerOpen).toHaveBeenCalledWith(true);
  });

  it('handleCreateChatFolder creates folder and reloads list', async () => {
    chatFoldersAPI.createFolder.mockResolvedValue({ id: 'f3' });
    const loadChatFolders = vi.fn().mockResolvedValue([]);
    const setFolderSaving = vi.fn();

    const { result } = renderHook(() => useChatFolderMutationsController(buildArgs({
      loadChatFolders,
      setFolderSaving,
    })));

    await act(async () => {
      await result.current.handleCreateChatFolder('Work');
    });

    expect(chatFoldersAPI.createFolder).toHaveBeenCalledWith('Work');
    expect(loadChatFolders).toHaveBeenCalledWith({ silent: true });
    expect(setFolderSaving).toHaveBeenCalledWith(true);
    expect(setFolderSaving).toHaveBeenCalledWith(false);
  });

  it('handleDeleteChatFolder resets filter when deleting active folder', async () => {
    chatFoldersAPI.deleteFolder.mockResolvedValue({});
    const handleActiveFolderChange = vi.fn();
    const loadChatFolders = vi.fn().mockResolvedValue([]);

    const { result } = renderHook(() => useChatFolderMutationsController(buildArgs({
      conversationFilter: 'f1',
      handleActiveFolderChange,
      loadChatFolders,
    })));

    await act(async () => {
      await result.current.handleDeleteChatFolder('f1');
    });

    expect(handleActiveFolderChange).toHaveBeenCalledWith('all');
    expect(chatFoldersAPI.deleteFolder).toHaveBeenCalledWith('f1');
  });
});
