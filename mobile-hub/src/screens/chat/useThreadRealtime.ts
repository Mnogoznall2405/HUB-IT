import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { ChatConversationSummary, ChatMessage } from '../../api/types';
import {
  applyReactionEnvelope,
  mergeMessages,
  messageFromEnvelope,
  resolveChatMessageIsOwn,
} from '../../chat/chatState';
import { chatSocket, shouldUseChatHttpFallback, type ChatSocketStatus } from '../../chat/chatSocket';
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
  const connectedOnceRef = useRef(chatSocket.getStatus() === 'connected');
  const incomingTypingTimeoutsRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());

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
      setMessages((current) => mergeMessages(current, message, userId));
      if (nearBottomRef.current) {
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
        }, 4000));
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
        if (!current.members?.length) return current;
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
      offTypingStarted();
      offTypingStopped();
      offPresence();
      chatSocket.unsubscribeConversation(conversationId);
    };
  }, [conversationId, loadInitial, markRead, offlineMode, requestBottomAnchor, syncLatestMessages, userId]);

  useEffect(() => {
    if (offlineMode || !shouldUseChatHttpFallback(status)) return undefined;
    void syncLatestMessages();
    const timer = setInterval(() => {
      void syncLatestMessages();
    }, 15_000);
    return () => clearInterval(timer);
  }, [offlineMode, status, syncLatestMessages]);

  return { status, typingParticipants };
}
