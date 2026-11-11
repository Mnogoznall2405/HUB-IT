import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Divider,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import CreateOutlinedIcon from '@mui/icons-material/CreateOutlined';
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import AssignmentOutlinedIcon from '@mui/icons-material/AssignmentOutlined';
import AttachFileOutlinedIcon from '@mui/icons-material/AttachFileOutlined';
import CreateNewFolderOutlinedIcon from '@mui/icons-material/CreateNewFolderOutlined';
import DateRangeOutlinedIcon from '@mui/icons-material/DateRangeOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DraftsOutlinedIcon from '@mui/icons-material/DraftsOutlined';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined';
import MarkEmailUnreadOutlinedIcon from '@mui/icons-material/MarkEmailUnreadOutlined';
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import ReportGmailerrorredOutlinedIcon from '@mui/icons-material/ReportGmailerrorredOutlined';
import SendOutlinedIcon from '@mui/icons-material/SendOutlined';
import SettingsSuggestOutlinedIcon from '@mui/icons-material/SettingsSuggestOutlined';
import StarRoundedIcon from '@mui/icons-material/StarRounded';
import TodayOutlinedIcon from '@mui/icons-material/TodayOutlined';
import { buildMailUiTokens, getMailMenuPaperSx } from './mailUiTokens';

const FOLDER_ICON_MAP = {
  inbox: <InboxOutlinedIcon fontSize="small" />,
  sent: <SendOutlinedIcon fontSize="small" />,
  drafts: <DraftsOutlinedIcon fontSize="small" />,
  trash: <DeleteOutlineIcon fontSize="small" />,
  junk: <ReportGmailerrorredOutlinedIcon fontSize="small" />,
  archive: <ArchiveOutlinedIcon fontSize="small" />,
  folder: <FolderOutlinedIcon fontSize="small" />,
};

const STANDARD_ORDER = ['inbox', 'sent', 'drafts', 'trash', 'junk', 'archive'];

function SectionTitle({ children }) {
  return (
    <Typography
      sx={{
        px: 1.2,
        pb: 0.5,
        fontSize: '0.74rem',
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        color: 'text.secondary',
      }}
    >
      {children}
    </Typography>
  );
}

function UnreadBadge({ unread }) {
  if (!unread) return null;
  return (
    <Box
      sx={{
        minWidth: 20,
        height: 20,
        px: 0.6,
        borderRadius: '6px',
        bgcolor: 'primary.main',
        color: 'primary.contrastText',
        fontWeight: 700,
        fontSize: '0.74rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {unread > 99 ? '99+' : unread}
    </Box>
  );
}

function RailRow({
  icon,
  leading = null,
  label,
  active = false,
  dropActive = false,
  trailing = null,
  onClick,
  onDragOver,
  onDragLeave,
  onDrop,
  sx = {},
  testId,
  tokens = null,
}) {
  return (
    <ListItemButton
      data-testid={testId}
      data-active={active ? 'true' : 'false'}
      data-drop-active={dropActive ? 'true' : 'false'}
      onClick={onClick}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      sx={{
        minHeight: 36,
        px: 1,
        py: 0.2,
        borderRadius: tokens?.radiusSm || 0,
        color: active || dropActive ? 'primary.main' : 'inherit',
        bgcolor: dropActive
          ? alpha(tokens?.selectedBorder || '#1976d2', 0.16)
          : active ? tokens?.selectedBg || 'action.selected' : 'transparent',
        outline: dropActive ? '1px solid' : 'none',
        outlineColor: dropActive ? 'primary.main' : 'transparent',
        transition: tokens?.transition,
        '&:hover': {
          bgcolor: dropActive
            ? alpha(tokens?.selectedBorder || '#1976d2', 0.2)
            : active ? tokens?.selectedHover || 'action.selected' : tokens?.surfaceHover || 'action.hover',
        },
        '&.Mui-focusVisible': {
          boxShadow: tokens?.focusRing,
        },
        ...sx,
      }}
    >
      <ListItemIcon
        sx={{
          minWidth: leading ? 48 : 30,
          color: active ? 'primary.main' : 'inherit',
        }}
      >
        {leading || icon}
      </ListItemIcon>
      <ListItemText
        primary={label}
        primaryTypographyProps={{
          noWrap: true,
          fontWeight: active ? 600 : 500,
          fontSize: '0.86rem',
        }}
      />
      {trailing}
    </ListItemButton>
  );
}

function FolderRow({
  item,
  depth,
  folder,
  onFolderChange,
  onOpenMenu,
  onDropMessagesToFolder,
  dropTargetId = '',
  onDropTargetChange,
  hasChildren = false,
  expanded = false,
  onToggleExpand,
  tokens,
}) {
  const active = folder === item.id;
  const unread = Math.max(0, Number(item.unread || 0));
  const iconNode = FOLDER_ICON_MAP[item.icon_key] || FOLDER_ICON_MAP.folder;

  return (
    <RailRow
      leading={(
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
          {hasChildren ? (
            <IconButton
              size="small"
              data-testid={`mail-folder-toggle-${String(item.id)}`}
              onClick={(event) => {
                event.stopPropagation();
                onToggleExpand?.();
              }}
              sx={{
                width: 24,
                height: 24,
                color: active ? 'primary.main' : tokens.textSecondary,
              }}
            >
              {expanded ? (
                <ExpandMoreRoundedIcon fontSize="inherit" />
              ) : (
                <ChevronRightRoundedIcon fontSize="inherit" />
              )}
            </IconButton>
          ) : (
            <Box sx={{ width: 24, height: 24, flexShrink: 0 }} />
          )}
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            {iconNode}
          </Box>
        </Box>
      )}
      icon={iconNode}
      label={item.label || item.name}
      active={active}
      dropActive={dropTargetId === item.id}
      onClick={() => onFolderChange?.(item.id)}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        onDropTargetChange?.(item.id);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        onDropTargetChange?.('');
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDropTargetChange?.('');
        onDropMessagesToFolder?.(item.id);
      }}
      tokens={tokens}
      sx={{
        pl: 1 + (depth * 1.45),
      }}
      trailing={(
        <Stack direction="row" spacing={0.35} alignItems="center" sx={{ ml: 0.6 }}>
          {item.is_favorite ? <StarRoundedIcon sx={{ fontSize: 15, color: '#f59e0b' }} /> : null}
          <UnreadBadge unread={unread} />
          <Tooltip title="Действия с папкой">
            <IconButton
              size="small"
              data-testid={`mail-folder-menu-${String(item.id)}`}
              aria-label={`Действия с папкой ${item.label || item.name || ''}`}
              onClick={(event) => {
                event.stopPropagation();
                onOpenMenu?.(event, item);
              }}
              sx={{
                width: 26,
                height: 26,
                color: tokens.textSecondary,
                opacity: 0,
                flexShrink: 0,
                '.MuiListItemButton-root:hover &, .MuiListItemButton-root:focus-within &, .MuiListItemButton-root[data-active="true"] &': {
                  opacity: 1,
                },
                ...(active ? { opacity: 1 } : {}),
              }}
            >
              <MoreHorizRoundedIcon fontSize="inherit" />
            </IconButton>
          </Tooltip>
        </Stack>
      )}
    />
  );
}

function FilterRow({ icon, label, active, onClick, tokens }) {
  return (
    <RailRow
      icon={icon}
      label={label}
      active={active}
      tokens={tokens}
      onClick={onClick}
    />
  );
}

function UtilityRow({ icon, label, onClick, testId, tokens }) {
  return (
    <RailRow
      icon={icon}
      label={label}
      tokens={tokens}
      onClick={onClick}
      testId={testId}
    />
  );
}

export default function MailFolderRail({
  folder,
  folderTreeItems,
  onFolderChange,
  viewMode,
  onViewModeChange,
  unreadOnly,
  onUnreadToggle,
  hasAttachmentsOnly,
  onToggleHasAttachmentsOnly,
  filterDateFrom,
  filterDateTo,
  onToggleToday,
  onToggleLast7Days,
  onCreateFolderRequest,
  onRenameFolderRequest,
  onDeleteFolderRequest,
  onToggleFavorite,
  onDropMessagesToFolder,
  onCompose,
  showFavoritesFirst = true,
  utilityItems = [],
}) {
  const theme = useTheme();
  const tokens = useMemo(() => buildMailUiTokens(theme), [theme]);
  const [menuAnchorEl, setMenuAnchorEl] = useState(null);
  const [menuFolder, setMenuFolder] = useState(null);
  const [expandedFolders, setExpandedFolders] = useState({});
  const [dropTargetId, setDropTargetId] = useState('');

  const items = useMemo(() => (Array.isArray(folderTreeItems) ? folderTreeItems : []), [folderTreeItems]);

  const childrenByParent = useMemo(() => {
    const map = new Map();
    items.forEach((item) => {
      const key = String(item.parent_id || '__root__');
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    });
    map.forEach((list) => {
      list.sort((left, right) => String(left.label || '').localeCompare(String(right.label || ''), 'ru'));
    });
    return map;
  }, [items]);

  const parentById = useMemo(() => {
    const map = new Map();
    items.forEach((item) => {
      map.set(String(item.id), _normalizeParentId(item.parent_id));
    });
    return map;
  }, [items]);

  const standardItems = useMemo(() => {
    const all = items.filter((item) => item.well_known_key);
    return STANDARD_ORDER
      .map((key) => all.find((item) => item.well_known_key === key))
      .filter(Boolean);
  }, [items]);

  const favoriteItems = useMemo(() => items.filter((item) => item.is_favorite), [items]);
  const rootCustomMailbox = useMemo(
    () => items.filter((item) => !item.well_known_key && !item.parent_id && item.scope === 'mailbox'),
    [items],
  );
  const rootCustomArchive = useMemo(
    () => items.filter((item) => !item.well_known_key && !item.parent_id && item.scope === 'archive'),
    [items],
  );

  const autoExpandedFolderIds = useMemo(() => {
    const next = new Set();
    let current = String(folder || '').trim();
    while (current) {
      const nested = childrenByParent.get(current) || [];
      if (nested.length > 0) {
        next.add(current);
      }
      current = parentById.get(current) || '';
    }
    if ((childrenByParent.get('inbox') || []).length > 0) {
      next.add('inbox');
    }
    return next;
  }, [childrenByParent, folder, parentById]);

  useEffect(() => {
    if (autoExpandedFolderIds.size === 0) return;
    setExpandedFolders((current) => {
      let changed = false;
      const next = { ...current };
      autoExpandedFolderIds.forEach((folderId) => {
        if (next[folderId] !== true) {
          next[folderId] = true;
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [autoExpandedFolderIds]);

  const toggleFolderExpanded = (folderId) => {
    const normalizedId = String(folderId || '').trim();
    if (!normalizedId) return;
    setExpandedFolders((current) => ({
      ...current,
      [normalizedId]: current[normalizedId] !== true,
    }));
  };

  const renderTree = (list, depth = 0) => list.flatMap((item) => {
    const nested = childrenByParent.get(String(item.id)) || [];
    const hasChildren = nested.length > 0;
    const expanded = hasChildren && expandedFolders[String(item.id)] === true;
    return [
      <FolderRow
        key={item.id}
        item={item}
        depth={depth}
        folder={folder}
        onFolderChange={onFolderChange}
        onOpenMenu={(event, targetItem) => {
          setMenuAnchorEl(event.currentTarget);
          setMenuFolder(targetItem);
        }}
        onDropMessagesToFolder={onDropMessagesToFolder}
        dropTargetId={dropTargetId}
        onDropTargetChange={setDropTargetId}
        hasChildren={hasChildren}
        expanded={expanded}
        onToggleExpand={() => toggleFolderExpanded(item.id)}
        tokens={tokens}
      />,
      ...(expanded ? renderTree(nested, depth + 1) : []),
    ];
  });

  const renderSection = (title, list, actionScope = '') => {
    if (!Array.isArray(list) || list.length === 0) return null;

    return (
      <Box>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ pr: 1 }}>
          <SectionTitle>{title}</SectionTitle>
          {actionScope ? (
            <Tooltip title="Создать папку">
              <IconButton
                size="small"
                aria-label="Создать папку"
                onClick={() => onCreateFolderRequest?.(actionScope)}
                sx={{ width: 28, height: 28, color: tokens.textSecondary, opacity: 0.7 }}
              >
                <CreateNewFolderOutlinedIcon fontSize="inherit" />
              </IconButton>
            </Tooltip>
          ) : null}
        </Stack>
        <List disablePadding dense>
          {renderTree(list)}
        </List>
      </Box>
    );
  };

  const normalizedUtilityItems = Array.isArray(utilityItems) ? utilityItems.filter(Boolean) : [];

  return (
    <Box
      className="mail-scroll-hidden"
      sx={{
        height: '100%',
        minHeight: 0,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        py: 0.85,
        bgcolor: tokens.panelBg,
      }}
    >
      {onCompose ? (
        <Box sx={{ px: 1, pb: 1 }}>
          <Button
            fullWidth
            variant="contained"
            startIcon={<CreateOutlinedIcon />}
            onClick={onCompose}
            data-testid="mail-compose-button"
            aria-label="Написать письмо"
            sx={{
              minHeight: 40,
              textTransform: 'none',
              fontWeight: 700,
              borderRadius: tokens.radiusSm,
              boxShadow: 'none',
            }}
          >
            Написать
          </Button>
        </Box>
      ) : null}

      {showFavoritesFirst ? renderSection('Избранное', favoriteItems) : null}
      {renderSection('Папки', standardItems, 'mailbox')}
      {renderSection('Мои папки', rootCustomMailbox, 'mailbox')}
      {renderSection('Архивные папки', rootCustomArchive, 'archive')}
      {!showFavoritesFirst ? renderSection('Избранное', favoriteItems) : null}

      <Divider sx={{ mx: 1.5, my: 0.9, borderColor: tokens.panelBorder }} />

      <ToggleButtonGroup
        data-testid="mail-view-mode-switcher"
        exclusive
        fullWidth
        size="small"
        value={viewMode === 'conversations' ? 'conversations' : 'messages'}
        onChange={(_event, value) => {
          if (!value) return;
          onViewModeChange?.(value);
        }}
        sx={{
          px: 1,
          pb: 0.6,
          '& .MuiToggleButton-root': {
            minHeight: 30,
            py: 0.25,
            px: 0.8,
            textTransform: 'none',
            fontWeight: 700,
            fontSize: '0.75rem',
            borderRadius: `${tokens.radiusSm} !important`,
          },
          '& .MuiToggleButton-root.MuiToggleButton-root': {
            color: tokens.textPrimary,
            borderColor: tokens.panelBorder,
          },
          '& .MuiToggleButton-root.Mui-selected': {
            color: tokens.textPrimary,
            bgcolor: tokens.selectedBg,
            '&:hover': {
              bgcolor: tokens.selectedHover,
            },
          },
        }}
      >
        <ToggleButton
          value="messages"
          aria-label="Письма"
          style={{ color: tokens.textPrimary }}
        >
          Письма
        </ToggleButton>
        <ToggleButton
          value="conversations"
          aria-label="Цепочки"
          style={{ color: tokens.textPrimary }}
        >
          Цепочки
        </ToggleButton>
      </ToggleButtonGroup>

      <Divider sx={{ mx: 1.5, my: 0.9, borderColor: tokens.panelBorder }} />

      <SectionTitle>Фильтры</SectionTitle>
      <List disablePadding dense>
        <FilterRow
          icon={<MarkEmailUnreadOutlinedIcon fontSize="small" />}
          label="Непрочитанные"
          active={unreadOnly}
          tokens={tokens}
          onClick={() => onUnreadToggle?.(!unreadOnly)}
        />
        <FilterRow
          icon={<AttachFileOutlinedIcon fontSize="small" />}
          label="С вложениями"
          active={hasAttachmentsOnly}
          tokens={tokens}
          onClick={onToggleHasAttachmentsOnly}
        />
        <FilterRow
          icon={<TodayOutlinedIcon fontSize="small" />}
          label="Сегодня"
          active={Boolean(filterDateFrom && filterDateTo && filterDateFrom === filterDateTo)}
          tokens={tokens}
          onClick={onToggleToday}
        />
        <FilterRow
          icon={<DateRangeOutlinedIcon fontSize="small" />}
          label="Последние 7 дней"
          active={Boolean(filterDateFrom && !filterDateTo)}
          tokens={tokens}
          onClick={onToggleLast7Days}
        />
      </List>

      {normalizedUtilityItems.length > 0 ? (
        <>
          <Divider sx={{ mx: 1.5, my: 1.3, borderColor: tokens.panelBorder }} />
          <SectionTitle>Инструменты</SectionTitle>
          <List disablePadding dense>
            {normalizedUtilityItems.map((item) => (
              <UtilityRow
                key={String(item.id || item.label || '')}
                icon={String(item.id || '').includes('template')
                  ? <SettingsSuggestOutlinedIcon fontSize="small" />
                  : <AssignmentOutlinedIcon fontSize="small" />}
                label={String(item.label || 'Инструмент')}
                onClick={item.onClick}
                testId={`mail-rail-utility-${String(item.id || '').trim() || 'item'}`}
                tokens={tokens}
              />
            ))}
          </List>
        </>
      ) : null}

      <Menu
        anchorEl={menuAnchorEl}
        open={Boolean(menuAnchorEl)}
        onClose={() => {
          setMenuAnchorEl(null);
          setMenuFolder(null);
        }}
        PaperProps={{
          sx: getMailMenuPaperSx(tokens, { minWidth: 220 }),
        }}
      >
        <MenuItem
          data-testid="mail-folder-menu-favorite"
          onClick={() => {
            onToggleFavorite?.(menuFolder);
            setMenuAnchorEl(null);
            setMenuFolder(null);
          }}
        >
          {menuFolder?.is_favorite ? 'Убрать из избранного' : 'В избранное'}
        </MenuItem>
        <MenuItem
          data-testid="mail-folder-menu-create-child"
          onClick={() => {
            onCreateFolderRequest?.(menuFolder?.id || 'mailbox');
            setMenuAnchorEl(null);
            setMenuFolder(null);
          }}
        >
          Создать вложенную папку
        </MenuItem>
        {menuFolder?.can_rename ? (
          <MenuItem
            data-testid="mail-folder-menu-rename"
            onClick={() => {
              onRenameFolderRequest?.(menuFolder);
              setMenuAnchorEl(null);
              setMenuFolder(null);
            }}
          >
            Переименовать
          </MenuItem>
        ) : null}
        {menuFolder?.can_delete ? (
          <MenuItem
            data-testid="mail-folder-menu-delete"
            onClick={() => {
              onDeleteFolderRequest?.(menuFolder);
              setMenuAnchorEl(null);
              setMenuFolder(null);
            }}
            sx={{ color: 'error.main' }}
          >
            Удалить
          </MenuItem>
        ) : null}
      </Menu>
    </Box>
  );
}

function _normalizeParentId(value) {
  const normalized = String(value || '').trim();
  return normalized || '';
}
