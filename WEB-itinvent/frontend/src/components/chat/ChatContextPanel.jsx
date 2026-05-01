import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  IconButton,
  Menu,
  MenuItem,
  Skeleton,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import AttachFileRoundedIcon from '@mui/icons-material/AttachFileRounded';
import AudiotrackRoundedIcon from '@mui/icons-material/AudiotrackRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import KeyboardArrowRightRoundedIcon from '@mui/icons-material/KeyboardArrowRightRounded';
import NotificationsOutlinedIcon from '@mui/icons-material/NotificationsOutlined';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import PersonOutlineRoundedIcon from '@mui/icons-material/PersonOutlineRounded';
import PhoneRoundedIcon from '@mui/icons-material/PhoneRounded';
import PhotoLibraryOutlinedIcon from '@mui/icons-material/PhotoLibraryOutlined';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import TaskAltOutlinedIcon from '@mui/icons-material/TaskAltOutlined';
import VideoLibraryOutlinedIcon from '@mui/icons-material/VideoLibraryOutlined';
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import CakeRoundedIcon from '@mui/icons-material/CakeRounded';

import { chatAPI } from '../../api/client';
import { PresenceAvatar } from './ChatCommon';
import {
  buildAttachmentUrl,
  formatFileSize,
  formatFullDate,
  formatPresenceText,
  getPriorityMeta,
  getStatusMeta,
  getTaskAssignee,
  isImageAttachment,
  isVideoAttachment,
  normalizeChatAttachmentUrl,
  sortByName,
} from './chatHelpers';

// Вспомогательная функция для получения расширения файла
const getFileExtension = (fileName) => {
  const normalized = String(fileName || '').trim();
  if (!normalized.includes('.')) return '';
  return normalized.split('.').pop()?.toUpperCase() || '';
};

const PANEL_WIDTH = 360;
const COLLAPSED_WIDTH = 72;
const ATTACHMENT_PAGE_SIZE = 12;
const TASK_PAGE_SIZE = 6;
const PARTICIPANTS_COLLAPSED_COUNT = 8;
const PARTICIPANTS_EXPANDED_MAX_HEIGHT = 360;
const GROUP_ROLE_LABELS = {
  owner: 'Владелец',
  moderator: 'Модератор',
  member: 'Участник',
};

const normalizeGroupRole = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'owner' || normalized === 'moderator' || normalized === 'member') return normalized;
  return 'member';
};

const SHEET_COLORS = {
  bg: 'var(--chat-sheet-bg)',
  bgStrong: 'var(--chat-sheet-bg-strong)',
  bgSoft: 'var(--chat-sheet-bg-soft)',
  bgHover: 'var(--chat-sheet-bg-hover)',
  text: 'var(--chat-sheet-text)',
  textSecondary: 'var(--chat-sheet-text-secondary)',
  border: 'var(--chat-sheet-border)',
  accent: 'var(--chat-sheet-accent)',
  accentSoft: 'var(--chat-sheet-accent-soft)',
  accentBorder: 'var(--chat-sheet-accent-border)',
  warning: 'var(--chat-sheet-warning)',
  warningSoft: 'var(--chat-sheet-warning-soft)',
  neutralSoft: 'var(--chat-sheet-neutral-soft)',
};

function buildSheetVars(ui, theme) {
  const isDarkTheme = theme?.palette?.mode === 'dark';
  const accent = ui.accentText || (isDarkTheme ? '#64b5f6' : '#3390ec');
  const panelBg = ui.drawerBg || (isDarkTheme ? '#17212b' : '#ffffff');
  const panelBgStrong = ui.drawerBgStrong || (isDarkTheme ? '#1e2c3a' : '#f7f9fc');
  const panelCardBg = ui.surfaceMuted || ui.drawerBgSoft || (isDarkTheme ? 'rgba(255,255,255,0.045)' : '#f4f7fb');
  const panelText = ui.textStrong || (isDarkTheme ? '#ffffff' : '#17212b');
  const panelMuted = ui.textSecondary || (isDarkTheme ? 'rgba(255,255,255,0.56)' : '#707579');
  const panelSoft = isDarkTheme ? 'rgba(255,255,255,0.42)' : '#8a96a3';
  const panelIcon = isDarkTheme ? 'rgba(255,255,255,0.58)' : '#8693a0';
  const panelDivider = ui.borderSoft || (isDarkTheme ? 'rgba(255,255,255,0.08)' : 'rgba(219,227,235,0.96)');
  const panelAccentSoft = ui.accentSoft || alpha(accent, isDarkTheme ? 0.18 : 0.12);
  return {
    '--chat-sheet-bg': panelBg,
    '--chat-sheet-bg-strong': panelBgStrong,
    '--chat-sheet-bg-soft': ui.drawerBgSoft || panelCardBg,
    '--chat-sheet-bg-card': panelCardBg,
    '--chat-sheet-bg-hover': ui.drawerHover || ui.sidebarRowHover || 'rgba(255,255,255,0.06)',
    '--chat-sheet-text': panelText,
    '--chat-sheet-text-secondary': panelMuted,
    '--chat-sheet-border': panelDivider,
    '--chat-sheet-accent': accent,
    '--chat-sheet-accent-soft': panelAccentSoft,
    '--chat-sheet-accent-border': alpha(accent, isDarkTheme ? 0.28 : 0.22),
    '--chat-sheet-warning': '#fbbf24',
    '--chat-sheet-warning-soft': 'rgba(251,191,36,0.16)',
    '--chat-sheet-neutral-soft': ui.surfaceMuted || alpha(isDarkTheme ? '#ffffff' : '#78909c', isDarkTheme ? 0.06 : 0.12),
    '--chat-sheet-panel-bg': panelBg,
    '--chat-sheet-panel-bg-strong': panelBgStrong,
    '--chat-sheet-panel-card': panelCardBg,
    '--chat-sheet-panel-text': panelText,
    '--chat-sheet-panel-muted': panelMuted,
    '--chat-sheet-panel-soft': panelSoft,
    '--chat-sheet-panel-icon': panelIcon,
    '--chat-sheet-panel-divider': panelDivider,
    '--chat-sheet-panel-divider-width': isDarkTheme ? '0.5px' : '1px',
    '--chat-sheet-panel-accent': accent,
    '--chat-sheet-panel-accent-soft': panelAccentSoft,
    '--chat-sheet-panel-grid': isDarkTheme ? 'rgba(255,255,255,0.06)' : 'rgba(219,227,235,0.98)',
    '--chat-sheet-panel-cell': isDarkTheme ? '#1f2c39' : '#edf2f6',
    '--chat-sheet-panel-overlay': isDarkTheme ? 'rgba(0,0,0,0.55)' : 'rgba(31,43,56,0.62)',
    '--chat-sheet-panel-menu-bg': ui.drawerBgStrong || (isDarkTheme ? '#1e2c3a' : '#ffffff'),
    '--chat-sheet-panel-menu-shadow': ui.shadowStrong || (isDarkTheme ? '0 24px 40px rgba(0,0,0,0.34)' : '0 18px 40px rgba(31,43,56,0.12)'),
    '--chat-sheet-shadow-soft': ui.shadowSoft || (isDarkTheme ? '0 2px 8px rgba(0,0,0,0.14)' : '0 1px 2px rgba(65,88,110,0.12)'),
    '--chat-sheet-shadow-strong': ui.shadowStrong || (isDarkTheme ? '0 18px 42px rgba(0,0,0,0.34)' : '0 16px 36px rgba(80,104,128,0.16)'),
    '--chat-sheet-skeleton-base': ui.skeletonBase || alpha(isDarkTheme ? '#ffffff' : '#78909c', isDarkTheme ? 0.07 : 0.14),
    '--chat-sheet-skeleton-wave': ui.skeletonWave || alpha('#ffffff', isDarkTheme ? 0.12 : 0.52),
  };
}

const ASSET_KIND_META = {
  image: {
    label: 'Фотографии',
    shortLabel: 'Фото',
    icon: <PhotoLibraryOutlinedIcon fontSize="small" />,
  },
  video: {
    label: 'Видео',
    shortLabel: 'Видео',
    icon: <VideoLibraryOutlinedIcon fontSize="small" />,
  },
  file: {
    label: 'Файлы',
    shortLabel: 'Файлы',
    icon: <InsertDriveFileOutlinedIcon fontSize="small" />,
  },
  audio: {
    label: 'Аудио',
    shortLabel: 'Аудио',
    icon: <AudiotrackRoundedIcon fontSize="small" />,
  },
  task: {
    label: 'Задачи',
    shortLabel: 'Задачи',
    icon: <TaskAltOutlinedIcon fontSize="small" />,
  },
  link: {
    label: 'Ссылки',
    shortLabel: 'Ссылки',
    icon: <OpenInNewRoundedIcon fontSize="small" />,
  },
};

const EMPTY_SUMMARY = {
  photos_count: 0,
  videos_count: 0,
  files_count: 0,
  audio_count: 0,
  shared_tasks_count: 0,
  recent_photos: [],
  recent_videos: [],
  recent_files: [],
  recent_audio: [],
};

const MESSAGE_LINK_PATTERN = /(https?:\/\/[^\s<>"']+)/gi;

function extractLinksFromText(text) {
  const source = String(text || '');
  if (!source) return [];

  const matches = source.match(MESSAGE_LINK_PATTERN) || [];
  return matches
    .map((url) => url.replace(/[),.!?]+$/u, ''))
    .filter(Boolean);
}

function CompactBadge({ children, tone = 'neutral' }) {
  const palette = tone === 'accent'
    ? { color: SHEET_COLORS.accent, bg: SHEET_COLORS.accentSoft }
    : tone === 'warning'
      ? { color: SHEET_COLORS.warning, bg: SHEET_COLORS.warningSoft }
      : { color: SHEET_COLORS.textSecondary, bg: SHEET_COLORS.neutralSoft };

  return (
    <Box
      component="span"
      sx={{
        px: 1,
        py: 0.45,
        borderRadius: 999,
        bgcolor: palette.bg,
        color: palette.color,
        fontSize: '0.72rem',
        fontWeight: 800,
        letterSpacing: '0.02em',
      }}
    >
      {children}
    </Box>
  );
}

function SectionLabel({ children }) {
  return (
    <Typography
      variant="overline"
      sx={{
        display: 'block',
        mb: 1,
        color: SHEET_COLORS.textSecondary,
        fontWeight: 800,
        letterSpacing: '0.08em',
      }}
    >
      {children}
    </Typography>
  );
}

function SectionCard({ children, sx }) {
  return (
    <Box
      sx={[
        {
          px: 1.35,
          py: 1.25,
          borderRadius: 2,
          border: `1px solid ${SHEET_COLORS.border}`,
          bgcolor: 'var(--chat-sheet-bg-card)',
          boxShadow: 'var(--chat-sheet-shadow-soft)',
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      {children}
    </Box>
  );
}

function SheetSkeleton({ width = '100%', height = 14, radius = 999, sx }) {
  return (
    <Skeleton
      variant="rounded"
      animation="wave"
      width={width}
      height={height}
      sx={{
        borderRadius: radius,
        bgcolor: 'var(--chat-sheet-skeleton-base)',
        '&::after': {
          background: 'linear-gradient(90deg, transparent, var(--chat-sheet-skeleton-wave), transparent)',
        },
        ...sx,
      }}
    />
  );
}

function SheetListSkeleton({ rows = 4, dense = false }) {
  return (
    <Stack spacing={dense ? 0.85 : 1.1} sx={{ px: dense ? 1 : 2, py: dense ? 1.2 : 2 }}>
      {Array.from({ length: rows }).map((_, index) => (
        <Stack key={index} direction="row" spacing={1.25} alignItems="center">
          <SheetSkeleton width={dense ? 34 : 42} height={dense ? 34 : 42} radius={dense ? 10 : 14} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <SheetSkeleton width={index % 2 ? '52%' : '68%'} height={14} radius={7} />
            <SheetSkeleton width={index % 2 ? '72%' : '48%'} height={11} radius={7} sx={{ mt: 0.8 }} />
          </Box>
        </Stack>
      ))}
    </Stack>
  );
}

function SheetGridSkeleton() {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1px', bgcolor: 'var(--chat-sheet-panel-grid)' }}>
      {Array.from({ length: 9 }).map((_, index) => (
        <SheetSkeleton
          key={index}
          width="100%"
          height="auto"
          radius={0}
          sx={{ aspectRatio: '1 / 1', bgcolor: index % 2 ? 'var(--chat-sheet-panel-card)' : 'var(--chat-sheet-skeleton-base)' }}
        />
      ))}
    </Box>
  );
}

function ActionTile({ icon, label, onClick }) {
  return (
    <ButtonBase
      onClick={() => void onClick?.()}
      sx={{
        minWidth: 0,
        p: 1.35,
        borderRadius: 1.75,
        bgcolor: 'var(--chat-sheet-bg-card)',
        border: `1px solid ${SHEET_COLORS.border}`,
        color: SHEET_COLORS.text,
        transition: 'background-color 140ms ease, transform 120ms ease, border-color 140ms ease, box-shadow 140ms ease, opacity 100ms ease',
        '&:hover': {
          bgcolor: SHEET_COLORS.bgHover,
          borderColor: SHEET_COLORS.accentBorder,
          transform: 'translateY(-1px)',
          boxShadow: 'var(--chat-sheet-shadow-soft)',
        },
        '&:active': {
          opacity: 0.82,
          transform: 'scale(0.985)',
        },
        '&:focus-visible': {
          outline: '2px solid var(--chat-sheet-accent)',
          outlineOffset: 2,
        },
      }}
    >
      <Stack spacing={0.65} alignItems="center">
        <Box
          sx={{
            width: 38,
            height: 38,
            borderRadius: 1.5,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: SHEET_COLORS.accentSoft,
            color: SHEET_COLORS.accent,
          }}
        >
          {icon}
        </Box>
        <Typography variant="caption" sx={{ fontWeight: 700, color: SHEET_COLORS.text }}>
          {label}
        </Typography>
      </Stack>
    </ButtonBase>
  );
}

function InfoRow({ label, value }) {
  return (
    <Stack spacing={0.3}>
      <Typography variant="body2" sx={{ color: SHEET_COLORS.text, fontWeight: 800, letterSpacing: '-0.01em' }}>
        {value || '—'}
      </Typography>
      <Typography variant="caption" sx={{ color: SHEET_COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </Typography>
    </Stack>
  );
}

function InfoRowTelegram({ icon, label, value }) {
  return (
    <Stack
      direction="row"
      spacing={2}
      alignItems="flex-start"
      sx={{
        px: 3,
        py: 2,
        borderBottom: 'var(--chat-sheet-panel-divider-width) solid var(--chat-sheet-panel-divider)',
      }}
    >
      <Box sx={{ mt: 0.5 }}>{icon}</Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ color: 'var(--chat-sheet-panel-text)', fontSize: '1rem', wordBreak: 'break-word' }}>
          {value}
        </Typography>
        <Typography sx={{ color: 'var(--chat-sheet-panel-soft)', fontSize: '0.85rem', mt: 0.25 }}>
          {label}
        </Typography>
      </Box>
    </Stack>
  );
}

function MobileProfileActionButton({ children, onClick, disabled = false, ariaLabel }) {
  return (
    <IconButton
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled}
      sx={{
        width: 42,
        height: 42,
        borderRadius: 999,
        color: 'var(--chat-sheet-panel-text)',
        bgcolor: 'transparent',
        '&:hover': {
          bgcolor: 'var(--chat-sheet-panel-accent-soft)',
        },
        '&:active': {
          opacity: 0.72,
        },
        '&.Mui-disabled': {
          color: 'var(--chat-sheet-panel-soft)',
        },
      }}
    >
      {children}
    </IconButton>
  );
}

function MobileProfileInfoRow({ icon, label, value, trailing = null }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 2.1,
        px: 2.8,
        py: 1.65,
        borderBottom: 'var(--chat-sheet-panel-divider-width) solid var(--chat-sheet-panel-divider)',
      }}
    >
      <Box
        sx={{
          width: 32,
          minWidth: 32,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--chat-sheet-panel-icon)',
        }}
      >
        {icon}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          sx={{
            color: 'var(--chat-sheet-panel-text)',
            fontSize: '1.03rem',
            lineHeight: 1.22,
            wordBreak: 'break-word',
          }}
        >
          {value}
        </Typography>
        <Typography
          sx={{
            mt: 0.2,
            color: 'var(--chat-sheet-panel-soft)',
            fontSize: '0.92rem',
            lineHeight: 1.15,
          }}
        >
          {label}
        </Typography>
      </Box>
      {trailing ? (
        <Box sx={{ ml: 1, flexShrink: 0 }}>
          {trailing}
        </Box>
      ) : null}
    </Box>
  );
}

function MobileProfileTabButton({ label, active, onClick, count = 0 }) {
  return (
    <ButtonBase
      onClick={onClick}
      sx={{
        minWidth: 0,
        px: 1.6,
        py: 1.2,
        color: active ? 'var(--chat-sheet-panel-accent)' : 'var(--chat-sheet-panel-muted)',
        justifyContent: 'center',
        position: 'relative',
        borderRadius: 0,
        fontSize: '0.98rem',
        fontWeight: active ? 800 : 600,
        whiteSpace: 'nowrap',
        '&:active': {
          opacity: 0.72,
        },
      }}
    >
      <Box component="span">
        {label}
        {count > 0 ? <Box component="span" sx={{ opacity: 0.55, ml: 0.45 }}>({count})</Box> : null}
      </Box>
      {active ? (
        <Box
          sx={{
            position: 'absolute',
            left: 10,
            right: 10,
            bottom: 0,
            height: 2.5,
            borderRadius: 999,
            bgcolor: 'var(--chat-sheet-panel-accent)',
          }}
        />
      ) : null}
    </ButtonBase>
  );
}

function MediaRow({ kind, count, active, onClick }) {
  const meta = ASSET_KIND_META[kind];

  return (
    <ButtonBase
      onClick={() => void onClick?.(kind)}
      sx={{
        width: '100%',
        px: 1.25,
        py: 1.1,
        borderRadius: 1.5,
        justifyContent: 'space-between',
        bgcolor: active ? SHEET_COLORS.accentSoft : 'transparent',
        color: SHEET_COLORS.text,
        border: `1px solid ${active ? SHEET_COLORS.accentBorder : 'transparent'}`,
        transition: 'background-color 140ms ease, border-color 140ms ease',
        '&:hover': {
          bgcolor: active ? SHEET_COLORS.accentSoft : SHEET_COLORS.bgHover,
        },
      }}
    >
      <Stack direction="row" spacing={1.1} alignItems="center">
        <Box
          sx={{
            width: 36,
            height: 36,
            borderRadius: 2,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: active ? SHEET_COLORS.accentSoft : SHEET_COLORS.neutralSoft,
            color: active ? SHEET_COLORS.accent : SHEET_COLORS.text,
          }}
        >
          {meta.icon}
        </Box>
        <Box sx={{ textAlign: 'left' }}>
          <Typography variant="body2" sx={{ fontWeight: 800 }}>
            {meta.label}
          </Typography>
          <Typography variant="caption" sx={{ color: SHEET_COLORS.textSecondary }}>
            {count}
          </Typography>
        </Box>
      </Stack>
      <KeyboardArrowRightRoundedIcon sx={{ color: active ? SHEET_COLORS.accent : SHEET_COLORS.textSecondary }} />
    </ButtonBase>
  );
}

function AttachmentListRow({ item, kind, onOpenAttachmentPreview }) {
  const fileUrl = buildAttachmentUrl(item.message_id, item.id, { inline: true });

  const handleOpen = () => {
    if (kind === 'image') {
      onOpenAttachmentPreview?.(item.message_id, item);
      return;
    }
    window.open(fileUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <ButtonBase
      onClick={handleOpen}
      sx={{
        width: '100%',
        px: 1.1,
        py: 1,
        borderRadius: 1.5,
        justifyContent: 'space-between',
        border: `1px solid ${SHEET_COLORS.border}`,
        bgcolor: SHEET_COLORS.neutralSoft,
        color: SHEET_COLORS.text,
        '&:hover': {
          bgcolor: SHEET_COLORS.bgHover,
        },
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
        <Box
          sx={{
            width: 34,
            height: 34,
            borderRadius: 2,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: SHEET_COLORS.neutralSoft,
            color: SHEET_COLORS.text,
            flexShrink: 0,
          }}
        >
          {ASSET_KIND_META[kind]?.icon || <InsertDriveFileOutlinedIcon fontSize="small" />}
        </Box>
        <Box sx={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
          <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>
            {item.file_name}
          </Typography>
          <Typography variant="caption" sx={{ color: SHEET_COLORS.textSecondary }} noWrap>
            {formatFileSize(item.file_size)} · {formatFullDate(item.created_at)}
          </Typography>
        </Box>
      </Stack>
      <OpenInNewRoundedIcon sx={{ fontSize: 18, color: SHEET_COLORS.textSecondary }} />
    </ButtonBase>
  );
}

function LinkRow({ item }) {
  let hostname = '';
  try {
    hostname = new URL(item.url).hostname.replace(/^www\./i, '');
  } catch {
    hostname = '';
  }

  return (
    <ButtonBase
      component="a"
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      sx={{
        width: '100%',
        px: 1.1,
        py: 1,
        borderRadius: 1.5,
        justifyContent: 'space-between',
        border: `1px solid ${SHEET_COLORS.border}`,
        bgcolor: SHEET_COLORS.neutralSoft,
        color: SHEET_COLORS.text,
        '&:hover': {
          bgcolor: SHEET_COLORS.bgHover,
        },
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
        <Box
          sx={{
            width: 34,
            height: 34,
            borderRadius: 2,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: SHEET_COLORS.neutralSoft,
            color: SHEET_COLORS.accent,
            flexShrink: 0,
          }}
        >
          <OpenInNewRoundedIcon fontSize="small" />
        </Box>
        <Box sx={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
          <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>
            {item.title}
          </Typography>
          <Typography variant="caption" sx={{ color: SHEET_COLORS.textSecondary }} noWrap>
            {hostname || item.url} · {formatFullDate(item.created_at)}
          </Typography>
        </Box>
      </Stack>
      <OpenInNewRoundedIcon sx={{ fontSize: 18, color: SHEET_COLORS.textSecondary }} />
    </ButtonBase>
  );
}

function ImageTile({ item, onOpenAttachmentPreview }) {
  const fileUrl = buildAttachmentUrl(item.message_id, item.id, { inline: true });

  return (
    <ButtonBase
      onClick={() => onOpenAttachmentPreview?.(item.message_id, item)}
      aria-label={`Открыть ${item.file_name}`}
      sx={{
        display: 'block',
        width: '100%',
        borderRadius: 1.5,
        overflow: 'hidden',
        border: `1px solid ${SHEET_COLORS.border}`,
        bgcolor: SHEET_COLORS.neutralSoft,
        textAlign: 'left',
        '&:hover .chat-context-image-overlay': {
          opacity: 1,
        },
      }}
    >
      <Box
        component="img"
        src={fileUrl}
        alt={item.file_name}
        sx={{
          display: 'block',
          width: '100%',
          aspectRatio: '1 / 1',
          objectFit: 'cover',
          bgcolor: alpha('#000000', 0.08),
        }}
      />
      <Box
        className="chat-context-image-overlay"
        sx={{
          px: 0.8,
          py: 0.65,
          bgcolor: 'rgba(11,18,32,0.82)',
          color: '#fff',
          opacity: 0.92,
          transition: 'opacity 140ms ease',
        }}
      >
        <Typography variant="caption" sx={{ display: 'block', fontWeight: 700 }} noWrap>
          {item.file_name}
        </Typography>
      </Box>
    </ButtonBase>
  );
}

function TaskRow({ item, onOpenTask }) {
  const statusMeta = getStatusMeta(item.task.status);
  const priorityMeta = getPriorityMeta(item.task.priority);

  return (
    <ButtonBase
      onClick={() => void onOpenTask?.(item.task.id)}
      sx={{
        width: '100%',
        px: 1.1,
        py: 1.05,
        borderRadius: 1.5,
        border: `1px solid ${SHEET_COLORS.border}`,
        bgcolor: SHEET_COLORS.neutralSoft,
        color: SHEET_COLORS.text,
        justifyContent: 'space-between',
        '&:hover': {
          bgcolor: SHEET_COLORS.bgHover,
        },
      }}
    >
      <Box sx={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
        <Typography variant="body2" sx={{ fontWeight: 800 }} noWrap>
          {item.task.title}
        </Typography>
        <Typography variant="caption" sx={{ display: 'block', color: SHEET_COLORS.textSecondary }} noWrap>
          {getTaskAssignee(item.task)} · {item.task.due_at ? formatFullDate(item.task.due_at) : 'Без срока'}
        </Typography>
        <Stack direction="row" spacing={0.75} sx={{ mt: 0.8 }}>
          <CompactBadge tone="accent">{statusMeta[0]}</CompactBadge>
          <CompactBadge tone="warning">{priorityMeta[0]}</CompactBadge>
        </Stack>
      </Box>
      <KeyboardArrowRightRoundedIcon sx={{ color: SHEET_COLORS.textSecondary }} />
    </ButtonBase>
  );
}

function ParticipantRow({ person }) {
  return (
    <Stack
      direction="row"
      spacing={1}
      alignItems="center"
      sx={{
        py: 0.85,
        px: 1,
        borderRadius: 1.4,
        transition: 'background-color 140ms ease',
        '&:hover': {
          bgcolor: SHEET_COLORS.bgHover,
        },
      }}
    >
      <PresenceAvatar item={person} online={Boolean(person?.presence?.is_online)} size={38} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="body2" sx={{ color: SHEET_COLORS.text, fontWeight: 700 }} noWrap>
          {person?.full_name || person?.username || 'Пользователь'}
        </Typography>
        <Typography variant="caption" sx={{ color: SHEET_COLORS.textSecondary }} noWrap>
          {formatPresenceText(person?.presence)}
        </Typography>
      </Box>
    </Stack>
  );
}

function SettingRow({ icon, label, value, active, onClick, disabled }) {
  return (
    <ButtonBase
      onClick={() => void onClick?.()}
      disabled={disabled}
      sx={{
        width: '100%',
        px: 1.2,
        py: 1.1,
        borderRadius: 1.5,
        justifyContent: 'space-between',
        color: SHEET_COLORS.text,
        border: `1px solid ${active ? SHEET_COLORS.accentBorder : SHEET_COLORS.border}`,
        bgcolor: active ? SHEET_COLORS.accentSoft : SHEET_COLORS.neutralSoft,
        opacity: disabled ? 0.56 : 1,
        '&:hover': {
          bgcolor: active ? SHEET_COLORS.accentSoft : SHEET_COLORS.bgHover,
        },
        '&:active': {
          opacity: 0.82,
        },
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
        <Box
          sx={{
            width: 34,
            height: 34,
            borderRadius: 2,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: active ? SHEET_COLORS.accentSoft : SHEET_COLORS.neutralSoft,
            color: active ? SHEET_COLORS.accent : SHEET_COLORS.text,
            flexShrink: 0,
          }}
        >
          {icon}
        </Box>
        <Box sx={{ minWidth: 0, textAlign: 'left' }}>
          <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>
            {label}
          </Typography>
          <Typography variant="caption" sx={{ color: SHEET_COLORS.textSecondary }} noWrap>
            {value}
          </Typography>
        </Box>
      </Stack>
      <KeyboardArrowRightRoundedIcon sx={{ color: SHEET_COLORS.textSecondary }} />
    </ButtonBase>
  );
}

function CollapsedRail({ activeConversation, summary, summaryLoading, onToggleOpen, ui, theme }) {
  const subject = activeConversation?.kind === 'direct'
    ? (activeConversation?.direct_peer || activeConversation)
    : activeConversation;

  return (
    <Box
      sx={{
        ...buildSheetVars(ui, theme),
        width: COLLAPSED_WIDTH,
        minWidth: COLLAPSED_WIDTH,
        borderLeft: `1px solid ${SHEET_COLORS.border}`,
        bgcolor: SHEET_COLORS.bg,
        color: SHEET_COLORS.text,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 1.2,
        py: 1.2,
      }}
    >
      <Tooltip title="Открыть контекст чата">
        <IconButton
          onClick={onToggleOpen}
          aria-label="Открыть контекст чата"
          sx={{
            color: SHEET_COLORS.text,
            bgcolor: SHEET_COLORS.neutralSoft,
            border: `1px solid ${SHEET_COLORS.border}`,
          }}
        >
          <ChevronLeftRoundedIcon />
        </IconButton>
      </Tooltip>

      {subject ? (
        <PresenceAvatar
          item={subject}
          online={Boolean(activeConversation?.kind === 'direct' && activeConversation?.direct_peer?.presence?.is_online)}
          size={44}
        />
      ) : null}

      {summaryLoading ? (
        <Stack spacing={0.9} sx={{ width: '100%', px: 1 }}>
          {[0, 1, 2, 3].map((index) => (
            <SheetSkeleton key={index} width="100%" height={48} radius={16} />
          ))}
        </Stack>
      ) : (
        <Stack spacing={0.9} sx={{ width: '100%', px: 1 }}>
          {[
            { key: 'image', count: Number(summary?.photos_count || 0), icon: <PhotoLibraryOutlinedIcon fontSize="small" /> },
            { key: 'video', count: Number(summary?.videos_count || 0), icon: <VideoLibraryOutlinedIcon fontSize="small" /> },
            { key: 'file', count: Number(summary?.files_count || 0), icon: <InsertDriveFileOutlinedIcon fontSize="small" /> },
            { key: 'task', count: Number(summary?.shared_tasks_count || 0), icon: <TaskAltOutlinedIcon fontSize="small" /> },
          ].map((item) => (
            <Box
              key={item.key}
              sx={{
                py: 0.8,
                borderRadius: 2,
                bgcolor: SHEET_COLORS.neutralSoft,
                textAlign: 'center',
                border: `1px solid ${SHEET_COLORS.border}`,
              }}
            >
              <Box sx={{ color: SHEET_COLORS.textSecondary }}>{item.icon}</Box>
              <Typography variant="caption" sx={{ display: 'block', mt: 0.2, color: SHEET_COLORS.text, fontWeight: 800 }}>
                {item.count}
              </Typography>
            </Box>
          ))}
        </Stack>
      )}
    </Box>
  );
}

export default function ChatContextPanel({
  theme,
  ui,
  activeConversation,
  conversationHeaderSubtitle,
  socketStatus,
  currentUser,
  messages = [],
  open,
  embedded = false,
  mobileScreen = false,
  onClose,
  onToggleOpen,
  onOpenSearch,
  onUpdateConversationSettings,
  onAddGroupMembers,
  onRemoveGroupMember,
  onUpdateGroupMemberRole,
  onTransferGroupOwnership,
  onLeaveGroup,
  onUpdateGroupProfile,
  settingsUpdating,
  onOpenAttachmentPreview,
  onOpenTask,
}) {
  const summaryRequestSeqRef = useRef(0);
  const attachmentRequestSeqRef = useRef(0);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const [assetKind, setAssetKind] = useState('image');
  const [attachments, setAttachments] = useState([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [attachmentsLoadingMore, setAttachmentsLoadingMore] = useState(false);
  const [attachmentsError, setAttachmentsError] = useState('');
  const [attachmentsHasMore, setAttachmentsHasMore] = useState(false);
  const [attachmentsCursor, setAttachmentsCursor] = useState('');
  const [taskVisibleCount, setTaskVisibleCount] = useState(TASK_PAGE_SIZE);
  const [participantsExpanded, setParticipantsExpanded] = useState(false);
  const [infoMenuAnchorEl, setInfoMenuAnchorEl] = useState(null);
  const [memberActionAnchorEl, setMemberActionAnchorEl] = useState(null);
  const [memberActionTarget, setMemberActionTarget] = useState(null);
  const [groupActionBusy, setGroupActionBusy] = useState(false);
  const mobileTabTouchStartRef = useRef(null);
  const conversationId = String(activeConversation?.id || '').trim();
  const isDirect = activeConversation?.kind === 'direct';
  const isGroup = activeConversation?.kind === 'group';
  const subject = isDirect ? (activeConversation?.direct_peer || activeConversation) : activeConversation;
  const panelVisible = Boolean(open);

  const participantMembers = useMemo(() => {
    if (!activeConversation) return [];
    if (isDirect) {
      return subject ? [{ user: subject, member_role: 'member' }] : [];
    }
    const source = Array.isArray(activeConversation.members)
      ? activeConversation.members
      : (Array.isArray(activeConversation.member_preview) ? activeConversation.member_preview : []);
    const normalized = source
      .map((member) => {
        const user = member?.user || member;
        if (!user?.id) return null;
        return {
          ...member,
          user,
          member_role: normalizeGroupRole(member?.member_role || member?.role),
        };
      })
      .filter(Boolean);
    const sortedUsers = sortByName(normalized.map((member) => member.user));
    const orderByUserId = new Map(sortedUsers.map((user, index) => [String(user?.id || ''), index]));
    return [...normalized].sort((left, right) => {
      const leftIndex = orderByUserId.get(String(left?.user?.id || '')) ?? 0;
      const rightIndex = orderByUserId.get(String(right?.user?.id || '')) ?? 0;
      return leftIndex - rightIndex;
    });
  }, [activeConversation, isDirect, subject]);

  const participants = useMemo(
    () => participantMembers.map((member) => member.user).filter(Boolean),
    [participantMembers],
  );
  const currentUserId = Number(currentUser?.id || 0);
  const currentMember = useMemo(
    () => participantMembers.find((member) => Number(member?.user?.id || 0) === currentUserId) || null,
    [currentUserId, participantMembers],
  );
  const currentMemberRole = normalizeGroupRole(currentMember?.member_role);
  const canManageMembers = isGroup && (currentMemberRole === 'owner' || currentMemberRole === 'moderator');
  const canManageOwners = isGroup && currentMemberRole === 'owner';

  const onlineCount = useMemo(
    () => (
      isDirect
        ? participants.filter((person) => Boolean(person?.presence?.is_online)).length
        : Number.isFinite(Number(activeConversation?.online_member_count))
          ? Number(activeConversation?.online_member_count || 0)
          : participants.filter((person) => Boolean(person?.presence?.is_online)).length
    ),
    [activeConversation?.online_member_count, isDirect, participants],
  );
  const participantsExpandable = !isDirect && participants.length > PARTICIPANTS_COLLAPSED_COUNT;
  const visibleParticipantMembers = useMemo(
    () => (
      participantsExpanded || !participantsExpandable
        ? participantMembers
        : participantMembers.slice(0, PARTICIPANTS_COLLAPSED_COUNT)
    ),
    [participantMembers, participantsExpandable, participantsExpanded],
  );

  const taskItems = useMemo(() => (
    [...(Array.isArray(messages) ? messages : [])]
      .filter((message) => message?.kind === 'task_share' && message?.task_preview?.id)
      .sort((left, right) => new Date(right?.created_at || 0).getTime() - new Date(left?.created_at || 0).getTime())
      .map((message) => ({
        messageId: message.id,
        createdAt: message.created_at,
        task: message.task_preview,
      }))
  ), [messages]);

  const visibleTaskItems = useMemo(
    () => taskItems.slice(0, taskVisibleCount),
    [taskItems, taskVisibleCount],
  );

  const linkItems = useMemo(() => {
    const seen = new Set();
    return [...(Array.isArray(messages) ? messages : [])]
      .sort((left, right) => new Date(right?.created_at || 0).getTime() - new Date(left?.created_at || 0).getTime())
      .flatMap((message) => extractLinksFromText(message?.body).map((url, index) => ({
        id: `${message.id || 'message'}-${index}-${url}`,
        url,
        title: url.replace(/^https?:\/\//i, ''),
        created_at: message.created_at,
      })))
      .filter((item) => {
        if (!item.url || seen.has(item.url)) return false;
        seen.add(item.url);
        return true;
      });
  }, [messages]);

  const assetCounts = useMemo(() => ({
    image: Number(summary?.photos_count || 0),
    video: Number(summary?.videos_count || 0),
    file: Number(summary?.files_count || 0),
    audio: Number(summary?.audio_count || 0),
    task: Number(summary?.shared_tasks_count || 0),
    link: linkItems.length,
    member: Number(activeConversation?.member_count || participants.length || 0),
  }), [activeConversation?.member_count, linkItems.length, participants.length, summary]);

  const mobileTabOptions = useMemo(() => (
    isDirect
      ? [
          { key: 'image', label: 'Фото', count: assetCounts.image },
          { key: 'file', label: 'Файлы', count: assetCounts.file },
          { key: 'video', label: 'Видео', count: assetCounts.video },
          { key: 'link', label: 'Ссылки', count: assetCounts.link },
          { key: 'task', label: 'Задачи', count: assetCounts.task },
        ]
      : [
          { key: 'image', label: 'Фото', count: assetCounts.image },
          { key: 'file', label: 'Файлы', count: assetCounts.file },
          { key: 'video', label: 'Видео', count: assetCounts.video },
          { key: 'member', label: 'Участники', count: assetCounts.member },
          { key: 'task', label: 'Задачи', count: assetCounts.task },
        ]
  ), [assetCounts.file, assetCounts.image, assetCounts.link, assetCounts.member, assetCounts.task, assetCounts.video, isDirect]);

  const attachmentItems = useMemo(() => {
    const items = Array.isArray(attachments) ? attachments : [];
    if (assetKind === 'video') {
      return items.filter((item) => isVideoAttachment(item));
    }
    if (assetKind === 'image') {
      return items.filter((item) => isImageAttachment(item) && !isVideoAttachment(item));
    }
    return items;
  }, [assetKind, attachments]);

  const mobileTabKeys = useMemo(
    () => mobileTabOptions.map((tab) => tab.key),
    [mobileTabOptions],
  );

  const stepMobileTab = useCallback((direction) => {
    if (!mobileScreen || mobileTabKeys.length <= 1) return;
    const currentIndex = mobileTabKeys.indexOf(assetKind);
    if (currentIndex < 0) return;
    const nextIndex = direction > 0
      ? Math.min(mobileTabKeys.length - 1, currentIndex + 1)
      : Math.max(0, currentIndex - 1);
    if (nextIndex === currentIndex) return;
    setAssetKind(mobileTabKeys[nextIndex]);
  }, [assetKind, mobileScreen, mobileTabKeys]);

  const handleMobileTabTouchStart = useCallback((event) => {
    const touch = event.changedTouches?.[0];
    if (!touch) return;
    mobileTabTouchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
    };
  }, []);

  const handleMobileTabTouchEnd = useCallback((event) => {
    const touch = event.changedTouches?.[0];
    const start = mobileTabTouchStartRef.current;
    mobileTabTouchStartRef.current = null;
    if (!touch || !start) return;
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (Math.abs(deltaX) < 56) return;
    if (Math.abs(deltaX) <= Math.abs(deltaY) * 1.15) return;
    if (deltaX < 0) {
      stepMobileTab(1);
      return;
    }
    stepMobileTab(-1);
  }, [stepMobileTab]);

  useEffect(() => {
    if (!conversationId) {
      setSummary(EMPTY_SUMMARY);
      setSummaryError('');
      return;
    }

    const requestSeq = summaryRequestSeqRef.current + 1;
    summaryRequestSeqRef.current = requestSeq;
    setSummaryLoading(true);
    setSummaryError('');

    chatAPI.getConversationAssetsSummary(conversationId)
      .then((payload) => {
        if (requestSeq !== summaryRequestSeqRef.current) return;
        setSummary({ ...EMPTY_SUMMARY, ...(payload || {}) });
      })
      .catch((error) => {
        if (requestSeq !== summaryRequestSeqRef.current) return;
        setSummary(EMPTY_SUMMARY);
        setSummaryError(error?.message || 'Не удалось загрузить данные чата.');
      })
      .finally(() => {
        if (requestSeq === summaryRequestSeqRef.current) {
          setSummaryLoading(false);
        }
      });
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) {
      setAssetKind('image');
      return;
    }

    if (!mobileScreen) {
      if (isDirect && assetKind === 'member') setAssetKind('image');
      return;
    }
    if (mobileTabKeys.includes(assetKind)) return;
    setAssetKind(mobileTabKeys[0] || 'image');
  }, [assetKind, conversationId, isDirect, mobileScreen, mobileTabKeys]);

  useEffect(() => {
    setTaskVisibleCount(TASK_PAGE_SIZE);
  }, [conversationId, assetKind]);

  useEffect(() => {
    setParticipantsExpanded(false);
  }, [conversationId]);

  const closeMemberActionMenu = useCallback(() => {
    setMemberActionAnchorEl(null);
    setMemberActionTarget(null);
  }, []);

  const runGroupAction = useCallback(async (action) => {
    if (typeof action !== 'function') return;
    setGroupActionBusy(true);
    try {
      await action();
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.message || 'Не удалось выполнить действие.';
      if (typeof window !== 'undefined') window.alert(detail);
    } finally {
      setGroupActionBusy(false);
      closeMemberActionMenu();
    }
  }, [closeMemberActionMenu]);

  const handlePromptAddMembers = useCallback(() => {
    if (!canManageMembers || typeof window === 'undefined') return;
    const raw = window.prompt('Введите ID пользователей через запятую');
    const memberUserIds = String(raw || '')
      .split(',')
      .map((item) => Number(String(item || '').trim()))
      .filter((item) => Number.isFinite(item) && item > 0);
    if (!memberUserIds.length) return;
    void runGroupAction(() => onAddGroupMembers?.(memberUserIds));
  }, [canManageMembers, onAddGroupMembers, runGroupAction]);

  const handleRenameGroup = useCallback(() => {
    if (!canManageOwners || typeof window === 'undefined') return;
    setInfoMenuAnchorEl(null);
    const nextTitle = window.prompt('Новое название группы', String(activeConversation?.title || '').trim());
    const normalizedTitle = String(nextTitle || '').trim();
    if (!normalizedTitle) return;
    void runGroupAction(() => onUpdateGroupProfile?.({ title: normalizedTitle }));
  }, [activeConversation?.title, canManageOwners, onUpdateGroupProfile, runGroupAction]);

  const handleLeaveGroup = useCallback(() => {
    if (!isGroup || currentMemberRole === 'owner' || typeof window === 'undefined') return;
    setInfoMenuAnchorEl(null);
    if (!window.confirm('Выйти из группы?')) return;
    void runGroupAction(() => onLeaveGroup?.());
  }, [currentMemberRole, isGroup, onLeaveGroup, runGroupAction]);

  const handleOpenMemberActions = useCallback((event, member) => {
    event?.stopPropagation?.();
    setMemberActionAnchorEl(event?.currentTarget || null);
    setMemberActionTarget(member || null);
  }, []);

  const loadAttachments = useCallback(async ({ append = false, beforeAttachmentId } = {}) => {
    if (!conversationId || assetKind === 'task' || assetKind === 'link' || assetKind === 'member') return;
    const requestKind = assetKind;

    const requestSeq = attachmentRequestSeqRef.current + 1;
    attachmentRequestSeqRef.current = requestSeq;

    if (append) {
      setAttachmentsLoadingMore(true);
    } else {
      setAttachmentsLoading(true);
      setAttachmentsError('');
    }

    try {
      const payload = await chatAPI.getConversationAttachments(conversationId, {
        kind: requestKind,
        limit: ATTACHMENT_PAGE_SIZE,
        before_attachment_id: beforeAttachmentId,
      });
      if (requestSeq !== attachmentRequestSeqRef.current) return;
      const items = Array.isArray(payload?.items) ? payload.items : [];
      setAttachments((current) => (append ? [...current, ...items] : items));
      setAttachmentsHasMore(Boolean(payload?.has_more));
      setAttachmentsCursor(String(payload?.next_before_attachment_id || '').trim());
    } catch (error) {
      if (requestSeq !== attachmentRequestSeqRef.current) return;
      if (!append) {
        setAttachments([]);
      }
      setAttachmentsHasMore(false);
      setAttachmentsCursor('');
      setAttachmentsError(error?.message || 'Не удалось загрузить вложения.');
    } finally {
      if (requestSeq === attachmentRequestSeqRef.current) {
        setAttachmentsLoading(false);
        setAttachmentsLoadingMore(false);
      }
    }
  }, [assetKind, conversationId]);

  useEffect(() => {
    if (!conversationId) {
      setAttachments([]);
      setAttachmentsError('');
      setAttachmentsHasMore(false);
      setAttachmentsCursor('');
      setAttachmentsLoading(false);
      setAttachmentsLoadingMore(false);
      return;
    }

    if (assetKind === 'task' || assetKind === 'link' || assetKind === 'member') {
      setAttachments([]);
      setAttachmentsError('');
      setAttachmentsHasMore(false);
      setAttachmentsCursor('');
      setAttachmentsLoading(false);
      setAttachmentsLoadingMore(false);
      return;
    }

    if (!panelVisible) return;
    void loadAttachments();
  }, [assetKind, conversationId, loadAttachments, panelVisible, activeConversation?.last_message_at]);

  if (!activeConversation) {
    return embedded ? null : (
      <Box
        sx={{
          ...buildSheetVars(ui, theme),
          width: PANEL_WIDTH,
          minWidth: PANEL_WIDTH,
          borderLeft: `1px solid ${SHEET_COLORS.border}`,
          bgcolor: SHEET_COLORS.bg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Typography sx={{ color: SHEET_COLORS.textSecondary }}>
          Выберите чат
        </Typography>
      </Box>
    );
  }

  if (!panelVisible && !embedded) {
    return (
      <CollapsedRail
        activeConversation={activeConversation}
        summary={summary}
        summaryLoading={summaryLoading}
        onToggleOpen={onToggleOpen}
        ui={ui}
        theme={theme}
      />
    );
  }

  if (!panelVisible && embedded) {
    return null;
  }

  const showPinnedBadge = Boolean(activeConversation?.is_pinned);
  const showMutedBadge = Boolean(activeConversation?.is_muted);
  const showArchivedBadge = Boolean(activeConversation?.is_archived);
  const taskBrowserHasMore = taskItems.length > taskVisibleCount;
  const infoMenuOpen = Boolean(infoMenuAnchorEl);
  const memberActionMenuOpen = Boolean(memberActionAnchorEl && memberActionTarget?.user?.id);
  const memberActionUser = memberActionTarget?.user || null;
  const memberActionRole = normalizeGroupRole(memberActionTarget?.member_role);
  const memberActionUserId = Number(memberActionUser?.id || 0);
  const canPromoteSelectedMember = canManageOwners && memberActionRole === 'member';
  const canDemoteSelectedMember = canManageOwners && memberActionRole === 'moderator';
  const canTransferSelectedOwnership = canManageOwners && memberActionUserId > 0 && memberActionUserId !== currentUserId;
  const canRemoveSelectedMember = canManageMembers
    && memberActionUserId > 0
    && memberActionUserId !== currentUserId
    && memberActionRole !== 'owner'
    && (currentMemberRole === 'owner' || memberActionRole === 'member');
  const subjectPhone = String(subject?.phone || '').trim();
  const subjectUsername = String(subject?.username || '').trim();
  const subjectBirthday = String(subject?.birth_date || subject?.birthday || '').trim();

  const memberActionsMenu = (
    <Menu
      anchorEl={memberActionAnchorEl}
      open={memberActionMenuOpen}
      onClose={closeMemberActionMenu}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      PaperProps={{
        sx: {
          mt: 0.5,
          minWidth: 230,
          borderRadius: 2.5,
          bgcolor: 'var(--chat-sheet-panel-menu-bg)',
          color: 'var(--chat-sheet-panel-text)',
          border: '1px solid var(--chat-sheet-panel-divider)',
          boxShadow: 'var(--chat-sheet-panel-menu-shadow)',
          '& .MuiMenuItem-root': {
            color: 'var(--chat-sheet-panel-text)',
          },
        },
      }}
    >
      {canPromoteSelectedMember ? (
        <MenuItem
          disabled={groupActionBusy}
          onClick={() => { void runGroupAction(() => onUpdateGroupMemberRole?.(memberActionUserId, 'moderator')); }}
        >
          Назначить модератором
        </MenuItem>
      ) : null}
      {canDemoteSelectedMember ? (
        <MenuItem
          disabled={groupActionBusy}
          onClick={() => { void runGroupAction(() => onUpdateGroupMemberRole?.(memberActionUserId, 'member')); }}
        >
          Снять модератора
        </MenuItem>
      ) : null}
      {canTransferSelectedOwnership ? (
        <MenuItem
          disabled={groupActionBusy}
          onClick={() => {
            if (typeof window !== 'undefined' && !window.confirm('Передать владельца группы этому участнику?')) return;
            void runGroupAction(() => onTransferGroupOwnership?.(memberActionUserId));
          }}
        >
          Передать ownership
        </MenuItem>
      ) : null}
      {canRemoveSelectedMember ? (
        <MenuItem
          disabled={groupActionBusy}
          onClick={() => {
            if (typeof window !== 'undefined' && !window.confirm('Исключить участника из группы?')) return;
            void runGroupAction(() => onRemoveGroupMember?.(memberActionUserId));
          }}
          sx={{ color: 'var(--chat-sheet-warning, #d64b4b) !important' }}
        >
          Исключить из группы
        </MenuItem>
      ) : null}
      {!canPromoteSelectedMember && !canDemoteSelectedMember && !canTransferSelectedOwnership && !canRemoveSelectedMember ? (
        <MenuItem disabled>Нет доступных действий</MenuItem>
      ) : null}
    </Menu>
  );

  if (mobileScreen) {
    return (
      <Box
        sx={{
          ...buildSheetVars(ui, theme),
          height: '100%',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          bgcolor: 'var(--chat-sheet-panel-bg)',
          color: 'var(--chat-sheet-panel-text)',
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            px: 1.35,
            pt: 'max(env(safe-area-inset-top), 12px)',
            pb: 1,
            flexShrink: 0,
            borderBottom: 'var(--chat-sheet-panel-divider-width) solid var(--chat-sheet-panel-divider)',
          }}
        >
          <MobileProfileActionButton
            ariaLabel="Закрыть информацию"
            onClick={embedded ? onClose : onToggleOpen}
          >
            <CloseRoundedIcon sx={{ fontSize: 30 }} />
          </MobileProfileActionButton>

          <Typography
            sx={{
              flex: 1,
              minWidth: 0,
              px: 1.2,
              fontSize: '1.15rem',
              fontWeight: 800,
              letterSpacing: '-0.02em',
            }}
            noWrap
          >
            Информация
          </Typography>

          <Stack direction="row" spacing={0.25} alignItems="center">
            <MobileProfileActionButton
              ariaLabel="Редактировать"
              onClick={handleRenameGroup}
              disabled={!canManageOwners || groupActionBusy}
            >
              <EditRoundedIcon sx={{ fontSize: 24 }} />
            </MobileProfileActionButton>
            <MobileProfileActionButton
              ariaLabel="Ещё"
              onClick={(event) => setInfoMenuAnchorEl(event.currentTarget)}
            >
              <MoreVertRoundedIcon sx={{ fontSize: 26 }} />
            </MobileProfileActionButton>
          </Stack>
        </Box>

        <Box
          className="chat-scroll-hidden"
          sx={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            bgcolor: 'var(--chat-sheet-panel-bg)',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            '&::-webkit-scrollbar': {
              display: 'none',
            },
          }}
        >
          <Box
            sx={{
              px: 2.5,
              pt: 4.25,
              pb: 3.4,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
            }}
          >
            <PresenceAvatar
              item={subject}
              online={Boolean(isDirect && activeConversation?.direct_peer?.presence?.is_online)}
              size={152}
            />
            <Typography
              sx={{
                mt: 2.75,
                fontSize: '2rem',
                lineHeight: 1.08,
                fontWeight: 800,
                letterSpacing: '-0.03em',
              }}
            >
              {activeConversation?.title || 'Без имени'}
            </Typography>
            <Typography
              sx={{
                mt: 0.7,
                color: 'var(--chat-sheet-panel-muted)',
                fontSize: '1.02rem',
                lineHeight: 1.2,
              }}
            >
              {conversationHeaderSubtitle || 'был(а) недавно'}
            </Typography>
          </Box>

          <Box sx={{ pb: 1.2 }}>
            {isDirect ? (
              <>
                {subjectPhone ? (
                  <MobileProfileInfoRow
                    icon={<PhoneRoundedIcon sx={{ fontSize: 22 }} />}
                    label="Телефон"
                    value={subjectPhone}
                  />
                ) : null}
                {subjectUsername ? (
                  <MobileProfileInfoRow
                    icon={<PersonOutlineRoundedIcon sx={{ fontSize: 22 }} />}
                    label="Имя пользователя"
                    value={subjectUsername}
                  />
                ) : null}
                {subjectBirthday ? (
                  <MobileProfileInfoRow
                    icon={<CakeRoundedIcon sx={{ fontSize: 22 }} />}
                    label="День рождения"
                    value={subjectBirthday}
                  />
                ) : null}
              </>
            ) : (
              <>
                <MobileProfileInfoRow
                  icon={<PersonOutlineRoundedIcon sx={{ fontSize: 22 }} />}
                  label="Участники"
                  value={String(Number(activeConversation?.member_count || participants.length || 0))}
                />
                <MobileProfileInfoRow
                  icon={<NotificationsOutlinedIcon sx={{ fontSize: 22 }} />}
                  label="В сети"
                  value={String(onlineCount)}
                />
              </>
            )}

            <MobileProfileInfoRow
              icon={<NotificationsOutlinedIcon sx={{ fontSize: 22 }} />}
              label="Уведомления"
              value="Уведомления"
              trailing={(
                <Switch
                  checked={!activeConversation?.is_muted}
                  onChange={(event) => onUpdateConversationSettings?.({ is_muted: !event.target.checked })}
                  disabled={settingsUpdating}
                  sx={{
                    mr: -0.5,
                    '& .MuiSwitch-switchBase.Mui-checked': {
                      color: 'var(--chat-sheet-panel-accent)',
                    },
                    '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                      bgcolor: 'var(--chat-sheet-panel-accent)',
                      opacity: 1,
                    },
                    '& .MuiSwitch-track': {
                      bgcolor: 'var(--chat-sheet-panel-soft)',
                      opacity: 1,
                    },
                  }}
                />
              )}
            />
          </Box>

          <Box
            data-testid="chat-context-mobile-tabs"
            sx={{
              mt: 0.4,
              borderTop: 'var(--chat-sheet-panel-divider-width) solid var(--chat-sheet-panel-divider)',
              borderBottom: 'var(--chat-sheet-panel-divider-width) solid var(--chat-sheet-panel-divider)',
              display: 'flex',
              justifyContent: 'flex-start',
              gap: 0.15,
              overflowX: 'auto',
              px: 0.75,
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
              '&::-webkit-scrollbar': {
                display: 'none',
              },
            }}
          >
            {mobileTabOptions.map((tab) => (
              <MobileProfileTabButton
                key={tab.key}
                label={tab.label}
                count={tab.count}
                active={assetKind === tab.key}
                onClick={() => setAssetKind(tab.key)}
              />
            ))}
          </Box>

          <Box
            data-testid="chat-context-mobile-tab-content"
            onTouchStart={handleMobileTabTouchStart}
            onTouchEnd={handleMobileTabTouchEnd}
            sx={{ minHeight: 220, bgcolor: 'var(--chat-sheet-panel-bg)' }}
          >
            {attachmentsLoading && (assetKind === 'image' || assetKind === 'file') ? (
              assetKind === 'image' ? <SheetGridSkeleton /> : <SheetListSkeleton rows={5} />
            ) : null}

            {!attachmentsLoading && assetKind === 'image' ? (
              attachmentItems.length === 0 ? (
                <Typography sx={{ color: 'var(--chat-sheet-panel-soft)', textAlign: 'center', py: 6, fontSize: '0.95rem' }}>
                  Нет фото
                </Typography>
              ) : (
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1px', bgcolor: 'var(--chat-sheet-panel-grid)' }}>
                  {attachmentItems.map((item) => {
                    const fileUrl = normalizeChatAttachmentUrl(item?.variant_urls?.thumb || item?.variant_urls?.preview)
                      || buildAttachmentUrl(item.message_id || item.messageId, item.id, { inline: true });
                    const isVideo = isVideoAttachment(item);
                    return (
                      <Box
                        key={item.id}
                        component="button"
                        type="button"
                        onClick={() => onOpenAttachmentPreview?.(item.message_id || item.messageId, item)}
                        sx={{
                          position: 'relative',
                          aspectRatio: '1 / 1',
                          p: 0,
                          border: 'none',
                          overflow: 'hidden',
                          bgcolor: 'var(--chat-sheet-panel-cell)',
                          cursor: 'pointer',
                          '&:active': { opacity: 0.78 },
                        }}
                      >
                        {isVideo ? (
                          <Box
                            component="video"
                            src={fileUrl}
                            muted
                            playsInline
                            preload="metadata"
                            sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        ) : (
                          <Box
                            component="img"
                            src={fileUrl}
                            alt={item.file_name || ''}
                            sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        )}
                        {isVideo ? (
                          <Box
                            sx={{
                              position: 'absolute',
                              top: 8,
                              right: 8,
                              px: 0.7,
                              py: 0.3,
                              borderRadius: 1,
                              bgcolor: 'var(--chat-sheet-panel-overlay)',
                              color: 'var(--chat-sheet-panel-text)',
                              fontSize: '0.72rem',
                              fontWeight: 700,
                            }}
                          >
                            Видео
                          </Box>
                        ) : null}
                      </Box>
                    );
                  })}
                </Box>
              )
            ) : null}

            {!attachmentsLoading && assetKind === 'file' ? (
              attachmentItems.length === 0 ? (
                <Typography sx={{ color: 'var(--chat-sheet-panel-soft)', textAlign: 'center', py: 6, fontSize: '0.95rem' }}>
                  Нет файлов
                </Typography>
              ) : (
                <Stack spacing={0} sx={{ py: 0.8 }}>
                  {attachmentItems.map((item) => (
                    <Box
                      key={item.id}
                      component="a"
                      href={buildAttachmentUrl(item.message_id || item.messageId, item.id, { inline: true })}
                      target="_blank"
                      rel="noopener noreferrer"
                      sx={{
                        px: 2.6,
                        py: 1.5,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.5,
                        textDecoration: 'none',
                        color: 'var(--chat-sheet-panel-text)',
                        '&:active': { opacity: 0.76 },
                      }}
                    >
                      <Box
                        sx={{
                          width: 42,
                          height: 42,
                          borderRadius: 2.25,
                          bgcolor: 'var(--chat-sheet-panel-card)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'var(--chat-sheet-panel-muted)',
                          fontSize: '0.7rem',
                          fontWeight: 800,
                        }}
                      >
                        {getFileExtension(item.file_name) || 'FILE'}
                      </Box>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={{ fontSize: '0.96rem', fontWeight: 600 }} noWrap>
                          {item.file_name}
                        </Typography>
                        <Typography sx={{ mt: 0.1, color: 'var(--chat-sheet-panel-soft)', fontSize: '0.83rem' }}>
                          {formatFileSize(item.file_size)}
                        </Typography>
                      </Box>
                    </Box>
                  ))}
                </Stack>
              )
            ) : null}

            {assetKind === 'link' ? (
              linkItems.length === 0 ? (
                <Typography sx={{ color: 'var(--chat-sheet-panel-soft)', textAlign: 'center', py: 6, fontSize: '0.95rem' }}>
                  Нет ссылок
                </Typography>
              ) : (
                <Stack spacing={0} sx={{ py: 0.8 }}>
                  {linkItems.map((item) => (
                    <Box
                      key={item.id}
                      component="a"
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      sx={{
                        px: 2.6,
                        py: 1.5,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.5,
                        textDecoration: 'none',
                        color: 'var(--chat-sheet-panel-text)',
                        '&:active': { opacity: 0.76 },
                      }}
                    >
                      <OpenInNewRoundedIcon sx={{ color: 'var(--chat-sheet-panel-icon)' }} />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={{ color: 'var(--chat-sheet-panel-accent)', fontSize: '0.95rem', fontWeight: 600 }} noWrap>
                          {item.title}
                        </Typography>
                      </Box>
                    </Box>
                  ))}
                </Stack>
              )
            ) : null}

            {assetKind === 'task' ? (
              visibleTaskItems.length === 0 ? (
                <Typography sx={{ color: 'var(--chat-sheet-panel-soft)', textAlign: 'center', py: 6, fontSize: '0.95rem' }}>
                  Нет задач
                </Typography>
              ) : (
                <Stack spacing={0} sx={{ py: 0.8 }}>
                  {visibleTaskItems.map((item) => (
                    <Box
                      key={`${item.messageId}-${item.task.id}`}
                      component="button"
                      type="button"
                      onClick={() => onOpenTask?.(item.task.id)}
                      sx={{
                        px: 2.6,
                        py: 1.5,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.5,
                        width: '100%',
                        border: 'none',
                        textAlign: 'left',
                        bgcolor: 'transparent',
                        color: 'var(--chat-sheet-panel-text)',
                        cursor: 'pointer',
                        '&:active': { opacity: 0.76 },
                      }}
                    >
                      <TaskAltOutlinedIcon sx={{ color: 'var(--chat-sheet-panel-icon)' }} />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={{ fontSize: '0.96rem', fontWeight: 600 }} noWrap>
                          {item.task.title}
                        </Typography>
                        <Typography sx={{ mt: 0.1, color: 'var(--chat-sheet-panel-soft)', fontSize: '0.83rem' }}>
                          {item.task.due_at ? formatFullDate(item.task.due_at) : 'Без срока'}
                        </Typography>
                      </Box>
                    </Box>
                  ))}
                </Stack>
              )
            ) : null}

            {assetKind === 'member' ? (
              participants.length === 0 ? (
                <Typography sx={{ color: 'var(--chat-sheet-panel-soft)', textAlign: 'center', py: 6, fontSize: '0.95rem' }}>
                  Нет участников
                </Typography>
              ) : (
                <Stack spacing={0} sx={{ py: 0.8 }}>
                  {canManageMembers ? (
                    <Box sx={{ px: 2.6, py: 1 }}>
                      <Button
                        fullWidth
                        variant="contained"
                        onClick={handlePromptAddMembers}
                        disabled={groupActionBusy}
                        sx={{
                          borderRadius: 999,
                          textTransform: 'none',
                          bgcolor: 'var(--chat-sheet-panel-accent)',
                          fontWeight: 800,
                        }}
                      >
                        Добавить участника
                      </Button>
                    </Box>
                  ) : null}
                  {visibleParticipantMembers.map((member) => {
                    const person = member?.user || {};
                    const role = normalizeGroupRole(member?.member_role);
                    const canOpenActions = isGroup && member?.user?.id && Number(member.user.id) !== currentUserId
                      && (canManageOwners || (canManageMembers && role === 'member'));
                    return (
                      <Box
                        key={`${conversationId}-person-${person.id}`}
                        sx={{
                          px: 2.6,
                          py: 1.3,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1.35,
                        }}
                      >
                        <PresenceAvatar item={person} online={Boolean(person?.presence?.is_online)} size={44} />
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Stack direction="row" alignItems="center" spacing={0.8} sx={{ minWidth: 0 }}>
                            <Typography sx={{ fontSize: '0.96rem', fontWeight: 600 }} noWrap>
                              {person?.full_name || person?.username || 'Пользователь'}
                            </Typography>
                            {role !== 'member' ? (
                              <Box
                                component="span"
                                sx={{
                                  px: 0.75,
                                  py: 0.2,
                                  borderRadius: 999,
                                  bgcolor: role === 'owner' ? 'var(--chat-sheet-panel-accent-soft)' : 'var(--chat-sheet-panel-card)',
                                  color: role === 'owner' ? 'var(--chat-sheet-panel-accent)' : 'var(--chat-sheet-panel-soft)',
                                  fontSize: '0.68rem',
                                  fontWeight: 800,
                                  flexShrink: 0,
                                }}
                              >
                                {GROUP_ROLE_LABELS[role]}
                              </Box>
                            ) : null}
                          </Stack>
                          <Typography sx={{ mt: 0.1, color: 'var(--chat-sheet-panel-soft)', fontSize: '0.83rem' }} noWrap>
                            {formatPresenceText(person?.presence)}
                          </Typography>
                        </Box>
                        {canOpenActions ? (
                          <IconButton
                            size="small"
                            onClick={(event) => handleOpenMemberActions(event, member)}
                            disabled={groupActionBusy}
                            sx={{ color: 'var(--chat-sheet-panel-soft)' }}
                          >
                            <MoreVertRoundedIcon fontSize="small" />
                          </IconButton>
                        ) : null}
                      </Box>
                    );
                  })}
                  {participantsExpandable ? (
                    <Box sx={{ px: 2.6, py: 1 }}>
                      <Button
                        fullWidth
                        variant="text"
                        onClick={() => setParticipantsExpanded((current) => !current)}
                        sx={{
                          borderRadius: 999,
                          textTransform: 'none',
                          color: 'var(--chat-sheet-panel-accent)',
                          fontWeight: 700,
                        }}
                      >
                        {participantsExpanded ? 'Свернуть' : 'Показать всех'}
                      </Button>
                    </Box>
                  ) : null}
                </Stack>
              )
            ) : null}
          </Box>
        </Box>

        <Menu
          anchorEl={infoMenuAnchorEl}
          open={infoMenuOpen}
          onClose={() => setInfoMenuAnchorEl(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          PaperProps={{
            sx: {
              mt: 0.5,
              minWidth: 220,
              borderRadius: 2.5,
              bgcolor: 'var(--chat-sheet-panel-menu-bg)',
              color: 'var(--chat-sheet-panel-text)',
              border: '1px solid var(--chat-sheet-panel-divider)',
              boxShadow: 'var(--chat-sheet-panel-menu-shadow)',
              '& .MuiMenuItem-root': {
                color: 'var(--chat-sheet-panel-text)',
              },
            },
          }}
        >
          {onOpenSearch ? (
            <MenuItem onClick={() => { setInfoMenuAnchorEl(null); onOpenSearch?.(); }}>
              Поиск в чате
            </MenuItem>
          ) : null}
          <MenuItem onClick={() => { setInfoMenuAnchorEl(null); onUpdateConversationSettings?.({ is_pinned: !activeConversation?.is_pinned }); }}>
            {activeConversation?.is_pinned ? 'Открепить чат' : 'Закрепить чат'}
          </MenuItem>
          <MenuItem onClick={() => { setInfoMenuAnchorEl(null); onUpdateConversationSettings?.({ is_muted: !activeConversation?.is_muted }); }}>
            {activeConversation?.is_muted ? 'Включить уведомления' : 'Отключить уведомления'}
          </MenuItem>
          <MenuItem onClick={() => { setInfoMenuAnchorEl(null); onUpdateConversationSettings?.({ is_archived: !activeConversation?.is_archived }); }}>
            {activeConversation?.is_archived ? 'Вернуть из архива' : 'Переместить в архив'}
          </MenuItem>
          {canManageOwners ? (
            <MenuItem onClick={handleRenameGroup}>
              Переименовать группу
            </MenuItem>
          ) : null}
          {isGroup && currentMemberRole !== 'owner' ? (
            <MenuItem onClick={handleLeaveGroup} sx={{ color: 'var(--chat-sheet-warning, #d64b4b) !important' }}>
              Выйти из группы
            </MenuItem>
          ) : null}
        </Menu>
        {memberActionsMenu}
      </Box>
    );
  }

  return (
    <Box
      sx={{
        ...buildSheetVars(ui, theme),
        width: embedded ? '100%' : PANEL_WIDTH,
        minWidth: embedded ? 0 : PANEL_WIDTH,
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        borderLeft: embedded ? 'none' : `1px solid ${SHEET_COLORS.border}`,
        bgcolor: 'var(--chat-sheet-panel-bg)',
        color: 'var(--chat-sheet-panel-text)',
      }}
    >
      {/* Шапка */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1.5, borderBottom: 'var(--chat-sheet-panel-divider-width) solid var(--chat-sheet-panel-divider)' }}>
        <IconButton onClick={embedded ? onClose : onToggleOpen} sx={{ color: 'var(--chat-sheet-panel-text)' }}>
          {embedded ? <CloseRoundedIcon /> : <ChevronRightRoundedIcon />}
        </IconButton>
        <Typography sx={{ fontWeight: 700 }}>Информация</Typography>
        <Box sx={{ width: 36 }} />
      </Box>

      {/* Профиль */}
      <Box sx={{ px: 2, py: 3, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, borderBottom: 'var(--chat-sheet-panel-divider-width) solid var(--chat-sheet-panel-divider)' }}>
        <PresenceAvatar
          item={subject}
          online={Boolean(isDirect && activeConversation?.direct_peer?.presence?.is_online)}
          size={120}
        />
        <Typography sx={{ fontWeight: 700, fontSize: '1.2rem' }}>
          {activeConversation?.title || 'Без имени'}
        </Typography>
        <Typography sx={{ color: 'var(--chat-sheet-panel-muted)' }}>
          {conversationHeaderSubtitle || 'был(а) недавно'}
        </Typography>
        {isGroup && (canManageOwners || currentMemberRole !== 'owner') ? (
          <Stack direction="row" spacing={1} sx={{ width: '100%', justifyContent: 'center', flexWrap: 'wrap' }}>
            {canManageOwners ? (
              <Button
                size="small"
                variant="outlined"
                onClick={handleRenameGroup}
                disabled={groupActionBusy}
                sx={{ borderRadius: 999, textTransform: 'none', fontWeight: 700 }}
              >
                Переименовать
              </Button>
            ) : null}
            {currentMemberRole !== 'owner' ? (
              <Button
                size="small"
                variant="outlined"
                color="error"
                onClick={handleLeaveGroup}
                disabled={groupActionBusy}
                sx={{ borderRadius: 999, textTransform: 'none', fontWeight: 700 }}
              >
                Выйти
              </Button>
            ) : null}
          </Stack>
        ) : null}
      </Box>

      {/* Контент */}
      <Box sx={{ flex: 1, overflowY: 'auto', bgcolor: 'var(--chat-sheet-panel-bg)' }}>
        {/* Информация о пользователе */}
        {isDirect ? (
          <>
            {String(subject?.phone || '').trim() ? (
              <InfoRowTelegram
                icon={<PhoneRoundedIcon sx={{ fontSize: 20, color: 'var(--chat-sheet-panel-icon)' }} />}
                label="Телефон"
                value={subject.phone}
              />
            ) : null}
            {String(subject?.username || '').trim() ? (
              <InfoRowTelegram
                icon={<PersonOutlineRoundedIcon sx={{ fontSize: 20, color: 'var(--chat-sheet-panel-icon)' }} />}
                label="Имя пользователя"
                value={`@${subject.username}`}
              />
            ) : null}
          </>
        ) : (
          <>
            <InfoRowTelegram
              icon={<PersonOutlineRoundedIcon sx={{ fontSize: 20, color: 'var(--chat-sheet-panel-icon)' }} />}
              label="Участники"
              value={String(Number(activeConversation?.member_count || participants.length || 0))}
            />
            <InfoRowTelegram
              icon={<NotificationsOutlinedIcon sx={{ fontSize: 20, color: 'var(--chat-sheet-panel-icon)' }} />}
              label="В сети"
              value={String(onlineCount)}
            />
          </>
        )}

        {/* Уведомления */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            px: 3,
            py: 2,
            borderBottom: 'var(--chat-sheet-panel-divider-width) solid var(--chat-sheet-panel-divider)',
          }}
        >
          <Stack direction="row" spacing={2} alignItems="center">
            <NotificationsOutlinedIcon sx={{ fontSize: 22, color: 'var(--chat-sheet-panel-icon)' }} />
            <Typography sx={{ color: 'var(--chat-sheet-panel-text)', fontSize: '1rem' }}>
              Уведомления
            </Typography>
          </Stack>
          <Switch
            checked={!activeConversation?.is_muted}
            onChange={(e) => onUpdateConversationSettings?.({ is_muted: !e.target.checked })}
            sx={{
              '& .MuiSwitch-switchBase.Mui-checked': { color: 'var(--chat-sheet-panel-accent)' },
              '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: 'var(--chat-sheet-panel-accent)' },
              '& .MuiSwitch-track': {
                bgcolor: 'var(--chat-sheet-panel-soft)',
                opacity: 1,
              },
            }}
          />
        </Box>

        {/* Медиа и содержимое — табы как в Telegram */}
        <Box sx={{ borderTop: 'var(--chat-sheet-panel-divider-width) solid var(--chat-sheet-panel-divider)' }}>
          {/* Табы */}
          <Box sx={{ display: 'flex', borderBottom: 'var(--chat-sheet-panel-divider-width) solid var(--chat-sheet-panel-divider)', overflowX: 'auto' }}>
            {[
              { key: 'image', label: 'Фото', count: assetCounts.image },
              { key: 'video', label: 'Видео', count: assetCounts.video },
              { key: 'file', label: 'Файлы', count: assetCounts.file },
              { key: 'link', label: 'Ссылки', count: linkItems.length },
              { key: 'task', label: 'Задачи', count: assetCounts.task },
              ...(!isDirect ? [{ key: 'member', label: 'Участники', count: assetCounts.member }] : []),
            ].map((tab) => (
              <Box
                key={tab.key}
                component="button"
                type="button"
                onClick={() => setAssetKind(tab.key)}
                aria-pressed={assetKind === tab.key}
                sx={{
                  appearance: 'none',
                  WebkitAppearance: 'none',
                  flex: '0 0 auto',
                  px: 2,
                  py: 1.5,
                  textAlign: 'center',
                  border: 0,
                  bgcolor: 'transparent',
                  cursor: 'pointer',
                  position: 'relative',
                  color: assetKind === tab.key ? 'var(--chat-sheet-panel-accent)' : 'var(--chat-sheet-panel-muted)',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  whiteSpace: 'nowrap',
                  '&:active': { opacity: 0.7 },
                }}
              >
                {tab.label} {tab.count > 0 && <span style={{ opacity: 0.6 }}>({tab.count})</span>}
                {assetKind === tab.key && (
                  <Box
                    sx={{
                      position: 'absolute',
                      bottom: 0,
                      left: '20%',
                      right: '20%',
                      height: 2,
                      bgcolor: 'var(--chat-sheet-panel-accent)',
                      borderRadius: 1,
                    }}
                  />
                )}
              </Box>
            ))}
          </Box>

          {/* Сетка медиа / список ссылок и задач */}
          <Box sx={{ px: 1, py: 1, minHeight: 120 }}>
            {assetKind === 'image' || assetKind === 'video' ? (
              /* Сетка фото/видео */
              attachmentItems.length === 0 ? (
                <Typography sx={{ color: 'var(--chat-sheet-panel-soft)', textAlign: 'center', py: 4, fontSize: '0.9rem' }}>
                  {assetKind === 'image' ? 'Нет фото' : 'Нет видео'}
                </Typography>
              ) : (
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0.5 }}>
                  {attachmentItems
                    .filter((item) => {
                      if (assetKind === 'video') return isVideoAttachment(item);
                      return isImageAttachment(item);
                    })
                    .map((item) => (
                      <Box
                        key={item.id}
                        onClick={() => onOpenAttachmentPreview?.(item.message_id, item)}
                        sx={{
                          position: 'relative',
                          aspectRatio: '1',
                          borderRadius: 0.5,
                          overflow: 'hidden',
                          cursor: 'pointer',
                          bgcolor: 'var(--chat-sheet-panel-card)',
                          '&:active': { opacity: 0.8 },
                        }}
                      >
                        {isImageAttachment(item) || isVideoAttachment(item) ? (
                          <Box
                            component="img"
                            src={normalizeChatAttachmentUrl(item?.variant_urls?.thumb || item?.variant_urls?.preview)
                              || buildAttachmentUrl(item.message_id || item.messageId, item.id, { inline: true })}
                            alt={item.file_name || ''}
                            sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        ) : (
                          <Stack alignItems="center" justifyContent="center" sx={{ height: '100%', px: 1 }}>
                            <Typography sx={{ color: 'var(--chat-sheet-panel-muted)', fontWeight: 700, fontSize: '0.7rem' }}>
                              {getFileExtension(item.file_name)}
                            </Typography>
                          </Stack>
                        )}
                        {isVideoAttachment(item) && (
                          <Box sx={{ position: 'absolute', bottom: 4, right: 4 }}>
                            <Box sx={{ bgcolor: 'var(--chat-sheet-panel-overlay)', px: 0.5, py: 0.25, borderRadius: 0.5 }}>
                              <Typography sx={{ color: 'var(--chat-sheet-panel-text)', fontSize: '0.65rem', fontWeight: 600 }}>0:06</Typography>
                            </Box>
                          </Box>
                        )}
                      </Box>
                    ))}
                </Box>
              )
            ) : assetKind === 'file' ? (
              /* Список файлов */
              attachmentItems.length === 0 ? (
                <Typography sx={{ color: 'var(--chat-sheet-panel-soft)', textAlign: 'center', py: 4, fontSize: '0.9rem' }}>
                  Нет файлов
                </Typography>
              ) : (
                <Stack spacing={0.5}>
                  {attachmentItems.map((item) => (
                    <Box
                      key={item.id}
                      component="a"
                      href={buildAttachmentUrl(item.message_id, item.id, { inline: true })}
                      target="_blank"
                      rel="noopener noreferrer"
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.5,
                        px: 1.5,
                        py: 1.2,
                        borderRadius: 1,
                        bgcolor: 'var(--chat-sheet-panel-card)',
                        cursor: 'pointer',
                        '&:active': { opacity: 0.8 },
                      }}
                    >
                      <Box sx={{ width: 40, height: 40, borderRadius: 1, bgcolor: 'var(--chat-sheet-panel-bg-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Typography sx={{ color: 'var(--chat-sheet-panel-muted)', fontSize: '0.7rem', fontWeight: 700 }}>
                          {getFileExtension(item.file_name)}
                        </Typography>
                      </Box>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={{ color: 'var(--chat-sheet-panel-text)', fontSize: '0.9rem', fontWeight: 600 }} noWrap>
                          {item.file_name}
                        </Typography>
                        <Typography sx={{ color: 'var(--chat-sheet-panel-soft)', fontSize: '0.75rem' }}>
                          {formatFileSize(item.file_size)}
                        </Typography>
                      </Box>
                    </Box>
                  ))}
                </Stack>
              )
            ) : assetKind === 'link' ? (
              /* Список ссылок */
              linkItems.length === 0 ? (
                <Typography sx={{ color: 'var(--chat-sheet-panel-soft)', textAlign: 'center', py: 4, fontSize: '0.9rem' }}>
                  Нет ссылок
                </Typography>
              ) : (
                <Stack spacing={0.5}>
                  {linkItems.map((item) => (
                    <Box
                      key={item.id}
                      component="a"
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.5,
                        px: 1.5,
                        py: 1.2,
                        borderRadius: 1,
                        bgcolor: 'var(--chat-sheet-panel-card)',
                        textDecoration: 'none',
                        '&:active': { opacity: 0.8 },
                      }}
                    >
                      <OpenInNewRoundedIcon sx={{ color: 'var(--chat-sheet-panel-icon)', fontSize: 20 }} />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={{ color: 'var(--chat-sheet-panel-accent)', fontSize: '0.9rem', fontWeight: 600 }} noWrap>
                          {item.title}
                        </Typography>
                      </Box>
                    </Box>
                  ))}
                </Stack>
              )
            ) : assetKind === 'task' ? (
              /* Список задач */
              visibleTaskItems.length === 0 ? (
                <Typography sx={{ color: 'var(--chat-sheet-panel-soft)', textAlign: 'center', py: 4, fontSize: '0.9rem' }}>
                  Нет задач
                </Typography>
              ) : (
                <Stack spacing={0.5}>
                  {visibleTaskItems.map((item) => (
                    <Box
                      key={`${item.messageId}-${item.task.id}`}
                      onClick={() => onOpenTask?.(item.task.id)}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.5,
                        px: 1.5,
                        py: 1.2,
                        borderRadius: 1,
                        bgcolor: 'var(--chat-sheet-panel-card)',
                        cursor: 'pointer',
                        '&:active': { opacity: 0.8 },
                      }}
                    >
                      <TaskAltOutlinedIcon sx={{ color: 'var(--chat-sheet-panel-icon)', fontSize: 20 }} />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={{ color: 'var(--chat-sheet-panel-text)', fontSize: '0.9rem', fontWeight: 600 }} noWrap>
                          {item.task.title}
                        </Typography>
                        <Typography sx={{ color: 'var(--chat-sheet-panel-soft)', fontSize: '0.75rem' }}>
                          {item.task.due_at ? formatFullDate(item.task.due_at) : 'Без срока'}
                        </Typography>
                      </Box>
                    </Box>
                  ))}
                </Stack>
              )
            ) : assetKind === 'member' ? (
              participants.length === 0 ? (
                <Typography sx={{ color: 'var(--chat-sheet-panel-soft)', textAlign: 'center', py: 4, fontSize: '0.9rem' }}>
                  Нет участников
                </Typography>
              ) : (
                <Stack spacing={0.5}>
                  {canManageMembers ? (
                    <Button
                      fullWidth
                      variant="contained"
                      onClick={handlePromptAddMembers}
                      disabled={groupActionBusy}
                      sx={{
                        mb: 1,
                        borderRadius: 999,
                        textTransform: 'none',
                        bgcolor: 'var(--chat-sheet-panel-accent)',
                        fontWeight: 800,
                      }}
                    >
                      Добавить участника
                    </Button>
                  ) : null}
                  {visibleParticipantMembers.map((member) => {
                    const person = member?.user || {};
                    const role = normalizeGroupRole(member?.member_role);
                    const canOpenActions = isGroup && member?.user?.id && Number(member.user.id) !== currentUserId
                      && (canManageOwners || (canManageMembers && role === 'member'));
                    return (
                      <Box
                        key={`${conversationId}-member-${person.id}`}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1.2,
                          px: 1.5,
                          py: 1.15,
                          borderRadius: 1.2,
                          bgcolor: 'var(--chat-sheet-panel-card)',
                        }}
                      >
                        <PresenceAvatar item={person} online={Boolean(person?.presence?.is_online)} size={40} />
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Stack direction="row" alignItems="center" spacing={0.75} sx={{ minWidth: 0 }}>
                            <Typography sx={{ color: 'var(--chat-sheet-panel-text)', fontSize: '0.9rem', fontWeight: 700 }} noWrap>
                              {person?.full_name || person?.username || 'Пользователь'}
                            </Typography>
                            {role !== 'member' ? (
                              <Box
                                component="span"
                                sx={{
                                  px: 0.7,
                                  py: 0.15,
                                  borderRadius: 999,
                                  bgcolor: role === 'owner' ? 'var(--chat-sheet-panel-accent-soft)' : 'var(--chat-sheet-panel-bg-strong)',
                                  color: role === 'owner' ? 'var(--chat-sheet-panel-accent)' : 'var(--chat-sheet-panel-soft)',
                                  fontSize: '0.66rem',
                                  fontWeight: 800,
                                  flexShrink: 0,
                                }}
                              >
                                {GROUP_ROLE_LABELS[role]}
                              </Box>
                            ) : null}
                          </Stack>
                          <Typography sx={{ color: 'var(--chat-sheet-panel-soft)', fontSize: '0.75rem' }} noWrap>
                            {formatPresenceText(person?.presence)}
                          </Typography>
                        </Box>
                        {canOpenActions ? (
                          <IconButton
                            size="small"
                            onClick={(event) => handleOpenMemberActions(event, member)}
                            disabled={groupActionBusy}
                            sx={{ color: 'var(--chat-sheet-panel-icon)' }}
                          >
                            <MoreVertRoundedIcon fontSize="small" />
                          </IconButton>
                        ) : null}
                      </Box>
                    );
                  })}
                </Stack>
              )
            ) : null}
          </Box>
        </Box>
      </Box>
      {memberActionsMenu}
    </Box>
  );
}
