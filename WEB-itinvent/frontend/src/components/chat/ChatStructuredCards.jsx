import { useEffect, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import AccountCircleRoundedIcon from '@mui/icons-material/AccountCircleRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import PlaceRoundedIcon from '@mui/icons-material/PlaceRounded';

import { buildChatLocationOpenUrl } from './chatStructuredContent';
import { CHAT_FONT_FAMILY } from './chatUiTokens';

// Д2-10: структурная карточка — контент единой карточки цвета стороны,
// которую рисует ChatBubble; собственной рамки и второй подложки нет.
const cardSurfaceSx = (ui, theme, isOwn) => ({
  width: '100%',
  color: isOwn ? (ui.bubbleOwnText || theme.palette.text.primary) : (ui.bubbleOtherText || theme.palette.text.primary),
  textAlign: 'left',
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

// R50: опрос как в Telegram. До голоса — строки с кружками и нажатием «сразу голосует»;
// после голоса (или у закрытого) — результаты: процент, полоса, галочка у своего варианта.
// «Остановить опрос» и «Отменить голос» живут в меню сообщения, не в карточке.
export const formatPollVotes = (count) => {
  const value = Math.max(0, Math.round(Number(count) || 0));
  if (value === 0) return 'Нет голосов';
  const mod100 = value % 100;
  const mod10 = value % 10;
  const word = mod100 >= 11 && mod100 <= 14
    ? 'голосов'
    : mod10 === 1 ? 'голос' : (mod10 >= 2 && mod10 <= 4 ? 'голоса' : 'голосов');
  return `${value} ${word}`;
};

const POLL_BAR_MS = 420;

export function ChatPollCard({ poll, ui, theme, isOwn, onVote }) {
  const [busy, setBusy] = useState(false);
  const question = String(poll?.question || 'Опрос').trim() || 'Опрос';
  const options = Array.isArray(poll?.options) ? poll.options : [];
  const totalVoters = Math.max(0, Number(poll?.total_voters || 0));
  const rawMine = poll?.my_option_index;
  const myOptionIndex = rawMine !== null && rawMine !== undefined && Number.isInteger(Number(rawMine)) ? Number(rawMine) : null;
  const closed = Boolean(poll?.closed);
  const hasVoted = myOptionIndex !== null && myOptionIndex >= 0 && myOptionIndex < options.length;
  const showResults = closed || hasVoted;
  const votable = typeof onVote === 'function' && !showResults;
  const ink = isOwn ? (ui.bubbleOwnText || '#ffffff') : (ui.bubbleOtherText || theme.palette.text.primary);
  const cardBg = isOwn ? (ui.bubbleOwnBg || '#2b5278') : (ui.bubbleOtherBg || theme.palette.background.paper);
  // На синем пузыре своей стороны полоса и проценты светлые, на чужом — акцент темы.
  const accent = isOwn ? ink : (ui.accentText || theme.palette.primary.main);
  const muted = secondaryColor(ui, theme, isOwn);
  const divider = alpha(ink, 0.12);

  // Полосы анимируются от 0 только при переходе в режим результатов, а не при каждом монтировании.
  const [barsReady, setBarsReady] = useState(showResults);
  useEffect(() => {
    if (!showResults) {
      setBarsReady(false);
      return undefined;
    }
    if (barsReady) return undefined;
    const frame = requestAnimationFrame(() => setBarsReady(true));
    return () => cancelAnimationFrame(frame);
  }, [showResults, barsReady]);

  const runVote = async (optionIndex) => {
    if (!votable || busy) return;
    setBusy(true);
    try {
      await onVote(optionIndex);
    } finally {
      setBusy(false);
    }
  };

  const typeLine = closed ? 'Итоги' : (poll?.anonymous ? 'Анонимный опрос' : 'Публичный опрос');

  return (
    <Box
      data-testid="chat-poll-card"
      data-poll-mode={showResults ? 'results' : 'vote'}
      sx={{
        ...cardSurfaceSx(ui, theme, isOwn),
        p: '12px',
        // Карточка не уже обычного пузыря: ~280 px, на телефоне — не шире ленты.
        minWidth: 'min(280px, 66vw)',
      }}
    >
      <Typography sx={{ fontSize: 15, fontWeight: 600, lineHeight: 1.3, color: 'inherit', fontFamily: CHAT_FONT_FAMILY, wordBreak: 'break-word' }}>
        {question}
      </Typography>
      <Typography
        data-testid="chat-poll-type"
        sx={{ mt: '2px', fontSize: 13, lineHeight: 1.3, color: muted, fontFamily: CHAT_FONT_FAMILY }}
      >
        {typeLine}
      </Typography>
      <Box sx={{ mt: '8px', display: 'flex', flexDirection: 'column' }}>
        {options.map((option, optionIndex) => {
          const text = String(option?.text || '');
          const isMine = myOptionIndex === optionIndex;
          const isLast = optionIndex === options.length - 1;
          const key = `${optionIndex}-${text}`;
          if (!showResults) {
            return (
              <Box
                key={key}
                component="button"
                type="button"
                data-testid="chat-poll-option"
                aria-label={`Вариант ${text}`}
                onClick={votable ? (event) => { event.stopPropagation(); void runVote(optionIndex); } : undefined}
                disabled={!votable || busy}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  width: '100%',
                  minHeight: 40,
                  px: '4px',
                  py: 0,
                  border: 'none',
                  borderRadius: '8px',
                  bgcolor: 'transparent',
                  color: 'inherit',
                  fontFamily: CHAT_FONT_FAMILY,
                  textAlign: 'left',
                  cursor: votable && !busy ? 'pointer' : 'default',
                  transition: 'background-color 120ms ease',
                  '&:hover': votable ? { bgcolor: alpha(ink, 0.07) } : undefined,
                  '&:focus-visible': { outline: `2px solid ${alpha(accent, 0.6)}`, outlineOffset: 1 },
                }}
              >
                <Box
                  aria-hidden="true"
                  sx={{
                    width: 20,
                    height: 20,
                    boxSizing: 'border-box',
                    flexShrink: 0,
                    borderRadius: '50%',
                    border: `2px solid ${alpha(ink, 0.55)}`,
                  }}
                />
                <Box
                  sx={{
                    flex: 1,
                    minWidth: 0,
                    minHeight: 40,
                    display: 'flex',
                    alignItems: 'center',
                    borderBottom: isLast ? 'none' : `1px solid ${divider}`,
                  }}
                >
                  <Typography
                    component="span"
                    sx={{ fontSize: 15, lineHeight: 1.3, color: 'inherit', fontFamily: CHAT_FONT_FAMILY, wordBreak: 'break-word', py: '6px' }}
                  >
                    {text}
                  </Typography>
                </Box>
              </Box>
            );
          }
          const votes = Math.max(0, Number(option?.votes || 0));
          const share = totalVoters > 0 ? Math.min(100, Math.round((votes / totalVoters) * 100)) : 0;
          const barWidth = !barsReady ? '0px' : (share > 0 ? `${share}%` : '4px');
          return (
            <Box
              key={key}
              data-testid="chat-poll-result"
              data-selected={isMine ? 'true' : undefined}
              aria-label={`${text}: ${share}%, ${formatPollVotes(votes)}${isMine ? ', ваш выбор' : ''}`}
              sx={{ display: 'flex', alignItems: 'flex-start', gap: '10px', py: '6px' }}
            >
              <Typography
                component="span"
                data-testid="chat-poll-percent"
                sx={{
                  width: 40,
                  flexShrink: 0,
                  textAlign: 'right',
                  fontSize: 14,
                  fontWeight: 600,
                  lineHeight: '20px',
                  color: accent,
                  fontFamily: CHAT_FONT_FAMILY,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {`${share}%`}
              </Typography>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography
                  component="span"
                  sx={{ display: 'block', fontSize: 15, lineHeight: '20px', color: 'inherit', fontFamily: CHAT_FONT_FAMILY, wordBreak: 'break-word' }}
                >
                  {text}
                </Typography>
                <Box sx={{ position: 'relative', mt: '2px', height: 16, display: 'flex', alignItems: 'center' }}>
                  <Box
                    aria-hidden="true"
                    sx={{ position: 'absolute', left: 0, right: 0, height: 4, borderRadius: '2px', bgcolor: alpha(accent, 0.16) }}
                  />
                  <Box
                    aria-hidden="true"
                    data-testid="chat-poll-bar"
                    sx={{
                      position: 'absolute',
                      left: 0,
                      height: 4,
                      borderRadius: '2px',
                      bgcolor: accent,
                      width: barWidth,
                      transition: `width ${POLL_BAR_MS}ms ease`,
                      '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
                    }}
                  />
                  {isMine ? (
                    <Box
                      aria-hidden="true"
                      data-testid="chat-poll-mine"
                      sx={{
                        position: 'absolute',
                        left: 0,
                        width: 16,
                        height: 16,
                        borderRadius: '50%',
                        bgcolor: accent,
                        color: cardBg,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <CheckRoundedIcon sx={{ fontSize: 12 }} />
                    </Box>
                  ) : null}
                </Box>
              </Box>
            </Box>
          );
        })}
      </Box>
      <Typography
        data-testid="chat-poll-total"
        sx={{ mt: '6px', textAlign: 'center', fontSize: 13, lineHeight: 1.3, color: muted, fontFamily: CHAT_FONT_FAMILY }}
      >
        {formatPollVotes(totalVoters)}
      </Typography>
    </Box>
  );
}
