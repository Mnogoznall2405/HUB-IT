import { memo, useEffect, useRef, useMemo, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  Collapse,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';

import { MemoChatBubble } from './ChatBubble';
import ChatTypingIndicator, { TypingDots } from './ChatTypingIndicator';
import { AI_RUN_STALE_AFTER_MS, AI_STAGE_LABELS } from './ChatThreadHeader';
import { CHAT_FONT_FAMILY } from './chatUiTokens';
import {
  buildTimelineItems,
} from './chatHelpers';

const GROUP_WINDOW_MS = 10 * 60 * 1000;

export function shouldGroupMessages(previousMessage, nextMessage) {
  if (!previousMessage || !nextMessage) return false;
  // Д2-2: серия определяется автором и временем, а не типом контента;
  // служебные system-сообщения серию не продолжают.
  if (String(previousMessage?.kind || '') === 'system' || String(nextMessage?.kind || '') === 'system') return false;
  if (Boolean(previousMessage?.is_own) !== Boolean(nextMessage?.is_own)) return false;
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

function TimelineMarker({ label, tone, dataTestId, isDateMarker = false }) {
  return (
    <div
      data-testid={dataTestId}
      data-date-marker={isDateMarker ? true : undefined}
      data-date-label={isDateMarker ? label : undefined}
      className="flex justify-center py-1.5"
    >
      {/* Д2-3: backdrop-blur на чипе даты заставляет пересчитывать размытие
          фона на каждом кадре скролла — убран, полупрозрачный фон остаётся. */}
      <div
        className="rounded-full border px-2 py-0.5 text-[11px] font-semibold"
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

// Д3: маркер непрочитанных — полоса на всю ширину ленты (не «пилюля»).
function UnreadSeparator({ label, theme }) {
  return (
    <Box
      data-testid="chat-unread-separator"
      role="separator"
      sx={{
        my: 0.7,
        mx: { xs: -0.7, md: -3.5 },
        py: 0.55,
        px: 1.5,
        textAlign: 'center',
        bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.13 : 0.08),
        borderTop: `1px solid ${alpha(theme.palette.primary.main, 0.16)}`,
        borderBottom: `1px solid ${alpha(theme.palette.primary.main, 0.16)}`,
      }}
    >
      <Typography
        component="span"
        sx={{
          fontSize: 12.5,
          fontWeight: 700,
          letterSpacing: '0.01em',
          color: theme.palette.mode === 'dark' ? theme.palette.primary.light : theme.palette.primary.dark,
          fontFamily: CHAT_FONT_FAMILY,
        }}
      >
        {label}
      </Typography>
    </Box>
  );
}

const AI_RUN_FEED_STALE_TICK_MS = 15 * 1000;

const formatAiRunStageCount = (count) => {
  const safeCount = Math.max(1, Number(count || 0));
  if (safeCount % 10 === 1 && safeCount % 100 !== 11) return `${safeCount} шаг`;
  if ([2, 3, 4].includes(safeCount % 10) && ![12, 13, 14].includes(safeCount % 100)) return `${safeCount} шага`;
  return `${safeCount} шагов`;
};

// AI9: статус выполнения живёт внутри ленты под сообщениями — текущий этап с
// «печатающими» точками, набираемый partial_text, а после завершения —
// свёрнутая строка «Выполнено N шагов». Заменяет верхнюю плашку у шапки.
function AiRunFeedStatus({ aiStatus, theme, ui, compactMobile, onRetry, onStop }) {
  const status = String(aiStatus?.status || '').trim();
  const [stepsOpen, setStepsOpen] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [actionBusy, setActionBusy] = useState(false);
  const runActive = status === 'queued' || status === 'running';
  // R36: «завис» считаем от серверного возраста (server_now − updated_at) +
  // прошедшее на клиенте время с момента получения — перекос часов клиента не
  // влияет. Без server_now — от последнего наблюдаемого изменения статуса.
  const progressAge = useMemo(() => {
    const updatedMs = Date.parse(String(aiStatus?.updated_at || ''));
    if (!Number.isFinite(updatedMs)) return null;
    const serverNowMs = Date.parse(String(aiStatus?.server_now || ''));
    return {
      receivedAt: Date.now(),
      ageMs: Number.isFinite(serverNowMs) ? Math.max(0, serverNowMs - updatedMs) : 0,
    };
  }, [aiStatus]);
  useEffect(() => {
    if (!runActive) return undefined;
    const timerId = window.setInterval(() => setNowMs(Date.now()), AI_RUN_FEED_STALE_TICK_MS);
    return () => window.clearInterval(timerId);
  }, [runActive]);
  if (!status) return null;

  const runAction = async (handler) => {
    if (typeof handler !== 'function' || actionBusy) return;
    setActionBusy(true);
    try {
      await handler();
    } finally {
      setActionBusy(false);
    }
  };

  const completedStages = Array.isArray(aiStatus?.completed_stages) ? aiStatus.completed_stages : [];
  const runStale = runActive
    && progressAge !== null
    && (progressAge.ageMs + (nowMs - progressAge.receivedAt)) > AI_RUN_STALE_AFTER_MS;
  const partialText = String(aiStatus?.partial_text || '').trim();
  const stageText = String(aiStatus?.status_text || '').trim()
    || AI_STAGE_LABELS[String(aiStatus?.stage || '').trim()]
    || (status === 'queued' ? 'Ставлю задачу в очередь' : 'Думаю…');
  const accent = ui.accentText || theme.palette.primary.main;

  if (status === 'completed') {
    if (!completedStages.length) return null;
    return (
      <Box data-testid="chat-ai-run-completed" sx={{ px: compactMobile ? 0.5 : 0, py: 0.5 }}>
        <Button
          size="small"
          onClick={() => setStepsOpen((value) => !value)}
          aria-expanded={stepsOpen}
          sx={{
            minHeight: 28,
            px: 1,
            textTransform: 'none',
            fontSize: 12,
            fontWeight: 600,
            color: ui.textSecondary,
            borderRadius: 999,
            fontFamily: CHAT_FONT_FAMILY,
          }}
        >
          {`Выполнено ${formatAiRunStageCount(completedStages.length)}`}
        </Button>
        <Collapse in={stepsOpen} unmountOnExit>
          <Stack spacing={0.2} sx={{ pl: 1.2, pb: 0.4 }}>
            {completedStages.map((stage) => (
              <Stack key={stage} direction="row" spacing={0.6} alignItems="center">
                <CheckRoundedIcon sx={{ fontSize: 13, color: ui.successText || theme.palette.success.main }} />
                <Typography sx={{ fontSize: 12, color: ui.textSecondary, fontFamily: CHAT_FONT_FAMILY }}>
                  {AI_STAGE_LABELS[stage] || 'Выполнен разрешённый шаг'}
                </Typography>
              </Stack>
            ))}
          </Stack>
        </Collapse>
      </Box>
    );
  }

  if (status === 'cancelled') {
    return (
      <Typography
        data-testid="chat-ai-run-cancelled"
        sx={{ px: compactMobile ? 0.5 : 0, py: 0.6, fontSize: 12.5, color: ui.textSecondary, fontFamily: CHAT_FONT_FAMILY }}
      >
        Выполнение остановлено
      </Typography>
    );
  }

  if (status === 'failed' || runStale) {
    return (
      <Box
        role="status"
        aria-live="polite"
        data-testid="chat-ai-run-failed"
        sx={{
          px: compactMobile ? 1.2 : 1.4,
          py: 1,
          my: 0.5,
          borderRadius: 2,
          bgcolor: alpha(theme.palette.error.main, theme.palette.mode === 'dark' ? 0.14 : 0.08),
          border: `1px solid ${alpha(theme.palette.error.main, 0.2)}`,
        }}
      >
        <Typography sx={{ fontSize: 13.5, fontWeight: 700, color: theme.palette.error.main, fontFamily: CHAT_FONT_FAMILY }}>
          {runStale ? 'ИИ не отвечает' : 'AI не смог обработать запрос'}
        </Typography>
        <Typography sx={{ mt: 0.3, fontSize: 12.5, color: ui.textSecondary, fontFamily: CHAT_FONT_FAMILY }}>
          {runStale
            ? 'Ответ занимает больше времени, чем обычно — можно повторить запрос или остановить его.'
            : String(aiStatus?.error_text || aiStatus?.status_text || 'Попробуйте повторить запрос.').trim()}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ mt: 0.6 }}>
          {typeof onRetry === 'function' ? (
            <Button
              size="small"
              disabled={actionBusy}
              onClick={() => { void runAction(onRetry); }}
              sx={{ minHeight: 32, textTransform: 'none', fontWeight: 700 }}
            >
              Повторить
            </Button>
          ) : null}
          {runStale && typeof onStop === 'function' ? (
            <Button
              size="small"
              disabled={actionBusy}
              onClick={() => { void runAction(onStop); }}
              sx={{ minHeight: 32, textTransform: 'none', fontWeight: 700, color: ui.textSecondary }}
            >
              Остановить
            </Button>
          ) : null}
        </Stack>
      </Box>
    );
  }

  // queued / running
  return (
    <Box
      role="status"
      aria-live="polite"
      data-testid="chat-ai-run-status"
      sx={{ px: compactMobile ? 0.5 : 0, py: 0.8 }}
    >
      <Stack direction="row" spacing={1} alignItems="flex-start">
        <Box
          sx={{
            width: compactMobile ? 28 : 30,
            height: compactMobile ? 28 : 30,
            borderRadius: '50%',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: alpha(accent, 0.12),
            color: accent,
          }}
        >
          <SmartToyOutlinedIcon sx={{ fontSize: compactMobile ? 16 : 17 }} />
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" spacing={0.9} alignItems="center">
            <TypingDots color={accent} />
            <Typography sx={{ fontSize: compactMobile ? 12.5 : 13, fontWeight: 600, color: ui.textSecondary, fontFamily: CHAT_FONT_FAMILY }}>
              {stageText}
            </Typography>
          </Stack>
          {completedStages.length > 0 ? (
            <Stack spacing={0.15} sx={{ mt: 0.4 }}>
              {completedStages.slice(-3).map((stage) => (
                <Stack key={stage} direction="row" spacing={0.6} alignItems="center">
                  <CheckRoundedIcon sx={{ fontSize: 12, color: ui.successText || theme.palette.success.main }} />
                  <Typography sx={{ fontSize: 11.5, color: ui.textSecondary, fontFamily: CHAT_FONT_FAMILY }}>
                    {AI_STAGE_LABELS[stage] || 'Выполнен разрешённый шаг'}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          ) : null}
          {partialText ? (
            <Typography
              data-testid="ai-partial-response"
              sx={{
                mt: 0.6,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                color: 'text.primary',
                fontSize: compactMobile ? 13.5 : 14,
                lineHeight: 1.5,
                fontFamily: CHAT_FONT_FAMILY,
              }}
            >
              {partialText}
            </Typography>
          ) : null}
        </Box>
      </Stack>
    </Box>
  );
}

function LoadOlderSentinel({
  loadingOlder,
  onLoadOlder,
  historyAutoLoadEnabled = false,
  threadScrollRef,
  ui,
  servicePillBg,
}) {
  const sentinelRef = useRef(null);
  const onLoadOlderRef = useRef(onLoadOlder);
  const loadingOlderRef = useRef(loadingOlder);
  onLoadOlderRef.current = onLoadOlder;
  loadingOlderRef.current = loadingOlder;

  useEffect(() => {
    const node = sentinelRef.current;
    if (!historyAutoLoadEnabled || !node || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || loadingOlderRef.current) return;
        const scrollNode = threadScrollRef?.current;
        if (scrollNode && Number(scrollNode.scrollHeight) <= Number(scrollNode.clientHeight) + 2) return;
        onLoadOlderRef.current?.();
      },
      { threshold: 0.1 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [historyAutoLoadEnabled, threadScrollRef]);

  return (
    <Stack ref={sentinelRef} alignItems="center" sx={{ pb: 0.8, pt: 0.5 }}>
      {loadingOlder ? (
        <Box
          className="rounded-full border px-3 py-0.5 text-[11px] font-semibold"
          style={{
            backgroundColor: servicePillBg,
            color: ui.textSecondary,
            borderColor: ui.borderSoft,
          }}
        >
          Загрузка истории...
        </Box>
      ) : (
        <Button
          variant="text"
          size="small"
          onClick={onLoadOlder}
          sx={{
            color: ui.accentText,
            textTransform: 'none',
            borderRadius: 999,
            px: 1.5,
            py: 0.4,
            bgcolor: alpha(servicePillBg, 0.96),
            border: '1px solid',
            borderColor: ui.borderSoft,
            fontSize: '11px',
            fontWeight: 600,
            minHeight: 0,
          }}
        >
          Показать ранние сообщения
        </Button>
      )}
    </Stack>
  );
}

function ThreadLoadErrorBlock({ theme, ui, compactMobile, onRetry }) {
  return (
    <Stack
      alignItems="center"
      justifyContent="center"
      spacing={1.5}
      data-testid="chat-thread-load-error"
      sx={{ minHeight: '100%', textAlign: 'center', px: 2 }}
    >
      <Avatar
        sx={{
          width: 64,
          height: 64,
          bgcolor: alpha(theme.palette.error.main, theme.palette.mode === 'dark' ? 0.24 : 0.12),
          color: theme.palette.error.main,
        }}
      >
        <ErrorOutlineRoundedIcon />
      </Avatar>
      <Typography variant="h6" sx={{ fontWeight: 800 }}>
        Не удалось загрузить сообщения
      </Typography>
      <Typography variant="body2" sx={{ maxWidth: 420, color: ui.textSecondary }}>
        Проверьте соединение и повторите попытку.
      </Typography>
      <Button
        variant="outlined"
        size="small"
        data-testid="chat-thread-load-retry"
        onClick={() => void onRetry?.()}
        sx={{
          mt: 0.5,
          minHeight: compactMobile ? 44 : 36,
          textTransform: 'none',
          borderRadius: 999,
          px: 2.5,
          fontWeight: 700,
        }}
      >
        Повторить
      </Button>
    </Stack>
  );
}

const ChatMessageList = memo(function ChatMessageList({
  theme,
  ui,
  isMobile = false,
  compactMobile,
  mobileInteractionsEnabled = false,
  activeConversation,
  navigate,
  messages,
  messagesLoading,
  threadLoadError,
  onRetryThreadLoad,
  effectiveLastReadMessageId,
  unreadAnchorId,
  messagesHasMore,
  loadingOlder,
  onLoadOlder,
  historyAutoLoadEnabled = false,
  threadScrollRef,
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
  highlightedMessageId,
  getReadTargetRef,
  onToggleReaction,
  onPollVote,
  onScrollToMessage,
  onRetryFailedMessage,
  onDiscardFailedMessage,
  currentUserId,
  aiTypingStatus,
  aiStatus,
  onRetryAiRun,
  onStopAiRun,
}) {
  const normalizedMessages = Array.isArray(messages) ? messages : [];
  const timelineItems = useMemo(
    // R21: `unreadAnchorId` is the divider position frozen when the thread
    // opened — it must not move when messages get marked as read.
    () => buildTimelineItems(normalizedMessages, effectiveLastReadMessageId, unreadAnchorId),
    [effectiveLastReadMessageId, normalizedMessages, unreadAnchorId],
  );
  const servicePillBg = ui.servicePillBg || alpha(ui.composerDockBg || ui.panelBg || theme.palette.background.paper, 0.78);
  const servicePillText = ui.servicePillText || ui.textSecondary;
  const selectedMessageIdSet = useMemo(
    () => new Set((Array.isArray(selectedMessageIds) ? selectedMessageIds : []).map((value) => String(value || '').trim()).filter(Boolean)),
    [selectedMessageIds],
  );
  const selectionMode = selectedMessageIdSet.size > 0;

  // AI9: «Повторить ответ» показываем только под последним ответом ассистента.
  const latestAiReplyId = useMemo(() => {
    if (String(activeConversation?.kind || '').trim() !== 'ai') return '';
    for (let index = normalizedMessages.length - 1; index >= 0; index -= 1) {
      const candidate = normalizedMessages[index];
      if (!candidate?.is_own && !candidate?.is_deleted && String(candidate?.body || '').trim()) {
        return String(candidate?.id || '').trim();
      }
    }
    return '';
  }, [activeConversation?.kind, normalizedMessages]);

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
      {threadLoadError ? (
        <ThreadLoadErrorBlock
          theme={theme}
          ui={ui}
          compactMobile={compactMobile}
          onRetry={onRetryThreadLoad}
        />
      ) : messagesLoading ? (
        <ThreadLoadingSkeleton compactMobile={compactMobile} />
      ) : normalizedMessages.length === 0 ? (
        String(activeConversation?.kind || '').trim() === 'ai' ? (
          // AI9: пустой AI-диалог — приветствие ассистента; подсказки-кнопки
          // отдельно закреплены над полем ввода в ChatThread.
          <Stack
            alignItems="center"
            justifyContent="center"
            data-testid="chat-ai-empty-state"
            sx={{ minHeight: '100%', textAlign: 'center', px: 2 }}
          >
            <Avatar sx={{ width: 64, height: 64, mb: 2, bgcolor: ui.accentSoft, color: ui.accentText }}>
              <SmartToyOutlinedIcon sx={{ fontSize: 32 }} />
            </Avatar>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>
              {String(activeConversation?.title || 'HUB Ассистент').trim() || 'HUB Ассистент'}
            </Typography>
            <Typography variant="body2" sx={{ mt: 1, maxWidth: 460, color: ui.textSecondary }}>
              Чем могу помочь? Спросите про оборудование, документы или задачи — отвечу в рамках ваших доступов.
            </Typography>
            {aiStatus ? (
              <Box sx={{ mt: 2, width: '100%', maxWidth: 460 }}>
                <AiRunFeedStatus
                  aiStatus={aiStatus}
                  theme={theme}
                  ui={ui}
                  compactMobile={compactMobile}
                  onRetry={onRetryAiRun}
                  onStop={onStopAiRun}
                />
              </Box>
            ) : null}
          </Stack>
        ) : (
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
        )
      ) : (
        <Stack ref={threadContentRef} data-testid="chat-thread-content" spacing={0} sx={{ overflowAnchor: 'none' }}>
          {messagesHasMore ? (
            <LoadOlderSentinel
              loadingOlder={loadingOlder}
              onLoadOlder={onLoadOlder}
              historyAutoLoadEnabled={historyAutoLoadEnabled}
              threadScrollRef={threadScrollRef}
              ui={ui}
              servicePillBg={servicePillBg}
            />
          ) : null}

          {timelineItems.map((item) => {
            if (item.type === 'date') {
              return (
                <TimelineMarker
                  key={item.key}
                  label={item.label}
                  isDateMarker
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
                <UnreadSeparator
                  key={item.key}
                  label={item.label}
                  theme={theme}
                />
              );
            }

            const groupedMeta = groupedMetaById.get(item.message?.id) || {};
            const messageId = String(item.message?.id || '').trim();
            const selected = Boolean(messageId && selectedMessageIdSet.has(messageId));
            return (
              <div key={item.key} data-message-id={item.message?.id}>
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
                  highlighted={highlightedMessageId === item.message?.id}
                  groupedWithPrevious={Boolean(groupedMeta.groupedWithPrevious)}
                  groupedWithNext={Boolean(groupedMeta.groupedWithNext)}
                  compactMobile={compactMobile}
                  mobileInteractionsEnabled={mobileInteractionsEnabled}
                  readTargetRef={getReadTargetRef?.(item.message?.id)}
                  onToggleReactionRaw={onToggleReaction}
                  onPollVote={onPollVote}
                  onScrollToMessage={onScrollToMessage}
                  onRetryFailedMessage={onRetryFailedMessage}
                  onDiscardFailedMessage={onDiscardFailedMessage}
                  onRetryAiAnswer={latestAiReplyId && latestAiReplyId === messageId ? onRetryAiRun : undefined}
                  currentUserId={currentUserId}
                />
              </div>
            );
          })}
          {String(activeConversation?.kind || '').trim() === 'ai' ? (
            <AiRunFeedStatus
              aiStatus={aiStatus}
              theme={theme}
              ui={ui}
              compactMobile={compactMobile}
              onRetry={onRetryAiRun}
              onStop={onStopAiRun}
            />
          ) : null}
          {aiTypingStatus?.visible && (
            <ChatTypingIndicator
              botName={aiTypingStatus.botName}
              theme={theme}
              ui={ui}
              compactMobile={compactMobile}
            />
          )}
          <Box ref={bottomRef} />
        </Stack>
      )}
    </>
  );
});

export default ChatMessageList;
