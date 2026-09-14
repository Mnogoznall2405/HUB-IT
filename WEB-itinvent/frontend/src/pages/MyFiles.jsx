import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import useRequestGuard from '../lib/useRequestGuard';
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  LinearProgress,
  Link,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Select,
  Skeleton,
  Stack,
  TableSortLabel,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import CloudUploadOutlinedIcon from '@mui/icons-material/CloudUploadOutlined';
import CreateNewFolderOutlinedIcon from '@mui/icons-material/CreateNewFolderOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import DriveFileMoveOutlinedIcon from '@mui/icons-material/DriveFileMoveOutlined';
import DriveFileRenameOutlineRoundedIcon from '@mui/icons-material/DriveFileRenameOutlineRounded';
import DriveFolderUploadOutlinedIcon from '@mui/icons-material/DriveFolderUploadOutlined';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import LinkOutlinedIcon from '@mui/icons-material/LinkOutlined';
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import StarOutlineRoundedIcon from '@mui/icons-material/StarOutlineRounded';
import StarRoundedIcon from '@mui/icons-material/StarRounded';
import GridViewOutlinedIcon from '@mui/icons-material/GridViewOutlined';
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';
import ShareOutlinedIcon from '@mui/icons-material/ShareOutlined';
import ViewListOutlinedIcon from '@mui/icons-material/ViewListOutlined';
import MainLayout from '../components/layout/MainLayout';
import MyFilesShareDialog from '../components/myFiles/MyFilesShareDialog';
import DocumentPreviewDialog from '../components/documentPreview/DocumentPreviewDialog';
import FileActionsContextMenu, {
  getFileActionsAnchorPosition,
  isFileActionsKeyboardShortcut,
} from '../components/fileActions/FileActionsContextMenu';
import PageShell from '../components/layout/PageShell';
import {
  formatMyFilesUploadLimitLabel,
  myFilesAPI,
  myFilesRetentionOptions,
} from '../api/myFiles';
import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';
import {
  formatFileSize,
  getMyFileName,
  isMyFilePreviewSupported,
} from '../lib/myFilesPreview';
import { useMyFilesDownload } from './myFiles/useMyFilesDownload';
import { useMyFilesPreviewController } from './myFiles/useMyFilesPreviewController';
import { useMyFilesShares } from './myFiles/useMyFilesShares';
import { useMyFilesUpload } from './myFiles/useMyFilesUpload';
import { collectDataTransferFiles } from '../lib/myFilesFolderZip';
import {
  FileCard,
  FileRow,
  FolderCard,
  FolderRow,
} from '../components/myFiles/MyFilesListItems';
import {
  ACTIVE_PROCESSING_STATUSES,
  getFileVisualColors,
  getFileVisualMeta,
  READY_STATUSES,
} from '../components/myFiles/myFilesVisual';
import { buildOfficeUiTokens, getOfficePanelSx } from '../theme/officeUiTokens';

const reconcileById = (previous, next) => {
  const previousById = new Map(previous.map((entry) => [String(entry?.id), entry]));
  let changed = previous.length !== next.length;
  const merged = next.map((entry) => {
    const old = previousById.get(String(entry?.id));
    if (!old) {
      changed = true;
      return entry;
    }
    const keys = new Set([...Object.keys(old), ...Object.keys(entry)]);
    const same = [...keys].every((key) => old[key] === entry[key]);
    if (!same) changed = true;
    return same ? old : entry;
  });
  return changed ? merged : previous;
};


export default function MyFiles() {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('my_files.write');
  const canShare = hasPermission('my_files.share');
  const [searchParams, setSearchParams] = useSearchParams();
  const viewParam = String(searchParams.get('view') || '');
  const isTrashView = viewParam === 'trash';
  const isRecentView = viewParam === 'recent';
  const isFavoritesView = viewParam === 'favorites';
  const isSpecialView = isTrashView || isRecentView || isFavoritesView;
  const listView = isRecentView ? 'recent' : isFavoritesView ? 'favorites' : '';
  const currentFolderId = isSpecialView ? null : (searchParams.get('folder') || null);
  const [items, setItems] = useState([]);
  const [folders, setFolders] = useState([]);
  const [breadcrumbs, setBreadcrumbs] = useState([]);
  const [allFolders, setAllFolders] = useState([]);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [createMenuAnchor, setCreateMenuAnchor] = useState(null);
  const [folderNameInput, setFolderNameInput] = useState('');
  const [renameDialog, setRenameDialog] = useState({ open: false, kind: '', id: '', name: '' });
  const [moveDialog, setMoveDialog] = useState({ open: false, kind: '', id: '', targetFolderId: '' });
  const [folderActionsMenu, setFolderActionsMenu] = useState({ folder: null, anchorPosition: null });
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [sortField, setSortField] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const [searchQuery, setSearchQuery] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [viewMode, setViewMode] = useState(() => (
    window.localStorage.getItem('my-files-view') === 'grid' ? 'grid' : 'list'
  ));
  const [showRetentionNotice, setShowRetentionNotice] = useState(() => (
    window.localStorage.getItem('my-files-retention-notice-dismissed') !== '1'
  ));
  const [dropTargetFolderId, setDropTargetFolderId] = useState('');
  const [thumbs, setThumbs] = useState({});
  const thumbsRef = useRef({});
  const [quota, setQuota] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fileActionsMenu, setFileActionsMenu] = useState({ item: null, anchorPosition: null });
  const { notifySuccess, notifyWarning, notifyApiError } = useNotification();
  const { downloadingFileId, downloadFile: handleDownload } = useMyFilesDownload({ notifyApiError, notifySuccess, notifyWarning });
  const {
    documentPreview,
    openDocumentPreview,
    closeDocumentPreview,
    refreshDocumentPreview,
    downloadDocumentPreviewPdf,
  } = useMyFilesPreviewController({ downloadFile: handleDownload });

  const hasProcessingFiles = useMemo(
    () => items.some((item) => ACTIVE_PROCESSING_STATUSES.has(String(item?.status || '').toLowerCase())),
    [items],
  );

  const beginLoad = useRequestGuard();
  const activeLoadsRef = useRef(0);
  const loadData = useCallback(async ({ silent = false } = {}) => {
    const isCurrent = beginLoad();
    activeLoadsRef.current += 1;
    if (!silent) setLoading(true);
    setRefreshing(true);
    try {
      const [filesPayload, quotaPayload, foldersPayload] = await Promise.all([
        isTrashView && myFilesAPI.listTrash
          ? myFilesAPI.listTrash()
          : myFilesAPI.listFiles({ folderId: currentFolderId, view: listView }),
        myFilesAPI.getQuota(),
        myFilesAPI.listFolders ? myFilesAPI.listFolders() : Promise.resolve({ items: [] }),
      ]);
      if (!isCurrent()) return;
      const nextItems = Array.isArray(filesPayload?.items) ? filesPayload.items : [];
      const nextFolders = Array.isArray(filesPayload?.folders) ? filesPayload.folders : [];
      const nextAllFolders = Array.isArray(foldersPayload?.items) ? foldersPayload.items : [];
      setItems((prev) => reconcileById(prev, nextItems));
      setFolders((prev) => reconcileById(prev, nextFolders));
      setBreadcrumbs((prev) => reconcileById(prev, Array.isArray(filesPayload?.breadcrumbs) ? filesPayload.breadcrumbs : []));
      setAllFolders((prev) => reconcileById(prev, nextAllFolders));
      setQuota((prev) => {
        if (!quotaPayload) return null;
        if (prev && Object.keys(quotaPayload).every((key) => prev[key] === quotaPayload[key])) return prev;
        return quotaPayload;
      });
    } catch (error) {
      if (!isCurrent()) return;
      notifyApiError(error, 'Не удалось загрузить список файлов.', { dedupeMode: 'recent' });
    } finally {
      activeLoadsRef.current -= 1;
      if (isCurrent()) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [beginLoad, currentFolderId, isTrashView, listView, notifyApiError]);

  const {
    uploading,
    readingDrop,
    uploadProgress,
    uploadDialogOpen,
    pendingUploadFiles,
    pendingFolderFiles,
    pendingFolderSummary,
    retentionDays,
    setRetentionDays,
    dragActive,
    setDragActive,
    fileInputRef,
    folderInputRef,
    openUploadDialog,
    closeUploadDialog,
    confirmUpload,
    handleInputChange,
    handleFolderInputChange,
    handleDrop,
  } = useMyFilesUpload({
    canWrite,
    currentFolderId,
    isSpecialView,
    allFolders,
    loadData,
    notifySuccess,
    notifyWarning,
    notifyApiError,
  });

  const {
    shareDialog,
    setShareDialog,
    folderShareDialog,
    setFolderShareDialog,
    shareFile: handleShare,
    revokeShare: handleRevokeShare,
    shareFolder: handleFolderShare,
    revokeFolderShare: handleRevokeFolderShare,
  } = useMyFilesShares({ loadData, notifySuccess, notifyWarning, notifyApiError });

  const navigateToFolder = useCallback((folderId) => {
    const next = folderId ? { folder: folderId } : {};
    setSearchParams(next, { replace: false });
  }, [setSearchParams]);

  const navigateToView = useCallback((view) => {
    setSearchParams(view ? { view } : {}, { replace: false });
  }, [setSearchParams]);

  const navigateToTrash = useCallback(() => {
    navigateToView('trash');
  }, [navigateToView]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const input = folderInputRef.current;
    if (!input) return;
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
  }, []);

  useEffect(() => {
    if (!hasProcessingFiles) return undefined;
    const timer = window.setInterval(() => {
      if (activeLoadsRef.current === 0) void loadData({ silent: true });
    }, 4000);
    return () => window.clearInterval(timer);
  }, [hasProcessingFiles, loadData]);

  const openFileActionsMenu = useCallback((event, item) => {
    event.preventDefault();
    event.stopPropagation();
    setFileActionsMenu({ item, anchorPosition: getFileActionsAnchorPosition(event) });
  }, []);

  const closeFileActionsMenu = useCallback(() => {
    setFileActionsMenu({ item: null, anchorPosition: null });
  }, []);


  const handleToggleFavorite = useCallback(async (entry, kind) => {
    const id = String(entry?.id || '');
    const next = !entry?.is_favorite;
    const isFolder = kind === 'folder';
    const setList = isFolder ? setFolders : setItems;
    if (isFavoritesView && !next) {
      setList((prev) => prev.filter((entryItem) => String(entryItem.id) !== id));
    } else {
      setList((prev) => prev.map((entryItem) => (
        String(entryItem.id) === id ? { ...entryItem, is_favorite: next } : entryItem
      )));
    }
    try {
      if (isFolder) {
        await myFilesAPI.updateFolder(id, { isFavorite: next });
      } else {
        await myFilesAPI.updateFile(id, { isFavorite: next });
      }
    } catch (error) {
      await loadData({ silent: true });
      notifyApiError(error, 'Не удалось обновить избранное.', { dedupeMode: 'none' });
    }
  }, [isFavoritesView, loadData, notifyApiError]);

  const handleFolderArchive = useCallback(async (folder) => {
    try {
      const grant = await myFilesAPI.createFolderArchiveGrant(folder.id);
      const downloadUrl = myFilesAPI.buildDownloadGrantUrl(grant?.download_path);
      if (!downloadUrl || !myFilesAPI.triggerNativeDownload(downloadUrl)) {
        throw new Error('Не удалось начать скачивание');
      }
      notifySuccess(`Архив папки «${folder.name || 'папка'}» готовится и начнёт скачиваться.`, {
        source: 'my-files-folder-archive', dedupeMode: 'none',
      });
    } catch (error) {
      notifyApiError(error, 'Не удалось скачать папку архивом.', { dedupeMode: 'none' });
    }
  }, [notifyApiError, notifySuccess]);

  const handleDelete = useCallback(async (item) => {
    if (!window.confirm(`Удалить файл "${item.original_file_name}"?`)) return;
    try {
      await myFilesAPI.deleteFile(item.id);
      notifySuccess('Файл удалён.', { source: 'my-files-delete', dedupeMode: 'none' });
      await loadData({ silent: true });
    } catch (error) {
      notifyApiError(error, 'Не удалось удалить файл.', { dedupeMode: 'none' });
    }
  }, [loadData, notifyApiError, notifySuccess]);

  const folderPathLabels = useMemo(() => {
    const byId = new Map(allFolders.map((folder) => [String(folder.id), folder]));
    const labels = new Map();
    const buildPath = (folder, guard = new Set()) => {
      const id = String(folder?.id || '');
      if (!id || guard.has(id)) return String(folder?.name || '');
      guard.add(id);
      const parent = byId.get(String(folder?.parent_id || ''));
      const prefix = parent ? `${buildPath(parent, guard)} / ` : '';
      const label = `${prefix}${folder.name}`;
      labels.set(id, label);
      return label;
    };
    allFolders.forEach((folder) => { buildPath(folder); });
    return labels;
  }, [allFolders]);

  const openFolderActionsMenu = useCallback((event, folder) => {
    event.preventDefault();
    event.stopPropagation();
    setFolderActionsMenu({ folder, anchorPosition: getFileActionsAnchorPosition(event) });
  }, []);

  const closeFolderActionsMenu = useCallback(() => {
    setFolderActionsMenu({ folder: null, anchorPosition: null });
  }, []);

  const handleCreateFolder = useCallback(async () => {
    const name = String(folderNameInput || '').trim();
    if (!name) return;
    try {
      await myFilesAPI.createFolder({ name, parentId: currentFolderId });
      setCreateFolderOpen(false);
      setFolderNameInput('');
      notifySuccess('Папка создана.', { source: 'my-files-folder', dedupeMode: 'none' });
      await loadData({ silent: true });
    } catch (error) {
      notifyApiError(error, 'Не удалось создать папку.', { dedupeMode: 'none' });
    }
  }, [currentFolderId, folderNameInput, loadData, notifyApiError, notifySuccess]);

  const openRenameDialog = useCallback((kind, id, currentName) => {
    setRenameDialog({ open: true, kind, id, name: String(currentName || '') });
  }, []);

  const confirmRename = useCallback(async () => {
    const name = String(renameDialog.name || '').trim();
    if (!name || !renameDialog.id) return;
    try {
      if (renameDialog.kind === 'folder') {
        await myFilesAPI.updateFolder(renameDialog.id, { name });
      } else {
        await myFilesAPI.updateFile(renameDialog.id, { name });
      }
      setRenameDialog({ open: false, kind: '', id: '', name: '' });
      notifySuccess('Переименовано.', { source: 'my-files-rename', dedupeMode: 'none' });
      await loadData({ silent: true });
    } catch (error) {
      notifyApiError(error, 'Не удалось переименовать.', { dedupeMode: 'none' });
    }
  }, [loadData, notifyApiError, notifySuccess, renameDialog]);

  const openMoveDialog = useCallback((kind, id) => {
    setMoveDialog({ open: true, kind, id, targetFolderId: '' });
  }, []);

  const confirmMove = useCallback(async () => {
    const target = moveDialog.targetFolderId || null;
    if (!moveDialog.id) return;
    try {
      if (moveDialog.kind === 'folder') {
        await myFilesAPI.updateFolder(moveDialog.id, { parentId: target });
      } else {
        await myFilesAPI.updateFile(moveDialog.id, { folderId: target });
      }
      setMoveDialog({ open: false, kind: '', id: '', targetFolderId: '' });
      notifySuccess('Объект перемещён.', { source: 'my-files-move', dedupeMode: 'none' });
      await loadData({ silent: true });
    } catch (error) {
      notifyApiError(error, 'Не удалось переместить.', { dedupeMode: 'none' });
    }
  }, [loadData, moveDialog, notifyApiError, notifySuccess]);

  const handleDeleteFolder = useCallback(async (folder) => {
    const name = String(folder?.name || '');
    if (!window.confirm(`Удалить папку "${name}" вместе со всем содержимым?`)) return;
    try {
      await myFilesAPI.deleteFolder(folder.id);
      notifySuccess('Папка удалена.', { source: 'my-files-folder-delete', dedupeMode: 'none' });
      await loadData({ silent: true });
    } catch (error) {
      notifyApiError(error, 'Не удалось удалить папку.', { dedupeMode: 'none' });
    }
  }, [loadData, notifyApiError, notifySuccess]);

  const handleRestoreEntry = useCallback(async (kind, id) => {
    try {
      if (kind === 'folder') {
        await myFilesAPI.restoreFolder(id);
      } else {
        await myFilesAPI.restoreFile(id);
      }
      notifySuccess('Восстановлено из корзины.', { source: 'my-files-restore', dedupeMode: 'none' });
      await loadData({ silent: true });
    } catch (error) {
      notifyApiError(error, 'Не удалось восстановить.', { dedupeMode: 'none' });
    }
  }, [loadData, notifyApiError, notifySuccess]);

  const handlePurgeEntry = useCallback(async (kind, id, name) => {
    const label = kind === 'folder' ? `папку «${name}»` : `файл «${name}»`;
    if (!window.confirm(`Удалить ${label} навсегда? Восстановить будет нельзя.`)) return;
    try {
      if (kind === 'folder') {
        await myFilesAPI.purgeFolder(id);
      } else {
        await myFilesAPI.purgeFile(id);
      }
      notifySuccess('Удалено навсегда.', { source: 'my-files-purge', dedupeMode: 'none' });
      await loadData({ silent: true });
    } catch (error) {
      notifyApiError(error, 'Не удалось удалить навсегда.', { dedupeMode: 'none' });
    }
  }, [loadData, notifyApiError, notifySuccess]);

  const handleEmptyTrash = useCallback(async () => {
    if (!window.confirm('Очистить корзину? Все объекты в ней будут удалены навсегда.')) return;
    try {
      await myFilesAPI.emptyTrash();
      notifySuccess('Корзина очищена.', { source: 'my-files-empty-trash', dedupeMode: 'none' });
      await loadData({ silent: true });
    } catch (error) {
      notifyApiError(error, 'Не удалось очистить корзину.', { dedupeMode: 'none' });
    }
  }, [loadData, notifyApiError, notifySuccess]);

  const handleMoveFileToFolder = useCallback(async (fileId, folderId) => {
    try {
      await myFilesAPI.updateFile(fileId, { folderId });
      notifySuccess('Файл перемещён.', { source: 'my-files-move', dedupeMode: 'none' });
      await loadData({ silent: true });
    } catch (error) {
      notifyApiError(error, 'Не удалось переместить файл.', { dedupeMode: 'none' });
    }
  }, [loadData, notifyApiError, notifySuccess]);

  const folderDropProps = useCallback((folder) => ({
    onDragOver: (event) => {
      if (isTrashView || !canWrite) return;
      const types = event.dataTransfer?.types;
      if (!types) return;
      if (types.includes('application/x-hubit-file') || types.includes('Files')) {
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = types.includes('application/x-hubit-file') ? 'move' : 'copy';
        setDropTargetFolderId(String(folder.id));
      }
    },
    onDragLeave: (event) => {
      event.stopPropagation();
      setDropTargetFolderId('');
    },
    onDrop: (event) => {
      if (isTrashView || !canWrite) return;
      const internalId = event.dataTransfer.getData('application/x-hubit-file');
      const osFiles = event.dataTransfer.files;
      const hasOsItems = (event.dataTransfer.items?.length || 0) > 0 || (osFiles?.length || 0) > 0;
      if (!internalId && !hasOsItems) return;
      event.preventDefault();
      event.stopPropagation();
      setDropTargetFolderId('');
      setDragActive(false);
      if (internalId) {
        void handleMoveFileToFolder(internalId, folder.id);
      } else {
        void collectDataTransferFiles(event.dataTransfer)
          .then(({ files, asFolder }) => {
            openUploadDialog(files, { asFolder, targetFolderId: folder.id });
          })
          .catch((error) => {
            notifyApiError(error, 'Не удалось прочитать перетащенную папку.', { dedupeMode: 'none' });
          });
      }
    },
  }), [canWrite, handleMoveFileToFolder, isTrashView, notifyApiError, openUploadDialog]);

  const fileDragProps = useCallback((item) => ({
    draggable: true,
    onDragStart: (event) => {
      event.dataTransfer.setData('application/x-hubit-file', String(item.id));
      event.dataTransfer.effectAllowed = 'move';
    },
  }), []);

  useEffect(() => () => {
    Object.values(thumbsRef.current).forEach((value) => {
      if (typeof value === 'string' && value.startsWith('blob:')) URL.revokeObjectURL(value);
    });
  }, []);

  const moveDialogOptions = useMemo(() => {
    const excluded = new Set();
    const seedIds = moveDialog.kind === 'folder' && moveDialog.id
      ? [String(moveDialog.id)]
      : moveDialog.kind === 'bulk'
        ? [...selectedKeys]
          .filter((key) => key.startsWith('folder:'))
          .map((key) => key.slice(7))
        : [];
    seedIds.forEach((id) => excluded.add(String(id)));
    if (excluded.size > 0) {
      let changed = true;
      while (changed) {
        changed = false;
        for (const folder of allFolders) {
          const id = String(folder.id);
          const pid = String(folder.parent_id || '');
          if (!excluded.has(id) && excluded.has(pid)) {
            excluded.add(id);
            changed = true;
          }
        }
      }
    }
    return allFolders.filter((folder) => !excluded.has(String(folder.id)));
  }, [allFolders, moveDialog.id, moveDialog.kind, selectedKeys]);

  const clearSelection = useCallback(() => setSelectedKeys(new Set()), []);

  useEffect(() => {
    clearSelection();
  }, [currentFolderId, viewParam, clearSelection]);

  const toggleSelected = useCallback((key) => {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const matchesSearch = useCallback((name) => {
    const query = String(searchQuery || '').trim().toLowerCase();
    if (!query) return true;
    return String(name || '').toLowerCase().includes(query);
  }, [searchQuery]);

  const compareRows = useCallback((a, b) => {
    let result = 0;
    if (sortField === 'size') {
      result = Number(a.original_size_bytes || 0) - Number(b.original_size_bytes || 0);
    } else if (sortField === 'updated') {
      result = String(a.updated_at || a.created_at || '').localeCompare(String(b.updated_at || b.created_at || ''));
    } else {
      result = String(a.name || a.original_file_name || '').localeCompare(
        String(b.name || b.original_file_name || ''), 'ru', { sensitivity: 'base' },
      );
    }
    return sortDir === 'desc' ? -result : result;
  }, [sortDir, sortField]);

  const visibleFolders = useMemo(
    () => folders.filter((folder) => matchesSearch(folder.name)).sort(compareRows),
    [compareRows, folders, matchesSearch],
  );
  const visibleItems = useMemo(
    () => items.filter((item) => matchesSearch(item.original_file_name)).sort(compareRows),
    [compareRows, items, matchesSearch],
  );

  const toggleSort = useCallback((field) => {
    if (sortField === field) {
      setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }, [sortField]);

  const allRowKeys = useMemo(
    () => [
      ...visibleFolders.map((folder) => `folder:${folder.id}`),
      ...visibleItems.map((item) => `file:${item.id}`),
    ],
    [visibleFolders, visibleItems],
  );
  const allSelected = allRowKeys.length > 0 && allRowKeys.every((key) => selectedKeys.has(key));
  const someSelected = allRowKeys.some((key) => selectedKeys.has(key));

  const toggleSelectAll = useCallback(() => {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (allRowKeys.every((key) => next.has(key))) {
        allRowKeys.forEach((key) => next.delete(key));
      } else {
        allRowKeys.forEach((key) => next.add(key));
      }
      return next;
    });
  }, [allRowKeys]);

  const selectedFolders = useMemo(
    () => visibleFolders.filter((folder) => selectedKeys.has(`folder:${folder.id}`)),
    [selectedKeys, visibleFolders],
  );
  const selectedFiles = useMemo(
    () => items.filter((item) => selectedKeys.has(`file:${item.id}`)),
    [items, selectedKeys],
  );

  const thumbObserverRef = useRef(null);
  const thumbNodesRef = useRef(new Map());

  const requestThumb = useCallback((item) => {
    const id = String(item?.id || '');
    if (!id || thumbsRef.current[id]) return;
    if (String(item.preview_kind || '') !== 'image' || !item.preview_available) return;
    thumbsRef.current[id] = 'loading';
    myFilesAPI.downloadPreviewContent(id, { variant: 'thumb' })
      .then((response) => {
        const url = URL.createObjectURL(response.data);
        thumbsRef.current[id] = url;
        setThumbs((current) => ({ ...current, [id]: url }));
      })
      .catch(() => {
        delete thumbsRef.current[id];
      });
  }, []);

  const observeThumbTarget = useCallback((node, item) => {
    if (!node || isTrashView || viewMode !== 'grid') return;
    if (String(item.preview_kind || '') !== 'image' || !item.preview_available) return;
    const id = String(item.id || '');
    if (!id || thumbsRef.current[id]) return;
    if (!thumbObserverRef.current) {
      thumbObserverRef.current = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const target = thumbNodesRef.current.get(entry.target);
          if (target) requestThumb(target);
          thumbObserverRef.current?.unobserve(entry.target);
          thumbNodesRef.current.delete(entry.target);
        }
      }, { rootMargin: '300px' });
    }
    thumbNodesRef.current.set(node, item);
    thumbObserverRef.current.observe(node);
  }, [isTrashView, requestThumb, viewMode]);

  useEffect(() => () => {
    thumbObserverRef.current?.disconnect();
    thumbNodesRef.current.clear();
  }, []);

  useEffect(() => {
    const visibleIds = new Set(visibleItems.map((item) => String(item.id || '')));
    Object.entries(thumbsRef.current).forEach(([id, value]) => {
      if (visibleIds.has(id)) return;
      if (typeof value === 'string' && value.startsWith('blob:')) URL.revokeObjectURL(value);
      delete thumbsRef.current[id];
    });
    thumbNodesRef.current.forEach((item, node) => {
      if (!node.isConnected || !visibleIds.has(String(item?.id || ''))) {
        thumbObserverRef.current?.unobserve(node);
        thumbNodesRef.current.delete(node);
      }
    });
    setThumbs((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([id]) => visibleIds.has(id)));
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [isTrashView, viewMode, visibleItems]);

  const handleBulkDelete = useCallback(async () => {
    if (selectedKeys.size === 0 || bulkBusy) return;
    const count = selectedFolders.length + selectedFiles.length;
    if (!window.confirm(`Удалить выбранные объекты (${count} шт.)? Содержимое папок будет удалено вместе с ними.`)) return;
    setBulkBusy(true);
    try {
      for (const folder of selectedFolders) {
        await myFilesAPI.deleteFolder(folder.id);
      }
      for (const file of selectedFiles) {
        await myFilesAPI.deleteFile(file.id);
      }
      notifySuccess(`Удалено объектов: ${count}.`, { source: 'my-files-bulk-delete', dedupeMode: 'none' });
      clearSelection();
      await loadData({ silent: true });
    } catch (error) {
      notifyApiError(error, 'Не удалось удалить выбранные объекты.', { dedupeMode: 'none' });
    } finally {
      setBulkBusy(false);
    }
  }, [bulkBusy, clearSelection, loadData, notifyApiError, notifySuccess, selectedFiles, selectedFolders, selectedKeys.size]);

  const handleBulkDownload = useCallback(async () => {
    if (selectedFiles.length === 0) return;
    for (const file of selectedFiles) {
      void handleDownload(file);
    }
  }, [handleDownload, selectedFiles]);

  const openBulkMoveDialog = useCallback(() => {
    setMoveDialog({ open: true, kind: 'bulk', id: '', targetFolderId: '' });
  }, []);

  const handleBulkMove = useCallback(async (targetFolderId) => {
    if (selectedKeys.size === 0 || bulkBusy) return;
    setBulkBusy(true);
    try {
      for (const folder of selectedFolders) {
        await myFilesAPI.updateFolder(folder.id, { parentId: targetFolderId });
      }
      for (const file of selectedFiles) {
        await myFilesAPI.updateFile(file.id, { folderId: targetFolderId });
      }
      notifySuccess('Выбранные объекты перемещены.', { source: 'my-files-bulk-move', dedupeMode: 'none' });
      clearSelection();
      setMoveDialog({ open: false, kind: '', id: '', targetFolderId: '' });
      await loadData({ silent: true });
    } catch (error) {
      notifyApiError(error, 'Не удалось переместить выбранные объекты.', { dedupeMode: 'none' });
    } finally {
      setBulkBusy(false);
    }
  }, [bulkBusy, clearSelection, loadData, notifyApiError, notifySuccess, selectedFiles, selectedFolders, selectedKeys.size]);

  const quotaUsed = Number(quota?.used_bytes || 0);
  const quotaLimit = Number(quota?.limit_bytes || 0);
  const quotaPercent = quotaLimit > 0 ? Math.min(100, Math.round((quotaUsed / quotaLimit) * 100)) : 0;

  return (
    <MainLayout showDatabaseSelector={false}>
      <PageShell>
        <Box
          sx={{
            display: 'flex',
            gap: 2.5,
            alignItems: 'stretch',
            flexDirection: { xs: 'column', lg: 'row' },
          }}
        >
          <Paper
            variant="outlined"
            sx={{
              ...getOfficePanelSx(ui),
              width: { lg: 252 },
              flexShrink: 0,
              p: 2,
              alignSelf: { lg: 'flex-start' },
              position: { lg: 'sticky' },
              top: { lg: 16 },
              display: 'flex',
              flexDirection: { xs: 'row', lg: 'column' },
              flexWrap: { xs: 'wrap', lg: 'nowrap' },
              gap: 2,
            }}
          >
            <Box sx={{ minWidth: { lg: '100%' } }}>
              <Button
                variant="contained"
                startIcon={<AddRoundedIcon />}
                onClick={(event) => setCreateMenuAnchor(event.currentTarget)}
                disabled={!canWrite || uploading || readingDrop || isSpecialView}
                data-testid="my-files-create-button"
                sx={{
                  borderRadius: '999px',
                  px: 2.5,
                  py: 1.1,
                  fontWeight: 700,
                  boxShadow: 'none',
                }}
              >
                Создать
              </Button>
              <Menu
                anchorEl={createMenuAnchor}
                open={Boolean(createMenuAnchor)}
                onClose={() => setCreateMenuAnchor(null)}
              >
                <MenuItem
                  data-testid="my-files-create-folder-button"
                  onClick={() => {
                    setCreateMenuAnchor(null);
                    setFolderNameInput('');
                    setCreateFolderOpen(true);
                  }}
                >
                  <ListItemIcon><CreateNewFolderOutlinedIcon fontSize="small" /></ListItemIcon>
                  <ListItemText>Новая папка</ListItemText>
                </MenuItem>
                <MenuItem
                  data-testid="my-files-upload-files-menu"
                  onClick={() => {
                    setCreateMenuAnchor(null);
                    fileInputRef.current?.click();
                  }}
                >
                  <ListItemIcon><CloudUploadOutlinedIcon fontSize="small" /></ListItemIcon>
                  <ListItemText>Загрузить файлы</ListItemText>
                </MenuItem>
                <MenuItem
                  data-testid="my-files-upload-folder-button"
                  onClick={() => {
                    setCreateMenuAnchor(null);
                    folderInputRef.current?.click();
                  }}
                >
                  <ListItemIcon><DriveFolderUploadOutlinedIcon fontSize="small" /></ListItemIcon>
                  <ListItemText>Загрузить папку</ListItemText>
                </MenuItem>
              </Menu>
            </Box>

            <Stack
              spacing={0.5}
              component="nav"
              aria-label="Разделы файлов"
              sx={{ minWidth: { lg: '100%' }, flex: { xs: 1, lg: 'unset' } }}
            >
              {[
                {
                  key: 'drive',
                  icon: <FolderOutlinedIcon fontSize="small" />,
                  label: 'Мой диск',
                  active: !currentFolderId && !isSpecialView,
                  onClick: () => navigateToFolder(null),
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
              ].map((item) => (
                <Box
                  key={item.key}
                  component="button"
                  type="button"
                  onClick={item.onClick}
                  aria-current={item.active ? 'page' : undefined}
                  data-testid={item.testId}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.25,
                    px: 1.5,
                    py: 1,
                    border: 'none',
                    font: 'inherit',
                    textAlign: 'left',
                    width: '100%',
                    borderRadius: '999px',
                    cursor: 'pointer',
                    fontWeight: 700,
                    color: item.active ? 'primary.main' : 'text.primary',
                    bgcolor: item.active ? alpha(theme.palette.primary.main, 0.12) : 'transparent',
                    '&:hover': { bgcolor: 'action.hover' },
                    '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 },
                  }}
                >
                  {item.icon}
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>{item.label}</Typography>
                </Box>
              ))}
            </Stack>

            <Box sx={{ minWidth: { xs: '100%', lg: '100%' }, mt: { lg: 1.5 } }}>
              <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
                <Typography variant="caption" color="text.secondary">Хранилище</Typography>
                <Typography variant="caption" sx={{ fontWeight: 600 }}>
                  {formatFileSize(quotaUsed)} / {formatFileSize(quotaLimit)}
                </Typography>
              </Stack>
              <LinearProgress variant="determinate" value={quotaPercent} sx={{ height: 6, borderRadius: 1 }} />
            </Box>
          </Paper>

          <Box
            sx={{
              flex: 1,
              minWidth: 0,
              borderRadius: 2,
              position: 'relative',
              outline: dragActive ? `2px dashed ${theme.palette.primary.main}` : '2px dashed transparent',
              outlineOffset: -6,
              bgcolor: dragActive ? alpha(theme.palette.primary.main, 0.06) : 'transparent',
              transition: 'background-color 0.15s ease',
            }}
            data-testid="my-files-drop-zone"
            onDragOver={(event) => {
              if (event.dataTransfer?.types?.includes('application/x-hubit-file')) return;
              event.preventDefault();
              if (!canWrite || uploading || readingDrop || isSpecialView) return;
              if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
              setDragActive(true);
            }}
            onDrop={(event) => { if (!isSpecialView) void handleDrop(event); }}
          >
            {dragActive ? (
              <Box
                data-testid="my-files-drop-overlay"
                sx={{
                  position: 'fixed',
                  inset: 0,
                  zIndex: (muiTheme) => muiTheme.zIndex.modal + 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  pointerEvents: 'none',
                  bgcolor: alpha(theme.palette.primary.main, 0.08),
                  backdropFilter: 'blur(2px)',
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 1,
                    px: 6,
                    py: 4,
                    borderRadius: 3,
                    border: `2px dashed ${theme.palette.primary.main}`,
                    bgcolor: 'background.paper',
                    boxShadow: theme.shadows[8],
                    color: 'primary.main',
                  }}
                >
                  <CloudUploadOutlinedIcon sx={{ fontSize: 56 }} />
                  <Typography variant="h6" sx={{ fontWeight: 700, color: 'text.primary' }}>
                    Перетащите файлы сюда
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {breadcrumbs.length > 0
                      ? `Загрузятся в папку «${breadcrumbs[breadcrumbs.length - 1]?.name || 'Мой диск'}»`
                      : 'Загрузятся в «Мой диск»'}
                  </Typography>
                </Box>
              </Box>
            ) : null}
            <input ref={fileInputRef} data-testid="my-files-input" type="file" multiple hidden disabled={!canWrite} onChange={handleInputChange} />
            <input
              ref={folderInputRef}
              data-testid="my-files-folder-input"
              type="file"
              multiple
              hidden
              disabled={!canWrite}
              onChange={handleFolderInputChange}
            />

            <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ mb: 1.5, minHeight: 40 }}>
              {isTrashView ? (
                <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0 }}>
                  <Typography variant="h5" sx={{ fontWeight: 700 }}>Корзина</Typography>
                  {(items.length > 0 || folders.length > 0) ? (
                    <Button
                      size="small"
                      color="error"
                      variant="outlined"
                      disabled={!canWrite}
                      onClick={() => void handleEmptyTrash()}
                      data-testid="my-files-empty-trash"
                    >
                      Очистить корзину
                    </Button>
                  ) : null}
                </Stack>
              ) : isRecentView || isFavoritesView ? (
                <Typography variant="h5" sx={{ fontWeight: 700 }}>
                  {isRecentView ? 'Недавние' : 'Избранное'}
                </Typography>
              ) : breadcrumbs.length > 0 ? (
                <Breadcrumbs aria-label="Путь по папкам" data-testid="my-files-breadcrumbs" sx={{ minWidth: 0, flexShrink: 1 }}>
                  <Link
                    component="button"
                    underline="hover"
                    color="text.secondary"
                    onClick={() => navigateToFolder(null)}
                    sx={{ fontWeight: 600, cursor: 'pointer', fontSize: '1.05rem' }}
                  >
                    Мой диск
                  </Link>
                  {breadcrumbs.map((crumb, index) => {
                    const isLast = index === breadcrumbs.length - 1;
                    return isLast ? (
                      <Typography key={crumb.id} color="text.primary" sx={{ fontWeight: 700, fontSize: '1.05rem' }}>
                        {crumb.name}
                      </Typography>
                    ) : (
                      <Link
                        key={crumb.id}
                        component="button"
                        underline="hover"
                        color="text.secondary"
                        onClick={() => navigateToFolder(crumb.id)}
                        sx={{ fontWeight: 600, cursor: 'pointer', fontSize: '1.05rem' }}
                      >
                        {crumb.name}
                      </Link>
                    );
                  })}
                </Breadcrumbs>
              ) : (
                <Typography variant="h5" sx={{ fontWeight: 700 }}>Мой диск</Typography>
              )}
              <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
                <TextField
                  size="small"
                  placeholder="Поиск по имени"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  inputProps={{ 'data-testid': 'my-files-search-input', 'aria-label': 'Поиск по имени файла или папки' }}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchOutlinedIcon fontSize="small" />
                      </InputAdornment>
                    ),
                  }}
                  sx={{ width: { xs: 140, sm: 220 } }}
                />
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={viewMode}
                  onChange={(_event, next) => {
                    if (!next) return;
                    setViewMode(next);
                    window.localStorage.setItem('my-files-view', next);
                  }}
                  sx={{ height: 32 }}
                >
                  <ToggleButton value="list" aria-label="Список" data-testid="my-files-view-list">
                    <Tooltip title="Список"><ViewListOutlinedIcon fontSize="small" /></Tooltip>
                  </ToggleButton>
                  <ToggleButton value="grid" aria-label="Сетка" data-testid="my-files-view-toggle">
                    <Tooltip title="Сетка"><GridViewOutlinedIcon fontSize="small" /></Tooltip>
                  </ToggleButton>
                </ToggleButtonGroup>
                <Tooltip title="Обновить">
                  <IconButton aria-label="Обновить список" onClick={() => loadData({ silent: true })} disabled={refreshing}>
                    {refreshing ? <CircularProgress size={20} /> : <RefreshOutlinedIcon />}
                  </IconButton>
                </Tooltip>
              </Stack>
            </Stack>

            {selectedKeys.size > 0 ? (
              <Paper
                variant="outlined"
                data-testid="my-files-selection-bar"
                sx={{
                  ...getOfficePanelSx(ui),
                  borderLeft: `3px solid ${theme.palette.primary.main}`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 1.5,
                  py: 0.75,
                  mb: 1.5,
                  flexWrap: 'wrap',
                }}
              >
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  Выбрано: {selectedKeys.size}
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Button
                  size="small"
                  startIcon={<DownloadOutlinedIcon />}
                  disabled={selectedFiles.length === 0 || bulkBusy}
                  onClick={handleBulkDownload}
                  data-testid="my-files-bulk-download"
                >
                  Скачать
                </Button>
                <Button
                  size="small"
                  startIcon={<DriveFileMoveOutlinedIcon />}
                  disabled={!canWrite || bulkBusy}
                  onClick={openBulkMoveDialog}
                  data-testid="my-files-bulk-move"
                >
                  Переместить
                </Button>
                <Button
                  size="small"
                  color="error"
                  startIcon={<DeleteOutlineIcon />}
                  disabled={!canWrite || bulkBusy}
                  onClick={() => void handleBulkDelete()}
                  data-testid="my-files-bulk-delete"
                >
                  Удалить
                </Button>
                <Button size="small" onClick={clearSelection} data-testid="my-files-bulk-clear">
                  Снять выбор
                </Button>
              </Paper>
            ) : null}

            {showRetentionNotice ? (
              <Alert
                severity="info"
                sx={{ mb: 1.5 }}
                onClose={() => {
                  setShowRetentionNotice(false);
                  try { window.localStorage.setItem('my-files-retention-notice-dismissed', '1'); } catch { /* noop */ }
                }}
              >
                Файлы хранятся до 30 дней. Папки открываются как на диске — файлы внутри можно скачивать, делиться и перемещать.
              </Alert>
            ) : null}

            {uploading || readingDrop ? (
              <Paper variant="outlined" sx={{ ...getOfficePanelSx(ui), p: 1.5, mb: 1.5 }}>
                <Stack spacing={0.75}>
                  {readingDrop ? (
                    <Typography variant="body2" color="text.secondary">Читаем перетащенную папку…</Typography>
                  ) : null}
                  {Object.entries(uploadProgress).map(([key, progress]) => (
                    <Box key={key}>
                      <Stack direction="row" justifyContent="space-between">
                        <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>{progress.name}</Typography>
                        <Typography variant="body2" color="text.secondary">{progress.percent}%</Typography>
                      </Stack>
                      <LinearProgress variant="determinate" value={progress.percent} />
                    </Box>
                  ))}
                </Stack>
              </Paper>
            ) : null}

            {viewMode === 'list' ? (
            <Paper
              variant="outlined"
              sx={{ ...getOfficePanelSx(ui), overflow: 'hidden' }}
            >
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: isTrashView
                    ? { xs: 'minmax(0,1fr) auto', md: 'minmax(0,1fr) 170px 110px 176px' }
                    : { xs: '40px minmax(0,1fr) auto', md: '40px minmax(0,1fr) 170px 110px 176px' },
                  gap: 1,
                  alignItems: 'center',
                  px: 1,
                  py: 0.5,
                  borderBottom: `1px solid ${theme.palette.divider}`,
                  position: 'sticky',
                  top: 0,
                  zIndex: 2,
                  bgcolor: 'background.paper',
                }}
              >
                {isTrashView ? null : (
                  <Checkbox
                    size="small"
                    checked={allSelected}
                    indeterminate={!allSelected && someSelected}
                    onChange={toggleSelectAll}
                    inputProps={{ 'aria-label': 'Выбрать все', 'data-testid': 'my-files-select-all' }}
                  />
                )}
                <TableSortLabel
                  active={sortField === 'name'}
                  direction={sortField === 'name' ? sortDir : 'asc'}
                  onClick={() => toggleSort('name')}
                  sx={{ fontSize: '0.75rem', fontWeight: 700, color: 'text.secondary' }}
                  data-testid="my-files-sort-name"
                >
                  Название
                </TableSortLabel>
                <TableSortLabel
                  active={sortField === 'updated'}
                  direction={sortField === 'updated' ? sortDir : 'asc'}
                  onClick={() => toggleSort('updated')}
                  sx={{ fontSize: '0.75rem', fontWeight: 700, color: 'text.secondary', display: { xs: 'none', md: 'flex' } }}
                  data-testid="my-files-sort-updated"
                >
                  {isTrashView ? 'Удалён' : 'Изменён'}
                </TableSortLabel>
                <TableSortLabel
                  active={sortField === 'size'}
                  direction={sortField === 'size' ? sortDir : 'asc'}
                  onClick={() => toggleSort('size')}
                  sx={{ fontSize: '0.75rem', fontWeight: 700, color: 'text.secondary', display: { xs: 'none', md: 'flex' } }}
                  data-testid="my-files-sort-size"
                >
                  Размер
                </TableSortLabel>
                <Box sx={{ display: { xs: 'none', md: 'block' } }} />
              </Box>

              {loading ? (
                <Box sx={{ px: 1, py: 0.5 }}>
                  {[0, 1, 2, 3].map((row) => (
                    <Stack key={row} direction="row" spacing={1.25} alignItems="center" sx={{ py: 0.75 }}>
                      {isTrashView ? null : <Skeleton variant="rounded" width={24} height={24} />}
                      <Skeleton variant="rounded" width={34} height={34} />
                      <Skeleton variant="text" sx={{ flex: 1, fontSize: '0.875rem' }} />
                      <Skeleton variant="text" width={110} sx={{ display: { xs: 'none', md: 'block' } }} />
                      <Skeleton variant="text" width={70} sx={{ display: { xs: 'none', md: 'block' } }} />
                    </Stack>
                  ))}
                </Box>
              ) : null}

              {!loading && visibleItems.length === 0 && visibleFolders.length === 0 ? (
                <Stack spacing={1.5} alignItems="center" sx={{ py: 6 }}>
                  {isTrashView ? (
                    <DeleteOutlineIcon sx={{ fontSize: 44, color: 'text.disabled' }} />
                  ) : (
                    <FolderOutlinedIcon sx={{ fontSize: 44, color: 'text.disabled' }} />
                  )}
                  <Typography color="text.secondary" align="center">
                    {isTrashView
                      ? 'Корзина пуста.'
                      : isRecentView
                        ? 'Нет недавних файлов.'
                        : isFavoritesView
                          ? 'В избранном пока пусто — отметьте файлы звёздочкой.'
                          : 'Здесь пусто — перетащите файлы или папку, либо создайте папку через «Создать».'}
                  </Typography>
                  {!isSpecialView && canWrite ? (
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<CloudUploadOutlinedIcon />}
                      onClick={() => fileInputRef.current?.click()}
                      sx={{ mt: 0.5 }}
                    >
                      Загрузить файлы
                    </Button>
                  ) : null}
                </Stack>
              ) : null}

              {!loading && visibleFolders.map((folder) => (
                <FolderRow
                  key={`folder-${folder.id}`}
                  folder={folder}
                  isTrashView={isTrashView}
                  canWrite={canWrite}
                  canShare={canShare}
                  isSelected={selectedKeys.has(`folder:${folder.id}`)}
                  isDropTarget={dropTargetFolderId === String(folder.id)}
                  folderDropProps={folderDropProps}
                  navigateToFolder={navigateToFolder}
                  openFolderActionsMenu={openFolderActionsMenu}
                  openRenameDialog={openRenameDialog}
                  handleFolderShare={handleFolderShare}
                  handleDeleteFolder={handleDeleteFolder}
                  handleRestoreEntry={handleRestoreEntry}
                  handlePurgeEntry={handlePurgeEntry}
                  onToggleFavorite={handleToggleFavorite}
                  toggleSelected={toggleSelected}
                />
              ))}

              {!loading && visibleItems.map((item) => (
                <FileRow
                  key={item.id}
                  item={item}
                  isTrashView={isTrashView}
                  canWrite={canWrite}
                  canShare={canShare}
                  isSelected={selectedKeys.has(`file:${item.id}`)}
                  downloading={downloadingFileId === item.id}
                  fileDragProps={fileDragProps}
                  openDocumentPreview={openDocumentPreview}
                  openFileActionsMenu={openFileActionsMenu}
                  handleRestoreEntry={handleRestoreEntry}
                  handlePurgeEntry={handlePurgeEntry}
                  handleDownload={handleDownload}
                  handleShare={handleShare}
                  handleDelete={handleDelete}
                  onToggleFavorite={handleToggleFavorite}
                  toggleSelected={toggleSelected}
                />
              ))}
            </Paper>
            ) : (
            <Box data-testid="my-files-grid">
              {!loading && visibleItems.length === 0 && visibleFolders.length === 0 ? (
                <Stack spacing={1.5} alignItems="center" sx={{ py: 6 }}>
                  <FolderOutlinedIcon sx={{ fontSize: 44, color: 'text.disabled' }} />
                  <Typography color="text.secondary" align="center">
                    {isTrashView ? 'Корзина пуста.' : isRecentView ? 'Нет недавних файлов.' : isFavoritesView ? 'В избранном пока пусто — отметьте файлы звёздочкой.' : 'Здесь пусто — перетащите файлы или папку.'}
                  </Typography>
                  {!isSpecialView && canWrite ? (
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<CloudUploadOutlinedIcon />}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Загрузить файлы
                    </Button>
                  ) : null}
                </Stack>
              ) : null}
              {visibleFolders.length > 0 ? (
                <>
                  <Typography
                    variant="subtitle2"
                    color="text.secondary"
                    sx={{ fontWeight: 700, mb: 0.75, px: 0.25 }}
                    data-testid="my-files-grid-folders-title"
                  >
                    Папки
                  </Typography>
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                      gap: 1,
                      mb: visibleItems.length > 0 ? 2 : 0,
                    }}
                  >
                    {visibleFolders.map((folder) => (
                      <FolderCard
                        key={`folder-${folder.id}`}
                        folder={folder}
                        isTrashView={isTrashView}
                        canWrite={canWrite}
                        isSelected={selectedKeys.has(`folder:${folder.id}`)}
                        isDropTarget={dropTargetFolderId === String(folder.id)}
                        folderDropProps={folderDropProps}
                        navigateToFolder={navigateToFolder}
                        openFolderActionsMenu={openFolderActionsMenu}
                        handleRestoreEntry={handleRestoreEntry}
                        handlePurgeEntry={handlePurgeEntry}
                        onToggleFavorite={handleToggleFavorite}
                        toggleSelected={toggleSelected}
                      />
                    ))}
                  </Box>
                </>
              ) : null}
              {visibleItems.length > 0 ? (
                <>
                  {visibleFolders.length > 0 ? (
                    <Typography
                      variant="subtitle2"
                      color="text.secondary"
                      sx={{ fontWeight: 700, mb: 0.75, px: 0.25 }}
                      data-testid="my-files-grid-files-title"
                    >
                      Файлы
                    </Typography>
                  ) : null}
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
                      gap: 1.5,
                    }}
                  >
                    {visibleItems.map((item) => (
                      <FileCard
                        key={item.id}
                        item={item}
                        isTrashView={isTrashView}
                        canWrite={canWrite}
                        isSelected={selectedKeys.has(`file:${item.id}`)}
                        thumbUrl={thumbs[String(item.id)] || ''}
                        fileDragProps={fileDragProps}
                        observeThumbTarget={observeThumbTarget}
                        openDocumentPreview={openDocumentPreview}
                        openFileActionsMenu={openFileActionsMenu}
                        handleRestoreEntry={handleRestoreEntry}
                        handlePurgeEntry={handlePurgeEntry}
                        onToggleFavorite={handleToggleFavorite}
                        toggleSelected={toggleSelected}
                      />
                    ))}
                  </Box>
                </>
              ) : null}
            </Box>
            )}

            {isTrashView ? (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, px: 0.5 }}>
                Объекты в корзине удаляются окончательно по истечении их срока хранения.
              </Typography>
            ) : (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, px: 0.5 }}>
                Перетащите файлы или папку в область списка — структура папок сохранится.
              </Typography>
            )}
          </Box>
        </Box>

          <FileActionsContextMenu
            open={Boolean(fileActionsMenu.anchorPosition)}
            anchorPosition={fileActionsMenu.anchorPosition}
            fileName={getMyFileName(fileActionsMenu.item)}
            canDownload={Boolean(
              fileActionsMenu.item
              && READY_STATUSES.has(String(fileActionsMenu.item.status || '').toLowerCase()),
            )}
            busy={Boolean(
              fileActionsMenu.item
              && downloadingFileId === String(fileActionsMenu.item.id || ''),
            )}
            onClose={closeFileActionsMenu}
            onPreview={fileActionsMenu.item && isMyFilePreviewSupported(fileActionsMenu.item)
              ? () => { void openDocumentPreview(fileActionsMenu.item, { forcePreview: true }); }
              : undefined}
            onDownload={fileActionsMenu.item
              ? () => { void handleDownload(fileActionsMenu.item); }
              : undefined}
            onRename={fileActionsMenu.item && canWrite
              ? () => openRenameDialog('file', fileActionsMenu.item.id, fileActionsMenu.item.original_file_name)
              : undefined}
            onMove={fileActionsMenu.item && canWrite
              ? () => openMoveDialog('file', fileActionsMenu.item.id)
              : undefined}
            onShare={fileActionsMenu.item && canShare && READY_STATUSES.has(String(fileActionsMenu.item.status || '').toLowerCase())
              ? () => { void handleShare(fileActionsMenu.item); }
              : undefined}
            onRevokeShare={fileActionsMenu.item && canShare && fileActionsMenu.item.is_shared
              ? () => { void handleRevokeShare(fileActionsMenu.item); }
              : undefined}
            isShared={Boolean(fileActionsMenu.item?.is_shared)}
            onToggleFavorite={fileActionsMenu.item && canWrite
              ? () => { void handleToggleFavorite(fileActionsMenu.item, 'file'); }
              : undefined}
            isFavorite={Boolean(fileActionsMenu.item?.is_favorite)}
            onDelete={fileActionsMenu.item && canWrite
              ? () => { void handleDelete(fileActionsMenu.item); }
              : undefined}
          />

          <Menu
            open={Boolean(folderActionsMenu.anchorPosition)}
            onClose={closeFolderActionsMenu}
            anchorReference="anchorPosition"
            anchorPosition={folderActionsMenu.anchorPosition || undefined}
          >
            <MenuItem
              data-testid="folder-action-open"
              onClick={() => {
                const folder = folderActionsMenu.folder;
                closeFolderActionsMenu();
                if (folder) navigateToFolder(folder.id);
              }}
            >
              <ListItemIcon><FolderOutlinedIcon fontSize="small" /></ListItemIcon>
              <ListItemText>Открыть</ListItemText>
            </MenuItem>
            <MenuItem
              data-testid="folder-action-rename"
              disabled={!canWrite}
              onClick={() => {
                const folder = folderActionsMenu.folder;
                closeFolderActionsMenu();
                if (folder) openRenameDialog('folder', folder.id, folder.name);
              }}
            >
              <ListItemIcon><DriveFileRenameOutlineRoundedIcon fontSize="small" /></ListItemIcon>
              <ListItemText>Переименовать</ListItemText>
            </MenuItem>
            <MenuItem
              data-testid="folder-action-favorite"
              disabled={!canWrite}
              onClick={() => {
                const folder = folderActionsMenu.folder;
                closeFolderActionsMenu();
                if (folder) void handleToggleFavorite(folder, 'folder');
              }}
            >
              <ListItemIcon>
                {folderActionsMenu.folder?.is_favorite
                  ? <StarRoundedIcon fontSize="small" sx={{ color: 'warning.main' }} />
                  : <StarOutlineRoundedIcon fontSize="small" />}
              </ListItemIcon>
              <ListItemText>{folderActionsMenu.folder?.is_favorite ? 'Убрать из избранного' : 'В избранное'}</ListItemText>
            </MenuItem>
            <MenuItem
              data-testid="folder-action-archive"
              onClick={() => {
                const folder = folderActionsMenu.folder;
                closeFolderActionsMenu();
                if (folder) void handleFolderArchive(folder);
              }}
            >
              <ListItemIcon><ArchiveOutlinedIcon fontSize="small" /></ListItemIcon>
              <ListItemText>Скачать папку (ZIP)</ListItemText>
            </MenuItem>
            <MenuItem
              data-testid="folder-action-move"
              disabled={!canWrite}
              onClick={() => {
                const folder = folderActionsMenu.folder;
                closeFolderActionsMenu();
                if (folder) openMoveDialog('folder', folder.id);
              }}
            >
              <ListItemIcon><DriveFileMoveOutlinedIcon fontSize="small" /></ListItemIcon>
              <ListItemText>Переместить</ListItemText>
            </MenuItem>
            <MenuItem
              data-testid="folder-action-share"
              disabled={!canShare}
              onClick={() => {
                const folder = folderActionsMenu.folder;
                closeFolderActionsMenu();
                if (folder) void handleFolderShare(folder);
              }}
            >
              <ListItemIcon><ShareOutlinedIcon fontSize="small" /></ListItemIcon>
              <ListItemText>Поделиться папкой</ListItemText>
            </MenuItem>
            {folderActionsMenu.folder?.is_shared ? (
              <MenuItem
                data-testid="folder-action-revoke-share"
                disabled={!canShare}
                onClick={() => {
                  const folder = folderActionsMenu.folder;
                  closeFolderActionsMenu();
                  if (folder) void handleRevokeFolderShare(folder.id);
                }}
              >
                <ListItemIcon><LinkOutlinedIcon fontSize="small" /></ListItemIcon>
                <ListItemText>Отключить ссылку</ListItemText>
              </MenuItem>
            ) : null}
            <MenuItem
              data-testid="folder-action-delete"
              disabled={!canWrite}
              onClick={() => {
                const folder = folderActionsMenu.folder;
                closeFolderActionsMenu();
                if (folder) void handleDeleteFolder(folder);
              }}
              sx={{ color: 'error.main' }}
            >
              <ListItemIcon sx={{ color: 'inherit' }}><DeleteOutlineIcon fontSize="small" /></ListItemIcon>
              <ListItemText>Удалить</ListItemText>
            </MenuItem>
          </Menu>

        <Dialog open={uploadDialogOpen} onClose={closeUploadDialog} maxWidth="sm" fullWidth>
          <DialogTitle>{pendingFolderSummary ? 'Загрузка папки' : 'Загрузка файлов'}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Alert severity="warning">
                Файлы будут удалены по окончании выбранного срока хранения. Публичные ссылки также перестанут работать.
                Лимит: {formatMyFilesUploadLimitLabel()}.
              </Alert>
              {pendingFolderSummary ? (
                <Alert severity="info" data-testid="my-files-folder-structure-notice">
                  Папка «{pendingFolderSummary.folderName}» ({pendingFolderSummary.fileCount} файл., {formatFileSize(pendingFolderSummary.totalBytes)})
                  будет создана на диске, файлы загрузятся с сохранением структуры — их можно будет открывать и делиться по отдельности.
                </Alert>
              ) : null}
              {pendingFolderSummary && pendingFolderSummary.totalBytes >= 200 * 1024 * 1024 ? (
                <Alert severity="warning" data-testid="my-files-folder-size-warn">
                  Большая папка ({formatFileSize(pendingFolderSummary.totalBytes)}): загрузка может
                  занять несколько минут. Не закрывайте вкладку до завершения.
                </Alert>
              ) : null}
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 0.75, fontWeight: 700 }}>Срок хранения</Typography>
                <Select
                  fullWidth
                  size="small"
                  value={retentionDays}
                  onChange={(event) => setRetentionDays(Number(event.target.value))}
                  inputProps={{ 'aria-label': 'Срок хранения' }}
                >
                  {myFilesRetentionOptions.map((days) => (
                    <MenuItem key={days} value={days}>{days} дн.</MenuItem>
                  ))}
                </Select>
              </Box>
              <Paper variant="outlined" sx={{ maxHeight: 260, overflow: 'auto', p: 1 }}>
                <Stack spacing={0.75}>
                  {pendingFolderSummary ? (
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                      <Box
                        sx={{
                          width: 34,
                          height: 34,
                          flex: '0 0 auto',
                          borderRadius: 1.25,
                          display: 'grid',
                          placeItems: 'center',
                          color: 'warning.main',
                          bgcolor: 'action.hover',
                        }}
                      >
                        <FolderOutlinedIcon sx={{ fontSize: 20 }} />
                      </Box>
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography variant="body2" sx={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {pendingFolderSummary.folderName}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Папка · {pendingFolderSummary.fileCount} файл. · ~{formatFileSize(pendingFolderSummary.totalBytes)}
                        </Typography>
                      </Box>
                    </Stack>
                  ) : pendingUploadFiles.map((file, index) => {
                    const meta = getFileVisualMeta({ original_file_name: file.name, mime_type: file.type });
                    const Icon = meta.icon;
                    const colors = getFileVisualColors(theme, meta);
                    return (
                      <Stack key={`${file.name}-${file.size}-${index}`} direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                        <Box
                          sx={{
                            width: 34,
                            height: 34,
                            flex: '0 0 auto',
                            borderRadius: 1.25,
                            display: 'grid',
                            placeItems: 'center',
                            color: colors.color,
                            bgcolor: colors.background,
                            border: `1px solid ${colors.border}`,
                          }}
                        >
                          <Icon sx={{ fontSize: 20 }} />
                        </Box>
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Typography variant="body2" sx={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {file.name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">{meta.label} · {formatFileSize(file.size)}</Typography>
                        </Box>
                      </Stack>
                    );
                  })}
                </Stack>
              </Paper>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={closeUploadDialog} disabled={uploading}>Отмена</Button>
            <Button
              variant="contained"
              onClick={confirmUpload}
              disabled={uploading || (pendingUploadFiles.length === 0 && pendingFolderFiles.length === 0)}
            >
              {pendingFolderSummary ? 'Загрузить папку' : 'Загрузить'}
            </Button>
          </DialogActions>
        </Dialog>

        <DocumentPreviewDialog
          open={documentPreview.open}
          title={getMyFileName(documentPreview.item)}
          subtitle={documentPreview.kind === 'image' ? 'Изображение' : documentPreview.sourceKind === 'excel' ? 'Excel' : 'PDF-предпросмотр'}
          kind={documentPreview.kind}
          sourceKind={documentPreview.sourceKind}
          objectUrl={documentPreview.objectUrl}
          excelWorkbook={documentPreview.excelWorkbook}
          pageCount={documentPreview.pageCount}
          sheets={documentPreview.sheets}
          loading={documentPreview.loading}
          error={documentPreview.error}
          onClose={closeDocumentPreview}
          onRefresh={refreshDocumentPreview}
          onDownloadOriginal={documentPreview.item ? () => { void handleDownload(documentPreview.item); } : undefined}
          onDownloadPdf={downloadDocumentPreviewPdf}
          canDownloadOriginal={Boolean(documentPreview.item)}
          canDownloadPdf={Boolean(documentPreview.previewBlob && (documentPreview.kind === 'office_pdf' || documentPreview.kind === 'office_excel'))}
        />

        <MyFilesShareDialog
          open={shareDialog.open}
          url={shareDialog.url}
          expiresAt={shareDialog.expiresAt}
          fileName={shareDialog.fileName}
          linkCopied={shareDialog.linkCopied}
          onClose={() => setShareDialog({
            open: false,
            fileId: '',
            url: '',
            expiresAt: null,
            fileName: '',
            linkCopied: false,
          })}
          onRotateShare={shareDialog.fileId
            ? () => {
              const item = items.find((entry) => entry.id === shareDialog.fileId);
              if (item) void handleShare(item, { rotate: true });
            }
            : undefined}
        />

        <MyFilesShareDialog
          open={folderShareDialog.open}
          url={folderShareDialog.url}
          expiresAt={null}
          fileName={folderShareDialog.folderName}
          linkCopied={folderShareDialog.linkCopied}
          onClose={() => setFolderShareDialog({
            open: false,
            folderId: '',
            url: '',
            folderName: '',
            linkCopied: false,
          })}
          onRotateShare={folderShareDialog.folderId
            ? () => {
              const folder = allFolders.find((entry) => entry.id === folderShareDialog.folderId);
              if (folder) void handleFolderShare(folder, { rotate: true });
            }
            : undefined}
        />

        <Dialog open={createFolderOpen} onClose={() => setCreateFolderOpen(false)} maxWidth="xs" fullWidth>
          <DialogTitle>Новая папка</DialogTitle>
          <DialogContent>
            <TextField
              autoFocus
              fullWidth
              size="small"
              label="Название папки"
              value={folderNameInput}
              onChange={(event) => setFolderNameInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleCreateFolder();
              }}
              inputProps={{ 'data-testid': 'my-files-folder-name-input' }}
              sx={{ mt: 1 }}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCreateFolderOpen(false)}>Отмена</Button>
            <Button
              variant="contained"
              data-testid="my-files-create-folder-confirm"
              disabled={!String(folderNameInput || '').trim()}
              onClick={() => void handleCreateFolder()}
            >
              Создать
            </Button>
          </DialogActions>
        </Dialog>

        <Dialog open={renameDialog.open} onClose={() => setRenameDialog({ open: false, kind: '', id: '', name: '' })} maxWidth="xs" fullWidth>
          <DialogTitle>{renameDialog.kind === 'folder' ? 'Переименовать папку' : 'Переименовать файл'}</DialogTitle>
          <DialogContent>
            <TextField
              autoFocus
              fullWidth
              size="small"
              label="Новое название"
              value={renameDialog.name}
              onChange={(event) => setRenameDialog((current) => ({ ...current, name: event.target.value }))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void confirmRename();
              }}
              inputProps={{ 'data-testid': 'my-files-rename-input' }}
              sx={{ mt: 1 }}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setRenameDialog({ open: false, kind: '', id: '', name: '' })}>Отмена</Button>
            <Button
              variant="contained"
              data-testid="my-files-rename-confirm"
              disabled={!String(renameDialog.name || '').trim()}
              onClick={() => void confirmRename()}
            >
              Сохранить
            </Button>
          </DialogActions>
        </Dialog>

        <Dialog open={moveDialog.open} onClose={() => setMoveDialog({ open: false, kind: '', id: '', targetFolderId: '' })} maxWidth="xs" fullWidth>
          <DialogTitle>
            {moveDialog.kind === 'bulk' ? `Переместить выбранные (${selectedKeys.size})` : 'Переместить в папку'}
          </DialogTitle>
          <DialogContent>
            <Select
              fullWidth
              size="small"
              displayEmpty
              value={moveDialog.targetFolderId}
              onChange={(event) => setMoveDialog((current) => ({ ...current, targetFolderId: event.target.value }))}
              inputProps={{ 'data-testid': 'my-files-move-select' }}
              sx={{ mt: 1 }}
            >
              <MenuItem value="">
                <em>Мои файлы (корень)</em>
              </MenuItem>
              {moveDialogOptions.map((folder) => (
                <MenuItem key={folder.id} value={folder.id}>
                  {folderPathLabels.get(String(folder.id)) || folder.name}
                </MenuItem>
              ))}
            </Select>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setMoveDialog({ open: false, kind: '', id: '', targetFolderId: '' })}>Отмена</Button>
            <Button
              variant="contained"
              data-testid="my-files-move-confirm"
              disabled={bulkBusy}
              onClick={() => {
                if (moveDialog.kind === 'bulk') {
                  void handleBulkMove(moveDialog.targetFolderId || null);
                  return;
                }
                void confirmMove();
              }}
            >
              Переместить
            </Button>
          </DialogActions>
        </Dialog>
      </PageShell>
    </MainLayout>
  );
}
