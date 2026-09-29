import { useState } from 'react';
import { Box, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import AccountCircleRoundedIcon from '@mui/icons-material/AccountCircleRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import PlaceRoundedIcon from '@mui/icons-material/PlaceRounded';
import RadioButtonUncheckedRoundedIcon from '@mui/icons-material/RadioButtonUncheckedRounded';

import { buildChatLocationOpenUrl } from './chatStructuredContent';
import { CHAT_FONT_FAMILY } from './chatUiTokens';

const cardSurfaceSx = (ui, theme, isOwn) => ({
  width: '100%',
  borderRadius: '14px',
  border: `1px solid ${ui.borderSoft || alpha(theme.palette.primary.main, 0.12)}`,
  backgroundColor: ui.surfaceStrong || ui.composerInputBg || alpha(theme.palette.primary.main, 0.08),
  color: isOwn ? (ui.bubbleOwnText || theme.palette.text.primary) : (ui.bubbleOtherText || theme.palette.text.primary),
  textAlign: 'left',
  overflow: 'hidden',
});

const cardIconWrapSx = (ui, theme, isOwn) => ({
  width: 40,
  height: 40,
  flexShrink: 0,
  borderRadius: '12px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: isOwn
    ? alpha(ui.bubbleOwnText || '#ffffff', 0.14)
    : alpha(theme.palette.primary.main, 0.14),
  color: isOwn ? (ui.bubbleOwnText || theme.palette.primary.main) : theme.palette.primary.main,
});

const secondaryColor = (ui, theme, isOwn) => (isOwn
  ? alpha(ui.bubbleOwnText || '#ffffff', 0.78)
  : (ui.textSecondary || theme.palette.text.secondary));

export function ChatLocationCard({ location, ui, theme, isOwn }) {
  const title = String(location?.title || 'Геопозиция').trim() || 'Геопозиция';
  const subtitle = String(location?.address || '').trim()
    || (Number.isFinite(Number(location?.latitude)) && Number.isFinite(Number(location?.longitude))
      ? `${Number(location.latitude).toFixed(5)}, ${Number(location.longitude).toFixed(5)}`
      : '');
  const mapUrl = buildChatLocationOpenUrl(location);
  const handleOpen = () => {
    if (!mapUrl) return;
    window.open(mapUrl, '_blank', 'noopener,noreferrer');
  };
  const handleKeyDown = (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    handleOpen();
  };
  return (
    <Box
      role={mapUrl ? 'link' : undefined}
      tabIndex={mapUrl ? 0 : undefined}
      aria-label="Открыть геопозицию на карте"
      data-testid="chat-location-card"
      onClick={mapUrl ? (event) => { event.stopPropagation(); handleOpen(); } : undefined}
      onKeyDown={mapUrl ? handleKeyDown : undefined}
      sx={{
        ...cardSurfaceSx(ui, theme, isOwn),
        p: '12px',
        cursor: mapUrl ? 'pointer' : 'default',
        transition: 'transform 100ms ease, opacity 100ms ease',
        '&:active': mapUrl ? { opacity: 0.88 } : undefined,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <Box sx={cardIconWrapSx(ui, theme, isOwn)}>
          <PlaceRoundedIcon fontSize="small" />
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography sx={{ fontSize: 15, fontWeight: 600, lineHeight: 1.3, color: 'inherit', fontFamily: CHAT_FONT_FAMILY }}>
            {title}
          </Typography>
          {subtitle ? (
            <Typography sx={{ mt: '2px', fontSize: 12.5, lineHeight: 1.3, color: secondaryColor(ui, theme, isOwn), fontFamily: CHAT_FONT_FAMILY }}>
              {subtitle}
            </Typography>
          ) : null}
        </Box>
        {mapUrl ? (
          <OpenInNewRoundedIcon sx={{ fontSize: 16, flexShrink: 0, color: secondaryColor(ui, theme, isOwn) }} />
        ) : null}
      </Box>
    </Box>
  );
}

export function ChatContactCard({ contact, ui, theme, isOwn }) {
  const name = String(contact?.name || '').trim() || 'Контакт';
  const phone = String(contact?.phone || '').trim();
  const organization = String(contact?.organization || '').trim();
  const meta = [phone, organization].filter(Boolean).join(' · ');
  const handleCall = (event) => {
    event.stopPropagation();
    if (phone) window.open(`tel:${phone}`, '_self');
  };
  const handleKeyDown = (event) => {
    if (!phone || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    handleCall(event);
  };
  return (
    <Box
      role={phone ? 'link' : undefined}
      tabIndex={phone ? 0 : undefined}
      aria-label={`Контакт ${name}`}
      data-testid="chat-contact-card"
      onClick={phone ? handleCall : undefined}
      onKeyDown={phone ? handleKeyDown : undefined}
      sx={{
        ...cardSurfaceSx(ui, theme, isOwn),
        p: '12px',
        cursor: phone ? 'pointer' : 'default',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <Box sx={cardIconWrapSx(ui, theme, isOwn)}>
          <AccountCircleRoundedIcon fontSize="small" />
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography noWrap sx={{ fontSize: 15, fontWeight: 600, lineHeight: 1.3, color: 'inherit', fontFamily: CHAT_FONT_FAMILY }}>
            {name}
          </Typography>
          <Typography sx={{ mt: '2px', fontSize: 12.5, lineHeight: 1.35, color: secondaryColor(ui, theme, isOwn), fontFamily: CHAT_FONT_FAMILY, wordBreak: 'break-word' }}>
            {meta || 'Контакт'}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

export function ChatPollCard({ poll, ui, theme, isOwn, isOwnMessage, onVote, onClose }) {
  const [busy, setBusy] = useState(false);
  const question = String(poll?.question || 'Опрос').trim() || 'Опрос';
  const options = Array.isArray(poll?.options) ? poll.options : [];
  const totalVoters = Math.max(0, Number(poll?.total_voters || 0));
  const myOptionIndex = Number.isInteger(Number(poll?.my_option_index)) ? Number(poll.my_option_index) : null;
  const closed = Boolean(poll?.closed);
  const votable = typeof onVote === 'function' && !closed;
  const accent = isOwn ? (ui.bubbleOwnText || theme.palette.primary.main) : (ui.accentText || theme.palette.primary.main);
  const muted = secondaryColor(ui, theme, isOwn);
  const runVote = async (optionIndex) => {
    if (!votable || busy) return;
    setBusy(true);
    try {
      await onVote(optionIndex);
    } finally {
      setBusy(false);
    }
  };
  const runClose = async (event) => {
    event.stopPropagation();
    if (typeof onClose !== 'function' || busy) return;
    setBusy(true);
    try {
      await onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Box
      data-testid="chat-poll-card"
      sx={{
        ...cardSurfaceSx(ui, theme, isOwn),
        p: '12px',
      }}
    >
      <Typography sx={{ fontSize: 15, fontWeight: 700, lineHeight: 1.3, color: 'inherit', fontFamily: CHAT_FONT_FAMILY }}>
        {question}
      </Typography>
      <Box sx={{ mt: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {options.map((option, optionIndex) => {
          const isMine = myOptionIndex === optionIndex;
          const votes = Math.max(0, Number(option?.votes || 0));
          const share = totalVoters > 0 ? Math.round((votes / totalVoters) * 100) : 0;
          return (
            <Box
              key={`${optionIndex}-${String(option?.text || '')}`}
              component={votable ? 'button' : 'div'}
              type={votable ? 'button' : undefined}
              role={votable ? 'button' : undefined}
              aria-pressed={votable ? isMine : undefined}
              aria-label={`Вариант ${String(option?.text || '')}, голосов ${votes}`}
              onClick={votable ? (event) => { event.stopPropagation(); void runVote(optionIndex); } : undefined}
              disabled={votable ? busy : undefined}
              sx={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                width: '100%',
                minHeight: 34,
                px: '10px',
                py: '6px',
                border: 'none',
                borderRadius: '10px',
                bgcolor: 'transparent',
                color: 'inherit',
                fontFamily: CHAT_FONT_FAMILY,
                textAlign: 'left',
                cursor: votable && !busy ? 'pointer' : 'default',
                overflow: 'hidden',
                transition: 'background-color 120ms ease',
                '&:hover': votable ? { bgcolor: alpha(accent, 0.07) } : undefined,
              }}
            >
              <Box
                aria-hidden="true"
                sx={{
                  position: 'absolute',
                  inset: 0,
                  width: `${Math.min(100, share)}%`,
                  bgcolor: alpha(accent, isMine ? 0.22 : 0.12),
                  transition: 'width 180ms ease',
                }}
              />
              {isMine ? (
                <CheckCircleRoundedIcon sx={{ position: 'relative', fontSize: 18, color: accent, flexShrink: 0 }} />
              ) : (
                <RadioButtonUncheckedRoundedIcon sx={{ position: 'relative', fontSize: 18, color: muted, flexShrink: 0 }} />
              )}
              <Typography
                component="span"
                sx={{
                  position: 'relative',
                  flex: 1,
                  minWidth: 0,
                  fontSize: 14,
                  lineHeight: 1.3,
                  color: 'inherit',
                  fontFamily: CHAT_FONT_FAMILY,
                  wordBreak: 'break-word',
                }}
              >
                {String(option?.text || '')}
              </Typography>
              {votes > 0 ? (
                <Typography
                  component="span"
                  sx={{ position: 'relative', fontSize: 12, fontWeight: 700, color: muted, fontFamily: CHAT_FONT_FAMILY, flexShrink: 0 }}
                >
                  {`${share}% · ${votes}`}
                </Typography>
              ) : null}
            </Box>
          );
        })}
      </Box>
      <Typography sx={{ mt: '6px', fontSize: 12, color: muted, fontFamily: CHAT_FONT_FAMILY }}>
        {closed
          ? `Опрос завершён · голосов: ${totalVoters}`
          : totalVoters > 0 ? `Голосов: ${totalVoters}` : 'Пока нет голосов'}
      </Typography>
      {isOwnMessage && !closed && typeof onClose === 'function' ? (
        <Box
          component="button"
          type="button"
          disabled={busy}
          onClick={runClose}
          sx={{
            mt: '6px',
            py: '6px',
            width: '100%',
            border: 'none',
            borderRadius: '10px',
            bgcolor: alpha(accent, 0.1),
            color: accent,
            fontSize: 13,
            fontWeight: 600,
            fontFamily: CHAT_FONT_FAMILY,
            cursor: busy ? 'default' : 'pointer',
          }}
        >
          Завершить опрос
        </Box>
      ) : null}
    </Box>
  );
}
