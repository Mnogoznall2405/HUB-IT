import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Divider,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
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
import ViewAgendaOutlinedIcon from '@mui/icons-material/ViewAgendaOutlined';
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
        px: 1.5,
        pb: 0.65,
        fontSize: '0.78rem',
        fontWeight: 800,
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
        minWidth: 22,
        height: 22,
        px: 0.7,
        borderRadius: '7px',
        bgcolor: 'primary.main',
        color: 'primary.contrastText',
        fontWeight: 700,
        fontSize: '0.78rem',
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
  trailing = null,
  onClick,
  onDragOver,
  onDrop,
  sx = {},
  testId,
  tokens = null,
}) {
  return (
    <ListItemButton
      data-testid={testId}
      onClick={onClick}
      onDragOver={onDragOver}
      onDrop={onDrop}
      sx={{
        minHeight: 46,
        px: 1.3,
        py: 0.5,
        borderRadius: tokens?.radiusSm || 0,
        color: active ? 'primary.main' : 'inherit',
        bgcolor: active ? tokens?.selectedBg || 'action.selected' : 'transparent',
        transition: tokens?.transition,
        '&:hover': {
          bgcolor: active ? tokens?.selectedHover || 'action.selected' : tokens?.surfaceHover || 'action.hover',
        },
        '&.Mui-focusVisible': {
          boxShadow: tokens?.focusRing,
        },
        ...sx,
      }}
    >
      <ListItemIcon
        sx={{
          minWidth: leading ? 58 : 34,
          color: active ? 'primary.main' : 'inherit',
        }}
      >
        {leading || icon}
      </ListItemIcon>
      <ListItemText
        primary={label}
        primaryTypographyProps={{
          noWrap: true,
          fontWeight: active ? 700 : 600,
          fontSize: '0.94rem',
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
      onClick={() => onFolderChange?.(item.id)}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDropMessagesToFolder?.(item.id);
      }}
      tokens={tokens}
      sx={{
        pl: 1.3 + (depth * 1.8),
      }}
      trailing={(
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ ml: 1 }}>
          {item.is_favorite ? <StarRoundedIcon sx={{ fontSize: 15, color: '#f59e0b' }} /> : null}
          <UnreadBadge unread={unread} />
          <IconButton
            size="small"
            data-testid={`mail-folder-menu-${String(item.id)}`}
            onClick={(event) => {
              event.stopPropagation();
              onOpenMenu?.(event, item);
            }}
            sx={{
              width: 28,
              height: 28,
              color: tokens.textSecondary,
            }}
          >
            <MoreHorizRoundedIcon fontSize="inherit" />
          </IconButton>
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
  showFavoritesFirst = true,
  utilityItems = [],
}) {
  const theme = useTheme();
  const tokens = useMemo(() => buildMailUiTokens(theme), [theme]);
  const [menuAnchorEl, setMenuAnchorEl] = useState(null);
  const [menuFolder, setMenuFolder] = useState(null);
  const [expandedFolders, setExpandedFolders] = useState({});

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
            <IconButton
              size="small"
              onClick={() => onCreateFolderRequest?.(actionScope)}
          sx={{ width: 28, height: 28, color: tokens.textSecondary }}
            >
              <CreateNewFolderOutlinedIcon fontSize="inherit" />
            </IconButton>
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
        py: 1.1,
        bgcolor: 'transparent',
      }}
    >
      {showFavoritesFirst ? renderSection('Избранное', favoriteItems) : null}
      {renderSection('Папки', standardItems, 'mailbox')}
      {renderSection('Мои папки', rootCustomMailbox, 'mailbox')}
      {renderSection('Архивные папки', rootCustomArchive, 'archive')}
      {!showFavoritesFirst ? renderSection('Избранное', favoriteItems) : null}

      <Divider sx={{ mx: 1.5, my: 1.3, borderColor: tokens.panelBorder }} />

      <SectionTitle>Режим</SectionTitle>
      <List disablePadding dense>
        <FilterRow
          icon={<ViewAgendaOutlinedIcon fontSize="small" />}
          label="Письма"
          active={viewMode === 'messages'}
          tokens={tokens}
          onClick={() => onViewModeChange?.('messages')}
        />
        <FilterRow
          icon={<ForumOutlinedIcon fontSize="small" />}
          label="Диалоги"
          active={viewMode === 'conversations'}
          tokens={tokens}
          onClick={() => onViewModeChange?.('conversations')}
        />
      </List>

      <Divider sx={{ mx: 1.5, my: 1.3, borderColor: tokens.panelBorder }} />

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
