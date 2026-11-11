import { useCallback, useEffect, useRef, useState } from 'react';
import type { EquipmentRecord } from '../api/databaseApi';
import { writeNativeEntitySnapshot } from '../cache/nativeSnapshotCache';
import type { InventoryQrPayload } from './nativeDatabaseModel';

export const SCAN_BATCH_LIMIT = 100;

export type ScanBatchItemStatus = 'ready' | 'missing' | 'offline-missing';

export type ScanBatchItem = {
  invNo: string;
  databaseId: string;
  equipment: EquipmentRecord | null;
  status: ScanBatchItemStatus;
};

export type ScanBatchAddResult =
  | { kind: 'added'; item: ScanBatchItem }
  | { kind: 'duplicate'; invNo: string }
  | { kind: 'different-database'; databaseId: string }
  | { kind: 'limit' }
  | { kind: 'consumable' }
  | { kind: 'invalid' }
  | { kind: 'cancelled' }
  | { kind: 'error' };

type ScanBatchSnapshot = { items: ScanBatchItem[] };

// Stored under the shared database-item-details entity scope so the batch is
// wiped together with the rest of the offline snapshots on logout.
export function scanBatchSnapshotKey(databaseId: string): string {
  return `scan-batch:${databaseId}`;
}

function normalizeInvNo(value: string): string {
  return String(value || '').trim().toLocaleUpperCase('ru-RU');
}

export function useNativeScanBatch({
  userId,
  databaseId,
  offlineMode,
  resolveEquipment,
}: {
  userId: number;
  databaseId: string;
  offlineMode: boolean;
  resolveEquipment: (invNo: string, databaseId: string) => Promise<EquipmentRecord | null>;
}) {
  const [items, setItems] = useState<ScanBatchItem[]>([]);
  const itemsRef = useRef<ScanBatchItem[]>([]);
  const pendingRef = useRef(new Map<string, { databaseId: string; token: number }>());
  const epochRef = useRef(0);
  const requestTokenRef = useRef(0);
  const mountedRef = useRef(false);
  const hadItemsRef = useRef(false);
  const [restored, setRestored] = useState(false);

  const setBatch = useCallback((updater: (current: ScanBatchItem[]) => ScanBatchItem[]) => {
    itemsRef.current = updater(itemsRef.current);
    setItems(itemsRef.current);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      epochRef.current += 1;
    };
  }, []);

  // Ш5-8: список больше не переживает открытия — снимок только записывается
  // (пустым после clear/сброса), но не восстанавливается. Новое открытие экрана
  // и сканера всегда начинается с пустого списка.
  useEffect(() => {
    epochRef.current += 1;
    itemsRef.current = [];
    pendingRef.current.clear();
    hadItemsRef.current = false;
    setItems([]);
    setRestored(true);
  }, [userId, databaseId]);

  useEffect(() => {
    if (!restored || !userId || !databaseId) return;
    if (items.length) hadItemsRef.current = true;
    else if (!hadItemsRef.current) return;
    void writeNativeEntitySnapshot<ScanBatchSnapshot>(
      'database-item-details',
      userId,
      scanBatchSnapshotKey(databaseId),
      { items },
    ).catch(() => undefined);
  }, [items, restored, userId, databaseId]);

  const add = useCallback(async (payload: InventoryQrPayload): Promise<ScanBatchAddResult> => {
    if (payload.kind === 'consumable') return { kind: 'consumable' };
    const invNo = payload.inventoryNumber.trim();
    if (!invNo) return { kind: 'invalid' };
    const normalized = normalizeInvNo(invNo);
    const targetDatabaseId = String(payload.databaseId || databaseId || '').trim();
    const batchDatabaseId = itemsRef.current[0]?.databaseId
      || pendingRef.current.values().next().value?.databaseId
      || '';
    if (batchDatabaseId && targetDatabaseId !== batchDatabaseId) {
      return { kind: 'different-database', databaseId: targetDatabaseId };
    }
    if (
      pendingRef.current.has(normalized)
      || itemsRef.current.some((item) => normalizeInvNo(item.invNo) === normalized)
    ) {
      return { kind: 'duplicate', invNo };
    }
    if (itemsRef.current.length + pendingRef.current.size >= SCAN_BATCH_LIMIT) {
      return { kind: 'limit' };
    }
    const epoch = epochRef.current;
    const token = ++requestTokenRef.current;
    const isCurrent = () => mountedRef.current && epochRef.current === epoch;
    pendingRef.current.set(normalized, { databaseId: targetDatabaseId, token });
    try {
      let equipment: EquipmentRecord | null;
      try {
        equipment = await resolveRef.current(invNo, targetDatabaseId);
      } catch {
        return { kind: isCurrent() ? 'error' : 'cancelled' };
      }
      if (!isCurrent()) return { kind: 'cancelled' };
      const item: ScanBatchItem = {
        invNo,
        databaseId: targetDatabaseId,
        equipment,
        status: equipment ? 'ready' : (offlineMode ? 'offline-missing' : 'missing'),
      };
      setBatch((current) => [item, ...current]);
      return { kind: 'added', item };
    } finally {
      const pending = pendingRef.current.get(normalized);
      if (pending?.token === token) pendingRef.current.delete(normalized);
    }
  }, [databaseId, offlineMode, setBatch]);

  // Ш5-2/Ш5-5: rows resolved only from offline snapshots stay 'offline-missing'
  // forever. When connectivity comes back, re-resolve them online in order.
  // The resolver lives in a ref: the screen rebuilds it when the equipment list
  // reloads, and a new identity must not cancel the in-flight refresh.
  const resolveRef = useRef(resolveEquipment);
  useEffect(() => { resolveRef.current = resolveEquipment; }, [resolveEquipment]);

  const offlineRef = useRef(offlineMode);
  useEffect(() => {
    const wasOffline = offlineRef.current;
    offlineRef.current = offlineMode;
    if (wasOffline !== true || offlineMode) return;
    let cancelled = false;
    const epoch = epochRef.current;
    const stale = () => cancelled || !mountedRef.current || epochRef.current !== epoch;
    const refresh = async () => {
      for (const item of itemsRef.current.filter((entry) => entry.status !== 'ready')) {
        if (stale()) return;
        let equipment: EquipmentRecord | null;
        try {
          equipment = await resolveRef.current(item.invNo, item.databaseId);
        } catch {
          continue;
        }
        if (stale()) return;
        const normalized = normalizeInvNo(item.invNo);
        setBatch((current) => current.map((entry) => (
          normalizeInvNo(entry.invNo) === normalized
            ? { ...entry, equipment, status: equipment ? 'ready' : 'missing' }
            : entry
        )));
      }
    };
    void refresh();
    return () => { cancelled = true; };
  }, [offlineMode, userId, databaseId, setBatch]);

  const remove = useCallback((invNo: string) => {
    const normalized = normalizeInvNo(invNo);
    setBatch((current) => current.filter((item) => normalizeInvNo(item.invNo) !== normalized));
  }, [setBatch]);

  const clear = useCallback(() => {
    epochRef.current += 1;
    pendingRef.current.clear();
    setBatch(() => []);
  }, [setBatch]);

  const keepOnly = useCallback((invNos: readonly string[]) => {
    epochRef.current += 1;
    pendingRef.current.clear();
    const keep = new Set(invNos.map(normalizeInvNo));
    setBatch((current) => current.filter((item) => keep.has(normalizeInvNo(item.invNo))));
  }, [setBatch]);

  const readyItems = items.filter((item) => item.status === 'ready' && item.equipment);

  return { items, readyItems, add, remove, clear, keepOnly };
}
