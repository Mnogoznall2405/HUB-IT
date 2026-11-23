import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Divider,
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
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import FolderSharedOutlinedIcon from '@mui/icons-material/FolderSharedOutlined';
import GroupOutlinedIcon from '@mui/icons-material/GroupOutlined';
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined';
import SlideshowOutlinedIcon from '@mui/icons-material/SlideshowOutlined';
import StarOutlineRoundedIcon from '@mui/icons-material/StarOutlineRounded';
import TableChartOutlinedIcon from '@mui/icons-material/TableChartOutlined';

import { formatFileSize } from '../../lib/myFilesPreview';
import { buildOfficeUiTokens, getOfficePanelSx } from '../../theme/officeUiTokens';

const LIBRARIES_EXPANDED_KEY = 'my-files-libraries-expanded';

const navButtonSx = (theme, active, collapsed) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: collapsed ? 'center' : 'flex-start',
  gap: collapsed ? 0 : 1,
  px: collapsed ? 0 : 1.25,
  py: 0.625,
  minHeight: collapsed ? 40 : 36,
  border: 'none',
  font: 'inherit',
  textAlign: 'left',
  width: '100%',
  borderRadius: '999px',
  cursor: 'pointer',
  fontWeight: 600,
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
      title={collapsed ? undefined : item.label}
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
        <Typography variant="body2" noWrap sx={{ fontWeight: 600, minWidth: 0 }}>{item.label}</Typography>
      )}
    </Box>
  );
  return collapsed ? (
    <Tooltip title={item.label} placement="right">
      {button}
    </Tooltip>
  ) : button;
}

// Real subfolder hierarchy of the opened library: rendered only under the
// active library row and built from the already-loaded flat folder list.
function LibraryFolderTree({ folders, currentFolderId, expandedIds, onToggle, onOpen, depth = 0 }) {
  const theme = useTheme();
  return folders.map((folder) => {
    const children = folder._children || [];
    const expanded = expandedIds.has(String(folder.id));
    const active = String(currentFolderId || '') === String(folder.id);
    return (
      <Box key={folder.id}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            minWidth: 0,
            pl: 1 + depth * 1.75,
            pr: 0.5,
            borderRadius: '999px',
            bgcolor: active ? 'action.selected' : 'transparent',
            '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          {children.length > 0 ? (
            <IconButton
              size="small"
              aria-label={expanded ? `Свернуть папку ${folder.name}` : `Развернуть папку ${folder.name}`}
              aria-expanded={expanded}
              data-testid={`my-files-tree-toggle-${folder.id}`}
              onClick={() => onToggle(String(folder.id))}
              sx={{ width: 22, height: 22, mr: 0.25, flex: '0 0 auto' }}
            >
              {expanded
                ? <ExpandMoreRoundedIcon sx={{ fontSize: 16 }} />
                : <ChevronRightRoundedIcon sx={{ fontSize: 16 }} />}
            </IconButton>
          ) : (
            <Box sx={{ width: 22, mr: 0.25, flex: '0 0 auto' }} />
          )}
          <Box
            component="button"
            type="button"
            title={folder.name}
            onClick={() => onOpen(folder)}
            aria-current={active ? 'page' : undefined}
            data-testid={`my-files-tree-folder-${folder.id}`}
            sx={{
              ...navButtonSx(theme, active, false),
              minHeight: 30,
              py: 0.375,
              px: 0.75,
              gap: 0.75,
            }}
          >
            <FolderOutlinedIcon sx={{ fontSize: 16, flex: '0 0 auto' }} />
            <Typography variant="body2" noWrap sx={{ fontWeight: active ? 700 : 500, fontSize: '0.8125rem', minWidth: 0 }}>
              {folder.name}
            </Typography>
          </Box>
        </Box>
        {expanded && children.length > 0 ? (
          <LibraryFolderTree
            folders={children}
            currentFolderId={currentFolderId}
            expandedIds={expandedIds}
            onToggle={onToggle}
            onOpen={onOpen}
            depth={depth + 1}
          />
        ) : null}
      </Box>
    );
  });
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
  libraryFolders = [],
  currentFolderId = null,
  onLibraryFolderOpen,
  quota = null,
  quotaLoading = false,
  isLibraryView = false,
}) {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const [createMenuAnchor, setCreateMenuAnchor] = useState(null);
  const [librariesExpanded, setLibrariesExpanded] = useState(() => (
    window.localStorage.getItem(LIBRARIES_EXPANDED_KEY) !== '0'
  ));
  const [librariesFlyoutAnchor, setLibrariesFlyoutAnchor] = useState(null);
  const [treeExpandedIds, setTreeExpandedIds] = useState(() => new Set());

  const toggleLibrariesExpanded = () => {
    setLibrariesExpanded((current) => {
      const next = !current;
      try { window.localStorage.setItem(LIBRARIES_EXPANDED_KEY, next ? '1' : '0'); } catch { /* noop */ }
      return next;
    });
  };

  const quotaUsed = Number(quota?.used_bytes || 0);
  const quotaLimit = Number(quota?.limit_bytes || 0);
  const quotaPercent = quotaLimit > 0 ? Math.min(100, Math.round((quotaUsed / quotaLimit) * 100)) : 0;

  // Tree of plain folders inside the active library — real parent_id links only.
  const libraryTree = useMemo(() => {
    const byParent = new Map();
    libraryFolders.forEach((folder) => {
      const parentId = String(folder?.parent_id || '');
      if (!byParent.has(parentId)) byParent.set(parentId, []);
      byParent.get(parentId).push({ ...folder });
    });
    const attach = (parentId, guard) => (byParent.get(parentId) || []).map((folder) => (
      guard.has(String(folder.id))
        ? folder
        : { ...folder, _children: attach(String(folder.id), new Set([...guard, String(folder.id)])) }
    ));
    return attach('', new Set());
  }, [libraryFolders]);

  // Auto-expand the WHOLE ancestor chain of the folder that is currently
  // open. An ancestor that is already expanded must not stop the walk —
  // folders above it can still be collapsed (e.g. the user folded the root
  // while a mid node stayed in the expanded set).
  useEffect(() => {
    if (!currentFolderId) return;
    const byId = new Map(libraryFolders.map((folder) => [String(folder.id), folder]));
    setTreeExpandedIds((current) => {
      const next = new Set(current);
      const seen = new Set([String(currentFolderId)]);
      let node = byId.get(String(currentFolderId));
      let changed = false;
      while (node) {
        const parentId = String(node.parent_id || '');
        if (!parentId || seen.has(parentId)) break;
        seen.add(parentId);
        if (!next.has(parentId)) {
          next.add(parentId);
          changed = true;
        }
        node = byId.get(parentId);
      }
      return changed ? next : current;
    });
  }, [currentFolderId, libraryFolders]);

  const toggleTreeNode = (id) => {
    setTreeExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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

  const librariesSection = (
    <Stack spacing={0.25} component="nav" aria-label="Общие папки" data-testid="my-files-libraries">
      <Stack direction="row" alignItems="center" sx={{ px: 0.5, minHeight: 30 }}>
        <Tooltip title={librariesExpanded ? 'Свернуть список общих папок' : 'Развернуть список общих папок'}>
          <IconButton
            size="small"
            aria-label={librariesExpanded ? 'Свернуть список общих папок' : 'Развернуть список общих папок'}
            aria-expanded={librariesExpanded}
            aria-controls="my-files-libraries-list"
            data-testid="my-files-libraries-toggle"
            onClick={toggleLibrariesExpanded}
            sx={{ width: 24, height: 24, mr: 0.25 }}
          >
            {librariesExpanded
              ? <ExpandMoreRoundedIcon sx={{ fontSize: 17 }} />
              : <ChevronRightRoundedIcon sx={{ fontSize: 17 }} />}
          </IconButton>
        </Tooltip>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontWeight: 600, flex: 1, minWidth: 0, letterSpacing: '0.02em' }}
        >
          Общие папки
        </Typography>
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
              sx={{ width: 24, height: 24 }}
            >
              <AddRoundedIcon sx={{ fontSize: 17 }} />
            </IconButton>
          </Tooltip>
        ) : null}
      </Stack>
      {librariesExpanded ? (
        <Box id="my-files-libraries-list" sx={{ minWidth: 0 }}>
          {libraries.map((library) => {
            const active = String(activeLibraryId || '') === String(library.id);
            const children = active && libraryTree.length > 0 ? (
              <Box sx={{ mt: 0.25 }}>
                <LibraryFolderTree
                  folders={libraryTree}
                  currentFolderId={currentFolderId}
                  expandedIds={treeExpandedIds}
                  onToggle={toggleTreeNode}
                  onOpen={(folder) => {
                    onLibraryFolderOpen?.(folder);
                    onNavigate?.();
                  }}
                />
              </Box>
            ) : null;
            return (
              <Box key={library.id} sx={{ minWidth: 0 }}>
                <NavButton
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
                {children}
              </Box>
            );
          })}
        </Box>
      ) : null}
    </Stack>
  );

  return (
    <Paper
      variant={inDrawer ? 'elevation' : 'outlined'}
      elevation={0}
      sx={{
        ...getOfficePanelSx(ui),
        width: inDrawer ? '100%' : (collapsed ? 64 : 232),
        height: inDrawer ? '100%' : undefined,
        flexShrink: 0,
        p: collapsed ? 1 : 1.25,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.25,
        borderRadius: inDrawer ? 0 : undefined,
        border: inDrawer ? 'none' : undefined,
        boxShadow: inDrawer ? 'none' : undefined,
        position: inDrawer ? 'static' : { lg: 'sticky' },
        top: inDrawer ? 'auto' : { lg: 16 },
        alignSelf: inDrawer ? 'stretch' : { lg: 'flex-start' },
        maxHeight: inDrawer ? '100%' : { lg: 'calc(100vh - 32px)' },
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
                  width: 40,
                  height: 40,
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
              borderRadius: '14px',
              px: 2.25,
              py: 1,
              minHeight: 40,
              fontWeight: 600,
              fontSize: '0.875rem',
              boxShadow: theme.shadows[2],
              '&:hover': { boxShadow: theme.shadows[5] },
            }}
          >
            Создать
          </Button>
        )}
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
        spacing={0.25}
        component="nav"
        aria-label="Разделы файлов"
        sx={{ alignItems: collapsed ? 'center' : 'stretch' }}
      >
        {navItems.map((item) => (
          <NavButton key={item.key} item={item} collapsed={collapsed} theme={theme} onNavigate={onNavigate} />
        ))}
        {collapsed && libraries.length > 0 ? (
          <>
            <Tooltip title="Общие папки" placement="right">
              <span>
                <IconButton
                  aria-label="Общие папки"
                  aria-haspopup="menu"
                  data-testid="my-files-libraries-flyout"
                  onClick={(event) => setLibrariesFlyoutAnchor(event.currentTarget)}
                  sx={{ width: 40, height: 40, borderRadius: '999px' }}
                >
                  <FolderSharedOutlinedIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Menu
              anchorEl={librariesFlyoutAnchor}
              open={Boolean(librariesFlyoutAnchor)}
              onClose={() => setLibrariesFlyoutAnchor(null)}
              anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'left' }}
              MenuListProps={{ 'aria-label': 'Общие папки' }}
            >
              {libraries.map((library) => (
                <MenuItem
                  key={library.id}
                  selected={String(activeLibraryId || '') === String(library.id)}
                  data-testid={`my-files-library-${library.id}`}
                  onClick={() => {
                    setLibrariesFlyoutAnchor(null);
                    onLibraryOpen?.(library);
                    onNavigate?.();
                  }}
                >
                  <ListItemIcon><FolderSharedOutlinedIcon fontSize="small" /></ListItemIcon>
                  <ListItemText>{library.name}</ListItemText>
                </MenuItem>
              ))}
              {canManageLibraries ? [
                <Divider key="lib-div" />,
                <MenuItem
                  key="lib-add"
                  data-testid="my-files-library-add"
                  onClick={() => {
                    setLibrariesFlyoutAnchor(null);
                    onLibraryCreate?.();
                    onNavigate?.();
                  }}
                >
                  <ListItemIcon><AddRoundedIcon fontSize="small" /></ListItemIcon>
                  <ListItemText>Создать общую папку</ListItemText>
                </MenuItem>,
              ] : null}
            </Menu>
          </>
        ) : null}
      </Stack>

      {!collapsed && (libraries.length > 0 || canManageLibraries) ? (
        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', mx: -0.5, px: 0.5 }}>
          {librariesSection}
        </Box>
      ) : null}

      {collapsed && quota && quotaLimit > 0 ? (
        <Tooltip
          title={`${isLibraryView ? 'Общая папка' : 'Хранилище'}: ${formatFileSize(quotaUsed)} из ${formatFileSize(quotaLimit)}`}
          placement="right"
        >
          <Box sx={{ width: 40, alignSelf: 'center' }}>
            <LinearProgress
              variant="determinate"
              value={quotaPercent}
              aria-label="Занятое место"
              sx={{ height: 4, borderRadius: 1 }}
            />
          </Box>
        </Tooltip>
      ) : null}

      {!collapsed && (quota || quotaLoading) ? (
        <Box data-testid="my-files-quota">
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
              ? <LinearProgress variant="determinate" value={quotaPercent} sx={{ height: 5, borderRadius: 1 }} />
              : null
          ) : (
            <Skeleton variant="rounded" height={5} />
          )}
        </Box>
      ) : null}

      {onToggleCollapse ? (
        <Box
          sx={{
            borderTop: `1px solid ${theme.palette.divider}`,
            pt: 0.75,
            display: 'flex',
            justifyContent: collapsed ? 'center' : 'flex-end',
          }}
        >
          <Tooltip title={collapsed ? 'Развернуть панель файлов' : 'Свернуть панель файлов'} placement={collapsed ? 'right' : 'top'}>
            <IconButton
              size="small"
              aria-label={collapsed ? 'Развернуть панель файлов' : 'Свернуть панель файлов'}
              data-testid="my-files-nav-collapse-toggle"
              onClick={onToggleCollapse}
              sx={{ width: 32, height: 32 }}
            >
              {collapsed
                ? <ChevronRightRoundedIcon fontSize="small" />
                : <ChevronLeftRoundedIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        </Box>
      ) : null}
    </Paper>
  );
}
