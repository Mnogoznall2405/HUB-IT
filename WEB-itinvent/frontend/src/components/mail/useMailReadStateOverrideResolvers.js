import { useCallback } from 'react';

import {
  applyReadStateOverridesToConversationDetail,
  applyReadStateOverridesToListData,
  applyReadStateOverridesToMessageDetail,
  pruneLocalReadStateOverrides,
} from './mailReadStateModel';

export default function useMailReadStateOverrideResolvers({
  localReadStateOverridesRef,
  ttlMs,
  viewMode,
} = {}) {
  const pruneReadStateOverridesRef = useCallback(() => {
    localReadStateOverridesRef.current = pruneLocalReadStateOverrides({
      overrides: localReadStateOverridesRef.current,
      now: Date.now(),
      ttlMs,
    });
    return localReadStateOverridesRef.current;
  }, [localReadStateOverridesRef, ttlMs]);

  const resolveListDataReadStateOverrides = useCallback((nextListData, selectionMode = viewMode) => {
    const overrides = pruneReadStateOverridesRef();
    return applyReadStateOverridesToListData({
      listData: nextListData,
      selectionMode,
      overrides,
    });
  }, [pruneReadStateOverridesRef, viewMode]);

  const resolveMessageReadStateOverrides = useCallback((message) => {
    const overrides = pruneReadStateOverridesRef();
    return applyReadStateOverridesToMessageDetail({
      message,
      overrides,
    });
  }, [pruneReadStateOverridesRef]);

  const resolveConversationReadStateOverrides = useCallback((conversation) => {
    const overrides = pruneReadStateOverridesRef();
    return applyReadStateOverridesToConversationDetail({
      conversation,
      overrides,
    });
  }, [pruneReadStateOverridesRef]);

  return {
    pruneReadStateOverridesRef,
    resolveListDataReadStateOverrides,
    resolveMessageReadStateOverrides,
    resolveConversationReadStateOverrides,
  };
}
