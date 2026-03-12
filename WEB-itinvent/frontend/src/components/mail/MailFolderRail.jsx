import { useMemo, useState } from 'react';
import {
  Badge,
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
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import AttachFileOutlinedIcon from '@mui/icons-material/AttachFileOutlined';
import CreateNewFolderOutlinedIcon from '@mui/icons-material/CreateNewFolderOutlined';
import DateRangeOutlinedIcon from '@mui/icons-material/DateRangeOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DraftsOutlinedIcon from '@mui/icons-material/DraftsOutlined';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined';
import MarkEmailUnreadOutlinedIcon from '@mui/icons-material/MarkEmailUnreadOutlined';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import ReportGmailerrorredOutlinedIcon from '@mui/icons-material/ReportGmailerrorredOutlined';
import SendOutlinedIcon from '@mui/icons-material/SendOutlined';
import StarBorderRoundedIcon from '@mui/icons-material/StarBorderRounded';
import StarRoundedIcon from '@mui/icons-material/StarRounded';
import TodayOutlinedIcon from '@mui/icons-material/TodayOutlined';
import ViewAgendaOutlinedIcon from '@mui/icons-material/ViewAgendaOutlined';
import { buildMailUiTokens } from './mailUiTokens';

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

function buttonSx(tokens, active, compact) {
  return {
    minWidth: compact ? 42 : 0,
    width: compact ? 42 : '100%',
    minHeight: 36,
    justifyContent: compact ? 'center' : 'flex-start',
    borderRadius: '10px',
    textTransform: 'none',
    fontWeight: active ? 700 : 600,
    px: compact ? 0.5 : 1.2,
    border: '1px solid',
    borderColor: active ? tokens.selectedBorder : tokens.actionBorder,
    bgcolor: active ? tokens.selectedBg : tokens.actionBg,
    color: active ? 'primary.main' : tokens.textPrimary,
    boxShadow: 'none',
    '&:hover': {
      borderColor: active ? tokens.selectedBorder : tokens.surfaceBorder,
      bgcolor: active ? tokens.selectedHover : tokens.actionHover,
      boxShadow: 'none',
    },
  };
}

function iconButtonSx(tokens) {
  return {
    width: 28,
    height: 28,
    borderRadius: '8px',
    color: tokens.iconColor,
    border: '1px solid',
    borderColor: 'transparent',
    '&:hover': {
      borderColor: tokens.surfaceBorder,
      bgcolor: tokens.actionHover,
    },
  };
}

function FilterAction({ compact, active, label, icon, onClick, tooltip, tokens }) {
  if (compact) {
    return (
      <Tooltip title={tooltip || label} placement="right">
        <Button size="small" onClick={onClick} sx={buttonSx(tokens, active, true)}>
          {icon}
        </Button>
      </Tooltip>
    );
  }

  return (
    <Button
      size="small"
      startIcon={icon}
      onClick={onClick}
      sx={buttonSx(tokens, active, false)}
      fullWidth
    >
      {label}
    </Button>
  );
}

function FolderRow({
  item,
  depth,
  folder,
  compact,
  tokens,
  onFolderChange,
  onOpenMenu,
  onDropMessagesToFolder,
}) {
  const active = folder === item.id;
  const iconNode = FOLDER_ICON_MAP[item.icon_key] || FOLDER_ICON_MAP.folder;
  const unread = Number(item.unread || 0);
  const total = Number(item.total || 0);

  return (
    <ListItemButton
      selected={active}
      onClick={() => onFolderChange(item.id)}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDropMessagesToFolder?.(item.id);
      }}
      sx={{
        mb: 0.35,
        minHeight: compact ? 42 : 46,
        borderRadius: '12px',
        px: compact ? 1 : 1.1,
        pl: compact ? 1 : 1.1 + (depth * 1.4),
        border: '1px solid',
        borderColor: active ? tokens.selectedBorder : 'transparent',
        bgcolor: active ? tokens.selectedBg : 'transparent',
        '&:hover': {
          bgcolor: active ? tokens.selectedHover : tokens.actionHover,
        },
        '&.Mui-selected': {
          bgcolor: tokens.selectedBg,
          borderColor: tokens.selectedBorder,
          '&:hover': {
            bgcolor: tokens.selectedHover,
          },
        },
      }}
    >
      <ListItemIcon
        sx={{
          minWidth: compact ? 0 : 34,
          justifyContent: 'center',
          color: active ? 'primary.main' : tokens.iconColor,
        }}
      >
        <Badge color="primary" badgeContent={unread || null} max={999}>
          {iconNode}
        </Badge>
      </ListItemIcon>

      {!compact ? (
        <>
          <ListItemText
            primary={item.label || item.name}
            secondary={total > 0 ? `${total} всего` : 'Пусто'}
            primaryTypographyProps={{
              fontWeight: active ? 700 : 600,
              fontSize: '0.88rem',
              noWrap: true,
              color: active ? 'primary.main' : tokens.textPrimary,
            }}
            secondaryTypographyProps={{
              fontSize: '0.72rem',
              color: tokens.textSecondary,
            }}
          />

          <Stack direction="row" spacing={0.2} alignItems="center">
            {item.is_favorite ? <StarRoundedIcon sx={{ fontSize: 16, color: '#f59e0b' }} /> : null}
            {!item.well_known_key ? (
              <IconButton
                size="small"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenMenu(event, item);
                }}
                sx={iconButtonSx(tokens)}
              >
                <MoreHorizIcon fontSize="inherit" />
              </IconButton>
            ) : null}
          </Stack>
        </>
      ) : null}
    </ListItemButton>
  );
}

export default function MailFolderRail({
  compact = false,
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
}) {
  const theme = useTheme();
  const tokens = useMemo(() => buildMailUiTokens(theme), [theme]);
  const [menuAnchorEl, setMenuAnchorEl] = useState(null);
  const [menuFolder, setMenuFolder] = useState(null);

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

  const standardItems = useMemo(() => {
    const all = items.filter((item) => item.well_known_key);
    return STANDARD_ORDER
      .map((key) => all.find((item) => item.well_known_key === key))
      .filter(Boolean);
  }, [items]);

  const favoriteItems = useMemo(() => items.filter((item) => item.is_favorite), [items]);
  const rootCustomMailbox = useMemo(
    () => items.filter((item) => !item.well_known_key && !item.parent_id && item.scope === 'mailbox'),
    [items]
  );
  const rootCustomArchive = useMemo(
    () => items.filter((item) => !item.well_known_key && !item.parent_id && item.scope === 'archive'),
    [items]
  );

  const renderTree = (list, depth = 0) => list.flatMap((item) => {
    const nested = childrenByParent.get(String(item.id)) || [];
    return [
      <FolderRow
        key={item.id}
        item={item}
        depth={depth}
        folder={folder}
        compact={compact}
        tokens={tokens}
        onFolderChange={onFolderChange}
        onOpenMenu={(event, targetItem) => {
          setMenuAnchorEl(event.currentTarget);
          setMenuFolder(targetItem);
        }}
        onDropMessagesToFolder={onDropMessagesToFolder}
      />,
      ...renderTree(nested, depth + 1),
    ];
  });

  const renderSection = (title, list, actionScope = '') => {
    if (!Array.isArray(list) || list.length === 0) return null;

    return (
      <Stack spacing={0.35} sx={{ px: compact ? 0.7 : 1, py: 0.8 }}>
        {!compact ? (
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="caption" sx={{ fontWeight: 700, px: 0.4, color: tokens.textSecondary }}>
              {title}
            </Typography>
            {actionScope ? (
              <Tooltip title="Новая папка">
                <IconButton size="small" onClick={() => onCreateFolderRequest?.(actionScope)} sx={iconButtonSx(tokens)}>
                  <CreateNewFolderOutlinedIcon fontSize="inherit" />
                </IconButton>
              </Tooltip>
            ) : null}
          </Stack>
        ) : null}

        <List dense disablePadding>
          {renderTree(list)}
        </List>
      </Stack>
    );
  };

  return (
    <Paper
      elevation={0}
      sx={{
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '16px',
        overflow: 'hidden',
        border: '1px solid',
        borderColor: tokens.panelBorder,
        bgcolor: tokens.panelBg,
        boxShadow: tokens.shadow,
      }}
    >
      <Box
        sx={{
          px: compact ? 1 : 1.5,
          py: 1.25,
          borderBottom: '1px solid',
          borderColor: tokens.panelBorder,
        }}
      >
        {compact ? (
          <Typography variant="caption" sx={{ display: 'block', textAlign: 'center', fontWeight: 700, color: tokens.textSecondary }}>
            Почта
          </Typography>
        ) : (
          <>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: tokens.textPrimary }}>
              Навигация
            </Typography>
            <Typography variant="caption" sx={{ color: tokens.textSecondary }}>
              Системные и созданные через приложение папки
            </Typography>
          </>
        )}
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', scrollbarGutter: 'stable' }}>
        {showFavoritesFirst ? renderSection('Избранное', favoriteItems) : null}
        {renderSection('Папки', standardItems, 'mailbox')}
        {renderSection('Мои папки', rootCustomMailbox, 'mailbox')}
        {renderSection('Архивные папки', rootCustomArchive, 'archive')}
        {!showFavoritesFirst ? renderSection('Избранное', favoriteItems) : null}

        <Divider sx={{ mx: compact ? 1 : 1.2, my: 0.4, borderColor: tokens.panelBorder }} />

        <Stack spacing={0.7} sx={{ px: compact ? 0.7 : 1.2, py: 1 }}>
          {!compact ? (
            <Typography variant="caption" sx={{ fontWeight: 700, px: 0.4, color: tokens.textSecondary }}>
              Режим просмотра
            </Typography>
          ) : null}

          <Stack direction={compact ? 'column' : 'row'} spacing={0.7}>
            <Tooltip title="Письма" placement="right" disableHoverListener={!compact}>
              <Button
                size="small"
                startIcon={compact ? null : <ViewAgendaOutlinedIcon fontSize="small" />}
                onClick={() => onViewModeChange('messages')}
                sx={buttonSx(tokens, viewMode === 'messages', compact)}
                fullWidth={!compact}
              >
                {compact ? <ViewAgendaOutlinedIcon fontSize="small" /> : 'Письма'}
              </Button>
            </Tooltip>

            <Tooltip title="Диалоги" placement="right" disableHoverListener={!compact}>
              <Button
                size="small"
                startIcon={compact ? null : <ForumOutlinedIcon fontSize="small" />}
                onClick={() => onViewModeChange('conversations')}
                sx={buttonSx(tokens, viewMode === 'conversations', compact)}
                fullWidth={!compact}
              >
                {compact ? <ForumOutlinedIcon fontSize="small" /> : 'Диалоги'}
              </Button>
            </Tooltip>
          </Stack>
        </Stack>

        <Divider sx={{ mx: compact ? 1 : 1.2, my: 0.5, borderColor: tokens.panelBorder }} />

        <Stack spacing={0.75} sx={{ px: compact ? 0.7 : 1.2, py: 1 }}>
          {!compact ? (
            <Typography variant="caption" sx={{ fontWeight: 700, px: 0.4, color: tokens.textSecondary }}>
              Быстрые фильтры
            </Typography>
          ) : null}

          <FilterAction
            compact={compact}
            active={unreadOnly}
            label="Непрочитанные"
            icon={<MarkEmailUnreadOutlinedIcon fontSize="small" />}
            onClick={() => onUnreadToggle(!unreadOnly)}
            tokens={tokens}
          />
          <FilterAction
            compact={compact}
            active={hasAttachmentsOnly}
            label="С вложениями"
            icon={<AttachFileOutlinedIcon fontSize="small" />}
            onClick={onToggleHasAttachmentsOnly}
            tokens={tokens}
          />
          <FilterAction
            compact={compact}
            active={Boolean(filterDateFrom && filterDateTo && filterDateFrom === filterDateTo)}
            label="Сегодня"
            icon={<TodayOutlinedIcon fontSize="small" />}
            onClick={onToggleToday}
            tokens={tokens}
          />
          <FilterAction
            compact={compact}
            active={Boolean(filterDateFrom && !filterDateTo)}
            label="7 дней"
            icon={<DateRangeOutlinedIcon fontSize="small" />}
            onClick={onToggleLast7Days}
            tokens={tokens}
          />
        </Stack>
      </Box>

      <Menu
        anchorEl={menuAnchorEl}
        open={Boolean(menuAnchorEl)}
        onClose={() => {
          setMenuAnchorEl(null);
          setMenuFolder(null);
        }}
        PaperProps={{
          sx: {
            mt: 0.5,
            minWidth: 220,
            borderRadius: '14px',
            bgcolor: tokens.menuBg,
            border: '1px solid',
            borderColor: tokens.panelBorder,
            boxShadow: tokens.shadow,
          },
        }}
      >
        <MenuItem
          onClick={() => {
            onToggleFavorite?.(menuFolder);
            setMenuAnchorEl(null);
            setMenuFolder(null);
          }}
        >
          {menuFolder?.is_favorite ? (
            <StarRoundedIcon sx={{ mr: 1, fontSize: 18, color: '#f59e0b' }} />
          ) : (
            <StarBorderRoundedIcon sx={{ mr: 1, fontSize: 18 }} />
          )}
          {menuFolder?.is_favorite ? 'Убрать из избранного' : 'В избранное'}
        </MenuItem>

        <MenuItem
          onClick={() => {
            onCreateFolderRequest?.(menuFolder?.id || 'mailbox');
            setMenuAnchorEl(null);
            setMenuFolder(null);
          }}
        >
          <CreateNewFolderOutlinedIcon sx={{ mr: 1, fontSize: 18 }} />
          Создать вложенную папку
        </MenuItem>

        {menuFolder?.can_rename ? (
          <MenuItem
            onClick={() => {
              onRenameFolderRequest?.(menuFolder);
              setMenuAnchorEl(null);
              setMenuFolder(null);
            }}
          >
            <FolderOutlinedIcon sx={{ mr: 1, fontSize: 18 }} />
            Переименовать
          </MenuItem>
        ) : null}

        {menuFolder?.can_delete ? (
          <MenuItem
            onClick={() => {
              onDeleteFolderRequest?.(menuFolder);
              setMenuAnchorEl(null);
              setMenuFolder(null);
            }}
            sx={{ color: 'error.main' }}
          >
            <DeleteOutlineIcon sx={{ mr: 1, fontSize: 18 }} />
            Удалить
          </MenuItem>
        ) : null}
      </Menu>
    </Paper>
  );
}
