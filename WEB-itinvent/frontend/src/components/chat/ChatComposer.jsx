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
  CHAT_DEFAULT_FONT_SIZES,
  CHAT_FONT_FAMILY,
  getChatComposerBodyFontSize,
  getChatComposerLineHeight,
} from './chatUiTokens';
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

const MENTION_QUERY_LIMIT = 32;
const MENTION_RESULT_LIMIT = 8;
const VOICE_RECORDING_WAVEFORM_BARS = 18;
const VOICE_RECORDING_BAR_PROFILE = [
  0.22, 0.52, 0.34, 0.78, 0.48, 0.92,
  0.58, 0.36, 0.72, 0.44, 0.84, 0.62,
  0.28, 0.68, 0.4, 0.76, 0.5, 0.3,
];

function clampRecordingLevel(value) {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue)) return 0;
  return Math.max(0, Math.min(1, numericValue));
}

const VoiceRecordingActivity = memo(function VoiceRecordingActivity({
  theme,
  ui,
  compactMobile,
  voiceRecordingLevelRef,
}) {
  const rootRef = useRef(null);
  const initialLevel = clampRecordingLevel(voiceRecordingLevelRef?.current);
  const activeColor = ui.accentText || theme.palette.primary.main;
  const inactiveColor = theme.palette.mode === 'dark'
    ? alpha('#ffffff', 0.42)
    : alpha(theme.palette.text.primary, 0.32);
  const ringOpacity = 0.18 + initialLevel * 0.42;
  const ringScale = 1 + initialLevel * 0.52;

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof window === 'undefined') return undefined;
    const bars = Array.from(root.querySelectorAll('[data-voice-wave-bar="true"]'));
    let frameId = null;

    const applyLevel = (value) => {
      const level = clampRecordingLevel(value);
      root.dataset.voiceActive = level > 0.12 ? 'true' : 'false';
      root.style.setProperty('--voice-level', level.toFixed(3));
      root.style.setProperty('--voice-ring-opacity', String((0.18 + level * 0.42).toFixed(3)));
      root.style.setProperty('--voice-ring-scale', String((1 + level * 0.52).toFixed(3)));
      bars.forEach((bar, index) => {
        const profile = VOICE_RECORDING_BAR_PROFILE[index % VOICE_RECORDING_BAR_PROFILE.length];
        const quietHeight = 3 + profile * 3.8;
        const activeHeight = compactMobile ? 22 : 24;
        const nextHeight = quietHeight + level * activeHeight * (0.42 + profile);
        bar.style.height = `${Math.min(compactMobile ? 24 : 26, nextHeight).toFixed(1)}px`;
        bar.style.opacity = String((0.42 + level * 0.5).toFixed(3));
      });
    };

    const tick = () => {
      applyLevel(voiceRecordingLevelRef?.current);
      frameId = window.requestAnimationFrame(tick);
    };

    applyLevel(voiceRecordingLevelRef?.current);
    frameId = window.requestAnimationFrame(tick);

    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
    };
  }, [compactMobile, voiceRecordingLevelRef]);

  return (
    <Box
      ref={rootRef}
      data-testid="chat-voice-recording-activity"
      data-voice-active={initialLevel > 0.12 ? 'true' : 'false'}
      aria-hidden="true"
      sx={{
        '--voice-level': initialLevel.toFixed(3),
        '--voice-ring-opacity': ringOpacity.toFixed(3),
        '--voice-ring-scale': ringScale.toFixed(3),
        display: 'inline-flex',
        alignItems: 'center',
        gap: compactMobile ? 0.75 : 0.9,
        minWidth: compactMobile ? 110 : 122,
        height: compactMobile ? 28 : 30,
        flexShrink: 0,
      }}
    >
      <Box
        sx={{
          width: 18,
          height: 18,
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            bgcolor: alpha(theme.palette.error.main, theme.palette.mode === 'dark' ? 0.24 : 0.18),
            opacity: 'var(--voice-ring-opacity)',
            transform: 'scale(var(--voice-ring-scale))',
            animation: 'voiceRecordingRing 1.2s ease-in-out infinite',
            '@keyframes voiceRecordingRing': {
              '0%, 100%': { opacity: 'var(--voice-ring-opacity)', transform: 'scale(var(--voice-ring-scale))' },
              '50%': { opacity: 0.1, transform: 'scale(1.45)' },
            },
            '@media (prefers-reduced-motion: reduce)': {
              animation: 'none',
            },
          }}
        />
        <Box
          sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            bgcolor: theme.palette.error.main,
            boxShadow: `0 0 0 1px ${alpha(theme.palette.error.main, 0.18)}`,
            position: 'relative',
          }}
        />
      </Box>
      <Box
        data-testid="chat-voice-recording-waveform"
        sx={{
          width: compactMobile ? 84 : 94,
          height: compactMobile ? 26 : 28,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '2px',
          overflow: 'hidden',
        }}
      >
        {Array.from({ length: VOICE_RECORDING_WAVEFORM_BARS }).map((_, index) => {
          const profile = VOICE_RECORDING_BAR_PROFILE[index % VOICE_RECORDING_BAR_PROFILE.length];
          const initialHeight = 3 + profile * 3.8 + initialLevel * (compactMobile ? 22 : 24) * (0.42 + profile);
          return (
            <Box
              key={`voice-wave-${index}`}
              data-testid="chat-voice-recording-bar"
              data-voice-wave-bar="true"
              sx={{
                width: compactMobile ? 2.5 : 3,
                height: `${Math.min(compactMobile ? 24 : 26, initialHeight).toFixed(1)}px`,
                borderRadius: 999,
                bgcolor: activeColor,
                opacity: 0.42 + initialLevel * 0.5,
                transition: 'height 90ms linear, opacity 120ms ease, background-color 120ms ease',
                '@media (prefers-reduced-motion: reduce)': {
                  transition: 'none',
                },
                '[data-voice-active="false"] &': {
                  bgcolor: inactiveColor,
                },
              }}
            />
          );
        })}
      </Box>
    </Box>
  );
});

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
  voiceRecordingLevelRef = null,
  onStartVoiceRecording,
  onStopVoiceRecording,
  onCancelVoiceRecording,
}) {
  const density = ui.density || {};
  const contentMaxWidth = Number(density.contentMaxWidth || ui.contentMaxWidth || 980);
  const composerFontSize = getChatComposerBodyFontSize(ui, compactMobile);
  const composerLineHeight = getChatComposerLineHeight(ui, compactMobile);
  const composerAuxFontSize = density.composerAuxFontSize || CHAT_DEFAULT_FONT_SIZES.composerAux;
  const safeKeyboardInset = compactMobile ? Math.max(0, Math.round(Number(keyboardInset || 0))) : 0;
  const composerBg = ui.composerBg || (theme.palette.mode === 'dark' ? '#1c1c1e' : '#ffffff');
  const composerActionBg = ui.composerActionBg || theme.palette.primary.main;
  const composerActionText = ui.composerActionText || theme.palette.primary.contrastText;
  const composerAuxColor = ui.textSecondary || theme.palette.text.secondary;
  const composerPrimaryText = ui.textPrimary || theme.palette.text.primary;
  const composerIconColor = theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.55)' : composerAuxColor;
  const composerDismissColor = theme.palette.mode === 'dark' ? alpha('#ffffff', 0.6) : composerAuxColor;
  const canSendComposerMessage = Boolean(String(messageText || '').trim());
  const filesBusy = preparingFiles || sendingFiles;
  const selectedFileList = useMemo(
    () => (Array.isArray(selectedFiles) ? selectedFiles : []),
    [selectedFiles],
  );
  const selectedFilePreviewItems = useMemo(
    () => selectedFileList.slice(0, 3),
    [selectedFileList],
  );
  const hiddenSelectedFileCount = Math.max(0, selectedFileList.length - selectedFilePreviewItems.length);
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
    if (compactMobile && event.key === 'Enter') {
      return;
    }
    onComposerKeyDown?.(event);
  }, [activeMentionIndex, closeMentions, compactMobile, insertMention, mentionOpen, mentionOptions, onComposerKeyDown]);

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
        px: { xs: compactMobile ? 0.8 : (density.composerDockPx || 1.1), md: density.composerDockPxMd || 1.6 },
        pt: compactMobile ? 0.55 : (density.composerDockPt || 0.95),
        pb: compactMobile ? 'max(calc(env(safe-area-inset-bottom, 0px) + 6px), 10px)' : (density.composerDockPb || 0.95),
        bgcolor: composerBg,
        backdropFilter: 'blur(22px) saturate(1.08)',
        position: 'relative',
        bottom: 0,
        transform: safeKeyboardInset > 0 ? `translate3d(0, -${safeKeyboardInset}px, 0)` : 'none',
        transition: safeKeyboardInset > 0 ? 'transform 80ms ease-out' : 'transform 120ms ease-in',
        willChange: compactMobile ? 'transform' : 'auto',
        zIndex: 5,
        borderTop: theme.palette.mode === 'dark' ? `0.5px solid ${ui.borderSoft}` : 'none',
        boxShadow: theme.palette.mode === 'dark'
          ? '0 -1px 0 rgba(255,255,255,0.04)'
          : `0 -1px 0 ${ui.borderSoft}, 0 -14px 26px rgba(80,104,128,0.08)`,
        fontFamily: CHAT_FONT_FAMILY,
      }}
    >
      <Box sx={{ maxWidth: { xs: '100%', md: `${contentMaxWidth}px` }, mx: 'auto', width: '100%' }}>
        {selectedFileList.length > 0 ? (
          <Box
            data-testid="chat-selected-files-bar"
            sx={{
              mb: compactMobile ? 0.8 : `${density.composerAttachmentMarginBottom || 10}px`,
              p: compactMobile ? '8px 10px' : (density.composerAttachmentPadding || '10px 12px'),
              borderRadius: compactMobile ? '18px' : '14px',
              border: `1px solid ${ui.borderSoft}`,
              backgroundColor: alpha(ui.composerDockBg, 0.94),
              boxShadow: ui.shadowSoft,
            }}
          >
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={compactMobile ? 0.8 : 1}
              alignItems={{ xs: 'stretch', sm: 'center' }}
            >
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Stack direction="row" spacing={0.7} alignItems="center" sx={{ minWidth: 0, mb: 0.65 }}>
                  {filesBusy ? (
                    <CircularProgress size={compactMobile ? 15 : 14} thickness={5} sx={{ color: ui.accentText, flexShrink: 0 }} />
                  ) : (
                    <AttachFileRoundedIcon sx={{ fontSize: compactMobile ? 18 : 16, color: ui.accentText, flexShrink: 0 }} />
                  )}
                  <Typography
                    noWrap
                    sx={{
                      minWidth: 0,
                      fontFamily: CHAT_FONT_FAMILY,
                      fontSize: composerAuxFontSize,
                      fontWeight: 800,
                      color: composerPrimaryText,
                    }}
                  >
                    {selectedFileList.length} файл(ов){selectedFilesTotalLabel ? ` · ${selectedFilesTotalLabel}` : ''}
                  </Typography>
                  {sendingFiles && fileUploadProgress > 0 ? (
                    <Typography
                      sx={{
                        flexShrink: 0,
                        fontFamily: CHAT_FONT_FAMILY,
                        fontSize: composerAuxFontSize,
                        fontWeight: 800,
                        color: ui.accentText,
                      }}
                    >
                      {Math.round(Number(fileUploadProgress || 0))}%
                    </Typography>
                  ) : null}
                </Stack>

                <Stack direction="row" spacing={0.65} useFlexGap flexWrap="wrap" sx={{ minWidth: 0 }}>
                  {selectedFilePreviewItems.map((file, index) => (
                    <Box
                      key={`${String(file?.name || 'file')}-${index}`}
                      sx={{
                        maxWidth: compactMobile ? '100%' : 190,
                        minHeight: compactMobile ? 30 : (density.composerAttachmentChipHeight || 28),
                        px: 1,
                        py: 0.35,
                        borderRadius: '999px',
                        bgcolor: alpha(ui.accentText || theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.16 : 0.1),
                        color: composerPrimaryText,
                        fontFamily: CHAT_FONT_FAMILY,
                        fontSize: composerAuxFontSize,
                        fontWeight: 700,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {String(file?.name || 'Файл')}
                    </Box>
                  ))}
                  {hiddenSelectedFileCount > 0 ? (
                    <Box
                      sx={{
                        minHeight: compactMobile ? 30 : (density.composerAttachmentChipHeight || 28),
                        px: 1,
                        py: 0.35,
                        borderRadius: '999px',
                        bgcolor: alpha(ui.accentText || theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.2 : 0.14),
                        color: ui.accentText,
                        fontFamily: CHAT_FONT_FAMILY,
                        fontSize: composerAuxFontSize,
                        fontWeight: 850,
                      }}
                    >
                      +{hiddenSelectedFileCount}
                    </Box>
                  ) : null}
                </Stack>

                {fileCaption ? (
                  <Typography
                    noWrap
                    sx={{
                      mt: 0.6,
                      fontFamily: CHAT_FONT_FAMILY,
                      fontSize: composerAuxFontSize,
                      color: composerAuxColor,
                    }}
                  >
                    {fileCaption}
                  </Typography>
                ) : null}
              </Box>

              <Stack direction="row" spacing={0.65} justifyContent={{ xs: 'flex-end', sm: 'center' }}>
                <Box
                  component="button"
                  type="button"
                  onClick={onOpenFileDialog}
                  disabled={filesBusy}
                  sx={{
                    minHeight: compactMobile ? 36 : (density.composerAttachmentActionHeight || 32),
                    px: compactMobile ? 1.3 : 1.1,
                    border: 'none',
                    borderRadius: '999px',
                    bgcolor: alpha(ui.accentText || theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.18 : 0.1),
                    color: ui.accentText,
                    fontFamily: CHAT_FONT_FAMILY,
                    fontSize: composerAuxFontSize,
                    fontWeight: 850,
                    cursor: filesBusy ? 'default' : 'pointer',
                    opacity: filesBusy ? 0.55 : 1,
                  }}
                >
                  Изменить
                </Box>
                <Box
                  component="button"
                  type="button"
                  onClick={onClearSelectedFiles}
                  disabled={filesBusy}
                  sx={{
                    minHeight: compactMobile ? 36 : (density.composerAttachmentActionHeight || 32),
                    px: compactMobile ? 1.3 : 1.1,
                    border: 'none',
                    borderRadius: '999px',
                    bgcolor: alpha(theme.palette.error.main, theme.palette.mode === 'dark' ? 0.18 : 0.1),
                    color: theme.palette.error.main,
                    fontFamily: CHAT_FONT_FAMILY,
                    fontSize: composerAuxFontSize,
                    fontWeight: 850,
                    cursor: filesBusy ? 'default' : 'pointer',
                    opacity: filesBusy ? 0.55 : 1,
                  }}
                >
                  Очистить
                </Box>
              </Stack>
            </Stack>
          </Box>
        ) : null}

        {replyMessage ? (
          <div
            className={joinClasses(
              'mb-3 flex items-start justify-between gap-3 border px-4 py-3',
              compactMobile ? 'rounded-[20px]' : 'rounded-[14px]',
            )}
            style={{
              marginBottom: compactMobile ? undefined : density.composerReplyMarginBottom,
              padding: compactMobile ? undefined : density.composerReplyPadding,
              backgroundColor: alpha(ui.composerDockBg, 0.94),
              borderColor: ui.borderSoft,
              borderLeft: `3px solid ${ui.accentText}`,
              boxShadow: ui.shadowSoft,
            }}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-semibold" style={{ color: ui.accentText, fontFamily: CHAT_FONT_FAMILY, fontSize: composerAuxFontSize }}>
                {replyMessage?.sender?.full_name || replyMessage?.sender?.username || 'Сообщение'}
              </p>
              <p className="truncate text-[12px]" style={{ color: ui.textSecondary, fontFamily: CHAT_FONT_FAMILY, fontSize: composerAuxFontSize }}>
                {getSearchResultPreview(replyMessage)}
              </p>
            </div>
            <button
              type="button"
              aria-label="Отменить ответ"
              onClick={onClearReply}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full transition duration-100 active:scale-[0.96] active:opacity-60"
              style={{
                width: compactMobile ? undefined : density.composerIconButton,
                height: compactMobile ? undefined : density.composerIconButton,
                color: composerDismissColor,
              }}
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
                    minHeight: compactMobile ? 50 : (density.composerMentionMinHeight || 48),
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
                      width: compactMobile ? 34 : (density.composerMentionAvatar || 34),
                      height: compactMobile ? 34 : (density.composerMentionAvatar || 34),
                      fontSize: compactMobile ? 13 : 12,
                      fontWeight: 850,
                      bgcolor: alpha(ui.accentText || theme.palette.primary.main, 0.18),
                      color: ui.accentText || theme.palette.primary.main,
                    }}
                  >
                    {getPersonInitials(person)}
                  </Avatar>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography noWrap sx={{ color: composerPrimaryText, fontSize: density.composerMentionTitleFontSize || 14.5, fontWeight: 800, lineHeight: 1.15 }}>
                      {displayName}
                    </Typography>
                    <Typography noWrap sx={{ color: composerAuxColor, fontSize: density.composerMentionMetaFontSize || 12.5, lineHeight: 1.25 }}>
                      @{handle}{person?.presence ? ` · ${getPersonStatusLine(person)}` : ''}
                    </Typography>
                  </Box>
                </Box>
              );
            })}
            {mentionLoading && mentionOptions.length === 0 ? (
              <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 1.25, py: 1, color: composerAuxColor }}>
                <CircularProgress size={16} />
                <Typography sx={{ fontSize: composerAuxFontSize, color: composerAuxColor }}>Ищем людей...</Typography>
              </Stack>
            ) : null}
          </Box>
        ) : null}

        <div className="flex items-center gap-2">
          <Box
            data-testid="chat-composer-capsule"
            onDrop={onComposerDrop}
            onDragOver={onComposerDragOver}
            onDragLeave={onComposerDragLeave}
            className={joinClasses(
              'flex flex-1 items-center gap-1 border px-2.5 py-0.5',
              compactMobile ? 'rounded-[23px]' : 'rounded-[20px]',
            )}
            sx={{
              minHeight: compactMobile ? 46 : (density.composerCapsuleMinHeight || 48),
              px: compactMobile ? undefined : `${density.composerCapsulePx || 10}px`,
              py: compactMobile ? undefined : `${density.composerCapsulePy ?? 2}px`,
              alignItems: 'center',
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
                  data-testid="chat-composer-cancel-voice-button"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition duration-100 active:scale-[0.96] active:opacity-60"
                  style={{
                    width: compactMobile ? undefined : density.composerIconButton,
                    height: compactMobile ? undefined : density.composerIconButton,
                    backgroundColor: 'transparent',
                    color: theme.palette.error.main,
                  }}
                >
                  <DeleteOutlineRoundedIcon sx={{ fontSize: 21 }} />
                </button>
                <Box
                  className="flex min-w-0 flex-1 items-center py-[11px]"
                  sx={{
                    minHeight: compactMobile ? 38 : (density.composerInputSlotMinHeight ?? density.composerIconButton ?? 32),
                    gap: 1,
                    py: compactMobile ? undefined : `${density.composerInnerPaddingY ?? 11}px`,
                  }}
                >
                  <VoiceRecordingActivity
                    theme={theme}
                    ui={ui}
                    compactMobile={compactMobile}
                    voiceRecordingLevelRef={voiceRecordingLevelRef}
                  />
                  <Typography
                    sx={{
                      fontFamily: CHAT_FONT_FAMILY,
                      fontSize: composerFontSize,
                      fontVariantNumeric: 'tabular-nums',
                      color: theme.palette.text.primary,
                      lineHeight: composerLineHeight,
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
                        width: compactMobile ? undefined : density.composerIconButton,
                        height: compactMobile ? undefined : density.composerIconButton,
                        backgroundColor: 'transparent',
                        color: composerIconColor,
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
                  data-testid="chat-composer-textarea-slot"
                  className="flex min-w-0 flex-1 items-center py-[11px]"
                  sx={{
                    alignItems: 'center',
                    minHeight: compactMobile ? 38 : (density.composerInputSlotMinHeight ?? density.composerIconButton ?? 32),
                    py: compactMobile ? undefined : `${density.composerInnerPaddingY ?? 11}px`,
                  }}
                >
                  <TextareaAutosize
                    ref={composerRef}
                    data-testid="chat-composer-textarea"
                    minRows={1}
                    maxRows={6}
                    aria-label="Message"
                    enterKeyHint={compactMobile ? 'enter' : 'send'}
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
                      fontFamily: CHAT_FONT_FAMILY,
                      fontSize: composerFontSize,
                      lineHeight: composerLineHeight,
                      padding: 0,
                      margin: 0,
                      overflowY: 'auto',
                      overflowWrap: 'anywhere',
                      wordBreak: 'break-word',
                      maxHeight: `${density.composerTextareaMaxHeight || 120}px`,
                      minHeight: `${compactMobile ? 18 : (density.composerTextareaMinHeight ?? 19)}px`,
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
                          width: compactMobile ? undefined : density.composerIconButton,
                          height: compactMobile ? undefined : density.composerIconButton,
                          backgroundColor: 'transparent',
                          color: composerIconColor,
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
                    width: density.composerActionSize || 46,
                    height: density.composerActionSize || 46,
                    backgroundColor: composerActionBg,
                    color: composerActionText,
                    boxShadow: `0 6px 16px ${alpha(composerActionBg, 0.24)}`,
                    transform: compactMobile ? undefined : 'translateY(-2px)',
                  }}
                >
                  <SendRoundedIcon sx={{ fontSize: density.composerActionIcon || 20 }} />
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
                    width: density.composerActionSize || 46,
                    height: density.composerActionSize || 46,
                    backgroundColor: alpha(composerActionBg, 0.12),
                    color: composerActionBg,
                    transform: compactMobile ? undefined : 'translateY(-2px)',
                  }}
                >
                  <MicRoundedIcon sx={{ fontSize: density.composerActionIcon || 22 }} />
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
