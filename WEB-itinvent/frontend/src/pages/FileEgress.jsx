import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CloseIcon from '@mui/icons-material/Close';
import RefreshIcon from '@mui/icons-material/Refresh';
import MainLayout from '../components/layout/MainLayout';
import PageShell from '../components/layout/PageShell';
import { fsEgressAPI } from '../api/fsEgress';

const CHANNEL_LABELS = {
  usb: 'USB',
  network: 'Сеть',
  telegram: 'Telegram',
  max: 'MAX',
  deleted: 'Удаление',
};

function formatTs(ts) {
  if (!ts) return '—';
  try {
    return new Date(Number(ts) * 1000).toLocaleString('ru-RU');
  } catch {
    return String(ts);
  }
}

function shortLabel(value, limit = 36) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function chatKey(chat, index) {
  return `${chat.computer_name || ''}:${chat.chat_id || chat.chat_name || index}`;
}

function unwrapPeerId(value) {
  const text = String(value || '').trim();
  const match = text.match(/^\[\s*\d+\s*,\s*'([^']+)'\s*\]$/);
  if (match?.[1]) return match[1];
  return text;
}

function isHumanChatTitle(name, chatId = '') {
  const text = String(name || '').trim();
  const cid = unwrapPeerId(chatId);
  if (!text) return false;
  if (text === cid || text === String(chatId || '').trim()) return false;
  if (text.startsWith('[') || text.startsWith('{')) return false;
  if (/^https?:\/\//i.test(text)) return false;
  if (/^[0-9a-f]{8,16}$/i.test(text)) return false;
  return true;
}

function displayChatTitle(chat, productLabel = 'Чат') {
  const cid = unwrapPeerId(chat?.chat_id);
  let name = unwrapPeerId(chat?.chat_name);
  if (!isHumanChatTitle(name, cid)) {
    const msgs = Array.isArray(chat?.messages) ? chat.messages : [];
    for (let i = msgs.length - 1; i >= 0; i -= 1) {
      const msg = msgs[i];
      const sender = String(msg?.sender || '').trim();
      if (messageSide(msg?.direction) === 'in' && sender && sender !== 'me' && isHumanChatTitle(sender, cid)) {
        name = sender;
        break;
      }
    }
  }
  if (!isHumanChatTitle(name, cid)) {
    name = cid ? `Диалог ${cid.slice(0, 10)}` : `Диалог ${productLabel}`;
  }
  return name;
}

function messageSide(direction) {
  const d = String(direction || '').toLowerCase();
  if (d.includes('out')) return 'out';
  if (d.includes('in')) return 'in';
  return 'other';
}

function normalizeHost(value) {
  return String(value || '').trim();
}

function mediaFileName(mediaPath) {
  const raw = String(mediaPath || '').replace(/\\/g, '/').trim();
  if (!raw) return '';
  return raw.split('/').pop() || '';
}

function isImageMedia(msg) {
  const kind = String(msg?.media_kind || '').toLowerCase();
  const path = String(msg?.media_path || '').toLowerCase();
  if (['jpeg', 'jpg', 'png', 'webp', 'gif'].includes(kind)) return true;
  if (/\.(jpe?g|png|webp|gif)$/i.test(path)) return true;
  const label = String(msg?.media || '').toLowerCase();
  return Boolean(path) && /^(фотография|photo|gif|стикер|sticker)\b/.test(label);
}

function isCacheHashName(name) {
  return /^[a-f0-9]{12,}\.(jpe?g|png|webp|gif|mp4)$/i.test(String(name || '').trim());
}

function isRealTelegramSend(row) {
  if (String(row?.channel || '').toLowerCase() !== 'telegram') return true;
  const details = row?.details && typeof row.details === 'object' ? row.details : {};
  if (String(details.source || '') === 'uia_outgoing') return true;
  const media = String(details.media || row?.file_name || '').trim();
  if (/^(файл|file|документ|document|фотография|photo|видео|video|gif|стикер|sticker)\b/i.test(media)) {
    return !isCacheHashName(row?.file_name) || Boolean(details.media);
  }
  // Legacy cache-hash rows without UIA media label — hide.
  if (isCacheHashName(row?.file_name) && !details.media) return false;
  return Boolean(media);
}

function displayMessageText(msg) {
  const raw = String(msg?.text || '').trim();
  const mediaLabel = String(msg?.media || '').trim();
  if (mediaLabel && raw.startsWith(mediaLabel)) {
    return raw.slice(mediaLabel.length).trim();
  }
  if (mediaLabel && raw === mediaLabel) return '';
  return raw;
}

function parseIsoDay(value) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseDateFromTimeField(timeValue) {
  const raw = String(timeValue || '').trim().toLowerCase();
  if (!raw) return null;
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (raw.startsWith('сегодня')) return startToday;
  if (raw.startsWith('вчера')) {
    return new Date(startToday.getTime() - 86400000);
  }
  const m = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})\s+в\s+/);
  if (!m) return null;
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  const d = new Date(year, Number(m[2]) - 1, Number(m[1]), 12, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

function messageDayMeta(msg) {
  const labelFromMsg = String(msg?.day_label || '').trim();
  const fromChatDate = parseIsoDay(msg?.chat_date);
  if (fromChatDate) {
    return {
      key: String(msg.chat_date).trim(),
      date: fromChatDate,
      label: labelFromMsg || formatDayLabel(fromChatDate),
    };
  }
  const fromTime = parseDateFromTimeField(msg?.time);
  if (fromTime) {
    const key = `${fromTime.getFullYear()}-${fromTime.getMonth() + 1}-${fromTime.getDate()}`;
    return { key, date: fromTime, label: labelFromMsg || formatDayLabel(fromTime) };
  }
  if (labelFromMsg) {
    return { key: `label:${labelFromMsg}`, date: null, label: labelFromMsg };
  }
  // Do NOT use recorded_at — that is capture time, not dialogue day.
  return { key: 'unknown', date: null, label: 'Без даты' };
}

function formatMsgClock(msg) {
  const raw = String(msg?.time || '').trim();
  if (raw) {
    const cleaned = raw
      .replace(/^(сегодня|вчера)\s+/i, '')
      .replace(/^\d{1,2}\.\d{1,2}\.\d{2,4}\s+/i, '')
      .replace(/^в\s+/i, '')
      .replace(/\s*\(изм\.?\)\s*$/i, '')
      .trim();
    if (cleaned) return cleaned;
  }
  return '—';
}

function formatDayLabel(date) {
  if (!date) return 'Без даты';
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startMsg = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((startToday - startMsg) / 86400000);
  if (diffDays === 0) return 'Сегодня';
  if (diffDays === 1) return 'Вчера';
  return date.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function dedupeMessages(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const seen = new Set();
  const out = [];
  list.forEach((msg) => {
    if (!msg || typeof msg !== 'object') return;
    const key = String(
      msg.msg_key
        || `${msg.direction || ''}|${msg.time || ''}|${msg.sender || ''}|${msg.text || msg.media || ''}`
    )
      .trim()
      .toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(msg);
  });
  return out;
}

function groupMessagesByDay(messages) {
  const groups = [];
  let current = null;
  messages.forEach((msg, index) => {
    const meta = messageDayMeta(msg);
    if (!current || current.key !== meta.key) {
      current = { key: meta.key, label: meta.label, items: [] };
      groups.push(current);
    }
    current.items.push({ msg, index });
  });
  return groups;
}

function lastMessagePreview(chat) {
  const messages = dedupeMessages(chat?.messages);
  if (!messages.length) return 'Нет сообщений';
  const last = messages[messages.length - 1] || {};
  const text = displayMessageText(last) || last.media || last.text || 'Медиа';
  const who = messageSide(last.direction) === 'out' ? 'Вы' : (last.sender || 'Собеседник');
  return `${who}: ${shortLabel(text, 48)}`;
}

function parseScreenshotStamp(fileName) {
  const m = String(fileName || '').match(/_(\d{8})_(\d{6})(?:_(\d+))?\.(png|jpe?g|webp)$/i);
  if (!m) return null;
  const y = Number(m[1].slice(0, 4));
  const mo = Number(m[1].slice(4, 6));
  const d = Number(m[1].slice(6, 8));
  const hh = Number(m[2].slice(0, 2));
  const mm = Number(m[2].slice(2, 4));
  const ss = Number(m[2].slice(4, 6));
  const date = new Date(y, mo - 1, d, hh, mm, ss);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatShotWhen(date) {
  if (!date) return { day: 'Без даты', clock: '—' };
  return {
    day: date.toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }),
    clock: date.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
  };
}

/** Link a message to its capture screenshot (explicit path or nearest by time). */
function resolveMessageScreenshot(msg, screenshots, maxSkewMs = 20 * 60 * 1000) {
  const list = Array.isArray(screenshots) ? screenshots : [];
  const names = list.map((shot) => mediaFileName(shot)).filter(Boolean);
  const direct = mediaFileName(msg?.screenshot_path);
  if (direct) return direct;
  const msgTs = Date.parse(String(msg?.recorded_at || ''));
  if (!Number.isFinite(msgTs) || !names.length) return '';
  let best = '';
  let bestDist = Infinity;
  names.forEach((name) => {
    const stamp = parseScreenshotStamp(name);
    if (!stamp) return;
    const dist = Math.abs(stamp.getTime() - msgTs);
    if (dist < bestDist) {
      bestDist = dist;
      best = name;
    }
  });
  return bestDist <= maxSkewMs ? best : '';
}

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

function TelegramDialogPanel({
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

function HostFilesTable({ rows, channel, onChannelChange }) {
  return (
    <Stack spacing={1.5}>
      <FormControl size="small" sx={{ minWidth: 180, maxWidth: 240 }}>
        <InputLabel>Канал</InputLabel>
        <Select label="Канал" value={channel} onChange={(e) => onChannelChange(e.target.value)}>
          <MenuItem value="all">Все каналы</MenuItem>
          <MenuItem value="usb">USB</MenuItem>
          <MenuItem value="network">Сеть</MenuItem>
          <MenuItem value="telegram">Telegram</MenuItem>
          <MenuItem value="max">MAX</MenuItem>
          <MenuItem value="deleted">Удаления</MenuItem>
        </Select>
      </FormControl>

      <Paper sx={{ overflow: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Время</TableCell>
              <TableCell>Пользователь</TableCell>
              <TableCell>Файл</TableCell>
                <TableCell>Путь</TableCell>
              <TableCell>Канал</TableCell>
              <TableCell>Размер</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id || row.event_id} hover>
                <TableCell>{formatTs(row.ts)}</TableCell>
                <TableCell>{row.windows_user || '—'}</TableCell>
                <TableCell>{row.file_name || '—'}</TableCell>
                <TableCell sx={{ maxWidth: 360, wordBreak: 'break-all' }}>
                  {row.dest_path || '—'}
                </TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={CHANNEL_LABELS[row.channel] || row.channel}
                    color={
                      row.channel === 'usb'
                        ? 'warning'
                        : row.channel === 'telegram' || row.channel === 'max'
                          ? 'info'
                          : 'default'
                    }
                  />
                </TableCell>
                <TableCell>
                  {row.size != null ? `${Math.round(Number(row.size) / 1024)} КБ` : '—'}
                </TableCell>
              </TableRow>
            ))}
            {!rows.length ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <Typography color="text.secondary" sx={{ py: 2 }}>
                    Залогированных файлов пока нет. USB/сеть — при копировании на флешку или шару;
                    Telegram/MAX — исходящие фото/файлы/видео из диалогов.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Paper>
    </Stack>
  );
}

const CATEGORY_META = {
  work: { label: 'Работа', color: 'success' },
  entertainment: { label: 'Развлечения', color: 'warning' },
  other: { label: 'Прочее', color: 'default' },
};

const BROWSER_LABELS = {
  chrome: 'Chrome',
  edge: 'Edge',
  yandex: 'Яндекс',
};

function formatIsoVisited(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('ru-RU');
  } catch {
    return String(value);
  }
}

function dayKeyFromIso(value) {
  if (!value) return '';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('sv-SE'); // YYYY-MM-DD
  } catch {
    return '';
  }
}

function CategoryChip({ category }) {
  const meta = CATEGORY_META[category] || CATEGORY_META.other;
  return <Chip size="small" label={meta.label} color={meta.color} variant={meta.color === 'default' ? 'outlined' : 'filled'} />;
}

function formatDwell(sec) {
  const n = Number(sec) || 0;
  if (n <= 0) return '0с';
  if (n < 60) return `${Math.round(n)}с`;
  const m = Math.floor(n / 60);
  const s = Math.round(n % 60);
  if (m < 60) return s ? `${m}м ${s}с` : `${m}м`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}ч ${rm}м` : `${h}ч`;
}

function BrowserDaySummary({ visits }) {
  const stats = useMemo(() => {
    let work = 0;
    let entertainment = 0;
    let other = 0;
    let workDwell = 0;
    let entDwell = 0;
    let otherDwell = 0;
    for (const v of visits || []) {
      const cat = String(v.category || 'other');
      const dwell = Number(v.dwell_sec) || 0;
      if (cat === 'work') {
        work += 1;
        workDwell += dwell;
      } else if (cat === 'entertainment') {
        entertainment += 1;
        entDwell += dwell;
      } else {
        other += 1;
        otherDwell += dwell;
      }
    }
    const dwellTotal = workDwell + entDwell + otherDwell;
    const useDwell = dwellTotal > 0;
    const denom = useDwell ? dwellTotal : (work + entertainment + other || 1);
    const workShare = useDwell ? workDwell : work;
    const entShare = useDwell ? entDwell : entertainment;
    return {
      work,
      entertainment,
      other,
      workDwell,
      entDwell,
      otherDwell,
      useDwell,
      workPct: Math.round((workShare / denom) * 100),
      entPct: Math.round((entShare / denom) * 100),
    };
  }, [visits]);

  return (
    <Paper variant="outlined" sx={{ p: 1.25 }}>
      <Stack spacing={0.75}>
        <Typography variant="subtitle2">
          Сводка за день {stats.useDwell ? '(по активному времени)' : '(по числу визитов)'}
        </Typography>
        <Stack direction="row" spacing={0.5} sx={{ height: 10, borderRadius: 1, overflow: 'hidden', bgcolor: 'action.hover' }}>
          <Box sx={{ width: `${stats.workPct}%`, bgcolor: 'success.main', minWidth: stats.workPct ? 4 : 0 }} />
          <Box sx={{ width: `${stats.entPct}%`, bgcolor: 'warning.main', minWidth: stats.entPct ? 4 : 0 }} />
          <Box sx={{ flex: 1, bgcolor: 'divider' }} />
        </Stack>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Chip
            size="small"
            color="success"
            label={
              stats.useDwell
                ? `Работа ${formatDwell(stats.workDwell)} (${stats.workPct}%) · ${stats.work} виз.`
                : `Работа ${stats.work} (${stats.workPct}%)`
            }
          />
          <Chip
            size="small"
            color="warning"
            label={
              stats.useDwell
                ? `Развлечения ${formatDwell(stats.entDwell)} (${stats.entPct}%) · ${stats.entertainment} виз.`
                : `Развлечения ${stats.entertainment} (${stats.entPct}%)`
            }
          />
          <Chip
            size="small"
            variant="outlined"
            label={
              stats.useDwell
                ? `Прочее ${formatDwell(stats.otherDwell)} · ${stats.other} виз.`
                : `Прочее ${stats.other}`
            }
          />
        </Stack>
      </Stack>
    </Paper>
  );
}

function BrowserShotButton({ host, fileName }) {
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');
  const [open, setOpen] = useState(false);

  const openShot = async () => {
    if (!host || !fileName) return;
    if (url) {
      setOpen(true);
      return;
    }
    setBusy(true);
    try {
      const res = await fsEgressAPI.getBrowserMedia(host, fileName);
      const blobUrl = URL.createObjectURL(res.data);
      setUrl(blobUrl);
      setOpen(true);
    } catch {
      setUrl('');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  if (!fileName) return <Typography variant="caption" color="text.secondary">—</Typography>;

  return (
    <>
      <Button size="small" variant="outlined" onClick={openShot} disabled={busy}>
        {busy ? '…' : 'Снимок'}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="lg" fullWidth>
        <DialogContent sx={{ p: 1, position: 'relative' }}>
          <IconButton
            size="small"
            onClick={() => setOpen(false)}
            sx={{ position: 'absolute', top: 8, right: 8, bgcolor: 'background.paper' }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
          {url ? (
            <Box
              component="img"
              src={url}
              alt={fileName}
              sx={{ width: '100%', maxHeight: '80vh', objectFit: 'contain', display: 'block' }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function isFocusVisit(row) {
  return String(row?.profile || '') === 'focus' || Number(row?.dwell_sec) > 0;
}

function BrowserVisitsPanel({ visits, host }) {
  // Default: only where the person actually sat (foreground), not background History SPA noise.
  const [sourceFilter, setSourceFilter] = useState('focus');
  const [day, setDay] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');

  const sourceVisits = useMemo(() => {
    const rows = visits || [];
    if (sourceFilter === 'history') {
      return rows.filter((v) => String(v.profile || '') !== 'focus');
    }
    if (sourceFilter === 'focus') {
      return rows.filter((v) => isFocusVisit(v));
    }
    return rows;
  }, [visits, sourceFilter]);

  const days = useMemo(() => {
    const set = new Set();
    for (const v of sourceVisits) {
      const key = dayKeyFromIso(v.visited_at);
      if (key) set.add(key);
    }
    return Array.from(set).sort().reverse();
  }, [sourceVisits]);

  useEffect(() => {
    if (!day && days[0]) setDay(days[0]);
    if (day && days.length && !days.includes(day)) setDay(days[0] || '');
    if (!days.length) setDay('');
  }, [days, day]);

  const dayVisits = useMemo(() => {
    let rows = sourceVisits;
    if (day) rows = rows.filter((v) => dayKeyFromIso(v.visited_at) === day);
    if (categoryFilter && categoryFilter !== 'all') {
      rows = rows.filter((v) => String(v.category || 'other') === categoryFilter);
    }
    return rows;
  }, [sourceVisits, day, categoryFilter]);

  const dayAllVisits = useMemo(() => {
    if (!day) return sourceVisits;
    return sourceVisits.filter((v) => dayKeyFromIso(v.visited_at) === day);
  }, [sourceVisits, day]);

  if (!(visits || []).length) {
    return (
      <Typography color="text.secondary" sx={{ py: 2 }}>
        Активности браузера пока нет. Probe смотрит активное окно (где человек реально сидит)
        и отдельно читает History Chrome / Edge / Яндекс.
      </Typography>
    );
  }

  return (
    <Stack spacing={1} sx={{ height: '100%', minHeight: 0 }}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel id="browser-src-label">Источник</InputLabel>
          <Select
            labelId="browser-src-label"
            label="Источник"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
          >
            <MenuItem value="focus">Только в фокусе</MenuItem>
            <MenuItem value="history">Вся History</MenuItem>
            <MenuItem value="all">Фокус + History</MenuItem>
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel id="browser-day-label">День</InputLabel>
          <Select
            labelId="browser-day-label"
            label="День"
            value={day || days[0] || ''}
            onChange={(e) => setDay(e.target.value)}
          >
            {days.map((d) => (
              <MenuItem key={d} value={d}>{d}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel id="browser-cat-label">Категория</InputLabel>
          <Select
            labelId="browser-cat-label"
            label="Категория"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <MenuItem value="all">Все</MenuItem>
            <MenuItem value="work">Работа</MenuItem>
            <MenuItem value="entertainment">Развлечения</MenuItem>
            <MenuItem value="other">Прочее</MenuItem>
          </Select>
        </FormControl>
        <Typography variant="caption" color="text.secondary">
          {dayVisits.length} {sourceFilter === 'focus' ? 'активных вкладок' : 'визитов'}
        </Typography>
      </Stack>
      {sourceFilter === 'focus' && !sourceVisits.length ? (
        <Alert severity="info">
          Пока нет записей «в фокусе». History в фоне не показывается — переключите источник
          на «Вся History», если нужен журнал переходов.
        </Alert>
      ) : null}
      <BrowserDaySummary visits={dayAllVisits} />
      <Paper sx={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>Время</TableCell>
              <TableCell>Браузер</TableCell>
              <TableCell>URL / заголовок</TableCell>
              <TableCell>Источник</TableCell>
              <TableCell>Категория</TableCell>
              <TableCell>В фокусе</TableCell>
              <TableCell align="right">Снимок</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {dayVisits.map((row) => (
              <TableRow key={row.id || `${row.browser}:${row.visit_id}:${row.visited_at}`} hover>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatIsoVisited(row.visited_at)}</TableCell>
                <TableCell>{BROWSER_LABELS[row.browser] || row.browser || '—'}</TableCell>
                <TableCell sx={{ maxWidth: 420 }}>
                  <Typography variant="body2" noWrap title={row.url || ''}>
                    {row.domain || shortLabel(row.url, 48) || '—'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap title={row.title || ''}>
                    {shortLabel(row.title, 72)}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={isFocusVisit(row) ? 'Фокус' : 'History'}
                    color={isFocusVisit(row) ? 'primary' : 'default'}
                    variant={isFocusVisit(row) ? 'filled' : 'outlined'}
                  />
                </TableCell>
                <TableCell><CategoryChip category={row.category} /></TableCell>
                <TableCell>
                  {row.dwell_sec != null ? formatDwell(row.dwell_sec) : '—'}
                </TableCell>
                <TableCell align="right">
                  <BrowserShotButton host={host} fileName={row.screenshot_file} />
                </TableCell>
              </TableRow>
            ))}
            {!dayVisits.length ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <Typography color="text.secondary" sx={{ py: 2 }}>
                    Нет визитов для выбранного фильтра
                  </Typography>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Paper>
    </Stack>
  );
}

export default function FileEgress() {
  const [items, setItems] = useState([]);
  const [tgChats, setTgChats] = useState([]);
  const [maxChats, setMaxChats] = useState([]);
  const [browserVisits, setBrowserVisits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedHost, setSelectedHost] = useState('');
  const [hostTab, setHostTab] = useState('files');
  const [reportHtml, setReportHtml] = useState(null);
  const [channel, setChannel] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [eventsRes, tgRes, maxRes, brRes] = await Promise.all([
        fsEgressAPI.listEvents({ limit: 500 }),
        fsEgressAPI.listTelegramChats({ limit: 200 }),
        fsEgressAPI.listMaxChats({ limit: 200 }),
        fsEgressAPI.listBrowserVisits({ limit: 500 }),
      ]);
      setItems(eventsRes.data?.items || []);
      setTgChats(tgRes.data?.chats || []);
      setMaxChats(maxRes.data?.chats || []);
      setBrowserVisits(brRes.data?.items || []);
    } catch (err) {
      setError(err?.response?.data?.detail || err.message || 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const hosts = useMemo(() => {
    const map = new Map();
    const emptyHost = (host) => ({
      computer_name: host,
      fileCount: 0,
      chatCount: 0,
      maxCount: 0,
      browserCount: 0,
      lastTs: 0,
    });
    for (const row of items) {
      if (!isRealTelegramSend(row)) continue;
      const host = normalizeHost(row.computer_name);
      if (!host) continue;
      const cur = map.get(host) || emptyHost(host);
      if (row.channel !== 'deleted') cur.fileCount += 1;
      cur.lastTs = Math.max(cur.lastTs, Number(row.ts) || 0);
      map.set(host, cur);
    }
    for (const chat of tgChats) {
      const host = normalizeHost(chat.computer_name);
      if (!host) continue;
      const cur = map.get(host) || emptyHost(host);
      cur.chatCount += 1;
      if (chat.updated_at) cur.lastTs = Math.max(cur.lastTs, Number(chat.updated_at) || 0);
      map.set(host, cur);
    }
    for (const chat of maxChats) {
      const host = normalizeHost(chat.computer_name);
      if (!host) continue;
      const cur = map.get(host) || emptyHost(host);
      cur.maxCount += 1;
      if (chat.updated_at) cur.lastTs = Math.max(cur.lastTs, Number(chat.updated_at) || 0);
      map.set(host, cur);
    }
    for (const visit of browserVisits) {
      const host = normalizeHost(visit.computer_name);
      if (!host) continue;
      const cur = map.get(host) || emptyHost(host);
      cur.browserCount += 1;
      const visitTs = visit.visited_at ? Math.floor(new Date(visit.visited_at).getTime() / 1000) : 0;
      if (visitTs) cur.lastTs = Math.max(cur.lastTs, visitTs);
      map.set(host, cur);
    }
    return Array.from(map.values()).sort((a, b) => {
      if (b.lastTs !== a.lastTs) return b.lastTs - a.lastTs;
      return a.computer_name.localeCompare(b.computer_name, 'ru');
    });
  }, [items, tgChats, maxChats, browserVisits]);

  const hostAllRows = useMemo(() => {
    const host = normalizeHost(selectedHost);
    return items.filter(
      (row) => normalizeHost(row.computer_name) === host && isRealTelegramSend(row)
    );
  }, [items, selectedHost]);

  const hostRows = useMemo(() => {
    if (!channel || channel === 'all') return hostAllRows;
    return hostAllRows.filter((row) => row.channel === channel);
  }, [hostAllRows, channel]);

  const hostFileCount = useMemo(
    () => hostAllRows.filter((row) => row.channel !== 'deleted').length,
    [hostAllRows]
  );

  const hostChats = useMemo(() => {
    const host = normalizeHost(selectedHost);
    return tgChats.filter((chat) => normalizeHost(chat.computer_name) === host);
  }, [tgChats, selectedHost]);

  const hostMaxChats = useMemo(() => {
    const host = normalizeHost(selectedHost);
    return maxChats.filter((chat) => normalizeHost(chat.computer_name) === host);
  }, [maxChats, selectedHost]);

  const hostBrowserVisits = useMemo(() => {
    const host = normalizeHost(selectedHost);
    return browserVisits.filter((visit) => normalizeHost(visit.computer_name) === host);
  }, [browserVisits, selectedHost]);

  const openReport = async () => {
    const host = normalizeHost(selectedHost);
    if (!host) return;
    try {
      const res = await fsEgressAPI.getTelegramReport(host);
      const html = typeof res.data === 'string' ? res.data : String(res.data || '');
      setReportHtml(html);
    } catch (err) {
      setError(err?.response?.data?.detail || err.message || 'Не удалось открыть отчёт');
    }
  };

  return (
    <MainLayout>
      <Dialog open={reportHtml !== null} onClose={() => setReportHtml(null)} maxWidth="lg" fullWidth>
        <DialogContent>
          <Button onClick={() => setReportHtml(null)}>Закрыть отчёт</Button>
          <Box component="iframe" title="Отчёт по переписке" sandbox="" srcDoc={reportHtml || ''}
            sx={{ width: '100%', height: '70dvh', border: 0 }} />
        </DialogContent>
      </Dialog>
      <PageShell fullHeight sx={{ p: { xs: 1.25, md: 1.75 }, minHeight: 0 }}>
        <Stack spacing={1.25} sx={{ height: '100%', minHeight: 0, overflow: 'hidden' }}>
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
            flexWrap="wrap"
            gap={1}
            sx={{ flexShrink: 0 }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h5" sx={{ lineHeight: 1.2 }}>DLP</Typography>
              <Typography variant="body2" color="text.secondary" noWrap>
                Хост → «Файлы», «Telegram», «MAX» или «Браузер». Права: Scan Center (`scan.read`).
              </Typography>
            </Box>
            <Button startIcon={<RefreshIcon />} onClick={load} variant="outlined" sx={{ flexShrink: 0 }}>
              Обновить
            </Button>
          </Stack>

          {error ? <Alert severity="error" sx={{ flexShrink: 0 }}>{error}</Alert> : null}

          {loading ? (
            <Box sx={{ display: 'grid', placeItems: 'center', flex: 1 }}>
              <CircularProgress />
            </Box>
          ) : !selectedHost ? (
            <Paper sx={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Хост</TableCell>
                    <TableCell>Файлы</TableCell>
                    <TableCell>Telegram</TableCell>
                    <TableCell>MAX</TableCell>
                    <TableCell>Браузер</TableCell>
                    <TableCell>Последнее событие</TableCell>
                    <TableCell align="right" />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {hosts.map((host) => (
                    <TableRow key={host.computer_name} hover>
                      <TableCell>
                        <Typography fontWeight={600}>{host.computer_name}</Typography>
                      </TableCell>
                      <TableCell>{host.fileCount}</TableCell>
                      <TableCell>{host.chatCount}</TableCell>
                      <TableCell>{host.maxCount}</TableCell>
                      <TableCell>{host.browserCount}</TableCell>
                      <TableCell>{host.lastTs ? formatTs(host.lastTs) : '—'}</TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          variant="contained"
                          onClick={() => {
                            setSelectedHost(host.computer_name);
                            setHostTab('files');
                            setChannel('all');
                          }}
                        >
                          Открыть
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!hosts.length ? (
                    <TableRow>
                      <TableCell colSpan={7}>
                        <Typography color="text.secondary" sx={{ py: 2 }}>
                          Хостов пока нет — агент ещё не присылал события
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </Paper>
          ) : (
            <Stack spacing={1} sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                flexWrap="wrap"
                gap={1}
                sx={{ flexShrink: 0 }}
              >
                <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                  <Button
                    size="small"
                    startIcon={<ArrowBackIcon />}
                    onClick={() => setSelectedHost('')}
                  >
                    К списку хостов
                  </Button>
                  <Typography variant="h6" noWrap>{selectedHost}</Typography>
                </Stack>
                <Button size="small" variant="outlined" onClick={openReport}>
                  Актуальный отчёт
                </Button>
              </Stack>

              <Paper variant="outlined" sx={{ px: 1, flexShrink: 0 }}>
                <Tabs
                  value={hostTab}
                  onChange={(_, value) => setHostTab(value)}
                  sx={{
                    minHeight: 40,
                    '& .MuiTab-root': { minHeight: 40, textTransform: 'none' },
                  }}
                >
                  <Tab value="files" label={`Файлы (${hostFileCount})`} />
                  <Tab value="telegram" label={`Telegram (${hostChats.length})`} />
                  <Tab value="max" label={`MAX (${hostMaxChats.length})`} />
                  <Tab value="browser" label={`Браузер (${hostBrowserVisits.length})`} />
                </Tabs>
              </Paper>

              <Box sx={{ flex: 1, minHeight: 0, overflow: hostTab === 'files' || hostTab === 'browser' ? 'auto' : 'hidden' }}>
                {hostTab === 'files' ? (
                  <HostFilesTable rows={hostRows} channel={channel} onChannelChange={setChannel} />
                ) : hostTab === 'telegram' ? (
                  <TelegramDialogPanel chats={hostChats} />
                ) : hostTab === 'max' ? (
                  <TelegramDialogPanel
                    chats={hostMaxChats}
                    getMedia={fsEgressAPI.getMaxMedia}
                    productLabel="MAX"
                    emptyHint="Откройте чат в MAX на этом ПК — probe снимет переписку и снимки окна."
                  />
                ) : (
                  <BrowserVisitsPanel visits={hostBrowserVisits} host={selectedHost} />
                )}
              </Box>
            </Stack>
          )}
        </Stack>
      </PageShell>
    </MainLayout>
  );
}
