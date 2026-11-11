import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import useMailMissingFolderFallback from './useMailMissingFolderFallback';

describe('useMailMissingFolderFallback', () => {
  it('resets to inbox when the current folder is gone from the tree', () => {
    const clearSelection = vi.fn();
    const setFolder = vi.fn();
    renderHook(() => useMailMissingFolderFallback({
      folderTree: [{ id: 'inbox' }, { id: 'sent' }],
      folder: 'projects',
      clearSelection,
      setFolder,
    }));
    expect(clearSelection).toHaveBeenCalledWith({ allModes: true });
    expect(setFolder).toHaveBeenCalledWith('inbox');
  });

  it('does nothing while the folder tree is empty or the folder still exists', () => {
    const clearSelection = vi.fn();
    const setFolder = vi.fn();
    renderHook(() => useMailMissingFolderFallback({
      folderTree: [],
      folder: 'projects',
      clearSelection,
      setFolder,
    }));
    renderHook(() => useMailMissingFolderFallback({
      folderTree: [{ id: 'sent' }],
      folder: 'sent',
      clearSelection,
      setFolder,
    }));
    expect(clearSelection).not.toHaveBeenCalled();
    expect(setFolder).not.toHaveBeenCalled();
  });
});
