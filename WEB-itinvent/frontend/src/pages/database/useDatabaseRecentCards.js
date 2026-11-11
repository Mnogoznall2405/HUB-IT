import { useCallback, useEffect, useState } from 'react';

import { equipmentAPI } from '../../api/client';

export const DATABASE_RECENT_CARDS_LIMIT = 8;

const normalizeItems = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
};

const normalizeInvNo = (value) => String(value ?? '').trim();

const upsertRecentCard = (items, nextItem) => {
  const invNo = normalizeInvNo(nextItem?.inv_no ?? nextItem?.INV_NO);
  if (!invNo) return items;
  const filtered = items.filter((item) => normalizeInvNo(item?.inv_no ?? item?.INV_NO) !== invNo);
  return [nextItem, ...filtered].slice(0, DATABASE_RECENT_CARDS_LIMIT);
};

export function useDatabaseRecentCards({
  enabled = true,
  dbName = '',
  limit = DATABASE_RECENT_CARDS_LIMIT,
} = {}) {
  const [recentCards, setRecentCards] = useState([]);
  const [recentCardsLoading, setRecentCardsLoading] = useState(false);

  const refreshRecentCards = useCallback(async () => {
    if (!enabled) {
      setRecentCards([]);
      setRecentCardsLoading(false);
      return [];
    }

    setRecentCardsLoading(true);
    try {
      const payload = await equipmentAPI.getRecentCards({ limit });
      const items = normalizeItems(payload);
      setRecentCards(items);
      return items;
    } catch (error) {
      console.warn('Failed to load recent equipment cards', error);
      setRecentCards([]);
      return [];
    } finally {
      setRecentCardsLoading(false);
    }
  }, [enabled, limit]);

  const touchRecentCard = useCallback(async ({
    invNo,
    actionType = 'view',
    snapshot = null,
  } = {}) => {
    const normalizedInvNo = normalizeInvNo(invNo ?? snapshot?.inv_no ?? snapshot?.INV_NO);
    if (!enabled || !normalizedInvNo) return null;

    try {
      const item = await equipmentAPI.touchRecentCard({
        invNo: normalizedInvNo,
        actionType,
        snapshot,
      });
      setRecentCards((prev) => upsertRecentCard(prev, item));
      return item;
    } catch (error) {
      console.warn('Failed to record recent equipment card activity', error);
      return null;
    }
  }, [enabled]);

  const removeRecentCard = useCallback(async (invNo) => {
    const normalizedInvNo = normalizeInvNo(invNo);
    if (!normalizedInvNo) return null;

    setRecentCards((prev) => (
      prev.filter((item) => normalizeInvNo(item?.inv_no ?? item?.INV_NO) !== normalizedInvNo)
    ));
    try {
      return await equipmentAPI.removeRecentCard(normalizedInvNo);
    } catch (error) {
      console.warn('Failed to remove recent equipment card', error);
      return null;
    }
  }, []);

  const clearRecentCards = useCallback(async () => {
    setRecentCards([]);
    try {
      return await equipmentAPI.clearRecentCards();
    } catch (error) {
      console.warn('Failed to clear recent equipment cards', error);
      return null;
    }
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!enabled) {
        setRecentCards([]);
        setRecentCardsLoading(false);
        return;
      }

      setRecentCardsLoading(true);
      try {
        const payload = await equipmentAPI.getRecentCards({ limit });
        if (active) {
          setRecentCards(normalizeItems(payload));
        }
      } catch (error) {
        console.warn('Failed to load recent equipment cards', error);
        if (active) {
          setRecentCards([]);
        }
      } finally {
        if (active) {
          setRecentCardsLoading(false);
        }
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [dbName, enabled, limit]);

  return {
    recentCards,
    recentCardsLoading,
    refreshRecentCards,
    touchRecentCard,
    removeRecentCard,
    clearRecentCards,
  };
}

export default useDatabaseRecentCards;
