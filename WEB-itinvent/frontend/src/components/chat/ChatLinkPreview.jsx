import { memo, useEffect, useState } from 'react';
import { Box, Typography } from '@mui/material';
import LinkRoundedIcon from '@mui/icons-material/LinkRounded';
import { chatMessageSendingAPI } from '../../api/chatMessageSending';
import { extractFirstChatUrl } from './chatPlainText';
import { resolveChatBubbleLinkColors } from './chatUiTokens';

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

export { extractFirstChatUrl as extractFirstUrl } from './chatPlainText';

// Global in-memory cache: url -> { data } | null (null = failed/empty)
const _previewCache = new Map();
// In-flight deduplication: url -> Promise
const _inflight = new Map();
const CACHE_MAX = 300;

function _getCached(url) {
  return _previewCache.has(url) ? _previewCache.get(url) : undefined;
}

function _setCached(url, value) {
  if (_previewCache.size >= CACHE_MAX) {
    const firstKey = _previewCache.keys().next().value;
    _previewCache.delete(firstKey);
  }
  _previewCache.set(url, value);
}

async function _fetchPreview(url) {
  if (_inflight.has(url)) return _inflight.get(url);
  const promise = chatMessageSendingAPI.getLinkPreview(url)
    .then((data) => {
      const result = (data?.title || data?.image || data?.description) ? data : null;
      _setCached(url, result);
      return result;
    })
    .catch(() => {
      _setCached(url, null);
      return null;
    })
    .finally(() => _inflight.delete(url));
  _inflight.set(url, promise);
  return promise;
}

const ChatLinkPreview = memo(function ChatLinkPreview({ url, theme, ui, isOwn }) {
  const cached = url ? _getCached(url) : undefined;
  // undefined = not fetched yet, null = failed/empty, object = success
  const [preview, setPreview] = useState(cached !== undefined ? cached : undefined);

  useEffect(() => {
    if (!url) return;
    const hit = _getCached(url);
    if (hit !== undefined) {
      setPreview(hit);
      return;
    }
    let cancelled = false;
    _fetchPreview(url).then((data) => {
      if (!cancelled) setPreview(data);
    });
    return () => { cancelled = true; };
  }, [url]);

  // null = failed, undefined = loading (not yet known), object = ok
  if (!url || preview === null) return null;
  if (preview === undefined) return null; // no skeleton — no layout shift

  const linkColors = resolveChatBubbleLinkColors(ui, isOwn);
  const borderColor = linkColors.border || ui?.accentText || theme.palette.primary.main;
  const cardBg = linkColors.bg || ui?.surfaceMuted;
  const textColor = linkColors.text || ui?.textPrimary || theme.palette.text.primary;
  const mutedColor = linkColors.muted || ui?.textSecondary || theme.palette.text.secondary;

  const hostname = (() => {
    try { return new URL(url).hostname.replace(/^www\./, ''); }
    catch { return url; }
  })();

  return (
    <Box
      component="a"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      sx={{
        mt: 1,
        display: 'flex',
        gap: 1,
        borderLeft: `3px solid ${borderColor}`,
        borderRadius: '0 8px 8px 0',
        pl: 1.2,
        pr: 1,
        py: 0.8,
        bgcolor: cardBg,
        textDecoration: 'none',
        overflow: 'hidden',
        transition: 'opacity 120ms ease',
        '&:hover': { opacity: 0.85 },
        '&:active': { opacity: 0.7 },
      }}
    >
      {/* Thumbnail */}
      {preview?.image ? (
        <Box
          component="img"
          src={preview.image}
          alt=""
          onError={(e) => { e.target.style.display = 'none'; }}
          sx={{
            width: 56,
            height: 56,
            objectFit: 'cover',
            borderRadius: 1.5,
            flexShrink: 0,
            alignSelf: 'flex-start',
          }}
        />
      ) : (
        <Box sx={{ width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, alignSelf: 'flex-start' }}>
          <LinkRoundedIcon sx={{ fontSize: 22, color: borderColor }} />
        </Box>
      )}

      {/* Text content */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {preview?.site_name ? (
          <Typography
            sx={{
              fontSize: 11,
              fontWeight: 600,
              color: borderColor,
              fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              lineHeight: 1.4,
              mb: 0.2,
            }}
          >
            {preview.site_name}
          </Typography>
        ) : (
          <Typography
            sx={{
              fontSize: 11,
              color: borderColor,
              fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
              lineHeight: 1.4,
              mb: 0.2,
            }}
          >
            {hostname}
          </Typography>
        )}

        {preview?.title ? (
          <Typography
            sx={{
              fontSize: 13,
              fontWeight: 600,
              color: textColor,
              fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
              lineHeight: 1.3,
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              mb: 0.3,
            }}
          >
            {preview.title}
          </Typography>
        ) : null}

        {preview?.description ? (
          <Typography
            sx={{
              fontSize: 12,
              color: mutedColor,
              fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
              lineHeight: 1.3,
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
            }}
          >
            {preview.description}
          </Typography>
        ) : null}
      </Box>
    </Box>
  );
});

export default ChatLinkPreview;
