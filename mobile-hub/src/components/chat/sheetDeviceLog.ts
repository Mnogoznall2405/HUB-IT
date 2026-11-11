import { useCallback, useEffect, useRef } from 'react';
import { logChatDevice } from '../../diagnostics/chatDeviceLog';

export type SheetDeviceName = 'forward' | 'new_chat' | 'group_edit' | 'folders';
export type SheetCloseReason = 'button' | 'backdrop' | 'back' | 'gesture' | 'done';

/**
 * Device-check journal for a sheet (fixed tokens only, no text or ids):
 * `sheet_open` when `visible` turns true, `sheet_close` when it turns false or
 * the owner unmounts while open. The close reason is the one the sheet marked
 * just before a user-initiated close, `done` when nothing was marked (the owner
 * closed it, e.g. after a successful action).
 *
 * Returns `markClose`. Call it only when the close will actually happen: a mark
 * left behind by a refused close would be reported by the next close.
 */
export function useSheetDeviceLog(sheet: SheetDeviceName, visible: boolean) {
  const reason = useRef<SheetCloseReason | null>(null);
  useEffect(() => {
    if (!visible) return undefined;
    const openedAt = Date.now();
    reason.current = null;
    logChatDevice('sheet_open', { sheet });
    return () => {
      logChatDevice('sheet_close', {
        sheet,
        reason: reason.current ?? 'done',
        ms: Date.now() - openedAt,
      });
      reason.current = null;
    };
  }, [sheet, visible]);
  return useCallback((next: SheetCloseReason) => {
    reason.current = next;
  }, []);
}
