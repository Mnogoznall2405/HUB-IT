import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Avatar,
  Box,
  CircularProgress,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import TextareaAutosize from '@mui/material/TextareaAutosize';
import { alpha } from '@mui/material/styles';
import AttachFileRoundedIcon from '@mui/icons-material/AttachFileRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import InsertEmoticonRoundedIcon from '@mui/icons-material/InsertEmoticonRounded';
import KeyboardRoundedIcon from '@mui/icons-material/KeyboardRounded';
import MicRoundedIcon from '@mui/icons-material/MicRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import StopRoundedIcon from '@mui/icons-material/StopRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';

import ChatEmojiPanel from './ChatEmojiPanel';
import {
  formatFileSize,
  getPersonStatusLine,
  getSearchResultPreview,
} from './chatHelpers';

const joinClasses = (...values) => values.filter(Boolean).join(' ');
const formatVoiceDuration = (seconds) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
};
const TELEGRAM_CHAT_FONT_FAMILY = [
  '"SF Pro Text"',
  '"SF Pro Display"',
  '"Segoe UI Variable Text"',
  '"Segoe UI"',
  'Roboto',
  'Helvetica',
  'Arial',
  'sans-serif',
].join(', ');
const CHAT_FONT_SIZES = {
  composer: '17px',
  composerAux: '13px',
};

const MENTION_QUERY_LIMIT = 32;
const MENTION_RESULT_LIMIT = 8;

function getPersonDisplayName(person) {
  return String(person?.full_name || person?.name || person?.username || '').trim();
}

function getPersonMentionHandle(person) {
  const username = String(person?.username || '').trim().replace(/^@+/, '');
  if (username) return username;
  return getPersonDisplayName(person)
    .replace(/\s+/g, '_')
    .replace(/[^0-9A-Za-zА-Яа-яЁё_.-]+/g, '')
    .slice(0, 48);
}

function getPersonInitials(person) {
  const name = getPersonDisplayName(person);
  if (!name) return '@';
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function normalizeMentionSearch(value) {
  return String(value || '').trim().replace(/^@+/, '').toLowerCase();
}

function filterMentionCandidates(candidates, query, limit = MENTION_RESULT_LIMIT) {
  const normalizedQuery = normalizeMentionSearch(query);
  const seen = new Set();
  const result = [];
  (Array.isArray(candidates) ? candidates : []).forEach((candidate) => {
    const person = candidate?.user || candidate;
    const id = Number(person?.id || 0);
    const handle = getPersonMentionHandle(person);
    const displayName = getPersonDisplayName(person);
    if (!handle && !displayName) return;
    const key = id > 0 ? `id:${id}` : `handle:${handle.toLowerCase()}`;
    if (seen.has(key)) return;
    const haystack = `${handle} ${displayName}`.toLowerCase();
    if (normalizedQuery && !haystack.includes(normalizedQuery)) return;
    seen.add(key);
    result.push(person);
  });
  return result.slice(0, limit);
}

export function getComposerMentionTrigger(value, caretPosition) {
  const text = String(value || '');
  const caret = Math.max(0, Math.min(Number(caretPosition ?? text.length), text.length));
  const beforeCaret = text.slice(0, caret);
  const atIndex = beforeCaret.lastIndexOf('@');
  if (atIndex < 0) return null;
  const charBeforeAt = atIndex > 0 ? beforeCaret[atIndex - 1] : '';
  if (charBeforeAt && !/\s/.test(charBeforeAt)) return null;
  const query = beforeCaret.slice(atIndex + 1);
  if (query.length > MENTION_QUERY_LIMIT || /\s/.test(query)) return null;
  return {
    start: atIndex,
    end: caret,
    query,
  };
}

const ChatComposer = memo(function ChatComposer({
  theme,
  ui,
  compactMobile,
  activeConversationId,
  selectedFiles,
  fileCaption,
  onOpenFileDialog,
  onClearSelectedFiles,
  preparingFiles,
  sendingFiles,
  fileUploadProgress,
  selectedFilesSummary,
  replyMessage,
  onClearReply,
  onOpenComposerMenu,
  composerRef,
  messageText,
  onMessageTextChange,
  onComposerKeyDown,
  onComposerSelectionSync,
  onOpenEmojiPicker,
  onCloseEmojiPicker,
  onSendMessage,
  onComposerPaste,
  onComposerDrop,
  onComposerDragOver,
  onComposerDragLeave,
  onComposerFocusChange,
  mentionCandidates = [],
  onSearchMentionPeople,
  composerDockRef,
  keyboardInset = 0,
  mobileEmojiPickerOpen = false,
  onInsertEmoji,
  onSendSticker,
  onSendGif,
  voiceRecording = false,
  voiceRecordingDuration = 0,
  onStartVoiceRecording,
  onStopVoiceRecording,
  onCancelVoiceRecording,
}) {
  const contentMaxWidth = Number(ui.contentMaxWidth || 980);
  const composerBg = ui.composerBg || (theme.palette.mode === 'dark' ? '#1c1c1e' : '#ffffff');
  const composerActionBg = ui.composerActionBg || theme.palette.primary.main;
  const composerActionText = ui.composerActionText || theme.palette.primary.contrastText;
  const composerAuxColor = ui.textSecondary || theme.palette.text.secondary;
  const composerPrimaryText = ui.textPrimary || theme.palette.text.primary;
  const composerIconColor = theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.55)' : composerAuxColor;
  const composerDismissColor = theme.palette.mode === 'dark' ? alpha('#ffffff', 0.6) : composerAuxColor;
  const canSendComposerMessage = Boolean(String(messageText || '').trim());
  const filesBusy = preparingFiles || sendingFiles;
  const [mentionTrigger, setMentionTrigger] = useState(null);
  const mentionTriggerRef = useRef(null);
  const [remoteMentionPeople, setRemoteMentionPeople] = useState([]);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const selectedFilesTotalLabel = useMemo(() => {
    const finalBytes = Number(selectedFilesSummary?.finalTotalBytes || 0);
    const originalBytes = Number(selectedFilesSummary?.originalTotalBytes || finalBytes);
    if (originalBytes > finalBytes && finalBytes > 0) {
      return `${formatFileSize(originalBytes)} -> ${formatFileSize(finalBytes)}`;
    }
    return finalBytes > 0 ? formatFileSize(finalBytes) : '';
  }, [selectedFilesSummary]);

  const updateMentionTriggerFromTextarea = useCallback((node) => {
    if (!node) {
      mentionTriggerRef.current = null;
      setMentionTrigger(null);
      return;
    }
    const nextTrigger = getComposerMentionTrigger(node.value, node.selectionStart);
    const previousTrigger = mentionTriggerRef.current;
    const unchanged = Boolean(previousTrigger) === Boolean(nextTrigger)
      && String(previousTrigger?.query || '') === String(nextTrigger?.query || '')
      && Number(previousTrigger?.start ?? -1) === Number(nextTrigger?.start ?? -1)
      && Number(previousTrigger?.end ?? -1) === Number(nextTrigger?.end ?? -1);
    mentionTriggerRef.current = nextTrigger;
    if (!unchanged) {
      setMentionTrigger(nextTrigger);
      setActiveMentionIndex(0);
    }
  }, []);

  const localMentionPeople = useMemo(
    () => filterMentionCandidates(mentionCandidates, mentionTrigger?.query, MENTION_RESULT_LIMIT),
    [mentionCandidates, mentionTrigger?.query],
  );

  useEffect(() => {
    const query = String(mentionTrigger?.query || '').trim();
    if (!mentionTrigger || query.length < 1 || typeof onSearchMentionPeople !== 'function') {
      setRemoteMentionPeople([]);
      setMentionLoading(false);
      return undefined;
    }
    let cancelled = false;
    setMentionLoading(true);
    const timeoutId = window.setTimeout(async () => {
      try {
        const people = await onSearchMentionPeople(query);
        if (cancelled) return;
        setRemoteMentionPeople(Array.isArray(people) ? people : []);
      } catch {
        if (!cancelled) setRemoteMentionPeople([]);
      } finally {
        if (!cancelled) setMentionLoading(false);
      }
    }, 140);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [mentionTrigger, onSearchMentionPeople]);

  const mentionOptions = useMemo(
    () => filterMentionCandidates([...localMentionPeople, ...remoteMentionPeople], mentionTrigger?.query, MENTION_RESULT_LIMIT),
    [localMentionPeople, mentionTrigger?.query, remoteMentionPeople],
  );
  const mentionOpen = Boolean(mentionTrigger) && (mentionOptions.length > 0 || mentionLoading);

  const closeMentions = useCallback(() => {
    mentionTriggerRef.current = null;
    setMentionTrigger(null);
    setRemoteMentionPeople([]);
    setMentionLoading(false);
    setActiveMentionIndex(0);
  }, []);

  const insertMention = useCallback((person) => {
    const trigger = mentionTriggerRef.current || mentionTrigger;
    const handle = getPersonMentionHandle(person);
    if (!trigger || !handle) return;
    const currentValue = String(messageText || '');
    const insertText = `@${handle} `;
    const nextValue = `${currentValue.slice(0, trigger.start)}${insertText}${currentValue.slice(trigger.end)}`;
    const nextCaret = trigger.start + insertText.length;
    onMessageTextChange?.(nextValue);
    closeMentions();
    window.requestAnimationFrame(() => {
      const node = composerRef?.current;
      node?.focus?.();
      node?.setSelectionRange?.(nextCaret, nextCaret);
      updateMentionTriggerFromTextarea(node);
    });
  }, [closeMentions, composerRef, mentionTrigger, messageText, onMessageTextChange, updateMentionTriggerFromTextarea]);

  const handleFocus = useCallback((event) => {
    onComposerFocusChange?.(true);
    onComposerSelectionSync?.(event);
    updateMentionTriggerFromTextarea(event.currentTarget);
  }, [onComposerFocusChange, onComposerSelectionSync, updateMentionTriggerFromTextarea]);

  const handleBlur = useCallback(() => {
    onComposerFocusChange?.(false);
  }, [onComposerFocusChange]);

  const handleComposerChange = useCallback((event) => {
    onMessageTextChange?.(event.target.value);
    updateMentionTriggerFromTextarea(event.target);
  }, [onMessageTextChange, updateMentionTriggerFromTextarea]);

  const handleComposerSelection = useCallback((event) => {
    onComposerSelectionSync?.(event);
    updateMentionTriggerFromTextarea(event.currentTarget);
  }, [onComposerSelectionSync, updateMentionTriggerFromTextarea]);

  const handleComposerKeyDown = useCallback((event) => {
    if (mentionOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveMentionIndex((current) => (mentionOptions.length > 0 ? (current + 1) % mentionOptions.length : 0));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveMentionIndex((current) => (mentionOptions.length > 0 ? (current - 1 + mentionOptions.length) % mentionOptions.length : 0));
        return;
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && mentionOptions.length > 0) {
        event.preventDefault();
        insertMention(mentionOptions[Math.max(0, Math.min(activeMentionIndex, mentionOptions.length - 1))]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMentions();
        return;
      }
    }
    onComposerKeyDown?.(event);
  }, [activeMentionIndex, closeMentions, insertMention, mentionOpen, mentionOptions, onComposerKeyDown]);

  const preserveComposerKeyboard = useCallback((event) => {
    if (!compactMobile) return;
    event.preventDefault();
  }, [compactMobile]);

  return (
    <Box
      ref={composerDockRef}
      data-testid="chat-composer-dock"
      className="chat-safe-bottom chat-native-shell chat-no-select"
      sx={{
        px: { xs: compactMobile ? 0.8 : 1.1, md: 1.6 },
        pt: compactMobile ? 0.55 : 0.95,
        pb: compactMobile ? 0.55 : 0.95,
        bgcolor: composerBg,
        backdropFilter: 'blur(22px) saturate(1.08)',
        position: 'relative',
        bottom: 0,
        zIndex: 5,
        borderTop: theme.palette.mode === 'dark' ? `0.5px solid ${ui.borderSoft}` : 'none',
        boxShadow: theme.palette.mode === 'dark'
          ? '0 -1px 0 rgba(255,255,255,0.04)'
          : `0 -1px 0 ${ui.borderSoft}, 0 -14px 26px rgba(80,104,128,0.08)`,
        fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
      }}
    >
      <Box sx={{ maxWidth: { xs: '100%', md: `${contentMaxWidth}px` }, mx: 'auto', width: '100%' }}>
        {/* File attachment status bar removed — upload dialog handles everything */}

        {replyMessage ? (
          <div
            className={joinClasses(
              'mb-3 flex items-start justify-between gap-3 border px-4 py-3',
              compactMobile ? 'rounded-[20px]' : 'rounded-[14px]',
            )}
            style={{
              backgroundColor: alpha(ui.composerDockBg, 0.94),
              borderColor: ui.borderSoft,
              borderLeft: `3px solid ${ui.accentText}`,
              boxShadow: ui.shadowSoft,
            }}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-semibold" style={{ color: ui.accentText, fontFamily: TELEGRAM_CHAT_FONT_FAMILY, fontSize: CHAT_FONT_SIZES.composerAux }}>
                {replyMessage?.sender?.full_name || replyMessage?.sender?.username || 'Сообщение'}
              </p>
              <p className="truncate text-[12px]" style={{ color: ui.textSecondary, fontFamily: TELEGRAM_CHAT_FONT_FAMILY, fontSize: CHAT_FONT_SIZES.composerAux }}>
                {getSearchResultPreview(replyMessage)}
              </p>
            </div>
            <button
              type="button"
              aria-label="Отменить ответ"
              onClick={onClearReply}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full transition duration-100 active:scale-[0.96] active:opacity-60"
              style={{ color: composerDismissColor }}
            >
              <CloseRoundedIcon sx={{ fontSize: 16 }} />
            </button>
          </div>
        ) : null}

        {mentionOpen ? (
          <Box
            data-testid="chat-mention-suggestions"
            sx={{
              mb: 0.75,
              overflow: 'hidden',
              borderRadius: compactMobile ? 3 : 2,
              border: '1px solid',
              borderColor: ui.borderSoft,
              bgcolor: alpha(ui.composerDockBg || composerBg, theme.palette.mode === 'dark' ? 0.98 : 0.96),
              boxShadow: theme.palette.mode === 'dark'
                ? '0 14px 32px rgba(0,0,0,0.28)'
                : '0 14px 32px rgba(15,23,42,0.14)',
            }}
          >
            {mentionOptions.map((person, index) => {
              const handle = getPersonMentionHandle(person);
              const displayName = getPersonDisplayName(person) || handle;
              const selected = index === activeMentionIndex;
              return (
                <Box
                  key={`${person?.id || handle}-${index}`}
                  component="button"
                  type="button"
                  data-testid={`chat-mention-option-${handle}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onPointerDown={(event) => {
                    if (!compactMobile) return;
                    event.preventDefault();
                    insertMention(person);
                  }}
                  onClick={() => insertMention(person)}
                  sx={{
                    width: '100%',
                    minHeight: compactMobile ? 50 : 48,
                    px: 1.1,
                    py: 0.65,
                    border: 'none',
                    bgcolor: selected ? alpha(ui.accentText || theme.palette.primary.main, 0.13) : 'transparent',
                    color: composerPrimaryText,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    textAlign: 'left',
                    cursor: 'pointer',
                    '&:hover': {
                      bgcolor: alpha(ui.accentText || theme.palette.primary.main, 0.1),
                    },
                  }}
                >
                  <Avatar
                    sx={{
                      width: 34,
                      height: 34,
                      fontSize: 13,
                      fontWeight: 850,
                      bgcolor: alpha(ui.accentText || theme.palette.primary.main, 0.18),
                      color: ui.accentText || theme.palette.primary.main,
                    }}
                  >
                    {getPersonInitials(person)}
                  </Avatar>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography noWrap sx={{ color: composerPrimaryText, fontSize: 14.5, fontWeight: 800, lineHeight: 1.15 }}>
                      {displayName}
                    </Typography>
                    <Typography noWrap sx={{ color: composerAuxColor, fontSize: 12.5, lineHeight: 1.25 }}>
                      @{handle}{person?.presence ? ` · ${getPersonStatusLine(person)}` : ''}
                    </Typography>
                  </Box>
                </Box>
              );
            })}
            {mentionLoading && mentionOptions.length === 0 ? (
              <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 1.25, py: 1, color: composerAuxColor }}>
                <CircularProgress size={16} />
                <Typography sx={{ fontSize: 13, color: composerAuxColor }}>Ищем людей...</Typography>
              </Stack>
            ) : null}
          </Box>
        ) : null}

        <div className="flex items-end gap-2">
          <Box
            data-testid="chat-composer-capsule"
            onDrop={onComposerDrop}
            onDragOver={onComposerDragOver}
            onDragLeave={onComposerDragLeave}
            className={joinClasses(
              'flex flex-1 items-end gap-1 border px-2.5 py-0.5',
              compactMobile ? 'rounded-[23px]' : 'rounded-[20px]',
            )}
            sx={{
              minHeight: compactMobile ? 46 : 48,
              bgcolor: alpha(ui.composerInputBg, 0.94),
              borderColor: theme.palette.mode === 'dark' ? alpha('#ffffff', 0.08) : ui.borderSoft,
              boxShadow: 'none',
              transition: 'border-color 140ms ease, box-shadow 140ms ease, background-color 140ms ease',
              '&:focus-within': {
                borderColor: ui.accentText || alpha(theme.palette.primary.main, 0.36),
                boxShadow: `0 0 0 3px ${ui.focusRing || alpha(ui.accentText || '#3390ec', theme.palette.mode === 'dark' ? 0.18 : 0.14)}`,
              },
            }}
          >
            {voiceRecording ? (
              <>
                <button
                  type="button"
                  aria-label="Отменить запись"
                  onClick={onCancelVoiceRecording}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition duration-100 active:scale-[0.96] active:opacity-60"
                  style={{
                    backgroundColor: 'transparent',
                    color: theme.palette.error.main,
                    transform: compactMobile ? undefined : 'translateY(-4px)',
                  }}
                >
                  <DeleteOutlineRoundedIcon sx={{ fontSize: 21 }} />
                </button>
                <Box
                  className="flex min-w-0 flex-1 items-center py-[11px]"
                  sx={{ minHeight: 38, gap: 1 }}
                >
                  <Box
                    sx={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      bgcolor: theme.palette.error.main,
                      animation: 'pulse 1.2s ease-in-out infinite',
                      '@keyframes pulse': {
                        '0%, 100%': { opacity: 1 },
                        '50%': { opacity: 0.3 },
                      },
                    }}
                  />
                  <Typography
                    sx={{
                      fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
                      fontSize: compactMobile ? '16px' : CHAT_FONT_SIZES.composer,
                      fontVariantNumeric: 'tabular-nums',
                      color: theme.palette.text.primary,
                      lineHeight: 1.34,
                      userSelect: 'none',
                    }}
                  >
                    {formatVoiceDuration(voiceRecordingDuration)}
                  </Typography>
                </Box>
              </>
            ) : (
              <>
                <Tooltip disableHoverListener={compactMobile} disableFocusListener={compactMobile} disableTouchListener={compactMobile} title="Emoji">
                  <span>
                    <button
                      type="button"
                      data-testid="chat-composer-emoji-button"
                      aria-label={mobileEmojiPickerOpen ? 'Клавиатура' : 'Emoji'}
                      onClick={mobileEmojiPickerOpen ? onCloseEmojiPicker : onOpenEmojiPicker}
                      disabled={!activeConversationId}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition duration-100 active:scale-[0.96] active:opacity-60 disabled:opacity-40"
                      style={{
                        backgroundColor: 'transparent',
                        color: composerIconColor,
                        transform: compactMobile ? undefined : 'translateY(-4px)',
                      }}
                      onMouseEnter={(event) => {
                        if (!compactMobile) event.currentTarget.style.backgroundColor = alpha(ui.accentText, 0.08);
                      }}
                      onMouseLeave={(event) => {
                        event.currentTarget.style.backgroundColor = 'transparent';
                      }}
                    >
                      {mobileEmojiPickerOpen
                        ? <KeyboardRoundedIcon sx={{ fontSize: 21 }} />
                        : <InsertEmoticonRoundedIcon sx={{ fontSize: 21 }} />}
                    </button>
                  </span>
                </Tooltip>

                <Box
                  className="flex min-w-0 flex-1 items-end py-[11px]"
                  sx={{ minHeight: 38 }}
                >
                  <TextareaAutosize
                    ref={composerRef}
                    data-testid="chat-composer-textarea"
                    minRows={1}
                    maxRows={6}
                    aria-label="Message"
                    placeholder="Сообщение..."
                    value={messageText}
                    onChange={handleComposerChange}
                    onKeyDown={handleComposerKeyDown}
                    onSelect={handleComposerSelection}
                    onClick={handleComposerSelection}
                    onKeyUp={handleComposerSelection}
                    onFocus={handleFocus}
                    onBlur={handleBlur}
                    onPaste={onComposerPaste}
                    style={{
                      width: '100%',
                      resize: 'none',
                      border: 'none',
                      outline: 'none',
                      background: 'transparent',
                      color: theme.palette.text.primary,
                      fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
                      fontSize: compactMobile ? '16px' : CHAT_FONT_SIZES.composer,
                      lineHeight: '1.34',
                      padding: 0,
                      margin: 0,
                      overflowY: 'auto',
                      overflowWrap: 'anywhere',
                      wordBreak: 'break-word',
                      maxHeight: '120px',
                      minHeight: compactMobile ? '18px' : '19px',
                    }}
                  />
                </Box>

                {!canSendComposerMessage ? (
                  <Tooltip title="Меню вложений">
                    <span>
                      <button
                        type="button"
                        aria-label="Меню вложений"
                        data-testid="chat-composer-menu-button"
                        onClick={onOpenComposerMenu}
                        onMouseDown={preserveComposerKeyboard}
                        onPointerDown={preserveComposerKeyboard}
                        disabled={!activeConversationId}
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition duration-100 active:scale-[0.96] active:opacity-60 disabled:opacity-40"
                        style={{
                          backgroundColor: 'transparent',
                          color: composerIconColor,
                          transform: compactMobile ? undefined : 'translateY(-4px)',
                        }}
                        onMouseEnter={(event) => {
                          if (!compactMobile) event.currentTarget.style.backgroundColor = alpha(ui.accentText, 0.08);
                        }}
                        onMouseLeave={(event) => {
                          event.currentTarget.style.backgroundColor = 'transparent';
                        }}
                      >
                        <AttachFileRoundedIcon sx={{ fontSize: 21 }} />
                      </button>
                    </span>
                  </Tooltip>
                ) : null}
              </>
            )}
          </Box>

          {canSendComposerMessage || voiceRecording ? (
            <Tooltip title={voiceRecording ? 'Отправить' : 'Отправить'}>
              <span>
                <button
                  type="button"
                  aria-label="Отправить"
                  onClick={voiceRecording ? onStopVoiceRecording : () => void onSendMessage()}
                  onMouseDown={preserveComposerKeyboard}
                  onPointerDown={preserveComposerKeyboard}
                  data-testid="chat-composer-send-button"
                  className="inline-flex h-[46px] w-[46px] items-center justify-center rounded-full transition duration-100 active:scale-[0.96] active:opacity-60"
                  style={{
                    backgroundColor: composerActionBg,
                    color: composerActionText,
                    boxShadow: `0 6px 16px ${alpha(composerActionBg, 0.24)}`,
                    transform: compactMobile ? undefined : 'translateY(-2px)',
                  }}
                >
                  <SendRoundedIcon sx={{ fontSize: 20 }} />
                </button>
              </span>
            </Tooltip>
          ) : (
            <Tooltip title="Голосовое сообщение">
              <span>
                <button
                  type="button"
                  aria-label="Голосовое сообщение"
                  onClick={onStartVoiceRecording}
                  disabled={!activeConversationId}
                  data-testid="chat-composer-voice-button"
                  className="inline-flex h-[46px] w-[46px] items-center justify-center rounded-full transition duration-100 active:scale-[0.96] active:opacity-60 disabled:opacity-40"
                  style={{
                    backgroundColor: alpha(composerActionBg, 0.12),
                    color: composerActionBg,
                    transform: compactMobile ? undefined : 'translateY(-2px)',
                  }}
                >
                  <MicRoundedIcon sx={{ fontSize: 22 }} />
                </button>
              </span>
            </Tooltip>
          )}
        </div>

      </Box>

      <ChatEmojiPanel
        open={mobileEmojiPickerOpen}
        theme={theme}
        ui={ui}
        onInsertEmoji={onInsertEmoji}
        onSendSticker={onSendSticker}
        onSendGif={onSendGif}
        onClose={onCloseEmojiPicker}
      />
    </Box>
  );
});

export default ChatComposer;
