import { memo } from 'react';
import { Box, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';

const normalizeReactionItems = (reactions) => (
  (Array.isArray(reactions) ? reactions : [])
    .map((reaction) => {
      const reactionEmoji = String(reaction?.reaction_emoji || reaction?.emoji || '').trim();
      const count = Number(reaction?.count || 0);
      return {
        reaction_emoji: reactionEmoji,
        count: Number.isFinite(count) ? count : 0,
        is_own: Boolean(reaction?.is_own),
      };
    })
    .filter((reaction) => reaction.reaction_emoji && reaction.count > 0)
);

const ChatMessageReactions = memo(function ChatMessageReactions({
  reactions = [],
  theme,
  ui,
  compactMobile,
  isOwn = false,
  onToggleReaction,
}) {
  const items = normalizeReactionItems(reactions);
  if (items.length === 0) return null;
  const bubbleReactionBg = alpha(isOwn ? '#123a5b' : ui.textPrimary || '#0f172a', theme.palette.mode === 'dark' ? 0.34 : 0.18);

  return (
    <Box
      data-testid="chat-message-reactions"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: compactMobile ? '1px' : '2px',
        minHeight: compactMobile ? 18 : 19,
        mt: compactMobile ? 0.34 : 0.38,
        mb: compactMobile ? -0.1 : -0.12,
        mr: compactMobile ? '4.15rem' : '4.35rem',
        px: compactMobile ? 0 : 0.32,
        py: 0,
        borderRadius: 999,
        maxWidth: compactMobile ? 'calc(100% - 4.15rem)' : 'calc(100% - 4.35rem)',
        overflow: 'hidden',
        pointerEvents: 'auto',
        bgcolor: compactMobile ? 'transparent' : bubbleReactionBg,
        border: 'none',
        boxShadow: 'none',
        verticalAlign: 'bottom',
      }}
    >
      {items.map((reaction) => {
        const reactionSelected = Boolean(reaction.is_own);
        const countLabel = reaction.count > 1 ? reaction.count : '';
        return (
          <Box
            key={reaction.reaction_emoji}
            component="button"
            type="button"
            aria-label={`Reaction ${reaction.reaction_emoji}`}
            aria-pressed={reactionSelected}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onToggleReaction?.(reaction.reaction_emoji);
            }}
            sx={{
              minWidth: compactMobile ? 17 : 18,
              height: compactMobile ? 17 : 18,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: countLabel ? 0.25 : 0,
              px: countLabel ? (compactMobile ? 0.32 : 0.38) : 0,
              py: 0,
              borderRadius: 999,
              border: 'none',
              cursor: 'pointer',
              bgcolor: !compactMobile && reactionSelected
                ? alpha('#ffffff', isOwn ? 0.12 : 0.22)
                : 'transparent',
              color: isOwn ? '#d9ebff' : (ui.textPrimary || theme.palette.text.primary),
              boxShadow: !compactMobile && reactionSelected
                ? `0 0 0 1px ${alpha('#ffffff', isOwn ? 0.34 : 0.78)}`
                : 'none',
              fontSize: compactMobile ? 13.5 : 14.5,
              lineHeight: 1,
              transition: 'transform 100ms ease, background-color 100ms ease',
              '&:hover': compactMobile ? undefined : {
                transform: 'translateY(-0.5px)',
                bgcolor: alpha('#ffffff', isOwn ? 0.16 : 0.28),
              },
              '&:active': {
                transform: 'scale(0.94)',
              },
            }}
          >
            <span>{reaction.reaction_emoji}</span>
            {countLabel ? (
              <Typography
                component="span"
                sx={{
                  fontSize: compactMobile ? 9.5 : 10,
                  fontWeight: 700,
                  lineHeight: 1,
                  color: 'inherit',
                }}
              >
                {countLabel}
              </Typography>
            ) : null}
          </Box>
        );
      })}
    </Box>
  );
});

export default ChatMessageReactions;
