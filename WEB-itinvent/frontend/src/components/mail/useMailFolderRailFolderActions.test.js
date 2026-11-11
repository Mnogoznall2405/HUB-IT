import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import useMailFolderRailFolderActions from './useMailFolderRailFolderActions';

describe('useMailFolderRailFolderActions', () => {
  it('closes mobile navigation before each folder mutation', async () => {
    const order = [];
    const closeMobileNavigationIfNeeded = vi.fn(() => order.push('close'));
    const handleOpenCreateFolderDialog = vi.fn(() => order.push('create'));
    const handleOpenRenameFolderDialog = vi.fn(() => order.push('rename'));
    const handleDeleteFolder = vi.fn(async () => {
      order.push('delete');
    });
    const handleToggleFavoriteFolder = vi.fn(async () => {
      order.push('favorite');
    });

    const { result } = renderHook(() => useMailFolderRailFolderActions({
      closeMobileNavigationIfNeeded,
      handleOpenCreateFolderDialog,
      handleOpenRenameFolderDialog,
      handleDeleteFolder,
      handleToggleFavoriteFolder,
    }));

    result.current.handleCreateFolderRequest('inbox');
    result.current.handleRenameFolderRequest({ id: 'folder-1' });
    await result.current.handleDeleteFolderRequest({ id: 'folder-2' });
    await result.current.handleToggleFavoriteFolderFromRail({ id: 'folder-3' });

    expect(handleOpenCreateFolderDialog).toHaveBeenCalledWith('inbox');
    expect(handleOpenRenameFolderDialog).toHaveBeenCalledWith({ id: 'folder-1' });
    expect(handleDeleteFolder).toHaveBeenCalledWith({ id: 'folder-2' });
    expect(handleToggleFavoriteFolder).toHaveBeenCalledWith({ id: 'folder-3' });
    expect(order).toEqual([
      'close', 'create',
      'close', 'rename',
      'close', 'delete',
      'close', 'favorite',
    ]);
  });
});
