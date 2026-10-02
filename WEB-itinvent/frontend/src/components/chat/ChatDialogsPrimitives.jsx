import { Box, CircularProgress, IconButton, Paper, Skeleton, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';

import { PresenceAvatar } from './ChatCommon';
import { formatFullDate, formatPresenceText, getSearchResultPreview } from './chatHelpers';

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

// Д2-9: подсветка совпадений поискового запроса внутри строк (как в Telegram Web A).
function HighlightMatch({ text, query, accent = 'inherit' }) {
  const source = String(text ?? '');
  const tokens = String(query || '')
    .trim()
    .toLocaleLowerCase('ru-RU')
    .split(/\s+/)
    .filter(Boolean);
  if (!source || tokens.length === 0) return source;
  const lowered = source.toLocaleLowerCase('ru-RU');
  const ranges = [];
  tokens.forEach((token) => {
    let from = 0;
    for (;;) {
      const at = lowered.indexOf(token, from);
      if (at < 0) break;
      ranges.push([at, at + token.length]);
      from = at + token.length;
    }
  });
  if (!ranges.length) return source;
  ranges.sort((a, b) => (a[0] - b[0]) || (b[1] - a[1]));
  const merged = [];
  ranges.forEach(([start, end]) => {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  });
  const parts = [];
  let cursor = 0;
  merged.forEach(([start, end], index) => {
    if (start > cursor) parts.push(source.slice(cursor, start));
    parts.push(
      // Сегменты детерминированы позицией в строке — индексный ключ безопасен.
      <Box
        component="span"
        key={`hl-${index}`}
        sx={{ color: accent, fontWeight: 700 }}
      >
        {source.slice(start, end)}
      </Box>,
    );
    cursor = end;
  });
  if (cursor < source.length) parts.push(source.slice(cursor));
  return parts;
}

// Д2-9: метастрока «статус · должность». «В сети» — акцентом,
// «был(а)…» — серым; должность после разделителя. Одна строка с ellipsis.
function PersonStatusJobLine({ item, ui, query = '', component = 'p' }) {
  const accentColor = ui.accentText || '#3390ec';
  const mutedColor = ui.textSecondary || '#8a939d';
  const online = Boolean(item?.presence?.is_online);
  const rawStatus = formatPresenceText(item?.presence);
  const lowered = rawStatus
    ? rawStatus.charAt(0).toLocaleLowerCase('ru-RU') + rawStatus.slice(1)
    : '';
  // «в сети» — как есть; время последнего визита читается как «был(а) вчера в 19:25».
  const status = online || !lowered || /^(был|не в сети)/i.test(lowered)
    ? lowered
    : `был(а) ${lowered}`;
  const job = String(item?.job_title || '').trim();
  return (
    <Typography
      component={component}
      variant="body2"
      sx={{
        color: mutedColor,
        fontSize: '0.82rem',
        lineHeight: 1.3,
        display: 'block',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        minWidth: 0,
      }}
    >
      <Box component="span" sx={{ color: online ? accentColor : mutedColor }}>
        <HighlightMatch text={status} query={query} accent={online ? accentColor : mutedColor} />
      </Box>
      {job ? (
        <Box component="span" sx={{ color: mutedColor }}>
          {' · '}
          <HighlightMatch text={job} query={query} accent={accentColor} />
        </Box>
      ) : null}
    </Typography>
  );
}

// Д2-9: строка выбора человека ~56px без разделителей, цветной аватар
// (PresenceAvatar уже красит по Telegram-палитре и подставляет фото).
function PersonPickerRow({
  item,
  ui,
  onPress,
  opening = false,
  checked = null,
  disabled = false,
  query = '',
}) {
  const accentColor = ui.accentText || '#3390ec';
  const primaryText = ui.textStrong || ui.bubbleOtherText || '#17212b';
  const hoverBg = ui.drawerHover || ui.surfaceHover || alpha(primaryText, 0.06);
  const selectable = checked !== null;
  const name = item?.full_name || item?.username || 'Пользователь';
  return (
    <Paper
      elevation={0}
      component="button"
      type="button"
      role={selectable ? 'checkbox' : 'button'}
      aria-checked={selectable ? checked : undefined}
      aria-disabled={disabled || undefined}
      data-user-id={String(item?.id || '')}
      onClick={() => {
        if (disabled) return;
        onPress?.(item);
      }}
      sx={{
        width: '100%',
        minHeight: 56,
        px: 1.2,
        py: 0.8,
        mx: 0,
        borderRadius: 2,
        display: 'flex',
        alignItems: 'center',
        gap: 1.4,
        textAlign: 'left',
        color: primaryText,
        cursor: disabled ? 'default' : 'pointer',
        bgcolor: 'transparent',
        opacity: disabled ? 0.45 : 1,
        transition: 'background-color 120ms ease, opacity 120ms ease',
        '&:hover': { bgcolor: disabled ? 'transparent' : hoverBg },
        '&:active': disabled ? {} : { opacity: 0.84 },
      }}
    >
      <PresenceAvatar item={item} online={Boolean(item?.presence?.is_online)} size={44} colorSeed={item?.id} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography
          variant="body1"
          sx={{
            fontWeight: 600,
            color: checked ? accentColor : primaryText,
            fontFamily: 'inherit',
            fontSize: '0.95rem',
            lineHeight: 1.35,
          }}
          noWrap
        >
          <HighlightMatch text={name} query={query} accent={accentColor} />
        </Typography>
        <PersonStatusJobLine item={item} ui={ui} query={query} />
      </Box>
      {opening ? <CircularProgress size={18} sx={{ flexShrink: 0 }} /> : null}
      {selectable ? (
        <Box
          aria-hidden="true"
          sx={{
            flexShrink: 0,
            width: 24,
            height: 24,
            borderRadius: '50%',
            border: `2px solid ${checked ? accentColor : (ui.borderSoft || alpha(primaryText, 0.3))}`,
            bgcolor: checked ? accentColor : 'transparent',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'background-color 120ms ease, border-color 120ms ease',
          }}
        >
          {checked ? <CheckRoundedIcon sx={{ fontSize: 15, color: '#fff' }} /> : null}
        </Box>
      ) : null}
    </Paper>
  );
}

// Обёртка сохраняет прежнее имя GroupUserCheckboxRow для выбора участников группы.
function GroupUserCheckboxRow({ item, ui, checked = false, disabled = false, onToggle, query = '' }) {
  return (
    <PersonPickerRow
      item={item}
      ui={ui}
      checked={checked}
      disabled={disabled}
      query={query}
      onPress={onToggle}
    />
  );
}

// Д2-9: чип выбранного участника внутри поискового поля (аватар + имя + ×).
function SelectedMemberChip({ item, ui, onRemove }) {
  const accentColor = ui.accentText || '#3390ec';
  const primaryText = ui.textStrong || ui.bubbleOtherText || '#17212b';
  const shortName = String(item?.full_name || item?.username || 'Участник').trim().split(/\s+/)[0];
  const chipBg = ui.surfaceMuted || alpha(accentColor, 0.14);
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        maxWidth: 160,
        height: 28,
        pl: 0.25,
        pr: 0.5,
        borderRadius: 999,
        bgcolor: chipBg,
        color: primaryText,
        flexShrink: 0,
      }}
    >
      <PresenceAvatar item={item} online={false} size={22} colorSeed={item?.id} />
      <Box
        component="span"
        sx={{
          fontSize: '0.82rem',
          fontWeight: 600,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {shortName}
      </Box>
      {onRemove ? (
        <Box
          component="button"
          type="button"
          aria-label={`Убрать ${shortName}`}
          onClick={(event) => {
            event.stopPropagation();
            onRemove(item);
          }}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 18,
            height: 18,
            border: 'none',
            borderRadius: '50%',
            bgcolor: 'transparent',
            color: ui.textSecondary || '#8a939d',
            cursor: 'pointer',
            p: 0,
            '&:hover': { color: primaryText, bgcolor: alpha(primaryText, 0.1) },
          }}
        >
          <CloseRoundedIcon sx={{ fontSize: 14 }} />
        </Box>
      ) : null}
    </Box>
  );
}

// Д2-9: общая шапка потоков «Новое сообщение» / «Новая группа» —
// стрелка назад + заголовок (+ счётчик выбранных).
function ComposeFlowHeader({ ui, title, subtitle = '', onBack, backLabel = 'Назад', compactMobile = false, children }) {
  const primaryText = ui.textStrong || ui.textPrimary || '#17212b';
  return (
    <Box
      className={compactMobile ? 'chat-safe-top' : undefined}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        px: compactMobile ? 1.25 : 1,
        py: compactMobile ? 0.75 : 0.75,
        borderBottom: `1px solid ${ui.borderSoft || alpha(primaryText, 0.12)}`,
        bgcolor: ui.sidebarHeaderBg || 'transparent',
      }}
    >
      <IconButton
        aria-label={backLabel}
        onClick={onBack}
        size={compactMobile ? 'medium' : 'small'}
        sx={{ color: primaryText, ml: -0.25 }}
      >
        <ArrowBackRoundedIcon />
      </IconButton>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography
          component="div"
          variant="subtitle1"
          sx={{ fontWeight: 800, fontSize: compactMobile ? '1.05rem' : '1rem', lineHeight: 1.25, color: primaryText }}
          noWrap
        >
          {title}
        </Typography>
        {subtitle ? (
          <Typography
            component="div"
            variant="caption"
            sx={{ color: ui.textSecondary, fontWeight: 500, lineHeight: 1.3 }}
            noWrap
          >
            {subtitle}
          </Typography>
        ) : null}
      </Box>
      {children}
    </Box>
  );
}

// Д2-9: плавающая круглая кнопка-акцент («→» к шагу названия, «✓» создать).
function ComposeActionFab({ ui, onClick, disabled = false, loading = false, label, icon = null, sx = {} }) {
  const active = !disabled && !loading;
  return (
    <Box
      component="button"
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        if (disabled || loading) return;
        onClick?.();
      }}
      aria-disabled={disabled || loading}
      sx={{
        position: 'absolute',
        right: 20,
        bottom: 20,
        zIndex: 10,
        width: 56,
        height: 56,
        borderRadius: '50%',
        border: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: active ? 'pointer' : 'default',
        bgcolor: active ? (ui.composeFabBg || ui.accentText || '#3390ec') : (ui.surfaceMuted || alpha(ui.textSecondary || '#8a939d', 0.28)),
        color: active ? (ui.composeFabText || '#ffffff') : (ui.textSecondary || '#8a939d'),
        boxShadow: active ? (ui.composeFabShadow || '0 8px 20px rgba(0,0,0,0.28)') : 'none',
        transition: 'transform 150ms ease, opacity 150ms ease, background-color 150ms ease',
        '&:hover': active ? { transform: 'scale(1.05)' } : {},
        '&:active': active ? { transform: 'scale(0.96)' } : {},
        ...sx,
      }}
    >
      {loading ? <CircularProgress size={22} sx={{ color: 'inherit' }} /> : icon}
    </Box>
  );
}

export {
  DialogSkeletonLine,
  DialogListSkeleton,
  SearchResultCard,
  HighlightMatch,
  PersonStatusJobLine,
  PersonPickerRow,
  GroupUserCheckboxRow,
  SelectedMemberChip,
  ComposeFlowHeader,
  ComposeActionFab,
};
