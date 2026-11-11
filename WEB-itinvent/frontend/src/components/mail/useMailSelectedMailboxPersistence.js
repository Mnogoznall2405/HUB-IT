import { useEffect } from 'react';

import { writeStoredSelectedMailboxId } from './mailMailboxModel';

export default function useMailSelectedMailboxPersistence({
  activeMailboxId,
  persistSelectedMailboxId = writeStoredSelectedMailboxId,
} = {}) {
  useEffect(() => {
    if (activeMailboxId) {
      persistSelectedMailboxId(activeMailboxId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMailboxId]);
}
