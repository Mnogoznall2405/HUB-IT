import { useEffect } from 'react';

export default function useMailMissingFolderFallback({
  folderTree,
  folder,
  clearSelection,
  setFolder,
} = {}) {
  useEffect(() => {
    if (!Array.isArray(folderTree) || folderTree.length === 0) return;
    const exists = folderTree.some((item) => String(item?.id || '') === String(folder || ''));
    if (!exists) {
      clearSelection({ allModes: true });
      setFolder('inbox');
    }
  }, [folderTree, folder, clearSelection]);
}
