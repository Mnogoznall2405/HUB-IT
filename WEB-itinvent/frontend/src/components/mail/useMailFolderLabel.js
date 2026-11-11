import { useCallback } from 'react';

import { getMailFolderLabel } from './mailFolderTreeModel';

export default function useMailFolderLabel(folderLabelMapRef) {
  return useCallback(
    (folderId) => getMailFolderLabel(folderId, folderLabelMapRef.current),
    // Map is stored on a ref so the callback can stay stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
}
