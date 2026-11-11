import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  ButtonBase,
  Chip,
  Dialog,
  DialogContent,
  IconButton,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CloseIcon from '@mui/icons-material/Close';
import { fsEgressAPI } from '../../api/fsEgress';
import {
  chatKey,
  dedupeMessages,
  displayChatTitle,
  displayMessageText,
  formatMsgClock,
  formatShotWhen,
  groupMessagesByDay,
  isImageMedia,
  lastMessagePreview,
  mediaFileName,
  messageDayMeta,
  messageSide,
  normalizeHost,
  parseScreenshotStamp,
  resolveMessageScreenshot,
} from './utils';

function ScreenshotStrip({
  computerName,
  screenshots,
  chatName = '',
  openFileName = '',
  onOpenHandled,
  getMedia = fsEgressAPI.getTelegramMedia,
  productLabel = 'Telegram',
}) {
  const host = normalizeHost(computerName);
  const [items, setItems] = useState([]);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    let cancelled = false;
    const urls = [];
    const list = Array.isArray(screenshots) ? screenshots : [];
    if (!host || !list.length) {
      setItems([]);
      return undefined;
    }
    (async () => {
      const loaded = [];
      // Newest last in store; show chronological, keep last 24 for the strip.
      const ordered = list
        .map((shot, index) => {
          const fileName = mediaFileName(shot);
          const date = parseScreenshotStamp(fileName);
          return { shot, fileName, date, index };
        })
        .filter((row) => row.fileName)
        .sort((a, b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0));
      const slice = ordered.slice(-40);
      for (const row of slice) {
        try {
          const res = await getMedia(host, row.fileName);
          if (cancelled) return;
          const blob = res.data instanceof Blob ? res.data : new Blob([res.data]);
          const objectUrl = URL.createObjectURL(blob);
          urls.push(objectUrl);
          const when = formatShotWhen(row.date);
          loaded.push({
            fileName: row.fileName,
            path: String(row.shot || '').replace(/\\/g, '/'),
            url: objectUrl,
            date: row.date,
            dayLabel: when.day,
            clockLabel: when.clock,
          });
        } catch {
          // skip missing shot
        }
      }
      if (!cancelled) setItems(loaded);
    })();
    return () => {
      cancelled = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [host, screenshots, getMedia]);

  useEffect(() => {
    if (activeIndex < 0) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') setActiveIndex(-1);
      if (event.key === 'ArrowLeft') {
        setActiveIndex((idx) => (idx <= 0 ? items.length - 1 : idx - 1));
      }
      if (event.key === 'ArrowRight') {
        setActiveIndex((idx) => (idx >= items.length - 1 ? 0 : idx + 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeIndex, items.length]);

  useEffect(() => {
    if (!openFileName || !host) return undefined;
    let cancelled = false;
    const target = mediaFileName(openFileName);
    if (!target) {
      onOpenHandled?.();
      return undefined;
    }

    const openExisting = (list) => {
      const existing = list.findIndex((item) => item.fileName === target);
      if (existing >= 0) {
        setActiveIndex(existing);
        onOpenHandled?.();
        return true;
      }
      return false;
    };

    if (openExisting(items)) return undefined;

    (async () => {
      try {
        const res = await getMedia(host, target);
        if (cancelled) return;
        const blob = res.data instanceof Blob ? res.data : new Blob([res.data]);
        const objectUrl = URL.createObjectURL(blob);
        const stamp = parseScreenshotStamp(target);
        const when = formatShotWhen(stamp);
        setItems((prev) => {
          if (prev.some((item) => item.fileName === target)) {
            const idx = prev.findIndex((item) => item.fileName === target);
            setActiveIndex(idx);
            return prev;
          }
          const next = [
            ...prev,
            {
              fileName: target,
              path: target,
              url: objectUrl,
              date: stamp,
              dayLabel: when.day,
              clockLabel: when.clock,
            },
          ];
          setActiveIndex(next.length - 1);
          return next;
        });
      } catch {
        // missing file
      } finally {
        if (!cancelled) onOpenHandled?.();
      }
    })();
    return () => {
      cancelled = true;
    };
    // intentionally ignore `items` to avoid re-fetch loops; openFileName is the trigger
  }, [openFileName, host, getMedia]);

  if (!items.length) return null;
  const active = activeIndex >= 0 ? items[activeIndex] : null;
  const total = Array.isArray(screenshots) ? screenshots.length : items.length;

  return (
    <>
      <Box
        component="aside"
        aria-label={`Снимки окна ${productLabel}`}
        sx={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          minWidth: 0,
          height: '100%',
          overflow: 'hidden',
          borderLeft: { md: '1px solid' },
          borderTop: { xs: '1px solid', md: 0 },
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <Box sx={{ px: 1.25, pt: 1.25, pb: 0.85, flexShrink: 0 }}>
          <Typography
            component="h3"
            sx={{ fontSize: 13, fontWeight: 700, letterSpacing: '-0.01em', lineHeight: 1.25 }}
          >
            Снимки
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
            {items.length}
            {total > items.length ? ` из ${total}` : ''} · дата съёмки
          </Typography>
        </Box>
        <Box
          sx={{
            px: 1,
            pb: 1.25,
            overflowY: 'auto',
            overflowX: 'hidden',
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            '&::-webkit-scrollbar': { width: 6 },
            '&::-webkit-scrollbar-thumb': {
              bgcolor: 'action.disabled',
              borderRadius: 999,
            },
          }}
        >
          {items.map((item, index) => (
            <ButtonBase
              key={item.fileName}
              focusRipple
              onClick={() => setActiveIndex(index)}
              aria-label={`Снимок ${item.dayLabel} ${item.clockLabel}`}
              sx={{
                width: '100%',
                maxWidth: '100%',
                flexShrink: 0,
                borderRadius: 1.5,
                overflow: 'hidden',
                bgcolor: 'background.default',
                boxShadow: (theme) =>
                  theme.palette.mode === 'dark'
                    ? '0 0 0 1px rgba(255,255,255,0.08)'
                    : '0 0 0 1px rgba(0,0,0,0.08)',
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'stretch',
                '&:hover': {
                  boxShadow: (theme) =>
                    theme.palette.mode === 'dark'
                      ? '0 0 0 1px rgba(255,255,255,0.16)'
                      : '0 0 0 1px rgba(25,118,210,0.35)',
                },
                '&.Mui-focusVisible': {
                  outline: '2px solid',
                  outlineColor: 'primary.main',
                  outlineOffset: 1,
                },
              }}
            >
              <Box
                sx={{
                  width: '100%',
                  aspectRatio: '16 / 10',
                  overflow: 'hidden',
                  bgcolor: 'action.hover',
                }}
              >
                <Box
                  component="img"
                  src={item.url}
                  alt=""
                  loading="lazy"
                  sx={{
                    display: 'block',
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    objectPosition: 'top center',
                  }}
                />
              </Box>
              <Box sx={{ px: 0.9, py: 0.55, width: '100%' }}>
                <Typography sx={{ fontSize: 11, fontWeight: 700, lineHeight: 1.2 }} noWrap>
                  {item.dayLabel}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' }}
                >
                  {item.clockLabel}
                </Typography>
              </Box>
            </ButtonBase>
          ))}
        </Box>
      </Box>

      <Dialog
        open={Boolean(active)}
        onClose={() => setActiveIndex(-1)}
        maxWidth="lg"
        fullWidth
        PaperProps={{
          sx: {
            bgcolor: 'background.paper',
            backgroundImage: 'none',
            overflow: 'hidden',
          },
        }}
      >
        {active ? (
          <>
            <Stack
              direction="row"
              alignItems="flex-start"
              justifyContent="space-between"
              spacing={1}
              sx={{ px: 2, pt: 1.5, pb: 1 }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography fontWeight={700} noWrap>
                  {chatName || 'Скриншот диалога'}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {active.dayLabel} · {active.clockLabel}
                  {items.length > 1 ? ` · ${activeIndex + 1} / ${items.length}` : ''}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }} noWrap>
                  {active.fileName}
                </Typography>
              </Box>
              <IconButton aria-label="Закрыть" onClick={() => setActiveIndex(-1)} size="small">
                <CloseIcon fontSize="small" />
              </IconButton>
            </Stack>
            <DialogContent
              sx={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: 'rgba(0,0,0,0.35)',
                minHeight: { xs: 280, sm: 420 },
                py: 2,
              }}
            >
              {items.length > 1 ? (
                <IconButton
                  aria-label="Предыдущий"
                  onClick={() => setActiveIndex((idx) => (idx <= 0 ? items.length - 1 : idx - 1))}
                  sx={{
                    position: 'absolute',
                    left: 8,
                    color: 'common.white',
                    bgcolor: 'rgba(0,0,0,0.35)',
                    '&:hover': { bgcolor: 'rgba(0,0,0,0.5)' },
                  }}
                >
                  <ChevronLeftIcon />
                </IconButton>
              ) : null}
              <Box
                component="img"
                src={active.url}
                alt={active.fileName}
                sx={{
                  maxWidth: '100%',
                  maxHeight: { xs: '55vh', sm: '70vh' },
                  objectFit: 'contain',
                  borderRadius: 1,
                  outline: '1px solid',
                  outlineColor: 'rgba(255,255,255,0.12)',
                  boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
                }}
              />
              {items.length > 1 ? (
                <IconButton
                  aria-label="Следующий"
                  onClick={() => setActiveIndex((idx) => (idx >= items.length - 1 ? 0 : idx + 1))}
                  sx={{
                    position: 'absolute',
                    right: 8,
                    color: 'common.white',
                    bgcolor: 'rgba(0,0,0,0.35)',
                    '&:hover': { bgcolor: 'rgba(0,0,0,0.5)' },
                  }}
                >
                  <ChevronRightIcon />
                </IconButton>
              ) : null}
            </DialogContent>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              justifyContent="space-between"
              alignItems={{ xs: 'stretch', sm: 'center' }}
              sx={{ px: 2, py: 1.5, borderTop: 1, borderColor: 'divider' }}
            >
              <Typography variant="caption" color="text.secondary" sx={{ textWrap: 'pretty' }}>
                {`Время съёмки окна ${productLabel}. Клавиши ← → переключают снимки.`}
              </Typography>
              <Button
                size="small"
                variant="contained"
                onClick={() => window.open(active.url, '_blank', 'noopener,noreferrer')}
              >
                Открыть в новой вкладке
              </Button>
            </Stack>
          </>
        ) : null}
      </Dialog>
    </>
  );
}

function MessageMedia({ computerName, msg, getMedia = fsEgressAPI.getTelegramMedia }) {
  const [url, setUrl] = useState('');
  const fileName = mediaFileName(msg?.media_path);
  const host = normalizeHost(computerName);
  const label = String(msg?.media || '').trim();
  const canPreview = Boolean(host && fileName && isImageMedia(msg));

  useEffect(() => {
    let revoked = '';
    let cancelled = false;
    if (!canPreview) {
      setUrl('');
      return undefined;
    }
    (async () => {
      try {
        const res = await getMedia(host, fileName);
        if (cancelled) return;
        const blob = res.data instanceof Blob ? res.data : new Blob([res.data]);
        const objectUrl = URL.createObjectURL(blob);
        revoked = objectUrl;
        setUrl(objectUrl);
      } catch {
        if (!cancelled) setUrl('');
      }
    })();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [canPreview, host, fileName, getMedia]);

  if (url) {
    return (
      <Box
        component="img"
        src={url}
        alt={label || 'Фото'}
        loading="lazy"
        sx={{
          display: 'block',
          maxWidth: 200,
          maxHeight: 160,
          width: 'auto',
          height: 'auto',
          borderRadius: 1,
          mb: displayMessageText(msg) ? 0.35 : 0,
          cursor: 'pointer',
          outline: '1px solid',
          outlineColor: (theme) =>
            theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
        }}
        onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
      />
    );
  }
  if (label) {
    return (
      <Typography
        variant="caption"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          mb: 0.35,
          px: 0.7,
          py: 0.2,
          borderRadius: 1,
          bgcolor: 'action.hover',
        }}
      >
        {label}
        {canPreview ? ' · загрузка…' : ''}
      </Typography>
    );
  }
  return null;
}

function ChatBubble({
  computerName,
  msg,
  screenshotFile = '',
  onOpenScreenshot,
  getMedia = fsEgressAPI.getTelegramMedia,
}) {
  const side = messageSide(msg?.direction);
  const mine = side === 'out';
  const text = displayMessageText(msg);
  const who = String(msg?.sender || (mine ? 'Я' : 'Собеседник')).trim() || (mine ? 'Я' : 'Собеседник');
  const day = messageDayMeta(msg);
  const clock = formatMsgClock(msg);
  const fullWhen = day.date
    ? `${day.date.toLocaleDateString('ru-RU')} ${clock}`
    : day.key !== 'unknown'
      ? `${day.label} ${clock}`
      : clock;

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: mine ? 'flex-end' : 'flex-start',
        mb: 0.55,
        px: 1.25,
      }}
    >
      <Box
        sx={{
          maxWidth: '78%',
          px: 1.1,
          py: 0.55,
          borderRadius: mine ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
          bgcolor: mine ? 'primary.main' : 'background.paper',
          color: mine ? 'primary.contrastText' : 'text.primary',
          boxShadow: mine
            ? 'none'
            : (theme) =>
                theme.palette.mode === 'dark'
                  ? '0 0 0 1px rgba(255,255,255,0.08)'
                  : '0 0 0 1px rgba(0,0,0,0.07)',
        }}
      >
        {!mine ? (
          <Typography
            sx={{
              fontSize: 10.5,
              fontWeight: 700,
              opacity: 0.8,
              mb: 0.15,
              lineHeight: 1.15,
            }}
          >
            {who}
          </Typography>
        ) : null}
        {(msg?.quote || msg?.reply_to) ? (
          <Box
            sx={{
              mb: 0.35,
              px: 0.65,
              py: 0.3,
              borderLeft: '2px solid',
              borderColor: mine ? 'rgba(255,255,255,0.55)' : 'primary.main',
              bgcolor: mine ? 'rgba(255,255,255,0.12)' : 'action.hover',
              borderRadius: 0.75,
            }}
          >
            <Typography sx={{ fontSize: 10, opacity: 0.85, lineHeight: 1.2 }}>
              {msg?.reply_to ? `Ответ для ${msg.reply_to}` : 'Ответ'}
            </Typography>
            {msg?.quote ? (
              <Typography sx={{ fontSize: 11, fontStyle: 'italic', lineHeight: 1.3 }}>
                {msg.quote}
              </Typography>
            ) : null}
          </Box>
        ) : null}
        <MessageMedia computerName={computerName} msg={msg} getMedia={getMedia} />
        {text ? (
          <Typography
            sx={{
              fontSize: 13,
              lineHeight: 1.35,
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
            }}
          >
            {text}
          </Typography>
        ) : null}
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="flex-end"
          spacing={0.75}
          sx={{ mt: 0.25 }}
        >
          {screenshotFile && onOpenScreenshot ? (
            <Button
              size="small"
              onClick={() => onOpenScreenshot(screenshotFile)}
              sx={{
                minWidth: 0,
                minHeight: 0,
                px: 0.6,
                py: 0.1,
                fontSize: 10,
                lineHeight: 1.2,
                textTransform: 'none',
                color: mine ? 'inherit' : 'primary.main',
                opacity: mine ? 0.9 : 1,
                borderColor: mine ? 'rgba(255,255,255,0.45)' : 'divider',
              }}
              variant="text"
              title="Открыть снимок окна с этим сообщением"
            >
              Снимок
            </Button>
          ) : null}
          <Typography
            sx={{
              fontSize: 10,
              opacity: 0.68,
              lineHeight: 1.1,
              fontVariantNumeric: 'tabular-nums',
            }}
            title={fullWhen}
          >
            {clock}
          </Typography>
        </Stack>
      </Box>
    </Box>
  );
}

export function TelegramDialogPanel({
  chats,
  getMedia = fsEgressAPI.getTelegramMedia,
  productLabel = 'Telegram',
  emptyHint = 'Откройте чат в Telegram на этом ПК — probe снимет переписку и снимки окна.',
}) {
  const sortedChats = useMemo(() => {
    return [...chats]
      .filter((chat) => dedupeMessages(chat.messages).length > 0)
      .sort((a, b) => {
        const am = dedupeMessages(a.messages);
        const bm = dedupeMessages(b.messages);
        const at = messageDayMeta(am[am.length - 1]).date?.getTime()
          || Number(a.updated_at || 0) * 1000
          || 0;
        const bt = messageDayMeta(bm[bm.length - 1]).date?.getTime()
          || Number(b.updated_at || 0) * 1000
          || 0;
        return bt - at;
      });
  }, [chats]);

  const [activeKey, setActiveKey] = useState('');
  const [openShotFile, setOpenShotFile] = useState('');

  useEffect(() => {
    if (!sortedChats.length) {
      setActiveKey('');
      return;
    }
    const exists = sortedChats.some((chat, index) => chatKey(chat, index) === activeKey);
    if (!exists) setActiveKey(chatKey(sortedChats[0], 0));
  }, [sortedChats, activeKey]);

  useEffect(() => {
    setOpenShotFile('');
  }, [activeKey]);

  if (!sortedChats.length) {
    return (
      <Paper
        variant="outlined"
        sx={{
          px: 3,
          py: 4,
          borderRadius: 2.5,
          textAlign: 'center',
          bgcolor: 'background.paper',
        }}
      >
        <Typography sx={{ fontWeight: 700, mb: 0.75 }}>Диалогов пока нет</Typography>
        <Typography color="text.secondary" sx={{ maxWidth: 420, mx: 'auto', textWrap: 'pretty' }}>
          {emptyHint}
        </Typography>
      </Paper>
    );
  }

  const activeIndex = Math.max(
    0,
    sortedChats.findIndex((chat, index) => chatKey(chat, index) === activeKey),
  );
  const active = sortedChats[activeIndex] || {};
  const messages = dedupeMessages(active.messages);
  const groups = groupMessagesByDay(messages);
  const host = normalizeHost(active.computer_name);
  const chatShots = Array.isArray(active.screenshots) ? active.screenshots : [];
  const shotCount = chatShots.length;
  const hasShots = shotCount > 0 || Boolean(openShotFile);

  return (
    <Box
      sx={{
        display: 'grid',
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        height: '100%',
        minHeight: 0,
        gridTemplateColumns: {
          xs: '1fr',
          md: hasShots
            ? 'minmax(180px, 220px) minmax(0, 1fr) minmax(168px, 200px)'
            : 'minmax(180px, 220px) minmax(0, 1fr)',
        },
        gridTemplateRows: { xs: 'auto minmax(0, 1fr) auto', md: 'minmax(0, 1fr)' },
        gridTemplateAreas: {
          xs: hasShots ? '"chats" "thread" "shots"' : '"chats" "thread"',
          md: hasShots ? '"chats thread shots"' : '"chats thread"',
        },
        borderRadius: 2,
        overflow: 'hidden',
        bgcolor: 'background.paper',
        boxShadow: (theme) =>
          theme.palette.mode === 'dark'
            ? '0 0 0 1px rgba(255,255,255,0.08)'
            : '0 0 0 1px rgba(0,0,0,0.08), 0 8px 24px rgba(15,23,42,0.06)',
      }}
    >
      <Box
        component="nav"
        aria-label={`Диалоги ${productLabel}`}
        sx={{
          gridArea: 'chats',
          minWidth: 0,
          minHeight: 0,
          borderRight: { md: '1px solid' },
          borderBottom: { xs: '1px solid', md: 0 },
          borderColor: 'divider',
          bgcolor: 'background.paper',
          maxHeight: { xs: 160, md: 'none' },
          overflow: 'auto',
        }}
      >
        <Box sx={{ px: 2, pt: 1.75, pb: 1.25 }}>
          <Typography
            component="h2"
            sx={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.015em', lineHeight: 1.25 }}
          >
            Чаты {productLabel}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.35 }}>
            {sortedChats.length} диалогов
          </Typography>
        </Box>
        <Box
          role="listbox"
          aria-label={`Список чатов ${productLabel}`}
          sx={{ px: 1, pb: 1.25, display: 'flex', flexDirection: 'column', gap: 0.5 }}
        >
          {sortedChats.map((chat, index) => {
            const key = chatKey(chat, index);
            const selected = key === activeKey;
            const msgs = dedupeMessages(chat.messages);
            const last = msgs[msgs.length - 1];
            const timeLabel = last
              ? (messageDayMeta(last).key !== 'unknown'
                ? messageDayMeta(last).label
                : formatMsgClock(last))
              : '—';
            const title = displayChatTitle(chat, productLabel);
            return (
              <ButtonBase
                key={key}
                role="option"
                aria-selected={selected}
                focusRipple
                onClick={() => setActiveKey(key)}
                sx={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  px: 1.25,
                  py: 1.1,
                  borderRadius: 2,
                  bgcolor: selected ? 'action.selected' : 'transparent',
                  boxShadow: selected
                    ? (theme) => `inset 3px 0 0 ${theme.palette.primary.main}`
                    : 'none',
                  transition: 'background-color 120ms cubic-bezier(0.2, 0, 0, 1)',
                  '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
                  '&:hover': {
                    bgcolor: selected ? 'action.selected' : 'action.hover',
                  },
                  '&.Mui-focusVisible': {
                    outline: '2px solid',
                    outlineColor: 'primary.main',
                    outlineOffset: 1,
                  },
                }}
              >
                <Stack direction="row" justifyContent="space-between" gap={1} alignItems="baseline">
                  <Typography
                    noWrap
                    title={title}
                    sx={{ fontSize: 13.5, fontWeight: 700, letterSpacing: '-0.01em', minWidth: 0 }}
                  >
                    {title}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ flex: '0 0 auto', fontVariantNumeric: 'tabular-nums' }}
                  >
                    {timeLabel}
                  </Typography>
                </Stack>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', mt: 0.35, lineHeight: 1.35 }}
                  noWrap
                  title={lastMessagePreview(chat)}
                >
                  {lastMessagePreview(chat)}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', mt: 0.25, opacity: 0.85, fontVariantNumeric: 'tabular-nums' }}
                >
                  {msgs.length} сообщ. · {chat.windows_user || '—'}
                </Typography>
              </ButtonBase>
            );
          })}
        </Box>
      </Box>

      <Box
        sx={{
          gridArea: 'thread',
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          minHeight: 0,
          overflow: 'hidden',
          bgcolor: (theme) =>
            theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(245,247,250,0.9)',
        }}
      >
        <Box
          sx={{
            px: 1.5,
            py: 1.1,
            bgcolor: 'background.paper',
            borderBottom: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Typography
            component="h2"
            sx={{
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: '-0.015em',
              lineHeight: 1.25,
            }}
            noWrap
            title={displayChatTitle(active, productLabel)}
          >
            {displayChatTitle(active, productLabel)}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mt: 0.35, fontVariantNumeric: 'tabular-nums' }}
          >
            {productLabel}
            {' · '}
            {active.windows_user || '—'}
            {host ? ` @ ${host}` : ''}
            {' · '}
            {messages.length} сообщ.
            {' · '}
            слева собеседник, справа вы
          </Typography>
        </Box>

        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            py: 1,
          }}
        >
          {!messages.length ? (
            <Box sx={{ px: 2, py: 4, textAlign: 'center' }}>
              <Typography sx={{ fontWeight: 700, mb: 0.5, fontSize: 14 }}>Сообщений пока нет</Typography>
              <Typography color="text.secondary" sx={{ fontSize: 13, textWrap: 'pretty' }}>
                {`Откройте этот чат в ${productLabel}, чтобы собрать историю.`}
              </Typography>
            </Box>
          ) : (
            groups.map((group) => (
              <Box key={group.key} sx={{ mb: 0.75 }}>
                <Box sx={{ display: 'flex', justifyContent: 'center', my: 0.85 }}>
                  <Chip
                    size="small"
                    label={group.label}
                    sx={{
                      fontSize: 10.5,
                      height: 22,
                      fontWeight: 600,
                      bgcolor: 'background.paper',
                      boxShadow: (theme) =>
                        theme.palette.mode === 'dark'
                          ? '0 0 0 1px rgba(255,255,255,0.08)'
                          : '0 0 0 1px rgba(0,0,0,0.08)',
                    }}
                  />
                </Box>
                {group.items.map(({ msg, index }) => (
                  <ChatBubble
                    key={`${msg?.msg_key || msg?.time || ''}-${index}`}
                    computerName={host}
                    msg={msg}
                    screenshotFile={resolveMessageScreenshot(msg, chatShots)}
                    onOpenScreenshot={setOpenShotFile}
                    getMedia={getMedia}
                  />
                ))}
              </Box>
            ))
          )}
        </Box>
      </Box>

      {hasShots ? (
        <Box sx={{ gridArea: 'shots', minWidth: 0, minHeight: { xs: 180, md: 0 }, height: '100%', overflow: 'hidden' }}>
          <ScreenshotStrip
            computerName={host}
            screenshots={chatShots}
            chatName={displayChatTitle(active, productLabel)}
            openFileName={openShotFile}
            onOpenHandled={() => setOpenShotFile('')}
            getMedia={getMedia}
            productLabel={productLabel}
          />
        </Box>
      ) : null}
    </Box>
  );
}

