import { useCallback, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { Alert } from 'react-native';
import {
  bulkMailMessageAction,
  getMailConversation,
  getMailMessages,
  markAllMailMessagesRead,
  type MailMessagePreview,
} from '../api/mailApi';
import { formatApiError } from '../api/formatError';
import { mailFolderLabel } from './nativeMailModel';
import type { NativeMailUndo } from './nativeMailUndo';
import type { MailListItem, MailViewMode } from './useMailList';

const CONVERSATION_FETCH_BATCH = 4;
const EMPTY_TRASH_PAGE_SIZE = 200;
const EMPTY_TRASH_MAX_MESSAGES = 1000;
const EMPTY_TRASH_BULK_CHUNK = 200;

function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function bulkUndoLabel(action: 'read' | 'unread' | 'move' | 'delete', count: number, targetFolder: string): string {
  const countLabel = `${count} ${plural(count, 'письмо', 'письма', 'писем')}`;
  if (action === 'read') return `${countLabel} отмечены прочитанными.`;
  if (action === 'unread') return `${countLabel} отмечены непрочитанными.`;
  if (action === 'delete') return `${countLabel} перемещены в удалённые.`;
  return `${countLabel} перемещены в папку «${mailFolderLabel(targetFolder)}».`;
}

export function useMailSelection(options: {
  items: MailListItem[];
  selected: Set<string>;
  setSelected: Dispatch<SetStateAction<Set<string>>>;
  view: MailViewMode;
  folder: string;
  mailboxId: string;
  offlineMode: boolean;
  listScope: string;
  listGeneration: number;
  listGenerationRef: MutableRefObject<number>;
  applyUnreadDelta: (delta: number, mailboxId: string) => void;
  load: (options: { reset: boolean; refresh?: boolean; silent?: boolean }) => Promise<void>;
  setError: (value: string) => void;
  setUndo: (value: NativeMailUndo | null) => void;
}) {
  const {
    items,
    selected,
    setSelected,
    view,
    folder,
    mailboxId,
    offlineMode,
    listScope,
    listGeneration,
    listGenerationRef,
    applyUnreadDelta,
    load,
    setError,
    setUndo,
  } = options;
  const [bulkBusy, setBulkBusy] = useState(false);
  const bulkBusyRef = useRef(false);
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const selectionKey = JSON.stringify([...selected].sort());
  const selectionKeyRef = useRef(selectionKey);
  const selectionGenerationRef = useRef(0);
  if (selectionKeyRef.current !== selectionKey) selectionGenerationRef.current += 1;
  selectionKeyRef.current = selectionKey;
  const selectionGeneration = selectionGenerationRef.current;

  const toggleSelected = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, [setSelected]);

  const selectionMode = selected.size > 0;

  const selectedHasUnread = useMemo(() => items.some((entry) => (
    entry.kind === 'message' ? selected.has(entry.value.id) && entry.value.is_read === false : selected.has(entry.value.conversation_id) && Number(entry.value.unread_count) > 0
  )), [items, selected]);

  /** Expands selected conversation ids into message ids in bounded parallel batches.
   *  Failed or incomplete conversations stay selected and are reported per item. */
  const expandConversationSelection = useCallback(async (conversationIds: string[]): Promise<{
    messages: MailMessagePreview[];
    byConversation: Map<string, string[]>;
    skipped: string[];
  }> => {
    const messages = new Map<string, MailMessagePreview>();
    const byConversation = new Map<string, string[]>();
    const skipped: string[] = [];
    for (let index = 0; index < conversationIds.length; index += CONVERSATION_FETCH_BATCH) {
      const chunk = conversationIds.slice(index, index + CONVERSATION_FETCH_BATCH);
      const results = await Promise.allSettled(chunk.map((id) => getMailConversation(id, { mailboxId, folder, folderScope: 'current' })));
      if (listGeneration !== listGenerationRef.current) return { messages: [], byConversation, skipped: [] };
      results.forEach((result, resultIndex) => {
        const conversationId = chunk[resultIndex];
        if (result.status === 'fulfilled' && result.value.conversation_complete === true) {
          const messageIds: string[] = [];
          for (const message of result.value.items) {
            messages.set(message.id, message);
            messageIds.push(message.id);
          }
          byConversation.set(conversationId, messageIds);
        } else {
          skipped.push(conversationId);
        }
      });
    }
    return { messages: [...messages.values()], byConversation, skipped };
  }, [folder, listGeneration, listGenerationRef, mailboxId]);

  const runBulk = useCallback(async (action: 'read' | 'unread' | 'delete' | 'move', targetFolder = '', permanent = false) => {
    let ids = [...selected];
    if (!ids.length || bulkBusyRef.current || bulkBusy || offlineMode || listGeneration !== listGenerationRef.current) return;
    bulkBusyRef.current = true;
    setBulkBusy(true);
    setError('');
    try {
      let selectedMessages = items.filter((entry): entry is Extract<MailListItem, { kind: 'message' }> => (
        entry.kind === 'message' && selected.has(entry.value.id)
      ));
      let skippedConversationIds: string[] = [];
      let byConversation = new Map<string, string[]>();
      if (view === 'conversations') {
        const expanded = await expandConversationSelection(ids);
        if (listGeneration !== listGenerationRef.current) return;
        skippedConversationIds = expanded.skipped;
        byConversation = expanded.byConversation;
        ids = expanded.messages.map((message) => message.id);
        selectedMessages = expanded.messages.map((value) => ({ kind: 'message' as const, key: `m:${value.id}`, value }));
        if (!ids.length) {
          if (!skippedConversationIds.length) setSelected(new Set());
          setError(skippedConversationIds.length
            ? 'Не удалось получить цепочку целиком. Действие не выполнено. Повторите позже или выберите отдельные письма.'
            : 'В выбранных цепочках нет писем текущей папки.');
          return;
        }
      }
      if (listGeneration !== listGenerationRef.current) return;
      const result = await bulkMailMessageAction({ mailboxId, action, messageIds: ids, targetFolder, permanent });
      if (listGeneration !== listGenerationRef.current) return;
      const failed = Math.max(0, Number(result.failed || 0));
      if (result.ok === false || failed > 0) {
        const failedIds = Array.isArray(result.errors)
          ? result.errors.map((entry) => String((entry as { message_id?: unknown })?.message_id || '')).filter(Boolean)
          : [];
        if (view === 'conversations') {
          if (!failedIds.length) {
            setSelected(new Set([...selected]));
          } else {
            const failedIdSet = new Set(failedIds);
            const failedConversationIds = new Set(skippedConversationIds);
            for (const [conversationId, messageIds] of byConversation) {
              if (messageIds.some((id) => failedIdSet.has(id))) failedConversationIds.add(conversationId);
            }
            setSelected(new Set([...selected].filter((id) => failedConversationIds.has(id))));
          }
        } else {
          setSelected(new Set(failedIds.length ? failedIds : ids));
        }
        await load({ reset: true });
        if (listGeneration !== listGenerationRef.current) return;
        setError(failed ? `Не удалось применить действие к ${failed} ${failed === 1 ? 'письму' : 'письмам'}.` : 'Не удалось применить действие к выбранным письмам.');
        return;
      }
      const selectedUnread = selectedMessages.filter((entry) => entry.value.is_read === false).length;
      const selectedRead = selectedMessages.length - selectedUnread;
      let appliedUnreadDelta = 0;
      if (action === 'read') appliedUnreadDelta = -selectedUnread;
      else if (action === 'unread') appliedUnreadDelta = selectedRead;
      else if (folder === 'inbox' && (action === 'delete' || action === 'move')) appliedUnreadDelta = -selectedUnread;
      if (appliedUnreadDelta) applyUnreadDelta(appliedUnreadDelta, mailboxId);
      if (permanent) {
        setUndo(null);
      } else {
        const undoIds = (Array.isArray(result.results) ? result.results : [])
          .map((entry) => String((entry as { result?: { message_id?: unknown } })?.result?.message_id || ''))
          .filter(Boolean);
        setUndo({
          kind: 'bulk',
          scope: listScope,
          mailboxId,
          action,
          messageIds: ids,
          undoIds: undoIds.length === ids.length ? undoIds : ids,
          sourceFolder: folder,
          unreadDelta: appliedUnreadDelta,
          label: bulkUndoLabel(action, ids.length, targetFolder),
        });
      }
      setSelected(new Set(skippedConversationIds));
      await load({ reset: true });
      if (listGeneration !== listGenerationRef.current) return;
      if (skippedConversationIds.length) {
        setError(`Действие не применено к ${skippedConversationIds.length} ${skippedConversationIds.length === 1 ? 'цепочке' : 'цепочкам'} — они остались выбранными.`);
      }
    } catch (cause) {
      if (listGeneration === listGenerationRef.current) setError(formatApiError(cause, 'Не удалось применить действие к письмам.'));
    } finally {
      bulkBusyRef.current = false;
      setBulkBusy(false);
    }
  }, [listGeneration, view, applyUnreadDelta, bulkBusy, expandConversationSelection, folder, items, listScope, load, mailboxId, offlineMode, selected, setError, setSelected, setUndo]);

  const confirmDelete = useCallback(() => {
    const permanent = folder === 'trash';
    Alert.alert(permanent ? 'Удалить выбранные письма навсегда?' : 'Удалить выбранные письма?', permanent ? 'Это действие нельзя отменить.' : 'Письма будут перемещены в папку «Удалённые».', [
      { text: 'Отмена', style: 'cancel' },
      { text: permanent ? 'Удалить навсегда' : 'Удалить', style: 'destructive', onPress: () => { if (selectionGeneration === selectionGenerationRef.current) void runBulk('delete', '', permanent); } },
    ]);
  }, [folder, runBulk, selectionGeneration]);

  const markAllRead = useCallback(async (currentFolderUnread: number) => {
    if (bulkBusy || offlineMode) return;
    setBulkBusy(true);
    setError('');
    try {
      const result = await markAllMailMessagesRead({ mailboxId, folder, folderScope: 'current' });
      const changed = Math.max(0, Number(result.changed ?? result.affected ?? currentFolderUnread));
      applyUnreadDelta(-changed, mailboxId);
      await load({ reset: true });
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось отметить папку прочитанной.'));
    } finally {
      setBulkBusy(false);
    }
  }, [applyUnreadDelta, bulkBusy, folder, load, mailboxId, offlineMode, setError]);

  const emptyTrash = useCallback(() => {
    if (folder !== 'trash' || bulkBusy || offlineMode) return;
    Alert.alert('Очистить корзину?', 'Все письма в папке «Удалённые» будут удалены навсегда. Это действие нельзя отменить.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить всё навсегда',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            bulkBusyRef.current = true;
            setBulkBusy(true);
            setError('');
            setUndo(null);
            setSelected(new Set());
            try {
              const ids: string[] = [];
              let offset = 0;
              for (;;) {
                const page = await getMailMessages({ mailboxId, folder: 'trash', limit: EMPTY_TRASH_PAGE_SIZE, offset });
                if (listGeneration !== listGenerationRef.current) return;
                ids.push(...page.items.map((item) => item.id));
                if (!page.has_more || !page.items.length || ids.length >= EMPTY_TRASH_MAX_MESSAGES) break;
                offset += page.items.length;
              }
              if (!ids.length) {
                setError('В корзине нет писем.');
                return;
              }
              for (let index = 0; index < ids.length; index += EMPTY_TRASH_BULK_CHUNK) {
                const result = await bulkMailMessageAction({
                  mailboxId,
                  action: 'delete',
                  messageIds: ids.slice(index, index + EMPTY_TRASH_BULK_CHUNK),
                  permanent: true,
                });
                if (listGeneration !== listGenerationRef.current) return;
                if (result.ok === false || Number(result.failed || 0) > 0) {
                  setError(`Удалено ${index} из ${ids.length} писем. Повторите очистку корзины.`);
                  await load({ reset: true });
                  return;
                }
              }
              await load({ reset: true });
            } catch (cause) {
              if (listGeneration === listGenerationRef.current) setError(formatApiError(cause, 'Не удалось очистить корзину.'));
            } finally {
              bulkBusyRef.current = false;
              setBulkBusy(false);
            }
          })();
        },
      },
    ]);
  }, [bulkBusy, folder, listGeneration, listGenerationRef, load, mailboxId, offlineMode, setError, setSelected, setUndo]);

  return {
    selected,
    setSelected,
    toggleSelected,
    selectionMode,
    selectedHasUnread,
    selectionGeneration,
    selectionGenerationRef,
    bulkBusy,
    bulkBusyRef,
    bulkMoveOpen,
    setBulkMoveOpen,
    runBulk,
    confirmDelete,
    markAllRead,
    emptyTrash,
  };
}
