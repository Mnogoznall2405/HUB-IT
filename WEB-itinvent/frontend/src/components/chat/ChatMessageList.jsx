import { memo, useMemo } from 'react';
import {
  Avatar,
  Box,
  Button,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';

import { MemoChatBubble } from './ChatBubble';
import ChatFileUploadPanel from './ChatFileUploadPanel';
import {
  buildTimelineItems,
  getDateDividerLabel,
} from './chatHelpers';

const GROUP_WINDOW_MS = 10 * 60 * 1000;

export function shouldGroupMessages(previousMessage, nextMessage) {
  if (!previousMessage || !nextMessage) return false;
  if (Boolean(previousMessage?.is_own) !== Boolean(nextMessage?.is_own)) return false;
  if (String(previousMessage?.kind || '') !== String(nextMessage?.kind || '')) return false;
  const previousSenderId = String(previousMessage?.sender?.id || previousMessage?.sender_id || '').trim();
  const nextSenderId = String(nextMessage?.sender?.id || nextMessage?.sender_id || '').trim();
  if ((previousSenderId || nextSenderId) && previousSenderId !== nextSenderId) return false;
  const previousDate = new Date(previousMessage?.created_at || '');
  const nextDate = new Date(nextMessage?.created_at || '');
  if (Number.isNaN(previousDate.getTime()) || Number.isNaN(nextDate.getTime())) return false;
  if (previousDate.toDateString() !== nextDate.toDateString()) return false;
  return (nextDate.getTime() - previousDate.getTime()) <= GROUP_WINDOW_MS;
}

function ChatSkeleton({ width = '100%', height = 16, radius = 999, sx = {} }) {
  return (
    <Skeleton
      variant="rounded"
      animation="wave"
      width={width}
      height={height}
      sx={{
        borderRadius: radius,
        bgcolor: 'var(--chat-skeleton-base, rgba(148,163,184,0.16))',
        '&::after': {
          background: 'linear-gradient(90deg, transparent, var(--chat-skeleton-wave, rgba(255,255,255,0.36)), transparent)',
        },
        ...sx,
      }}
    />
  );
}

function ThreadLoadingSkeleton({ compactMobile = false }) {
  const rows = compactMobile
    ? [
      { side: 'left', width: '64%', lines: [0.72, 0.42] },
      { side: 'right', width: '74%', lines: [0.88, 0.58] },
      { side: 'left', width: '48%', lines: [0.56] },
      { side: 'right', width: '68%', lines: [0.78, 0.36] },
    ]
    : [
      { side: 'left', width: '42%', lines: [0.7, 0.54] },
      { side: 'right', width: '48%', lines: [0.92, 0.62] },
      { side: 'left', width: '35%', lines: [0.58] },
      { side: 'right', width: '44%', lines: [0.78, 0.4] },
    ];

  return (
    <Stack spacing={1.2} sx={{ px: { xs: 1, md: 3 }, py: 3 }}>
      <Stack alignItems="center" sx={{ py: 0.5 }}>
        <ChatSkeleton width={94} height={24} radius={999} />
      </Stack>
      {rows.map((row, index) => (
        <Stack key={`${row.side}-${index}`} alignItems={row.side === 'right' ? 'flex-end' : 'flex-start'}>
          <Box
            sx={{
              width: row.width,
              maxWidth: compactMobile ? '82vw' : 440,
              px: 1.4,
              py: 1.15,
              borderRadius: row.side === 'right' ? '18px 18px 5px 18px' : '18px 18px 18px 5px',
              bgcolor: row.side === 'right' ? 'var(--chat-skeleton-own-bg, rgba(217,253,211,0.54))' : 'var(--chat-skeleton-other-bg, rgba(255,255,255,0.62))',
              boxShadow: 'var(--chat-skeleton-shadow, none)',
            }}
          >
            <Stack spacing={0.8}>
              {row.lines.map((lineWidth, lineIndex) => (
                <ChatSkeleton
                  key={lineIndex}
                  width={`${Math.round(lineWidth * 100)}%`}
                  height={lineIndex === 0 ? 15 : 13}
                  radius={8}
                />
              ))}
              <Stack alignItems="flex-end">
                <ChatSkeleton width={42} height={10} radius={999} />
              </Stack>
            </Stack>
          </Box>
        </Stack>
      ))}
    </Stack>
  );
}

function TimelineMarker({ label, tone, stickyOffset = 0, dataTestId, isDateMarker = false, compactMobile = false }) {
  if (isDateMarker && compactMobile) {
    return (
      <div
        data-testid={dataTestId}
        data-date-marker
        data-date-label={label}
        className="flex justify-center py-1.5"
      >
        <div
          className="rounded-full border px-2 py-0.5 text-[11px] font-semibold backdrop-blur-xl"
          style={{
            backgroundColor: tone.bg,
            color: tone.text,
            boxShadow: tone.shadow,
            borderColor: tone.border || 'transparent',
            minWidth: '70px',
            textAlign: 'center',
          }}
        >
          {label}
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid={dataTestId}
      className="pointer-events-none sticky z-50 flex justify-center py-1.5"
      style={{ top: stickyOffset }}
    >
      <div
        className="rounded-full border px-2 py-0.5 text-[11px] font-semibold backdrop-blur-xl"
        style={{
          backgroundColor: tone.bg,
          color: tone.text,
          boxShadow: tone.shadow,
          borderColor: tone.border || 'transparent',
          minWidth: '70px',
          textAlign: 'center',
        }}
      >
        {label}
      </div>
    </div>
  );
}

const ChatMessageList = memo(function ChatMessageList({
  theme,
  ui,
  compactMobile,
  mobileInteractionsEnabled = false,
  activeConversation,
  navigate,
  messages,
  messagesLoading,
  effectiveLastReadMessageId,
  messagesHasMore,
  loadingOlder,
  onLoadOlder,
  threadContentRef,
  bottomRef,
  onOpenReads,
  onOpenAttachmentPreview,
  onReplyMessage,
  onOpenMessageMenu,
  onConfirmAction,
  onCancelAction,
  onEditAction,
  selectedMessageIds = [],
  onToggleMessageSelection,
  onStartMessageSelection,
  onToggleReaction,
  highlightedMessageId,
  isFileDragActive,
  getReadTargetRef,
}) {
  const normalizedMessages = Array.isArray(messages) ? messages : [];
  const timelineItems = useMemo(
    () => buildTimelineItems(normalizedMessages, effectiveLastReadMessageId),
    [effectiveLastReadMessageId, normalizedMessages],
  );
  const servicePillBg = ui.servicePillBg || alpha(ui.composerDockBg || ui.panelBg || theme.palette.background.paper, 0.78);
  const servicePillText = ui.servicePillText || ui.textSecondary;
  const selectedMessageIdSet = useMemo(
    () => new Set((Array.isArray(selectedMessageIds) ? selectedMessageIds : []).map((value) => String(value || '').trim()).filter(Boolean)),
    [selectedMessageIds],
  );
  const selectionMode = selectedMessageIdSet.size > 0;

  const groupedMetaById = useMemo(() => {
    const entries = new Map();
    normalizedMessages.forEach((message, index) => {
      entries.set(message.id, {
        groupedWithPrevious: shouldGroupMessages(normalizedMessages[index - 1], message),
        groupedWithNext: shouldGroupMessages(message, normalizedMessages[index + 1]),
      });
    });
    return entries;
  }, [normalizedMessages]);

  return (
    <>
      {isFileDragActive ? (
        <Box
          sx={{
            position: 'sticky',
            top: 12,
            zIndex: 6,
            mx: 'auto',
            mb: 1.5,
            display: 'flex',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <ChatFileUploadPanel
            mode="drop"
            files={[]}
            showActions={false}
            showCaption={false}
            theme={theme}
            ui={ui}
          />
        </Box>
      ) : null}

      {messagesLoading ? (
        <ThreadLoadingSkeleton compactMobile={compactMobile} />
      ) : normalizedMessages.length === 0 ? (
        <Stack alignItems="center" justifyContent="center" sx={{ minHeight: '100%', textAlign: 'center', px: 2 }}>
          <Avatar sx={{ width: 64, height: 64, mb: 2, bgcolor: ui.accentSoft, color: ui.accentText }}>
            <ForumOutlinedIcon />
          </Avatar>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            Здесь пока тихо
          </Typography>
          <Typography variant="body2" sx={{ mt: 1, maxWidth: 420, color: ui.textSecondary }}>
            Отправьте первое сообщение, задачу или вложение. Диалог уже готов к работе.
          </Typography>
        </Stack>
      ) : (
        <Stack ref={threadContentRef} data-testid="chat-thread-content" spacing={0} sx={{ overflowAnchor: 'none' }}>
          {messagesHasMore ? (
            <Stack alignItems="center" sx={{ pb: 0.8 }}>
              <Button
                data-testid="chat-load-older-button"
                variant="text"
                size="small"
                onClick={onLoadOlder}
                disabled={loadingOlder}
                sx={{
                  color: ui.accentText,
                  textTransform: 'none',
                  borderRadius: compactMobile ? 999 : 1.5,
                  px: 1.5,
                  py: 0.4,
                  bgcolor: alpha(servicePillBg, 0.96),
                  border: '1px solid',
                  borderColor: ui.borderSoft,
                }}
              >
                {loadingOlder ? 'Загрузка истории...' : 'Показать более ранние сообщения'}
              </Button>
            </Stack>
          ) : null}

          {timelineItems.map((item) => {
            if (item.type === 'date') {
              if (compactMobile) return null;
              return (
                <TimelineMarker
                  key={item.key}
                  label={item.label}
                  stickyOffset={10}
                  tone={{
                    bg: servicePillBg,
                    text: servicePillText,
                    border: ui.borderSoft,
                    shadow: 'none',
                  }}
                />
              );
            }

            if (item.type === 'unread') {
              return (
                <TimelineMarker
                  key={item.key}
                  label={item.label}
                  dataTestId="chat-unread-separator"
                  stickyOffset={48}
                  tone={{
                    bg: alpha(theme.palette.primary.main, 0.14),
                    text: theme.palette.primary.light,
                    border: alpha(theme.palette.primary.main, 0.2),
                    shadow: 'none',
                  }}
                />
              );
            }

            const groupedMeta = groupedMetaById.get(item.message?.id) || {};
            const messageId = String(item.message?.id || '').trim();
            const selected = Boolean(messageId && selectedMessageIdSet.has(messageId));
            return (
              <div key={item.key} data-message-date={getDateDividerLabel(item.message?.created_at)}>
                <MemoChatBubble
                  conversationKind={activeConversation.kind}
                  message={item.message}
                  navigate={navigate}
                  theme={theme}
                  ui={ui}
                  onOpenReads={onOpenReads}
                  onOpenAttachmentPreview={onOpenAttachmentPreview}
                  onReplyMessage={onReplyMessage}
                  onOpenMessageMenu={onOpenMessageMenu}
                  onConfirmAction={onConfirmAction}
                  onCancelAction={onCancelAction}
                  onEditAction={onEditAction}
                  selectionMode={selectionMode}
                  selected={selected}
                  onToggleMessageSelection={onToggleMessageSelection}
                  onStartMessageSelection={onStartMessageSelection}
                  onToggleReaction={onToggleReaction}
                  highlighted={highlightedMessageId === item.message?.id}
                  groupedWithPrevious={Boolean(groupedMeta.groupedWithPrevious)}
                  groupedWithNext={Boolean(groupedMeta.groupedWithNext)}
                  compactMobile={compactMobile}
                  mobileInteractionsEnabled={mobileInteractionsEnabled}
                  readTargetRef={getReadTargetRef?.(item.message?.id)}
                />
              </div>
            );
          })}
          <Box ref={bottomRef} />
        </Stack>
      )}
    </>
  );
});

export default ChatMessageList;
