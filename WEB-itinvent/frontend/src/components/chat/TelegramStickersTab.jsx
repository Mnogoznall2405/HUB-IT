import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  Portal,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import TelegramIcon from '@mui/icons-material/Telegram';

import { chatStickersAPI } from '../../api/chatStickers';
import ChatStickerMedia from './ChatStickerMedia';
import ChatStickerThumbnail from './ChatStickerThumbnail';

const STICKER_PREVIEW_HOLD_MS = 420;
const STICKER_PREVIEW_MOVE_TOLERANCE_PX = 12;
const RECENT_STICKERS_LIMIT = 20;

const buildRecentStorageKey = (currentUserId) => (
  `hubit.chat.recent-stickers.v1:${String(currentUserId || 'device')}`
);

const readRecentStickerIds = (storageKey) => {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || '[]');
    return Array.isArray(parsed)
      ? parsed.map((item) => String(item || '').trim()).filter(Boolean).slice(0, RECENT_STICKERS_LIMIT)
      : [];
  } catch {
    return [];
  }
};

const getApiError = (error, fallback) => String(
  error?.response?.data?.detail
  || error?.message
  || fallback,
).trim();

const TelegramStickersTab = memo(function TelegramStickersTab({
  theme,
  ui,
  onSendSticker,
  dense = false,
  currentUserId = null,
}) {
  const recentStorageKey = useMemo(() => buildRecentStorageKey(currentUserId), [currentUserId]);
  const [packs, setPacks] = useState([]);
  const [activeSectionId, setActiveSectionId] = useState('recent');
  const [recentStickerIds, setRecentStickerIds] = useState(() => readRecentStickerIds(recentStorageKey));
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [source, setSource] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [statusText, setStatusText] = useState('');
  const [sendingStickerId, setSendingStickerId] = useState('');
  const [previewSticker, setPreviewSticker] = useState(null);
  const sourceInputRef = useRef(null);
  const packStripRef = useRef(null);
  const packTabRefsRef = useRef(new Map());
  const scrollContainerRef = useRef(null);
  const sectionRefsRef = useRef(new Map());
  const scrollFrameRef = useRef(null);
  const pendingScrollSectionRef = useRef('');
  const holdTimerRef = useRef(null);
  const pointerPressRef = useRef(null);
  const keyboardPressRef = useRef(false);
  const holdTriggeredRef = useRef(false);
  const suppressClickRef = useRef(false);

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  const openHoldPreview = useCallback((sticker) => {
    holdTriggeredRef.current = true;
    suppressClickRef.current = true;
    setPreviewSticker(sticker);
  }, []);

  const closeHoldPreview = useCallback(() => {
    clearHoldTimer();
    holdTriggeredRef.current = false;
    setPreviewSticker(null);
  }, [clearHoldTimer]);

  const scheduleHoldPreview = useCallback((sticker) => {
    clearHoldTimer();
    holdTriggeredRef.current = false;
    suppressClickRef.current = false;
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = null;
      openHoldPreview(sticker);
    }, STICKER_PREVIEW_HOLD_MS);
  }, [clearHoldTimer, openHoldPreview]);

  useEffect(() => () => clearHoldTimer(), [clearHoldTimer]);

  useEffect(() => {
    if (!previewSticker) return undefined;
    const handleEscape = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      suppressClickRef.current = true;
      closeHoldPreview();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [closeHoldPreview, previewSticker]);

  const applyPackPayload = useCallback((payload, preferredPackId = '') => {
    const nextPacks = Array.isArray(payload?.items) ? payload.items : [];
    setPacks(nextPacks);
    const preferred = String(preferredPackId || '').trim();
    if (preferred && nextPacks.some((item) => item.id === preferred)) {
      setActiveSectionId(preferred);
      pendingScrollSectionRef.current = preferred;
    }
  }, []);

  useEffect(() => {
    setRecentStickerIds(readRecentStickerIds(recentStorageKey));
  }, [recentStorageKey]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    chatStickersAPI.listPacks()
      .then((payload) => {
        if (!cancelled) applyPackPayload(payload);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(getApiError(error, 'Не удалось загрузить наборы стикеров.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [applyPackPayload]);

  useEffect(() => {
    const refreshPacks = () => {
      chatStickersAPI.listPacks()
        .then((payload) => applyPackPayload(payload))
        .catch(() => {});
    };
    window.addEventListener('chat-sticker-packs-changed', refreshPacks);
    return () => window.removeEventListener('chat-sticker-packs-changed', refreshPacks);
  }, [applyPackPayload]);

  useEffect(() => {
    if (!importOpen) return;
    const frame = window.requestAnimationFrame(() => sourceInputRef.current?.focus?.());
    return () => window.cancelAnimationFrame(frame);
  }, [importOpen]);

  const stickersById = useMemo(
    () => new Map(
      packs.flatMap((pack) => (pack.stickers || []).map((sticker) => [String(sticker.id), sticker])),
    ),
    [packs],
  );
  const recentStickers = useMemo(
    () => recentStickerIds.map((stickerId) => stickersById.get(stickerId)).filter(Boolean),
    [recentStickerIds, stickersById],
  );
  const stickerSections = useMemo(
    () => [
      { id: 'recent', title: 'Недавние', stickers: recentStickers, recent: true },
      ...packs.map((pack) => ({ ...pack, stickers: pack.stickers || [], recent: false })),
    ],
    [packs, recentStickers],
  );

  useEffect(() => {
    const validSectionIds = new Set(stickerSections.map((section) => String(section.id)));
    setActiveSectionId((current) => (validSectionIds.has(current) ? current : 'recent'));
  }, [stickerSections]);

  const registerSectionRef = useCallback((sectionId, node) => {
    const normalizedId = String(sectionId || '');
    if (node) sectionRefsRef.current.set(normalizedId, node);
    else sectionRefsRef.current.delete(normalizedId);
  }, []);

  const registerPackTabRef = useCallback((sectionId, node) => {
    const normalizedId = String(sectionId || '');
    if (node) packTabRefsRef.current.set(normalizedId, node);
    else packTabRefsRef.current.delete(normalizedId);
  }, []);

  const handlePackStripWheel = useCallback((event) => {
    const strip = packStripRef.current || event.currentTarget;
    if (!strip || strip.scrollWidth <= strip.clientWidth) return;
    const rawDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
      ? event.deltaX
      : event.deltaY;
    if (!rawDelta) return;
    const unit = event.deltaMode === 1
      ? 16
      : (event.deltaMode === 2 ? strip.clientWidth : 1);
    const maxScrollLeft = Math.max(0, strip.scrollWidth - strip.clientWidth);
    const nextScrollLeft = Math.max(
      0,
      Math.min(maxScrollLeft, strip.scrollLeft + (rawDelta * unit)),
    );
    if (nextScrollLeft === strip.scrollLeft) return;
    event.preventDefault();
    strip.scrollLeft = nextScrollLeft;
  }, []);

  useEffect(() => {
    const strip = packStripRef.current;
    const activeTab = packTabRefsRef.current.get(String(activeSectionId));
    if (!strip || !activeTab || strip.scrollWidth <= strip.clientWidth) return;
    const edgePadding = 6;
    const visibleStart = strip.scrollLeft;
    const visibleEnd = visibleStart + strip.clientWidth;
    const tabStart = activeTab.offsetLeft;
    const tabEnd = tabStart + activeTab.offsetWidth;
    let nextScrollLeft = visibleStart;

    if (tabStart < visibleStart + edgePadding) {
      nextScrollLeft = Math.max(0, tabStart - edgePadding);
    } else if (tabEnd > visibleEnd - edgePadding) {
      nextScrollLeft = Math.min(
        Math.max(0, strip.scrollWidth - strip.clientWidth),
        tabEnd - strip.clientWidth + edgePadding,
      );
    }
    if (Math.abs(nextScrollLeft - visibleStart) < 1) return;
    if (typeof strip.scrollTo === 'function') {
      strip.scrollTo({ left: nextScrollLeft, behavior: 'smooth' });
    } else {
      strip.scrollLeft = nextScrollLeft;
    }
  }, [activeSectionId]);

  const scrollToSection = useCallback((sectionId) => {
    const normalizedId = String(sectionId || '');
    const scrollRoot = scrollContainerRef.current;
    const sectionNode = sectionRefsRef.current.get(normalizedId);
    setActiveSectionId(normalizedId);
    if (!scrollRoot || !sectionNode) return;
    const nextTop = Math.max(0, sectionNode.offsetTop - 4);
    if (typeof scrollRoot.scrollTo === 'function') {
      scrollRoot.scrollTo({ top: nextTop, behavior: 'smooth' });
    } else {
      scrollRoot.scrollTop = nextTop;
    }
  }, []);

  useEffect(() => {
    const pendingSectionId = pendingScrollSectionRef.current;
    if (!pendingSectionId || !sectionRefsRef.current.has(pendingSectionId)) return undefined;
    pendingScrollSectionRef.current = '';
    const frame = window.requestAnimationFrame(() => scrollToSection(pendingSectionId));
    return () => window.cancelAnimationFrame(frame);
  }, [scrollToSection, stickerSections]);

  useEffect(() => {
    const scrollRoot = scrollContainerRef.current;
    if (!scrollRoot) return undefined;
    const updateActiveSection = () => {
      scrollFrameRef.current = null;
      const marker = scrollRoot.scrollTop + 20;
      let nextSectionId = 'recent';
      stickerSections.forEach((section) => {
        const sectionNode = sectionRefsRef.current.get(String(section.id));
        if (sectionNode && sectionNode.offsetTop <= marker) nextSectionId = String(section.id);
      });
      setActiveSectionId((current) => (current === nextSectionId ? current : nextSectionId));
    };
    const handleScroll = () => {
      if (scrollFrameRef.current !== null) return;
      scrollFrameRef.current = window.requestAnimationFrame(updateActiveSection);
    };
    scrollRoot.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      scrollRoot.removeEventListener('scroll', handleScroll);
      if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = null;
    };
  }, [stickerSections]);

  const rememberRecentSticker = useCallback((stickerId) => {
    const normalizedStickerId = String(stickerId || '').trim();
    if (!normalizedStickerId) return;
    setRecentStickerIds((current) => {
      const next = [normalizedStickerId, ...current.filter((item) => item !== normalizedStickerId)]
        .slice(0, RECENT_STICKERS_LIMIT);
      try {
        window.localStorage.setItem(recentStorageKey, JSON.stringify(next));
      } catch {
        // The picker still works when browser storage is unavailable.
      }
      return next;
    });
  }, [recentStorageKey]);

  const handleImportSubmit = useCallback(async (event) => {
    event.preventDefault();
    const normalizedSource = String(source || '').trim();
    if (!normalizedSource) {
      setImportError('Вставьте ссылку на набор Telegram.');
      sourceInputRef.current?.focus?.();
      return;
    }
    setImporting(true);
    setImportError('');
    setStatusText('');
    try {
      const payload = await chatStickersAPI.importPack(normalizedSource);
      const nextPacks = Array.isArray(payload?.items) ? payload.items : [];
      const importedShortName = normalizedSource.split('/').filter(Boolean).pop()?.split('?')[0] || '';
      const importedPack = nextPacks.find(
        (item) => String(item?.short_name || '').toLowerCase() === importedShortName.toLowerCase(),
      ) || nextPacks[nextPacks.length - 1];
      applyPackPayload(payload, importedPack?.id);
      setSource('');
      setImportOpen(false);
      setStatusText(`Набор «${importedPack?.title || 'Telegram'}» добавлен.`);
    } catch (error) {
      setImportError(getApiError(error, 'Не удалось импортировать набор.'));
    } finally {
      setImporting(false);
    }
  }, [applyPackPayload, source]);

  const handleStickerClick = useCallback(async (sticker) => {
    const stickerId = String(sticker?.id || '').trim();
    if (!stickerId || sendingStickerId) return;
    setSendingStickerId(stickerId);
    setStatusText('');
    try {
      const sent = await onSendSticker?.(sticker);
      if (sent === false) {
        setStatusText('Стикер не отправлен.');
      } else {
        rememberRecentSticker(stickerId);
      }
    } finally {
      setSendingStickerId('');
    }
  }, [onSendSticker, rememberRecentSticker, sendingStickerId]);

  const handleStickerPointerDown = useCallback((event, sticker) => {
    if (sendingStickerId || (event.pointerType === 'mouse' && event.button !== 0)) return;
    pointerPressRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    scheduleHoldPreview(sticker);
  }, [scheduleHoldPreview, sendingStickerId]);

  const handleStickerPointerMove = useCallback((event) => {
    const press = pointerPressRef.current;
    if (!press || press.pointerId !== event.pointerId || holdTriggeredRef.current) return;
    const distance = Math.hypot(event.clientX - press.x, event.clientY - press.y);
    if (distance <= STICKER_PREVIEW_MOVE_TOLERANCE_PX) return;
    pointerPressRef.current = null;
    clearHoldTimer();
  }, [clearHoldTimer]);

  const handleStickerPointerEnd = useCallback((event) => {
    const press = pointerPressRef.current;
    if (!press || press.pointerId !== event.pointerId) return;
    const previewWasOpen = holdTriggeredRef.current;
    pointerPressRef.current = null;
    clearHoldTimer();
    if (previewWasOpen) {
      suppressClickRef.current = true;
      closeHoldPreview();
    }
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }, [clearHoldTimer, closeHoldPreview]);

  const handleStickerPointerCancel = useCallback(() => {
    pointerPressRef.current = null;
    clearHoldTimer();
    if (holdTriggeredRef.current) suppressClickRef.current = true;
    closeHoldPreview();
  }, [clearHoldTimer, closeHoldPreview]);

  const handleStickerButtonClick = useCallback((event, sticker) => {
    if (suppressClickRef.current) {
      event.preventDefault();
      suppressClickRef.current = false;
      return;
    }
    void handleStickerClick(sticker);
  }, [handleStickerClick]);

  const handleStickerKeyDown = useCallback((event, sticker) => {
    if (event.key !== ' ' || event.repeat || keyboardPressRef.current || sendingStickerId) return;
    event.preventDefault();
    keyboardPressRef.current = true;
    scheduleHoldPreview(sticker);
  }, [scheduleHoldPreview, sendingStickerId]);

  const handleStickerKeyUp = useCallback((event, sticker) => {
    if (event.key !== ' ' || !keyboardPressRef.current) return;
    event.preventDefault();
    keyboardPressRef.current = false;
    const previewWasOpen = holdTriggeredRef.current;
    const shouldSuppressSend = previewWasOpen || suppressClickRef.current;
    clearHoldTimer();
    if (shouldSuppressSend) {
      suppressClickRef.current = false;
      closeHoldPreview();
      return;
    }
    void handleStickerClick(sticker);
  }, [clearHoldTimer, closeHoldPreview, handleStickerClick]);

  const accent = ui.accentText || theme.palette.primary.main;
  const border = ui.borderSoft || theme.palette.divider;
  const panelBg = ui.composerBg || ui.panelBg || theme.palette.background.paper;

  if (loading) {
    return (
      <Box sx={{ height: '100%', display: 'grid', placeItems: 'center' }}>
        <CircularProgress size={24} aria-label="Загрузка наборов стикеров" />
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Box
        sx={{
          minHeight: dense ? 44 : 48,
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          px: 0.75,
          borderBottom: `1px solid ${border}`,
        }}
      >
        <Box
          ref={packStripRef}
          role="tablist"
          aria-label="Наборы стикеров"
          onWheel={handlePackStripWheel}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.4,
            overflowX: 'auto',
            overscrollBehaviorInline: 'contain',
            scrollbarWidth: 'none',
            flex: 1,
            minWidth: 0,
            '&::-webkit-scrollbar': { display: 'none' },
          }}
        >
          <Tooltip title="Недавние" placement="top">
            <Box
              ref={(node) => registerPackTabRef('recent', node)}
              component="button"
              type="button"
              role="tab"
              aria-selected={activeSectionId === 'recent'}
              aria-label="Недавние"
              onClick={() => scrollToSection('recent')}
              sx={{
                width: dense ? 38 : 42,
                height: dense ? 38 : 42,
                flexShrink: 0,
                display: 'grid',
                placeItems: 'center',
                p: 0.35,
                border: 'none',
                borderRadius: 2,
                color: activeSectionId === 'recent' ? accent : (ui.textSecondary || theme.palette.text.secondary),
                bgcolor: activeSectionId === 'recent' ? alpha(accent, 0.14) : 'transparent',
                cursor: 'pointer',
                transition: 'background-color 120ms ease, color 120ms ease, transform 100ms ease',
                '&:hover': { bgcolor: alpha(accent, 0.1) },
                '&:active': { transform: 'scale(0.96)' },
                '&:focus-visible': { outline: `2px solid ${accent}`, outlineOffset: 1 },
              }}
            >
              <HistoryRoundedIcon sx={{ fontSize: dense ? 23 : 25 }} aria-hidden="true" />
            </Box>
          </Tooltip>
          {packs.map((pack) => {
            const selected = pack.id === activeSectionId;
            const cover = pack.stickers?.[0];
            return (
              <Tooltip key={pack.id} title={pack.title} placement="top">
                <Box
                  ref={(node) => registerPackTabRef(pack.id, node)}
                  component="button"
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-label={pack.title}
                  onClick={() => scrollToSection(pack.id)}
                  sx={{
                    width: dense ? 38 : 42,
                    height: dense ? 38 : 42,
                    flexShrink: 0,
                    display: 'grid',
                    placeItems: 'center',
                    p: 0.35,
                    border: 'none',
                    borderRadius: 2,
                    color: 'inherit',
                    bgcolor: selected ? alpha(accent, 0.14) : 'transparent',
                    cursor: 'pointer',
                    transition: 'background-color 120ms ease, transform 100ms ease',
                    '&:hover': { bgcolor: alpha(accent, 0.1) },
                    '&:active': { transform: 'scale(0.96)' },
                    '&:focus-visible': { outline: `2px solid ${accent}`, outlineOffset: 1 },
                  }}
                >
                  {cover ? (
                    <ChatStickerThumbnail sticker={cover} size={dense ? 30 : 34} staticOnly />
                  ) : (
                    <TelegramIcon sx={{ fontSize: 22 }} aria-hidden="true" />
                  )}
                </Box>
              </Tooltip>
            );
          })}
        </Box>
        <Tooltip title={importOpen ? 'Закрыть добавление' : 'Добавить набор из Telegram'}>
          <IconButton
            type="button"
            aria-label={importOpen ? 'Закрыть добавление набора' : 'Добавить набор стикеров из Telegram'}
            onClick={() => {
              setImportOpen((value) => !value);
              setImportError('');
            }}
            sx={{
              width: dense ? 36 : 40,
              height: dense ? 36 : 40,
              flexShrink: 0,
              color: accent,
              bgcolor: alpha(accent, 0.08),
              transition: 'background-color 120ms ease, transform 100ms ease',
              '&:hover': { bgcolor: alpha(accent, 0.14) },
              '&:active': { transform: 'scale(0.96)' },
            }}
          >
            {importOpen ? <CloseRoundedIcon /> : <AddRoundedIcon />}
          </IconButton>
        </Tooltip>
      </Box>

      {importOpen ? (
        <Box
          component="form"
          onSubmit={handleImportSubmit}
          noValidate
          sx={{ p: 1, display: 'grid', gap: 0.8, borderBottom: `1px solid ${border}` }}
        >
          <TextField
            inputRef={sourceInputRef}
            value={source}
            onChange={(event) => {
              setSource(event.target.value);
              setImportError('');
            }}
            label="Ссылка на набор Telegram"
            placeholder="https://t.me/addstickers/PackName"
            size="small"
            fullWidth
            autoComplete="off"
            error={Boolean(importError)}
            helperText={importError || 'Откройте набор в Telegram и скопируйте его ссылку.'}
            inputProps={{ inputMode: 'url', 'aria-describedby': 'telegram-sticker-import-help' }}
            FormHelperTextProps={{ id: 'telegram-sticker-import-help' }}
            sx={{ '& .MuiInputBase-input': { fontSize: 16 } }}
          />
          <Button
            type="submit"
            variant="contained"
            disabled={importing}
            startIcon={importing ? <CircularProgress size={16} color="inherit" /> : <TelegramIcon />}
            sx={{ minHeight: 40, justifySelf: 'end', textTransform: 'none', '&:active': { transform: 'scale(0.96)' } }}
          >
            {importing ? 'Импортируем…' : 'Добавить набор'}
          </Button>
        </Box>
      ) : null}

      <Box role="status" aria-live="polite" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        {statusText}
      </Box>

      {loadError ? (
        <Alert severity="error" sx={{ m: 1 }}>{loadError}</Alert>
      ) : packs.length === 0 ? (
        <Box sx={{ flex: 1, display: 'grid', placeItems: 'center', p: 2, textAlign: 'center' }}>
          <Box>
            <TelegramIcon sx={{ fontSize: 38, color: accent, mb: 0.6 }} aria-hidden="true" />
            <Typography sx={{ fontSize: 14, fontWeight: 700, color: ui.textPrimary || theme.palette.text.primary }}>
              Добавьте первый набор
            </Typography>
            <Typography sx={{ mt: 0.4, fontSize: 12.5, lineHeight: 1.35, color: ui.textSecondary || theme.palette.text.secondary }}>
              Нажмите «+» и вставьте ссылку t.me/addstickers/…
            </Typography>
          </Box>
        </Box>
      ) : (
        <Box
          ref={scrollContainerRef}
          data-testid="chat-sticker-sections-scroll"
          sx={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', px: 0.75, py: 0.6 }}
        >
          {stickerSections.map((section) => (
            <Box
              key={section.id}
              component="section"
              ref={(node) => registerSectionRef(section.id, node)}
              data-sticker-section={section.id}
              sx={{ pb: section.id === stickerSections.at(-1)?.id ? 0.5 : 1.2 }}
            >
              <Typography
                sx={{
                  position: 'sticky',
                  top: 0,
                  zIndex: 2,
                  px: 0.4,
                  py: 0.55,
                  fontSize: 12,
                  fontWeight: 800,
                  color: ui.textSecondary || theme.palette.text.secondary,
                  bgcolor: panelBg,
                }}
              >
                {section.title}
              </Typography>
              {section.recent && section.stickers.length === 0 ? (
                <Typography
                  sx={{
                    px: 0.5,
                    py: 1,
                    fontSize: 12.5,
                    lineHeight: 1.35,
                    color: alpha(ui.textSecondary || theme.palette.text.secondary, 0.78),
                  }}
                >
                  Отправленные стикеры появятся здесь
                </Typography>
              ) : (
                <Box
                  role="tabpanel"
                  aria-label={section.title}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${dense ? 5 : 4}, minmax(0, 1fr))`,
                    gap: dense ? 0.3 : 0.4,
                    alignItems: 'start',
                  }}
                >
                  {section.stickers.map((sticker) => (
              <Box
                key={`${section.id}-${sticker.id}`}
                component="button"
                type="button"
                aria-label={`Отправить стикер ${sticker.emoji || ''}`.trim()}
                disabled={Boolean(sendingStickerId)}
                onClick={(event) => handleStickerButtonClick(event, sticker)}
                onPointerDown={(event) => handleStickerPointerDown(event, sticker)}
                onPointerMove={handleStickerPointerMove}
                onPointerUp={handleStickerPointerEnd}
                onPointerCancel={handleStickerPointerCancel}
                onKeyDown={(event) => handleStickerKeyDown(event, sticker)}
                onKeyUp={(event) => handleStickerKeyUp(event, sticker)}
                onContextMenu={(event) => event.preventDefault()}
                sx={{
                  position: 'relative',
                  aspectRatio: '1 / 1',
                  minWidth: 0,
                  p: 0.2,
                  display: 'grid',
                  placeItems: 'center',
                  border: 'none',
                  borderRadius: 2,
                  bgcolor: 'transparent',
                  cursor: sendingStickerId ? 'wait' : 'pointer',
                  touchAction: 'manipulation',
                  userSelect: 'none',
                  WebkitUserSelect: 'none',
                  WebkitTouchCallout: 'none',
                  contentVisibility: 'auto',
                  containIntrinsicSize: dense ? '72px 72px' : '80px 80px',
                  transition: 'background-color 120ms ease, transform 100ms ease, opacity 120ms ease',
                  opacity: sendingStickerId && sendingStickerId !== sticker.id ? 0.55 : 1,
                  '&:hover': { bgcolor: alpha(accent, 0.08) },
                  '&:active': { transform: 'scale(0.96)' },
                  '&:focus-visible': { outline: `2px solid ${accent}`, outlineOffset: 1 },
                }}
              >
                <ChatStickerThumbnail sticker={sticker} size={dense ? 68 : 76} staticOnly />
                {sendingStickerId === sticker.id ? (
                  <CircularProgress size={22} sx={{ position: 'absolute', color: accent }} aria-label="Отправка стикера" />
                ) : null}
              </Box>
                  ))}
                </Box>
              )}
            </Box>
          ))}
        </Box>
      )}

      {previewSticker ? (
        <Portal>
          <Box
            data-testid="sticker-hold-preview"
            aria-hidden="true"
            sx={{
              position: 'fixed',
              inset: 0,
              zIndex: theme.zIndex.modal + 10,
              display: 'grid',
              placeItems: 'center',
              pointerEvents: 'none',
              bgcolor: alpha(theme.palette.common.black, 0.78),
              boxSizing: 'border-box',
              p: 'max(12px, env(safe-area-inset-top, 0px)) max(12px, env(safe-area-inset-right, 0px)) max(12px, env(safe-area-inset-bottom, 0px)) max(12px, env(safe-area-inset-left, 0px))',
            }}
          >
            <Box
              data-testid="sticker-hold-preview-frame"
              sx={{
                width: 'min(560px, calc(100vw - 24px), calc(100vh - 112px))',
                maxWidth: '100%',
                display: 'grid',
                justifyItems: 'center',
                gap: 2,
                filter: 'drop-shadow(0 18px 44px rgba(0, 0, 0, 0.42))',
                '@supports (width: 100dvw)': {
                  width: 'min(560px, calc(100dvw - 24px), calc(100dvh - 112px))',
                },
              }}
            >
              <ChatStickerMedia
                src={previewSticker.file_url}
                mimeType={previewSticker.mime_type}
                posterSrc={previewSticker.preview_url}
                emoji={previewSticker.emoji}
                decorative
                autoPlay
                forceAutoPlay
                eager
                size={560}
              />
              <Typography
                variant="body2"
                sx={{
                  color: theme.palette.common.white,
                  bgcolor: alpha(theme.palette.common.black, 0.36),
                  borderRadius: 999,
                  px: 1.5,
                  py: 0.65,
                }}
              >
                Отпустите, чтобы закрыть
              </Typography>
            </Box>
          </Box>
        </Portal>
      ) : null}
    </Box>
  );
});

export default TelegramStickersTab;
