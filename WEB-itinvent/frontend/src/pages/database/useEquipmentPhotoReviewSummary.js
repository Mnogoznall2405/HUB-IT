import { useCallback, useEffect, useRef, useState } from 'react';

import { equipmentPhotoReviewAPI } from '../../api/equipmentPhotoReview';

// Счётчики очереди проверки фото для бейджа. enabled=false — запросов нет вовсе.
export default function useEquipmentPhotoReviewSummary({ enabled = false, dbId = '' } = {}) {
  const [summary, setSummary] = useState(null);
  const requestRef = useRef(0);

  const refresh = useCallback(async ({ force = false } = {}) => {
    if (!enabled) return;
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    try {
      const data = await equipmentPhotoReviewAPI.summary({ refresh: force, dbId });
      if (requestRef.current === requestId) setSummary(data);
    } catch {
      // Бейдж вспомогательный: при ошибке остаётся прежнее значение.
    }
  }, [dbId, enabled]);

  useEffect(() => {
    if (!enabled) {
      setSummary(null);
      return undefined;
    }
    void refresh();
    return () => { requestRef.current += 1; };
  }, [enabled, refresh]);

  return { summary, refresh };
}
