import { useCallback } from 'react';
import {
  getMailRecentMessageDetail,
  writeMailRecentBootstrap,
  writeMailRecentList,
  writeMailRecentMessageDetail,
} from '../../lib/mailRecentCache';
import { normalizeMailListResponse } from './mailListModel';

export default function useMailRecentSnapshots({ scope, initialScope } = {}) {
  const persistBootstrapSnapshot = useCallback((nextFolderSummary, nextFolderTree, overrideScope = scope) => {
    writeMailRecentBootstrap({
      scope: overrideScope || scope,
      folderSummary: nextFolderSummary,
      folderTree: nextFolderTree,
    });
  }, [scope]);

  const persistListSnapshot = useCallback((contextKey, nextListData, overrideScope = scope) => {
    const normalizedContextKey = String(contextKey || '').trim();
    if (!normalizedContextKey) return;

    writeMailRecentList({
      scope: overrideScope || scope,
      contextKey: normalizedContextKey,
      listData: normalizeMailListResponse(nextListData),
    });
  }, [scope]);

  const persistMessageDetailSnapshot = useCallback((detailPayload) => {
    if (!detailPayload || typeof detailPayload !== 'object') return;
    const normalizedMessageId = String(detailPayload?.id || '').trim();
    if (!normalizedMessageId) return;

    writeMailRecentMessageDetail({
      scope,
      message: detailPayload,
    });
  }, [scope]);

  const getMessageDetailSnapshot = useCallback((messageId) => {
    const fromCurrentScope = getMailRecentMessageDetail({
      scope,
      messageId,
    });
    if (fromCurrentScope) return fromCurrentScope;

    if (initialScope && initialScope !== scope) {
      return getMailRecentMessageDetail({
        scope: initialScope,
        messageId,
      });
    }

    return null;
  }, [initialScope, scope]);

  return {
    persistBootstrapSnapshot,
    persistListSnapshot,
    persistMessageDetailSnapshot,
    getMessageDetailSnapshot,
  };
}
