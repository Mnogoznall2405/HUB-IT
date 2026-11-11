import { useEffect } from 'react';

export default function useMailSelectedByModeSync({
  selectedId,
  viewMode,
  setSelectedByMode,
} = {}) {
  useEffect(() => {
    const current = String(selectedId || '');
    setSelectedByMode((prev) => {
      if (String(prev?.[viewMode] || '') === current) return prev;
      return { ...(prev || {}), [viewMode]: current };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, viewMode]);
}
