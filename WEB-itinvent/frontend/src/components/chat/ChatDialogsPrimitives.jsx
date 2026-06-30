import { Box, Checkbox, Paper, Skeleton, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';

import { PresenceAvatar } from './ChatCommon';
import { formatFullDate, getSearchResultPreview } from './chatHelpers';
import { CHAT_FONT_FAMILY } from './chatUiTokens';

function DialogSkeletonLine({ ui, width = '100%', height = 14, radius = 999, sx }) {
  return (
    <Skeleton
      variant="rounded"
      animation="wave"
      width={width}
      height={height}
      sx={{
        borderRadius: radius,
        bgcolor: ui.skeletonBase || alpha(ui.textSecondary || '#78909c', 0.16),
        '&::after': {
          background: `linear-gradient(90deg, transparent, ${ui.skeletonWave || alpha('#ffffff', 0.48)}, transparent)`,
        },
        ...sx,
      }}
    />
  );
}

function DialogListSkeleton({ ui, rows = 4, compact = false }) {
  return (
    <Stack spacing={compact ? 0.9 : 1.05} sx={{ px: compact ? 1.1 : 1.5, py: compact ? 1.25 : 2 }}>
      {Array.from({ length: rows }).map((_, index) => (
        <Stack key={index} direction="row" spacing={1.25} alignItems="center">
          <DialogSkeletonLine ui={ui} width={compact ? 34 : 42} height={compact ? 34 : 42} radius={compact ? 11 : 14} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <DialogSkeletonLine ui={ui} width={index % 2 ? '54%' : '72%'} height={14} radius={8} />
            <DialogSkeletonLine ui={ui} width={index % 2 ? '76%' : '48%'} height={11} radius={8} sx={{ mt: 0.8 }} />
          </Box>
        </Stack>
      ))}
    </Stack>
  );
}

function SearchResultCard({ item, ui, onOpen }) {
  const cardText = ui.textStrong || ui.textPrimary || '#17212b';
  const cardSurface = ui.surfaceMuted || ui.drawerBgSoft || ui.panelBg || '#ffffff';
  const cardHover = ui.surfaceHover || ui.drawerHover || ui.accentSoft || cardSurface;
  return (
    <Paper
      elevation={0}
      component="button"
      type="button"
      onClick={() => onOpen?.(item)}
      sx={{
        width: '100%',
        textAlign: 'left',
        p: 1.4,
        borderRadius: 3,
        border: `1px solid ${ui.borderSoft}`,
        bgcolor: cardSurface,
        cursor: 'pointer',
        color: cardText,
        transition: 'background-color 140ms ease, border-color 140ms ease, transform 100ms ease, opacity 100ms ease',
        '&:hover': {
          bgcolor: cardHover,
          borderColor: ui.accentSoft || alpha(ui.accentText || '#3390ec', 0.24),
        },
        '&:active': {
          opacity: 0.84,
          transform: 'scale(0.995)',
        },
      }}
    >
      <Stack spacing={0.7}>
        <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="center">
          <Typography variant="subtitle2" sx={{ fontWeight: 800, color: cardText }} noWrap>
            {item?.sender?.full_name || item?.sender?.username || 'Сообщение'}
          </Typography>
          <Typography variant="caption" sx={{ color: ui.textSecondary, flexShrink: 0 }}>
            {formatFullDate(item?.created_at)}
          </Typography>
        </Stack>
        <Typography variant="body2" sx={{ color: ui.textSecondary }} noWrap>
          {getSearchResultPreview(item)}
        </Typography>
      </Stack>
    </Paper>
  );
}

function GroupUserRow({
  item,
  ui,
  onAction,
  checked = false,
}) {
  const accentColor = ui.accentText || '#3390ec';
  const primaryText = ui.textStrong || ui.bubbleOtherText || '#17212b';
  const hoverBg = ui.drawerHover || ui.surfaceHover || alpha(primaryText, 0.06);
  return (
    <Paper
      elevation={0}
      component="button"
      type="button"
      role="checkbox"
      aria-checked={checked}
      data-user-id={String(item?.id || '')}
      onClick={() => onAction?.(item)}
      sx={{
        width: '100%',
        px: 1.35,
        py: 0.9,
        borderRadius: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 1.35,
        textAlign: 'left',
        color: primaryText,
        cursor: 'pointer',
        bgcolor: 'transparent',
        transition: 'background-color 120ms ease',
        '&:hover': { bgcolor: hoverBg },
        '&:active': { opacity: 0.76 },
      }}
    >
      {/* Avatar with check overlay */}
      <Box sx={{ position: 'relative', flexShrink: 0 }}>
        <PresenceAvatar item={item} online={Boolean(item?.presence?.is_online)} size={46} />
        {checked ? (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              borderRadius: '50%',
              bgcolor: accentColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              animation: 'fadeIn 120ms ease',
              '@keyframes fadeIn': { from: { opacity: 0, transform: 'scale(0.7)' }, to: { opacity: 1, transform: 'scale(1)' } },
            }}
          >
            <CheckRoundedIcon sx={{ fontSize: 26, color: '#fff' }} />
          </Box>
        ) : null}
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography
          variant="body1"
          sx={{ fontWeight: checked ? 700 : 600, color: checked ? accentColor : primaryText, fontFamily: 'inherit', lineHeight: 1.35 }}
          noWrap
        >
          {item?.full_name || item?.username || 'Пользователь'}
        </Typography>
        <Typography variant="body2" sx={{ color: ui.textSecondary, fontSize: '0.82rem', lineHeight: 1.3 }} noWrap>
          {getPersonStatusLine(item)}
        </Typography>
      </Box>
    </Paper>
  );
}

function GroupUserCheckboxRow({ item, ui, checked = false, onToggle, compact = false }) {
  return <GroupUserRow item={item} ui={ui} checked={checked} onAction={onToggle} />;
}

function SelectedUserPill({ item, ui, onRemove }) {
  const accentColor = ui.accentText || '#3390ec';
  const primaryText = ui.textStrong || ui.bubbleOtherText || '#17212b';
  const bgColor = ui.drawerBg || ui.panelBg || '#17212b';
  const shortName = String(item?.full_name || item?.username || 'Участник').split(' ')[0];
  return (
    <Stack
      alignItems="center"
      spacing={0.4}
      sx={{ flex: '0 0 auto', width: 68, cursor: onRemove ? 'pointer' : 'default', pt: 0.5, pb: 0.25 }}
      onClick={() => onRemove?.(item)}
    >
      {/* Extra padding so presence dot + close badge don't clip */}
      <Box sx={{ position: 'relative', p: '3px' }}>
        <PresenceAvatar item={item} online={Boolean(item?.presence?.is_online)} size={46} />
        {onRemove ? (
          <Box
            sx={{
              position: 'absolute',
              top: 0,
              right: 0,
              width: 18,
              height: 18,
              borderRadius: '50%',
              bgcolor: bgColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: `2px solid ${bgColor}`,
              zIndex: 2,
            }}
          >
            <CloseRoundedIcon sx={{ fontSize: 11, color: accentColor }} />
          </Box>
        ) : null}
      </Box>
      <Typography
        variant="caption"
        sx={{ color: primaryText, fontWeight: 600, fontSize: '0.74rem', lineHeight: 1.2, textAlign: 'center', width: '100%', px: 0.25 }}
        noWrap
      >
        {shortName}
      </Typography>
    </Stack>
  );
}


export {
  DialogSkeletonLine,
  DialogListSkeleton,
  SearchResultCard,
  GroupUserRow,
  GroupUserCheckboxRow,
  SelectedUserPill,
};
