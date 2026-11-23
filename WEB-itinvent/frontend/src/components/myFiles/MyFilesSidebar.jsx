import { useMemo, useState } from 'react';
import {
  Box,
  Button,
  IconButton,
  LinearProgress,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Skeleton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import CloudUploadOutlinedIcon from '@mui/icons-material/CloudUploadOutlined';
import CreateNewFolderOutlinedIcon from '@mui/icons-material/CreateNewFolderOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import DriveFolderUploadOutlinedIcon from '@mui/icons-material/DriveFolderUploadOutlined';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import FolderSharedOutlinedIcon from '@mui/icons-material/FolderSharedOutlined';
import GroupOutlinedIcon from '@mui/icons-material/GroupOutlined';
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined';
import SlideshowOutlinedIcon from '@mui/icons-material/SlideshowOutlined';
import StarOutlineRoundedIcon from '@mui/icons-material/StarOutlineRounded';
import TableChartOutlinedIcon from '@mui/icons-material/TableChartOutlined';

import { formatFileSize } from '../../lib/myFilesPreview';
import { buildOfficeUiTokens, getOfficePanelSx } from '../../theme/officeUiTokens';

const navButtonSx = (theme, active, collapsed) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: collapsed ? 'center' : 'flex-start',
  gap: collapsed ? 0 : 1.25,
  px: collapsed ? 0 : 1.5,
  py: 1,
  border: 'none',
  font: 'inherit',
  textAlign: 'left',
  width: '100%',
  borderRadius: '999px',
  cursor: 'pointer',
  fontWeight: 700,
  color: active ? 'primary.main' : 'text.primary',
  bgcolor: active ? 'action.selected' : 'transparent',
  '&:hover': { bgcolor: 'action.hover' },
  '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 },
});

function NavButton({ item, collapsed, theme, onNavigate }) {
  const button = (
    <Box
      component="button"
      type="button"
      onClick={() => {
        item.onClick();
        onNavigate?.();
      }}
      aria-current={item.active ? 'page' : undefined}
      data-testid={item.testId}
      aria-label={collapsed ? item.label : undefined}
      sx={navButtonSx(theme, item.active, collapsed)}
    >
      {item.icon}
      {collapsed ? null : (
        <Typography variant="body2" noWrap sx={{ fontWeight: 700, minWidth: 0 }}>{item.label}</Typography>
      )}
    </Box>
  );
  return collapsed ? (
    <Tooltip title={item.label} placement="right">
      {button}
    </Tooltip>
  ) : button;
}

export default function MyFilesSidebar({
  collapsed = false,
  inDrawer = false,
  onToggleCollapse = null,
  onNavigate = null,
  officeEnabled = false,
  createDisabled = false,
  onCreateFolder,
  onCreateDocument,
  onUploadFiles,
  onUploadFolder,
  isDriveActive = false,
  isRecentView = false,
  isFavoritesView = false,
  isTrashView = false,
  isSharedView = false,
  navigateToView,
  navigateToTrash,
  libraries = [],
  canManageLibraries = false,
  activeLibraryId = null,
  onLibraryOpen,
  onLibraryCreate,
  quota = null,
  quotaLoading = false,
  isLibraryView = false,
}) {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const [createMenuAnchor, setCreateMenuAnchor] = useState(null);

  const quotaUsed = Number(quota?.used_bytes || 0);
  const quotaLimit = Number(quota?.limit_bytes || 0);
  const quotaPercent = quotaLimit > 0 ? Math.min(100, Math.round((quotaUsed / quotaLimit) * 100)) : 0;

  const navItems = [
    {
      key: 'drive',
      icon: <FolderOutlinedIcon fontSize="small" />,
      label: 'Мой диск',
      active: isDriveActive,
      onClick: () => navigateToView(null),
      testId: 'my-files-nav-drive',
    },
    {
      key: 'recent',
      icon: <HistoryOutlinedIcon fontSize="small" />,
      label: 'Недавние',
      active: isRecentView,
      onClick: () => navigateToView('recent'),
      testId: 'my-files-nav-recent',
    },
    {
      key: 'favorites',
      icon: <StarOutlineRoundedIcon fontSize="small" />,
      label: 'Избранное',
      active: isFavoritesView,
      onClick: () => navigateToView('favorites'),
      testId: 'my-files-nav-favorites',
    },
    {
      key: 'trash',
      icon: <DeleteOutlineIcon fontSize="small" />,
      label: 'Корзина',
      active: isTrashView,
      onClick: navigateToTrash,
      testId: 'my-files-nav-trash',
    },
    ...(officeEnabled ? [{
      key: 'shared-editing',
      icon: <GroupOutlinedIcon fontSize="small" />,
      label: 'Доступно мне',
      active: isSharedView,
      onClick: () => navigateToView('shared'),
      testId: 'my-files-nav-shared-editing',
    }] : []),
  ];

  return (
    <Paper
      variant={inDrawer ? 'elevation' : 'outlined'}
      elevation={0}
      sx={{
        ...getOfficePanelSx(ui),
        width: inDrawer ? '100%' : (collapsed ? 64 : 252),
        height: inDrawer ? '100%' : undefined,
        flexShrink: 0,
        p: collapsed ? 1 : 2,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        borderRadius: inDrawer ? 0 : undefined,
        border: inDrawer ? 'none' : undefined,
        boxShadow: inDrawer ? 'none' : undefined,
        position: inDrawer ? 'static' : { lg: 'sticky' },
        top: inDrawer ? 'auto' : { lg: 16 },
        alignSelf: inDrawer ? 'stretch' : { lg: 'flex-start' },
        overflow: 'hidden',
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1} sx={{ justifyContent: collapsed ? 'center' : 'flex-start' }}>
        {collapsed ? (
          <Tooltip title="Создать" placement="right">
            <span>
              <IconButton
                color="primary"
                aria-label="Создать"
                onClick={(event) => setCreateMenuAnchor(event.currentTarget)}
                disabled={createDisabled}
                data-testid="my-files-create-button"
                sx={{
                  width: 44,
                  height: 44,
                  bgcolor: 'primary.main',
                  color: 'primary.contrastText',
                  boxShadow: theme.shadows[3],
                  '&:hover': { bgcolor: 'primary.dark', boxShadow: theme.shadows[6] },
                  '&.Mui-disabled': { bgcolor: 'action.disabledBackground', color: 'action.disabled' },
                }}
              >
                <AddRoundedIcon />
              </IconButton>
            </span>
          </Tooltip>
        ) : (
          <Button
            variant="contained"
            startIcon={<AddRoundedIcon />}
            onClick={(event) => setCreateMenuAnchor(event.currentTarget)}
            disabled={createDisabled}
            data-testid="my-files-create-button"
            sx={{
              alignSelf: 'flex-start',
              borderRadius: '16px',
              px: 3,
              py: 1.6,
              fontWeight: 600,
              fontSize: '0.95rem',
              boxShadow: theme.shadows[3],
              '&:hover': { boxShadow: theme.shadows[6] },
            }}
          >
            Создать
          </Button>
        )}
        {!collapsed && onToggleCollapse ? (
          <Tooltip title="Свернуть панель">
            <IconButton
              size="small"
              aria-label="Свернуть панель навигации"
              onClick={onToggleCollapse}
              sx={{ ml: 'auto' }}
            >
              <ChevronLeftRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : null}
        <Menu
          anchorEl={createMenuAnchor}
          open={Boolean(createMenuAnchor)}
          onClose={() => setCreateMenuAnchor(null)}
        >
          <MenuItem
            data-testid="my-files-create-folder-button"
            onClick={() => {
              setCreateMenuAnchor(null);
              onCreateFolder?.();
              onNavigate?.();
            }}
          >
            <ListItemIcon><CreateNewFolderOutlinedIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Новая папка</ListItemText>
          </MenuItem>
          {officeEnabled ? [
            ['docx', 'Документ', DescriptionOutlinedIcon],
            ['xlsx', 'Таблица', TableChartOutlinedIcon],
            ['pptx', 'Презентация', SlideshowOutlinedIcon],
          ].map(([kind, label, KindIcon], index) => (
            <MenuItem
              key={kind}
              divider={index === 2}
              data-testid={`my-files-create-${kind}`}
              onClick={() => {
                setCreateMenuAnchor(null);
                void onCreateDocument?.(kind);
                onNavigate?.();
              }}
            >
              <ListItemIcon><KindIcon fontSize="small" /></ListItemIcon>
              <ListItemText>{label}</ListItemText>
            </MenuItem>
          )) : null}
          <MenuItem
            data-testid="my-files-upload-files-menu"
            onClick={() => {
              setCreateMenuAnchor(null);
              onUploadFiles?.();
              onNavigate?.();
            }}
          >
            <ListItemIcon><CloudUploadOutlinedIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Загрузить файлы</ListItemText>
          </MenuItem>
          <MenuItem
            data-testid="my-files-upload-folder-button"
            onClick={() => {
              setCreateMenuAnchor(null);
              onUploadFolder?.();
              onNavigate?.();
            }}
          >
            <ListItemIcon><DriveFolderUploadOutlinedIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Загрузить папку</ListItemText>
          </MenuItem>
        </Menu>
      </Stack>

      <Stack
        spacing={0.5}
        component="nav"
        aria-label="Разделы файлов"
        sx={{ alignItems: collapsed ? 'center' : 'stretch' }}
      >
        {navItems.map((item) => (
          <NavButton key={item.key} item={item} collapsed={collapsed} theme={theme} onNavigate={onNavigate} />
        ))}
      </Stack>

      {collapsed && onToggleCollapse ? (
        <Tooltip title="Развернуть панель" placement="right">
          <IconButton
            size="small"
            aria-label="Развернуть панель навигации"
            onClick={onToggleCollapse}
            sx={{ alignSelf: 'center' }}
          >
            <ChevronRightRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : null}

      {!collapsed && (libraries.length > 0 || canManageLibraries) ? (
        <Stack spacing={0.5} component="nav" aria-label="Общие папки" data-testid="my-files-libraries">
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 1.5 }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>Общие папки</Typography>
            {canManageLibraries ? (
              <Tooltip title="Создать общую папку">
                <IconButton
                  size="small"
                  aria-label="Создать общую папку"
                  data-testid="my-files-library-add"
                  onClick={() => {
                    onLibraryCreate?.();
                    onNavigate?.();
                  }}
                >
                  <AddRoundedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : null}
          </Stack>
          {libraries.map((library) => {
            const active = String(activeLibraryId || '') === String(library.id);
            return (
              <NavButton
                key={library.id}
                item={{
                  key: library.id,
                  icon: <FolderSharedOutlinedIcon fontSize="small" />,
                  label: library.name,
                  active,
                  onClick: () => onLibraryOpen?.(library),
                  testId: `my-files-library-${library.id}`,
                }}
                collapsed={false}
                theme={theme}
                onNavigate={onNavigate}
              />
            );
          })}
        </Stack>
      ) : null}

      {!collapsed && (quota || quotaLoading) ? (
        <Box sx={{ mt: 1.5 }} data-testid="my-files-quota">
          <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
            <Typography variant="caption" color="text.secondary">
              {isLibraryView ? 'Общая папка' : 'Хранилище'}
            </Typography>
            <Typography variant="caption" sx={{ fontWeight: 600 }}>
              {quota
                ? (quotaLimit > 0 ? `${formatFileSize(quotaUsed)} / ${formatFileSize(quotaLimit)}` : `${formatFileSize(quotaUsed)} · без лимита`)
                : '—'}
            </Typography>
          </Stack>
          {quota ? (
            quotaLimit > 0
              ? <LinearProgress variant="determinate" value={quotaPercent} sx={{ height: 6, borderRadius: 1 }} />
              : null
          ) : (
            <Skeleton variant="rounded" height={6} />
          )}
        </Box>
      ) : null}
    </Paper>
  );
}
