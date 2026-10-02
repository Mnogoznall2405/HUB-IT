import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { useFocusEffect } from 'expo-router';
import type { ChatConversationSummary, ChatMessage } from '../../api/types';
import {
  applyReactionEnvelope,
  applyReadReceiptDelta,
  mergeMessages,
  messageFromEnvelope,
  resolveChatMessageIsOwn,
} from '../../chat/chatState';
import { chatSocket, shouldUseChatHttpFallback, type ChatSocketStatus } from '../../chat/chatSocket';
import { getActiveNativeChatConversationId } from '../../chat/chatActiveConversation';
import {
  applyTypingParticipant,
  parsePresenceEnvelope,
  parseTypingEnvelope,
} from '../../chat/chatTyping';
import { chatMessageMotionKey, type ChatMessageEnterKind } from '../../components/chat/ChatMessageEnterMotion';

/** chatSocket subscriptions for the open thread: status, created/updated/deleted,
 * reactions, typing, presence, plus the 15s HTTP fallback while disconnected. */
export function useThreadRealtime({
  conversationId,
  userId,
  offlineMode,
  hasNewer,
  mountedRef,
  markedReadRef,
  knownMessageIdsRef,
  messageAnimationReadyRef,
  messageEnterMotionsRef,
  nearBottomRef,
  loadGenerationRef,
  typingIdleRef,
  typingActiveRef,
  pendingAnchorTimerRef,
  highlightTimerRef,
  uploadControllersRef,
  downloadControllersRef,
  loadInitial,
  syncLatestMessages,
  markRead,
  requestBottomAnchor,
  setMessages,
  setConversation,
  setNewMessageCount,
  setShowJumpToBottom,
}: {
  conversationId: string;
  userId?: number;
  offlineMode: boolean;
  /** True while the loaded window is detached from the bottom of history
   * (search jump / mid-history focus): a fresh socket message then must not be
   * merged into the slice — it would land at data[0] next to unrelated items. */
  hasNewer: boolean;
  mountedRef: MutableRefObject<boolean>;
  markedReadRef: MutableRefObject<string>;
  knownMessageIdsRef: MutableRefObject<Set<string>>;
  messageAnimationReadyRef: MutableRefObject<boolean>;
  messageEnterMotionsRef: MutableRefObject<Map<string, ChatMessageEnterKind>>;
  nearBottomRef: MutableRefObject<boolean>;
  loadGenerationRef: MutableRefObject<number>;
  typingIdleRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  typingActiveRef: MutableRefObject<boolean>;
  pendingAnchorTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  highlightTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  uploadControllersRef: MutableRefObject<Map<string, AbortController>>;
  downloadControllersRef: MutableRefObject<Map<string, AbortController>>;
  loadInitial: () => Promise<void>;
  syncLatestMessages: () => Promise<void>;
  markRead: (latest?: ChatMessage | null) => void;
  requestBottomAnchor: () => void;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setConversation: Dispatch<SetStateAction<ChatConversationSummary | null>>;
  setNewMessageCount: Dispatch<SetStateAction<number>>;
  setShowJumpToBottom: Dispatch<SetStateAction<boolean>>;
}) {
  const [status, setStatus] = useState<ChatSocketStatus>(chatSocket.getStatus());
  const [typingParticipants, setTypingParticipants] = useState<Array<{ userId: number; name: string }>>([]);
  // M6: live AI run status line for the open conversation (chat.ai.run.updated).
  const [aiRunStatus, setAiRunStatus] = useState<{ botTitle: string; statusText: string; status: string } | null>(null);
  const connectedOnceRef = useRef(chatSocket.getStatus() === 'connected');
  const incomingTypingTimeoutsRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  // Socket handlers read the detached-window flag through a ref so a hasNewer
  // flip does not re-subscribe the conversation.
  const hasNewerRef = useRef(hasNewer);
  hasNewerRef.current = hasNewer;

  useEffect(() => {
    mountedRef.current = true;
    markedReadRef.current = '';
    void loadInitial();
    if (offlineMode) {
      setStatus('offline');
      return () => {
        mountedRef.current = false;
        loadGenerationRef.current += 1;
        incomingTypingTimeoutsRef.current.forEach((timer) => clearTimeout(timer));
        incomingTypingTimeoutsRef.current.clear();
        // An in-place conversationId switch keeps this state — drop the stale
        // typing line and AI status along with their timers.
        setTypingParticipants([]);
        setAiRunStatus(null);
        if (typingIdleRef.current) clearTimeout(typingIdleRef.current);
        if (pendingAnchorTimerRef.current) clearTimeout(pendingAnchorTimerRef.current);
        if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      };
    }
    chatSocket.subscribeConversation(conversationId);
    void chatSocket.connect();

    const offStatus = chatSocket.on('status', (next) => {
      const nextStatus = next as ChatSocketStatus;
      setStatus(nextStatus);
      if (nextStatus !== 'connected') return;
      if (connectedOnceRef.current) void syncLatestMessages();
      else connectedOnceRef.current = true;
    });
    const applyMessage = (envelope: unknown, countAsNew = false) => {
      const message = messageFromEnvelope(envelope);
      if (!message || message.conversation_id !== conversationId) return;
      const isNew = !knownMessageIdsRef.current.has(message.id);
      if (
        messageAnimationReadyRef.current
        && nearBottomRef.current
        && countAsNew
        && isNew
        && resolveChatMessageIsOwn(message, userId) !== true
      ) {
        messageEnterMotionsRef.current.set(chatMessageMotionKey(message), 'incoming');
      }
      knownMessageIdsRef.current.add(message.id);
      // Detached history window (hasNewer — a mid-history slice reached via a
      // search jump): merging would pin the fresh message at data[0] next to
      // unrelated older items. It only counts towards jump-to-bottom; the gap
      // is fetched by jumpToBottom/loadNewer. Attached == nearBottom && !hasNewer,
      // same invariant the scroll handler uses.
      const detached = hasNewerRef.current;
      if (!detached) {
        setMessages((current) => mergeMessages(current, message, userId));
      }
      if (!detached && nearBottomRef.current) {
        requestBottomAnchor();
        markRead(message);
      }
      else if (countAsNew && isNew) {
        setNewMessageCount((current) => current + 1);
        setShowJumpToBottom(true);
      }
    };
    const applyExisting = (envelope: unknown) => {
      const message = messageFromEnvelope(envelope);
      if (!message || message.conversation_id !== conversationId) return;
      // Edits/deletes only patch the loaded window: inserting a message the
      // user never loaded would place a stray bubble outside its page context.
      setMessages((current) => (
        current.some((item) => item.id === message.id)
          ? mergeMessages(current, message, userId)
          : current
      ));
    };
    const offCreated = chatSocket.on('chat.message.created', (envelope) => applyMessage(envelope, true));
    const offUpdated = chatSocket.on('chat.message.updated', applyExisting);
    const offDeleted = chatSocket.on('chat.message.deleted', applyExisting);
    const offReaction = chatSocket.on('chat.message.reaction', (envelope: unknown) => {
      setMessages((current) => applyReactionEnvelope(current, envelope).items);
    });
    // M1: room read receipts update the loaded window in place — no refetch.
    const offMessageRead = chatSocket.on('chat.message.read', (envelope: unknown) => {
      const event = envelope as { conversation_id?: string; payload?: Record<string, unknown> };
      const payload = event?.payload || {};
      const eventConversationId = String(payload.conversation_id || event?.conversation_id || '').trim();
      if (eventConversationId !== conversationId) return;
      setMessages((current) => applyReadReceiptDelta(current, payload, userId));
    });
    // M6: AI run lifecycle for this conversation → header status line; a
    // terminal event also triggers the message catch-up in case the reply
    // message event raced ahead of the status update.
    const offAiRun = chatSocket.on('chat.ai.run.updated', (envelope: unknown) => {
      const event = envelope as { conversation_id?: string; payload?: Record<string, unknown> };
      const payload = event?.payload || {};
      const eventConversationId = String(payload.conversation_id || event?.conversation_id || '').trim();
      if (eventConversationId !== conversationId) return;
      const aiStatus = String(payload.status || '').trim();
      const botTitle = String(payload.bot_title || '').trim();
      const statusText = String(payload.status_text || '').trim();
      const terminal = ['completed', 'failed', 'cancelled', 'succeeded', 'expired'].includes(aiStatus);
      if (!terminal) {
        setAiRunStatus({ botTitle, statusText, status: aiStatus });
      } else {
        setAiRunStatus(null);
        void syncLatestMessages();
      }
    });
    const applyTyping = (envelope: unknown) => {
      const parsed = parseTypingEnvelope(envelope);
      if (!parsed || parsed.conversationId !== conversationId || parsed.userId === Number(userId || 0)) {
        return;
      }
      const existing = incomingTypingTimeoutsRef.current.get(parsed.userId);
      if (existing) clearTimeout(existing);
      setTypingParticipants((current) => applyTypingParticipant(
        current,
        { userId: parsed.userId, name: parsed.name || 'Участник' },
        parsed.isTyping,
      ));
      if (parsed.isTyping) {
        incomingTypingTimeoutsRef.current.set(parsed.userId, setTimeout(() => {
          setTypingParticipants((current) => applyTypingParticipant(
            current,
            { userId: parsed.userId, name: parsed.name || 'Участник' },
            false,
          ));
          incomingTypingTimeoutsRef.current.delete(parsed.userId);
        }, parsed.expiresInMs));
      } else {
        incomingTypingTimeoutsRef.current.delete(parsed.userId);
      }
    };
    const offTypingStarted = chatSocket.on('chat.typing.started', applyTyping);
    const offTypingStopped = chatSocket.on('chat.typing.stopped', applyTyping);
    const offPresence = chatSocket.on('chat.presence.updated', (envelope: unknown) => {
      const parsed = parsePresenceEnvelope(envelope);
      if (!parsed) return;
      setConversation((current) => {
        if (!current) return current;
        if (current.direct_peer?.id === parsed.userId) {
          return { ...current, direct_peer: { ...current.direct_peer, presence: parsed.presence } };
        }
        // Presence frames for non-members must not allocate a new conversation
        // object — each one would re-render the whole thread screen.
        if (!current.members?.some((member) => member.user.id === parsed.userId)) return current;
        return {
          ...current,
          members: current.members.map((member) => (
            member.user.id === parsed.userId
              ? { ...member, user: { ...member.user, presence: parsed.presence } }
              : member
          )),
        };
      });
    });

    return () => {
      mountedRef.current = false;
      loadGenerationRef.current += 1;
      incomingTypingTimeoutsRef.current.forEach((timer) => clearTimeout(timer));
      incomingTypingTimeoutsRef.current.clear();
      // An in-place conversationId switch keeps this state — reset it here so
      // the next conversation does not inherit the typing line / AI status.
      setTypingParticipants([]);
      setAiRunStatus(null);
      if (typingIdleRef.current) clearTimeout(typingIdleRef.current);
      if (pendingAnchorTimerRef.current) clearTimeout(pendingAnchorTimerRef.current);
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      // Persisted uploads belong to the session delivery host.
      uploadControllersRef.current.clear();
      downloadControllersRef.current.forEach((controller) => controller.abort());
      downloadControllersRef.current.clear();
      if (typingActiveRef.current) chatSocket.sendTyping(conversationId, false);
      typingActiveRef.current = false;
      offStatus();
      offCreated();
      offUpdated();
      offDeleted();
      offReaction();
      offMessageRead();
      offAiRun();
      offTypingStarted();
      offTypingStopped();
      offPresence();
      chatSocket.unsubscribeConversation(conversationId);
    };
  }, [conversationId, loadInitial, markRead, offlineMode, requestBottomAnchor, syncLatestMessages, userId]);

  // Focus-scoped: pushed-over thread screens stay mounted — without this gate
  // every stacked screen would keep its own 15s poller while disconnected.
  useFocusEffect(useCallback(() => {
    if (offlineMode || !shouldUseChatHttpFallback(status)) return undefined;
    const syncIfActive = () => {
      if (getActiveNativeChatConversationId() === conversationId) void syncLatestMessages();
    };
    syncIfActive();
    const timer = setInterval(syncIfActive, 15_000);
    return () => clearInterval(timer);
  }, [conversationId, offlineMode, status, syncLatestMessages]));

  return { status, typingParticipants, aiRunStatus };
}
