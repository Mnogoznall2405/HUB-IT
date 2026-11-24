import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import useRequestGuard from '../lib/useRequestGuard';
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
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
  useMediaQuery,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import CloudUploadOutlinedIcon from '@mui/icons-material/CloudUploadOutlined';
import ArrowDropDownRoundedIcon from '@mui/icons-material/ArrowDropDownRounded';
import ClearRoundedIcon from '@mui/icons-material/ClearRounded';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import DriveFileMoveOutlinedIcon from '@mui/icons-material/DriveFileMoveOutlined';
import DriveFileRenameOutlineRoundedIcon from '@mui/icons-material/DriveFileRenameOutlineRounded';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import GroupOutlinedIcon from '@mui/icons-material/GroupOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import LinkOutlinedIcon from '@mui/icons-material/LinkOutlined';
import MenuOutlinedIcon from '@mui/icons-material/MenuOutlined';
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import StarOutlineRoundedIcon from '@mui/icons-material/StarOutlineRounded';
import StarRoundedIcon from '@mui/icons-material/StarRounded';
import GridViewOutlinedIcon from '@mui/icons-material/GridViewOutlined';
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';
import ShareOutlinedIcon from '@mui/icons-material/ShareOutlined';
import ViewListOutlinedIcon from '@mui/icons-material/ViewListOutlined';
import MainLayout from '../components/layout/MainLayout';
import MyFileAuditDialog from '../components/myFiles/MyFileAuditDialog';
import MyFilesCollaboratorsDialog from '../components/myFiles/MyFilesCollaboratorsDialog';
import MyFilesCopyDialog from '../components/myFiles/MyFilesCopyDialog';
import MyFilesDetailsPanel from '../components/myFiles/MyFilesDetailsPanel';
import MyFilesLibraryDialog from '../components/myFiles/MyFilesLibraryDialog';
import MyFilesOfficeEditorDialog from '../components/myFiles/MyFilesOfficeEditorDialog';
import MyFilesShareDialog from '../components/myFiles/MyFilesShareDialog';
import MyFilesSidebar from '../components/myFiles/MyFilesSidebar';
import MyFilesVersionsDialog from '../components/myFiles/MyFilesVersionsDialog';
import DocumentPreviewDialog from '../components/documentPreview/DocumentPreviewDialog';
import FileActionsContextMenu, {
  getFileActionsAnchorPosition,
} from '../components/fileActions/FileActionsContextMenu';
import NestedMenuItem, { SUBMENU_SWITCH_DELAY_MS } from '../components/fileActions/NestedMenuItem';
import PageShell from '../components/layout/PageShell';
import PageTopBar from '../components/layout/PageTopBar';
import {
  formatMyFilesRetentionLabel,
  myFilesAPI,
  myFilesRetentionOptions,
} from '../api/myFiles';
import { myFilesLibrariesAPI } from '../api/myFilesLibraries';
import { myFilesOfficeAPI } from '../api/myFilesOffice';
import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';
import {
  formatFileSize,
  getMyFileName,
  isMyFilePreviewSupported,
} from '../lib/myFilesPreview';
import { isNativeShellRuntime } from '../lib/platform';
import { buildEditorRoute, buildEditorUrl } from '../lib/myFilesEditorLink';
import { requestDesktopEditorWindow } from '../lib/desktopBridge';
import { useMyFilesDownload } from './myFiles/useMyFilesDownload';

// Stable empty array: a fresh [] literal in props re-invalidates downstream
// useMemo chains (e.g. the sidebar library tree) on every page render.
const EMPTY_ENTRIES = [];
import { useMyFilesPreviewController } from './myFiles/useMyFilesPreviewController';
import { useMyFilesShares } from './myFiles/useMyFilesShares';
import { useMyFilesUpload } from './myFiles/useMyFilesUpload';
import { MeasuredBox, VirtualFileGrid, VirtualFolderGrid, VirtualListRows } from './myFiles/MyFilesVirtualViews';
import { collectDataTransferFiles } from '../lib/myFilesFolderZip';
import { folderIsInsideSubtree } from '../lib/myFilesFolderTree';
import {
  FileCard,
  FileRow,
  FolderCard,
  FolderRow,
  ownerLabel,
  ROW_COL_OWNER_MIN,
  ROW_COL_SIZE_MIN,
  ROW_COL_TRASH_DATE_MIN,
  ROW_COL_TRASH_RETENTION_MIN,
  ROW_COL_UPDATED_MIN,
  rowGridColumns,
  secondaryColumnSx,
  sharedOpenLabel,
} from '../components/myFiles/MyFilesListItems';
import {
  DATE_FILTERS,
  TYPE_FILTERS,
  dateFilterLabel,
  matchesDateFilter,
  matchesTypeFilter,
  typeFilterLabel,
} from '../lib/myFilesFilters';
import {
  ACTIVE_PROCESSING_STATUSES,
  formatDateTime,
  getFileVisualColors,
  getFileVisualMeta,
  MY_FILES_ROW_HEIGHT,
  READY_STATUSES,
} from '../components/myFiles/myFilesVisual';
import { buildOfficeUiTokens, getOfficePanelSx } from '../theme/officeUiTokens';

const LIBRARY_ROLE_RANK = { view: 1, comment: 2, edit: 3, manage: 4 };
const LIBRARY_ROLE_LABELS = { manage: 'Управление', edit: 'Правка', comment: 'Комментарии', view: 'Просмотр' };

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
  const { hasPermission, user: authUser } = useAuth();
  const currentUsername = String(authUser?.username || '');
  const [searchParams, setSearchParams] = useSearchParams();
  const viewParam = String(searchParams.get('view') || '');
  const isTrashView = viewParam === 'trash';
  const isRecentView = viewParam === 'recent';
  const isFavoritesView = viewParam === 'favorites';
  const isSharedView = viewParam === 'shared';
  const isSpecialView = isTrashView || isRecentView || isFavoritesView || isSharedView;
  const listView = isRecentView ? 'recent' : isFavoritesView ? 'favorites' : isSharedView ? 'shared' : '';
  // A folder opened through "Доступно мне" belongs to somebody else: it is only browsed, never written to.
  const currentFolderId = isSharedView || !isSpecialView ? (searchParams.get('folder') || null) : null;
  // A shared library ("Общие папки") is opened with ?library=<id>; its trash is ?view=trash&library=<id>.
  const libraryId = !isRecentView && !isFavoritesView && !isSharedView ? (searchParams.get('library') || null) : null;
  const isLibraryView = Boolean(libraryId);
  const [libraries, setLibraries] = useState([]);
  const [canManageLibraries, setCanManageLibraries] = useState(false);
  const [libraryDialog, setLibraryDialog] = useState({ open: false, library: null });
  const [libraryInfo, setLibraryInfo] = useState(null);
  const activeLibrary = useMemo(
    () => (libraryId ? libraries.find((entry) => String(entry.id) === String(libraryId)) || null : null),
    [libraries, libraryId],
  );
  const libraryRole = isLibraryView
    ? String((libraryInfo && String(libraryInfo.id) === String(libraryId) ? libraryInfo.my_role : activeLibrary?.my_role) || '')
    : '';
  const libraryRank = LIBRARY_ROLE_RANK[libraryRole] || 0;
  const canManageLibrary = isLibraryView && libraryRank >= LIBRARY_ROLE_RANK.manage;
  // Library roles govern editing and trash; individual sharing uses the server's author/admin capability.
  const canWrite = hasPermission('my_files.write')
    && (!isLibraryView || libraryRank >= (isTrashView ? LIBRARY_ROLE_RANK.manage : LIBRARY_ROLE_RANK.edit));
  const canShare = hasPermission('my_files.share')
    && (!isLibraryView || authUser?.role === 'admin' || libraryRank >= LIBRARY_ROLE_RANK.manage);
  const libraryName = String(activeLibrary?.name || (libraryInfo && String(libraryInfo.id) === String(libraryId) ? libraryInfo.name : '') || 'Общая папка');
  // "Недавние" and search results mix in rows of libraries the user belongs to: each one is gated by its own role.
  const entryAccess = useCallback((entry) => {
    const entryLibraryId = entry?.library_id ? String(entry.library_id) : '';
    const isFile = entry?.original_file_name !== undefined;
    // can_manage_access also marks the uploader of a library file: collaborators stay with the
    // author, while a public link additionally requires the "manage" library role.
    const fileAccess = isFile && hasPermission('my_files.share') && entry.can_manage_access === true;
    if (!entryLibraryId || entryLibraryId === String(libraryId || '')) {
      const fileShare = isFile
        ? (isLibraryView
            ? hasPermission('my_files.share') && (authUser?.role === 'admin' || libraryRank >= LIBRARY_ROLE_RANK.manage)
            : fileAccess)
        : null;
      return {
        library: isLibraryView,
        canWrite,
        canShare: fileShare ?? canShare,
        canManageAccess: isFile ? fileAccess : canShare,
        canManage: canManageLibrary,
      };
    }
    const rank = LIBRARY_ROLE_RANK[String(entry.my_role || '')] || 0;
    const adminShare = hasPermission('my_files.share') && authUser?.role === 'admin';
    const fileShare = isFile
      ? hasPermission('my_files.share') && (authUser?.role === 'admin' || rank >= LIBRARY_ROLE_RANK.manage)
      : null;
    const folderShare = hasPermission('my_files.share')
      && (authUser?.role === 'admin' || rank >= LIBRARY_ROLE_RANK.manage);
    return {
      library: true,
      canWrite: hasPermission('my_files.write') && rank >= LIBRARY_ROLE_RANK.edit,
      canShare: fileShare ?? folderShare,
      canManageAccess: isFile ? fileAccess : adminShare,
      canManage: isFile ? fileAccess : adminShare,
    };
  }, [authUser?.role, canManageLibrary, canShare, canWrite, hasPermission, isLibraryView, libraryId, libraryRank]);
  const [items, setItems] = useState([]);
  const [folders, setFolders] = useState([]);
  const [breadcrumbs, setBreadcrumbs] = useState([]);
  const [allFolders, setAllFolders] = useState([]);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [folderNameInput, setFolderNameInput] = useState('');
  const [renameDialog, setRenameDialog] = useState({ open: false, kind: '', id: '', name: '' });
  const [moveDialog, setMoveDialog] = useState({ open: false, kind: '', id: '', targetFolderId: '' });
  const [folderActionsMenu, setFolderActionsMenu] = useState({ folder: null, anchorPosition: null });
  const [folderSubmenu, setFolderSubmenu] = useState('');
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [sortField, setSortField] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [filterMenu, setFilterMenu] = useState({ kind: '', anchor: null });
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedSearchQuery(String(searchQuery || '').trim()),
      300,
    );
    return () => window.clearTimeout(timer);
  }, [searchQuery]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [viewMode, setViewMode] = useState(() => (
    window.localStorage.getItem('my-files-view') === 'grid' ? 'grid' : 'list'
  ));
  const [showRetentionNotice, setShowRetentionNotice] = useState(() => (
    window.localStorage.getItem('my-files-retention-notice-dismissed') !== '1'
  ));
  const isBelowLg = useMediaQuery(theme.breakpoints.down('lg'));
  const isXs = useMediaQuery(theme.breakpoints.down('sm'));
  const [navOpen, setNavOpen] = useState(false);
  // ≥lg: the file nav collapses to a 64px icon rail; below lg it lives in a drawer.
  const [navCollapsed, setNavCollapsed] = useState(() => (
    window.localStorage.getItem('my-files-nav-collapsed') === '1'
  ));
  const toggleNavCollapsed = useCallback(() => {
    setNavCollapsed((current) => {
      const next = !current;
      try { window.localStorage.setItem('my-files-nav-collapsed', next ? '1' : '0'); } catch { /* noop */ }
      return next;
    });
  }, []);
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Пункт «Сведения» в меню привязывает панель к объекту, даже если он не выбран.
  const [detailsPinned, setDetailsPinned] = useState(null);
  const openDetailsFor = useCallback((kind, entry) => {
    if (entry?.id) setDetailsPinned({ kind, id: String(entry.id) });
    setDetailsOpen(true);
  }, []);
  const [dropTargetFolderId, setDropTargetFolderId] = useState('');
  const [thumbs, setThumbs] = useState({});
  const thumbsRef = useRef({});
  const [quota, setQuota] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fileActionsMenu, setFileActionsMenu] = useState({ item: null, anchorPosition: null });
  const [auditDialogFile, setAuditDialogFile] = useState(null);
  const [officeStatus, setOfficeStatus] = useState({ enabled: false, editable_extensions: [] });
  const [officeEditorFile, setOfficeEditorFile] = useState(null);
  const [officeEditorCompare, setOfficeEditorCompare] = useState('');
  const [collaboratorsFile, setCollaboratorsFile] = useState(null);
  const [collaboratorsFolder, setCollaboratorsFolder] = useState(null);
  const [versionsFile, setVersionsFile] = useState(null);
  const [confirmState, setConfirmState] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const { notifySuccess, notifyWarning, notifyApiError } = useNotification();
  // The guard checker of the latest load: false after unmount or once a newer
  // load cycle began — keeps late download/share responses from touching state.
  const latestIsCurrentRef = useRef(() => false);
  const isPageCurrent = useCallback(() => latestIsCurrentRef.current(), []);
  const { downloadingFileId, downloadFile: handleDownload } = useMyFilesDownload({ notifyApiError, notifySuccess, notifyWarning, isCurrent: isPageCurrent });
  const [exportingFileId, setExportingFileId] = useState('');
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
  // In-memory stale-while-revalidate cache for folder listings: a revisit of a
  // recently opened folder paints instantly, then revalidates in background.
  // Per page instance (unmount = cache gone), bounded, TTL-limited, and wiped
  // by invalidateListingsCache on every local mutation — it never outlives a
  // session or an auth change.
  const listingsCacheRef = useRef(new Map());
  const LISTINGS_CACHE_TTL_MS = 20_000;
  const LISTINGS_CACHE_MAX = 30;
  // Cache entries are bound to the signed-in identity: a switch of the auth
  // context (re-login without unmount, impersonation-style flows) must never
  // answer a listing from the previous user's payload.
  const authUserKey = String(authUser?.id || authUser?.username || 'anon');
  const invalidateListingsCache = useCallback(() => {
    listingsCacheRef.current.clear();
  }, []);
  const applyListingsPayload = useCallback(({ filesPayload, quotaPayload, foldersPayload }) => {
    setLibraryInfo(libraryId && filesPayload?.library ? filesPayload.library : null);
    const nextItems = Array.isArray(filesPayload?.items) ? filesPayload.items : [];
    const nextFolders = Array.isArray(filesPayload?.folders) ? filesPayload.folders : [];
    const nextAllFolders = Array.isArray(foldersPayload?.items) ? foldersPayload.items : [];
    setItems((prev) => reconcileById(prev, nextItems));
    setFolders((prev) => reconcileById(prev, nextFolders));
    setBreadcrumbs((prev) => reconcileById(prev, Array.isArray(filesPayload?.breadcrumbs) ? filesPayload.breadcrumbs : []));
    setAllFolders((prev) => reconcileById(prev, nextAllFolders));
    if (!libraryId) {
      setQuota((prev) => {
        if (!quotaPayload) return null;
        if (prev && Object.keys(quotaPayload).every((key) => prev[key] === quotaPayload[key])) return prev;
        return quotaPayload;
      });
    }
  }, [libraryId]);
  // A new navigation supersedes the in-flight listing: without aborting it,
  // the stale requests still occupy the browser's per-origin connection pool,
  // so a quick click after mount queues the real fetch behind dead traffic.
  const loadAbortRef = useRef(null);
  const loadData = useCallback(async ({ silent = false } = {}) => {
    const isCurrent = beginLoad();
    latestIsCurrentRef.current = isCurrent;
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    const { signal } = controller;
    activeLoadsRef.current += 1;
    const cacheKey = `${authUserKey}|${isTrashView ? 'trash' : listView}|${libraryId || ''}|${currentFolderId || ''}|${debouncedSearchQuery}`;
    try {
      const cached = listingsCacheRef.current.get(cacheKey);
      // Optimistic paint is limited to the user's own space. Shared scopes (a
      // library, the "shared with me" view) revalidate first: access can be
      // revoked server-side and a cached payload would flash forbidden rows.
      const sharedScope = Boolean(libraryId) || isSharedView;
      const cacheFresh = !silent && !sharedScope && cached && (Date.now() - cached.t) < LISTINGS_CACHE_TTL_MS;
      if (cacheFresh) {
        applyListingsPayload(cached.payload);
        // Let the cached paint commit before the revalidation fetch + second
        // apply — keeps the perceived navigation instant.
        await new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
        if (!isCurrent()) return;
      }
      if (!silent && !cacheFresh) setLoading(true);
      setRefreshing(true);
      // A library has its own limit: its usage comes with the library list instead of the personal quota.
      // Сам список библиотек грузится один раз через loadLibraries (mount + refreshQuota):
      // здесь он дублировал GET /my-files/libraries на каждый переход по папкам.
      const [filesPayload, quotaPayload, foldersPayload] = await Promise.all([
        isTrashView && myFilesAPI.listTrash
          ? myFilesAPI.listTrash({ libraryId, signal })
          : myFilesAPI.listFiles({ folderId: currentFolderId, view: listView, q: debouncedSearchQuery, libraryId, signal }),
        libraryId ? Promise.resolve(null) : myFilesAPI.getQuota({ signal }),
        myFilesAPI.listFolders ? myFilesAPI.listFolders({ libraryId, signal }) : Promise.resolve({ items: [] }),
      ]);
      if (!isCurrent()) return;
      applyListingsPayload({ filesPayload, quotaPayload, foldersPayload });
      listingsCacheRef.current.set(cacheKey, {
        t: Date.now(),
        payload: { filesPayload, quotaPayload, foldersPayload },
      });
      if (listingsCacheRef.current.size > LISTINGS_CACHE_MAX) {
        listingsCacheRef.current.delete(listingsCacheRef.current.keys().next().value);
      }
    } catch (error) {
      if (!isCurrent()) return;
      const status = Number(error?.response?.status || error?.status || 0);
      if (status === 401 || status === 403 || status === 404) {
        // Access revoked or object gone: evict the cached payload and clear
        // what is on screen so forbidden rows can't linger or resurface later.
        listingsCacheRef.current.delete(cacheKey);
        applyListingsPayload({
          filesPayload: { items: [], folders: [], breadcrumbs: [] },
          quotaPayload: null,
          foldersPayload: { items: [] },
        });
      }
      notifyApiError(error, 'Не удалось загрузить список файлов.', { dedupeMode: 'recent' });
    } finally {
      activeLoadsRef.current -= 1;
      if (isCurrent()) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [applyListingsPayload, authUserKey, beginLoad, currentFolderId, debouncedSearchQuery, isSharedView, isTrashView, libraryId, listView, notifyApiError]);

  const postMutationLoadData = useCallback(
    (opts) => { listingsCacheRef.current.clear(); return loadData(opts); },
    [loadData],
  );

  const loadLibraries = useCallback(async () => {
    try {
      const payload = await myFilesLibrariesAPI.list();
      setLibraries(Array.isArray(payload?.items) ? payload.items : []);
      setCanManageLibraries(Boolean(payload?.can_manage));
    } catch {
      // Libraries are an optional section: without the endpoint it simply stays hidden.
    }
  }, []);

  useEffect(() => {
    void loadLibraries();
  }, [loadLibraries]);

  useEffect(() => {
    const controller = new AbortController();
    myFilesOfficeAPI.getStatus({ signal: controller.signal })
      .then((status) => {
        if (!controller.signal.aborted && status) setOfficeStatus(status);
      })
      .catch(() => {
        // Online editing is optional: without the status endpoint the actions simply stay hidden.
      });
    return () => controller.abort();
  }, []);

  // Older invitation notifications link to ?shared=1: show the "available to me" section instead.
  useEffect(() => {
    if (searchParams.get('shared') !== '1') return;
    setSearchParams({ view: 'shared' }, { replace: true });
  }, [searchParams, setSearchParams]);

  // Link for collaborators (?edit=<file id>): open the editor once and drop the parameter.
  useEffect(() => {
    const fileId = String(searchParams.get('edit') || '');
    if (!fileId || !officeStatus.enabled) return;
    setOfficeEditorFile({ id: fileId });
    const next = new URLSearchParams(searchParams);
    next.delete('edit');
    setSearchParams(next, { replace: true });
  }, [officeStatus.enabled, searchParams, setSearchParams]);

  const isOfficeEditable = useCallback((item) => {
    if (!officeStatus.enabled || !item) return false;
    if (!READY_STATUSES.has(String(item.status || '').toLowerCase())) return false;
    const name = String(getMyFileName(item) || '').toLowerCase();
    return (officeStatus.editable_extensions || []).some((extension) => name.endsWith(extension));
  }, [officeStatus]);

  // In the browser the editor gets a tab of its own, in HUB Desktop the second window of the app, so the first one stays
  // free to work in. Without either (an older Desktop, a blocked pop-up) it opens in a window over the list.
  const editorTabOpenedRef = useRef(false);
  const lastEditorOpenRef = useRef({ fileId: '', at: 0 });
  const openOfficeEditor = useCallback(async (file, { compare = '' } = {}) => {
    const fileId = String(file?.id || '');
    if (!fileId) return;
    // Двойной клик по строке даёт два вызова подряд — без защиты открываются две вкладки редактора.
    const now = Date.now();
    if (lastEditorOpenRef.current.fileId === fileId && now - lastEditorOpenRef.current.at < 1500) return;
    lastEditorOpenRef.current = { fileId, at: now };
    const suffix = compare ? `?compare=${encodeURIComponent(compare)}` : '';
    const route = `${buildEditorRoute(fileId)}${suffix}`;
    if (isNativeShellRuntime()) {
      const result = await requestDesktopEditorWindow(route);
      if (result.status === 'opened' || result.status === 'activated') {
        editorTabOpenedRef.current = true;
        return;
      }
    } else {
      const tab = window.open(`${buildEditorUrl(fileId)}${suffix}`, '_blank');
      if (tab) {
        editorTabOpenedRef.current = true;
        return;
      }
    }
    setOfficeEditorCompare(compare);
    setOfficeEditorFile(file);
  }, []);

  // The list shows what was saved in the editor tab as soon as the user comes back to it.
  useEffect(() => {
    const refresh = () => {
      if (!editorTabOpenedRef.current || document.visibilityState === 'hidden') return;
      void loadData({ silent: true });
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [loadData]);

  // A document shared with others (or kept in a shared folder) is edited online by everybody: never in a local application.
  const opensInEditor = (item) => isOfficeEditable(item)
    && Boolean(item.shared_with_me || Number(item.collaborators_count || 0) > 0 || item.library_id || isLibraryView);

  // Documents open in the editor; any other file shared with me is simply downloaded.
  const openSharedFile = useCallback((item) => {
    if (isOfficeEditable(item)) openOfficeEditor(item);
    else if (item && READY_STATUSES.has(String(item.status || '').toLowerCase())) void handleDownload(item);
  }, [handleDownload, isOfficeEditable, openOfficeEditor]);

  const closeOfficeEditor = useCallback(() => {
    setOfficeEditorFile(null);
    setOfficeEditorCompare('');
    void loadData({ silent: true });
  }, [loadData]);

  // A blank document is queued like any upload: remember it and open the editor once it becomes ready.
  const [copyDialogFile, setCopyDialogFile] = useState(null);
  const [pendingOpenId, setPendingOpenId] = useState('');
  const [creatingDocument, setCreatingDocument] = useState(false);
  const handleCreateDocument = useCallback(async (kind) => {
    setCreatingDocument(true);
    try {
      const created = await myFilesOfficeAPI.createBlank({ kind, folderId: currentFolderId, libraryId });
      if (created?.id) setPendingOpenId(String(created.id));
      await loadData({ silent: true });
    } catch (error) {
      notifyApiError(error, 'Не удалось создать документ.');
    } finally {
      setCreatingDocument(false);
    }
  }, [currentFolderId, libraryId, loadData, notifyApiError]);

  useEffect(() => {
    if (!pendingOpenId) return;
    const created = items.find((entry) => String(entry.id) === pendingOpenId);
    if (!created) return;
    const status = String(created.status || '').toLowerCase();
    if (status === 'failed') {
      setPendingOpenId('');
    } else if (isOfficeEditable(created)) {
      setPendingOpenId('');
      openOfficeEditor(created);
    }
  }, [isOfficeEditable, items, openOfficeEditor, pendingOpenId]);

  const refreshQuota = useCallback(async () => {
    if (libraryId) {
      await loadLibraries();
      return;
    }
    try {
      const payload = await myFilesAPI.getQuota();
      setQuota((prev) => {
        if (!payload) return prev;
        if (prev && Object.keys(payload).every((key) => prev[key] === payload[key])) return prev;
        return payload;
      });
    } catch {
      // Quota is informational — never surface its refresh as an error.
    }
  }, [libraryId, loadLibraries]);

  const handleFileShareChanged = useCallback((fileId, isShared) => {
    const id = String(fileId || '');
    listingsCacheRef.current.clear();
    setItems((prev) => prev.map((entryItem) => (
      String(entryItem.id) === id ? { ...entryItem, is_shared: Boolean(isShared) } : entryItem
    )));
  }, []);

  const handleFolderShareChanged = useCallback((folderId, isShared) => {
    const id = String(folderId || '');
    listingsCacheRef.current.clear();
    const patch = (prev) => prev.map((entryItem) => (
      String(entryItem.id) === id ? { ...entryItem, is_shared: Boolean(isShared) } : entryItem
    ));
    setFolders(patch);
    setAllFolders(patch);
  }, []);

  const collectFolderSubtreeIds = useCallback((rootId) => {
    const ids = new Set([String(rootId)]);
    let grew = true;
    while (grew) {
      grew = false;
      allFolders.forEach((folder) => {
        const parentId = String(folder?.parent_id || '');
        const id = String(folder?.id || '');
        if (parentId && ids.has(parentId) && !ids.has(id)) {
          ids.add(id);
          grew = true;
        }
      });
    }
    return ids;
  }, [allFolders]);

  // The sidebar meter and upload checks follow the library being browsed; limit 0 means "no limit".
  const activeQuota = useMemo(() => {
    if (!isLibraryView) return quota;
    if (!activeLibrary) return null;
    const limit = Number(activeLibrary.quota_bytes || 0);
    const used = Number(activeLibrary.used_bytes || 0);
    return { used_bytes: used, limit_bytes: limit, ...(limit > 0 ? { remaining_bytes: Math.max(0, limit - used) } : {}) };
  }, [activeLibrary, isLibraryView, quota]);

  const {
    uploading,
    readingDrop,
    uploadProgress,
    uploadStats,
    prepareStats,
    cancelUpload,
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
    libraryId,
    isSpecialView,
    allFolders,
    // Upload completions refresh listings and may add files anywhere — the
    // wrapped loader drops the SWR cache first so a revisit can't flash stale data.
    loadData: postMutationLoadData,
    notifySuccess,
    notifyWarning,
    notifyApiError,
    quota: activeQuota,
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
  } = useMyFilesShares({ onFileShareChanged: handleFileShareChanged, onFolderShareChanged: handleFolderShareChanged, notifySuccess, notifyWarning, notifyApiError, isCurrent: isPageCurrent });

  // A folder found by search or in recent files may belong to a library other than the one being browsed.
  const navigateToFolder = useCallback((folderId, folderLibraryId) => {
    const targetLibrary = folderLibraryId || libraryId;
    const base = isSharedView ? { view: 'shared' } : targetLibrary ? { library: targetLibrary } : {};
    const next = folderId ? { ...base, folder: folderId } : base;
    setSearchParams(next, { replace: false });
  }, [isSharedView, libraryId, setSearchParams]);

  const navigateToView = useCallback((view) => {
    setSearchParams(view ? { view } : {}, { replace: false });
  }, [setSearchParams]);

  const navigateToTrash = useCallback(() => {
    navigateToView('trash');
  }, [navigateToView]);

  const navigateToLibrary = useCallback((id, { trash = false } = {}) => {
    setSearchParams(trash ? { view: 'trash', library: id } : { library: id }, { replace: false });
  }, [setSearchParams]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Auth identity changed without an unmount (re-login, account switch):
  // everything on screen belongs to the previous user — drop it, wipe the
  // cache and reload under the new identity.
  const loadDataRef = useRef(loadData);
  loadDataRef.current = loadData;
  const authUserKeyRef = useRef(authUserKey);
  useEffect(() => {
    if (authUserKeyRef.current === authUserKey) return;
    authUserKeyRef.current = authUserKey;
    listingsCacheRef.current.clear();
    setItems([]);
    setFolders([]);
    setAllFolders([]);
    setBreadcrumbs([]);
    setLibraryInfo(null);
    setLibraries([]);
    setQuota(null);
    void loadLibraries();
    void loadDataRef.current();
  }, [authUserKey, loadLibraries]);

  // Leaving the page must release the in-flight listing fetch — its results
  // can no longer be applied anyway, and a held socket slows the next screen.
  useEffect(() => () => loadAbortRef.current?.abort(), []);

  useEffect(() => {
    const input = folderInputRef.current;
    if (!input) return;
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
  }, []);

  useEffect(() => {
    if (!hasProcessingFiles) return undefined;
    // Adaptive poll: statuses change quickly at first, then large files sit in
    // processing for a long time — back off instead of polling forever at 4s.
    let delay = 4000;
    let cancelled = false;
    let timer = 0;
    const tick = () => {
      if (cancelled) return;
      if (activeLoadsRef.current === 0) void loadData({ silent: true });
      delay = Math.min(delay * 1.5, 15000);
      timer = window.setTimeout(tick, delay);
    };
    timer = window.setTimeout(tick, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
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
      listingsCacheRef.current.clear();
    } catch (error) {
      await loadData({ silent: true });
      notifyApiError(error, 'Не удалось обновить избранное.', { dedupeMode: 'none' });
    }
  }, [isFavoritesView, loadData, notifyApiError]);

  const handleExportPdf = useCallback(async (item) => {
    const fileId = String(item?.id || '');
    if (!fileId) return;
    setExportingFileId(fileId);
    try {
      const response = await myFilesOfficeAPI.exportOffice(fileId, 'pdf');
      const blob = response?.data instanceof Blob
        ? response.data
        : new Blob([response?.data], { type: 'application/pdf' });
      const stem = String(getMyFileName(item) || 'document').replace(/\.[^.]+$/, '');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${stem}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      notifySuccess('PDF готов — смотрите панель загрузок браузера.', { source: 'my-files-export-pdf', dedupeMode: 'none', durationMs: 4000 });
    } catch (error) {
      notifyApiError(error, 'Не удалось получить PDF.', { dedupeMode: 'none' });
    } finally {
      setExportingFileId('');
    }
  }, [notifyApiError, notifySuccess]);

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

  const runConfirm = useCallback(async () => {
    const action = confirmState?.action;
    if (typeof action !== 'function') {
      setConfirmState(null);
      return;
    }
    setConfirmBusy(true);
    try {
      await action();
    } finally {
      setConfirmBusy(false);
      setConfirmState(null);
    }
  }, [confirmState]);

  const handleDelete = useCallback((item) => {
    setConfirmState({
      title: 'Удалить файл',
      body: `Файл «${getMyFileName(item)}» будет перемещён в корзину.`,
      confirmLabel: 'Удалить',
      danger: true,
      action: async () => {
        try {
          await myFilesAPI.deleteFile(item.id);
          listingsCacheRef.current.clear();
          const id = String(item.id);
          setItems((prev) => prev.filter((entryItem) => String(entryItem.id) !== id));
          notifySuccess('Файл удалён.', { source: 'my-files-delete', dedupeMode: 'none' });
          void refreshQuota();
        } catch (error) {
          notifyApiError(error, 'Не удалось удалить файл.', { dedupeMode: 'none' });
        }
      },
    });
  }, [notifyApiError, notifySuccess, refreshQuota]);

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

  const folderSubmenuCloseTimer = useRef(null);
  const cancelFolderSubmenuClose = useCallback(() => {
    clearTimeout(folderSubmenuCloseTimer.current);
    folderSubmenuCloseTimer.current = null;
  }, []);
  const scheduleFolderSubmenuClose = useCallback(() => {
    cancelFolderSubmenuClose();
    folderSubmenuCloseTimer.current = setTimeout(() => {
      folderSubmenuCloseTimer.current = null;
      setFolderSubmenu('');
    }, SUBMENU_SWITCH_DELAY_MS);
  }, [cancelFolderSubmenuClose]);

  const closeFolderActionsMenu = useCallback(() => {
    setFolderActionsMenu({ folder: null, anchorPosition: null });
    setFolderSubmenu('');
    cancelFolderSubmenuClose();
  }, [cancelFolderSubmenuClose]);

  const handleCreateFolder = useCallback(async () => {
    const name = String(folderNameInput || '').trim();
    if (!name) return;
    try {
      const created = await myFilesAPI.createFolder({ name, parentId: currentFolderId, libraryId });
      if (created?.id) {
        listingsCacheRef.current.clear();
        setFolders((prev) => [...prev, created]);
        setAllFolders((prev) => [...prev, created]);
      }
      setCreateFolderOpen(false);
      setFolderNameInput('');
      notifySuccess('Папка создана.', { source: 'my-files-folder', dedupeMode: 'none' });
    } catch (error) {
      notifyApiError(error, 'Не удалось создать папку.', { dedupeMode: 'none' });
    }
  }, [currentFolderId, folderNameInput, libraryId, notifyApiError, notifySuccess]);

  const openRenameDialog = useCallback((kind, id, currentName) => {
    setRenameDialog({ open: true, kind, id, name: String(currentName || '') });
  }, []);

  const confirmRename = useCallback(async () => {
    const name = String(renameDialog.name || '').trim();
    if (!name || !renameDialog.id) return;
    try {
      if (renameDialog.kind === 'folder') {
        const updated = await myFilesAPI.updateFolder(renameDialog.id, { name });
        const id = String(renameDialog.id);
        const patch = (prev) => prev.map((entryItem) => (
          String(entryItem.id) === id ? { ...entryItem, ...(updated?.id ? updated : { name }) } : entryItem
        ));
        setFolders(patch);
        setAllFolders(patch);
      } else {
        const updated = await myFilesAPI.updateFile(renameDialog.id, { name });
        const id = String(renameDialog.id);
        const fallback = { download_file_name: name, original_file_name: name };
        setItems((prev) => prev.map((entryItem) => (
          String(entryItem.id) === id ? { ...entryItem, ...(updated?.id ? updated : fallback) } : entryItem
        )));
      }
      listingsCacheRef.current.clear();
      setRenameDialog({ open: false, kind: '', id: '', name: '' });
      notifySuccess('Переименовано.', { source: 'my-files-rename', dedupeMode: 'none' });
    } catch (error) {
      notifyApiError(error, 'Не удалось переименовать.', { dedupeMode: 'none' });
    }
  }, [notifyApiError, notifySuccess, renameDialog]);

  const openMoveDialog = useCallback((kind, id) => {
    setMoveDialog({ open: true, kind, id, targetFolderId: '' });
  }, []);

  const confirmMove = useCallback(async () => {
    const target = moveDialog.targetFolderId || null;
    if (!moveDialog.id) return;
    try {
      if (moveDialog.kind === 'folder') {
        await myFilesAPI.updateFolder(moveDialog.id, { parentId: target });
        const id = String(moveDialog.id);
        setAllFolders((prev) => prev.map((entryItem) => (
          String(entryItem.id) === id ? { ...entryItem, parent_id: target } : entryItem
        )));
        const staysVisible = String(target || '') === String(currentFolderId || '');
        if (!staysVisible) {
          setFolders((prev) => prev.filter((entryItem) => String(entryItem.id) !== id));
        }
      } else {
        await myFilesAPI.updateFile(moveDialog.id, { folderId: target });
        const id = String(moveDialog.id);
        const staysVisible = isSpecialView || String(target || '') === String(currentFolderId || '');
        setItems((prev) => staysVisible
          ? prev.map((entryItem) => (String(entryItem.id) === id ? { ...entryItem, folder_id: target } : entryItem))
          : prev.filter((entryItem) => String(entryItem.id) !== id));
      }
      listingsCacheRef.current.clear();
      setMoveDialog({ open: false, kind: '', id: '', targetFolderId: '' });
      notifySuccess('Объект перемещён.', { source: 'my-files-move', dedupeMode: 'none' });
    } catch (error) {
      notifyApiError(error, 'Не удалось переместить.', { dedupeMode: 'none' });
    }
  }, [currentFolderId, isSpecialView, moveDialog, notifyApiError, notifySuccess]);

  const handleDeleteFolder = useCallback((folder) => {
    const name = String(folder?.name || 'папка');
    setConfirmState({
      title: 'Удалить папку',
      body: `Папка «${name}» будет перемещена в корзину вместе со всем содержимым.`,
      confirmLabel: 'Удалить',
      danger: true,
      action: async () => {
        try {
          await myFilesAPI.deleteFolder(folder.id);
          listingsCacheRef.current.clear();
          const removed = collectFolderSubtreeIds(folder.id);
          setFolders((prev) => prev.filter((entryItem) => !removed.has(String(entryItem.id))));
          setAllFolders((prev) => prev.filter((entryItem) => !removed.has(String(entryItem.id))));
          notifySuccess('Папка удалена.', { source: 'my-files-folder-delete', dedupeMode: 'none' });
          void refreshQuota();
        } catch (error) {
          notifyApiError(error, 'Не удалось удалить папку.', { dedupeMode: 'none' });
        }
      },
    });
  }, [collectFolderSubtreeIds, notifyApiError, notifySuccess, refreshQuota]);

  const handleRestoreEntry = useCallback(async (kind, id) => {
    try {
      const targetId = String(id);
      if (kind === 'folder') {
        await myFilesAPI.restoreFolder(id);
        setFolders((prev) => prev.filter((entryItem) => String(entryItem.id) !== targetId));
        setItems((prev) => prev.filter((entryItem) => String(entryItem.folder_id || '') !== targetId));
      } else {
        await myFilesAPI.restoreFile(id);
        setItems((prev) => prev.filter((entryItem) => String(entryItem.id) !== targetId));
      }
      listingsCacheRef.current.clear();
      notifySuccess('Восстановлено из корзины.', { source: 'my-files-restore', dedupeMode: 'none' });
      void refreshQuota();
    } catch (error) {
      notifyApiError(error, 'Не удалось восстановить.', { dedupeMode: 'none' });
    }
  }, [notifyApiError, notifySuccess, refreshQuota]);

  const handlePurgeEntry = useCallback((kind, id, name) => {
    const label = kind === 'folder' ? `папку «${name}»` : `файл «${name}»`;
    setConfirmState({
      title: 'Удалить навсегда',
      body: `Удалить ${label} навсегда? Восстановить будет нельзя.`,
      confirmLabel: 'Удалить навсегда',
      danger: true,
      action: async () => {
        try {
          const targetId = String(id);
          if (kind === 'folder') {
            await myFilesAPI.purgeFolder(id);
            setFolders((prev) => prev.filter((entryItem) => String(entryItem.id) !== targetId));
            setItems((prev) => prev.filter((entryItem) => String(entryItem.folder_id || '') !== targetId));
          } else {
            await myFilesAPI.purgeFile(id);
            setItems((prev) => prev.filter((entryItem) => String(entryItem.id) !== targetId));
          }
          listingsCacheRef.current.clear();
          notifySuccess('Удалено навсегда.', { source: 'my-files-purge', dedupeMode: 'none' });
          void refreshQuota();
        } catch (error) {
          notifyApiError(error, 'Не удалось удалить навсегда.', { dedupeMode: 'none' });
        }
      },
    });
  }, [notifyApiError, notifySuccess, refreshQuota]);

  const handleEmptyTrash = useCallback(() => {
    setConfirmState({
      title: 'Очистить корзину',
      body: 'Все объекты в корзине будут удалены навсегда. Восстановить будет нельзя.',
      confirmLabel: 'Очистить',
      danger: true,
      action: async () => {
        try {
          await myFilesAPI.emptyTrash({ libraryId });
          listingsCacheRef.current.clear();
          setItems([]);
          setFolders([]);
          notifySuccess('Корзина очищена.', { source: 'my-files-empty-trash', dedupeMode: 'none' });
          void refreshQuota();
        } catch (error) {
          notifyApiError(error, 'Не удалось очистить корзину.', { dedupeMode: 'none' });
        }
      },
    });
  }, [libraryId, notifyApiError, notifySuccess, refreshQuota]);

  const handleMoveFileToFolder = useCallback(async (fileId, folderId) => {
    try {
      await myFilesAPI.updateFile(fileId, { folderId });
      listingsCacheRef.current.clear();
      const id = String(fileId);
      const staysVisible = isSpecialView || String(folderId || '') === String(currentFolderId || '');
      setItems((prev) => staysVisible
        ? prev.map((entryItem) => (String(entryItem.id) === id ? { ...entryItem, folder_id: folderId } : entryItem))
        : prev.filter((entryItem) => String(entryItem.id) !== id));
      notifySuccess('Файл перемещён.', { source: 'my-files-move', dedupeMode: 'none' });
    } catch (error) {
      notifyApiError(error, 'Не удалось переместить файл.', { dedupeMode: 'none' });
    }
  }, [currentFolderId, isSpecialView, notifyApiError, notifySuccess]);

  const handleMoveFolderToFolder = useCallback(async (folderId, targetFolderId) => {
    try {
      await myFilesAPI.updateFolder(folderId, { parentId: targetFolderId });
      listingsCacheRef.current.clear();
      const id = String(folderId);
      setAllFolders((prev) => prev.map((entryItem) => (
        String(entryItem.id) === id ? { ...entryItem, parent_id: targetFolderId } : entryItem
      )));
      const staysVisible = String(targetFolderId || '') === String(currentFolderId || '');
      if (!staysVisible) {
        setFolders((prev) => prev.filter((entryItem) => String(entryItem.id) !== id));
      }
      notifySuccess('Папка перемещена.', { source: 'my-files-move', dedupeMode: 'none' });
    } catch (error) {
      notifyApiError(error, 'Не удалось переместить папку.', { dedupeMode: 'none' });
    }
  }, [currentFolderId, notifyApiError, notifySuccess]);

  const folderDragIdRef = useRef('');

  const folderDragProps = useCallback((folder) => ({
    draggable: canWrite,
    onDragStart: (event) => {
      folderDragIdRef.current = String(folder.id);
      event.dataTransfer.setData('application/x-hubit-folder', String(folder.id));
      event.dataTransfer.effectAllowed = 'move';
    },
    onDragEnd: () => {
      folderDragIdRef.current = '';
      setDropTargetFolderId('');
    },
  }), [canWrite]);

  const folderDropProps = useCallback((folder) => ({
    onDragOver: (event) => {
      if (isTrashView || !canWrite) return;
      const types = event.dataTransfer?.types;
      if (!types) return;
      const internalFolder = types.includes('application/x-hubit-folder');
      if (
        types.includes('application/x-hubit-file')
        || internalFolder
        || types.includes('Files')
      ) {
        // Сама перетаскиваемая папка и её поддерево — невалидная цель, без подсветки.
        if (internalFolder && folderIsInsideSubtree(allFolders, folder.id, folderDragIdRef.current)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = types.includes('Files') ? 'copy' : 'move';
        setDropTargetFolderId(String(folder.id));
      }
    },
    onDragLeave: (event) => {
      event.stopPropagation();
      // dragleave срабатывает и при переходе курсора на дочерние элементы строки —
      // в этом случае подсветку не сбрасываем, иначе она мигает.
      if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget)) return;
      setDropTargetFolderId('');
    },
    onDrop: (event) => {
      if (isTrashView || !canWrite) return;
      const internalId = event.dataTransfer.getData('application/x-hubit-file');
      const internalFolderId = event.dataTransfer.getData('application/x-hubit-folder');
      const osFiles = event.dataTransfer.files;
      const hasOsItems = (event.dataTransfer.items?.length || 0) > 0 || (osFiles?.length || 0) > 0;
      if (!internalId && !internalFolderId && !hasOsItems) return;
      event.preventDefault();
      event.stopPropagation();
      setDropTargetFolderId('');
      setDragActive(false);
      if (internalFolderId) {
        if (folderIsInsideSubtree(allFolders, folder.id, internalFolderId)) {
          notifyWarning('Нельзя переместить папку внутрь самой себя.', { source: 'my-files-move', dedupeMode: 'none' });
          return;
        }
        const dragged = allFolders.find((entry) => String(entry.id) === String(internalFolderId));
        if (dragged && String(dragged.parent_id || '') === String(folder.id)) return;
        void handleMoveFolderToFolder(internalFolderId, folder.id);
        return;
      }
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
  }), [allFolders, canWrite, handleMoveFileToFolder, handleMoveFolderToFolder, isTrashView, notifyApiError, notifyWarning, openUploadDialog]);

  // Подстраховка: drop/dragend за пределами строки-папки снимает подсветку цели.
  useEffect(() => {
    const clearDropTarget = () => setDropTargetFolderId('');
    window.addEventListener('dragend', clearDropTarget);
    window.addEventListener('drop', clearDropTarget);
    return () => {
      window.removeEventListener('dragend', clearDropTarget);
      window.removeEventListener('drop', clearDropTarget);
    };
  }, []);

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
    thumbsRef.current = {};
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
  }, [currentFolderId, viewParam, debouncedSearchQuery, typeFilter, dateFilter, clearSelection]);

  // A fresh selection or a navigation wins over an entry pinned via «Сведения».
  useEffect(() => {
    setDetailsPinned(null);
  }, [selectedKeys, currentFolderId, viewParam, libraryId]);

  const toggleSelected = useCallback((key) => {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Client filtering follows the debounced query (the same value the server
  // search uses): refilter+resort per keystroke on a 1000-row list was the
  // main input-latency cost during search.
  const matchesSearch = useCallback((name) => {
    const query = String(debouncedSearchQuery || '').trim().toLowerCase();
    if (!query) return true;
    return String(name || '').toLowerCase().includes(query);
  }, [debouncedSearchQuery]);

  const compareRows = useCallback((a, b) => {
    let result = 0;
    if (sortField === 'size') {
      result = Number(a.original_size_bytes || 0) - Number(b.original_size_bytes || 0);
    } else if (sortField === 'updated') {
      result = String(a.updated_at || a.created_at || '').localeCompare(String(b.updated_at || b.created_at || ''));
    } else if (sortField === 'owner') {
      result = ownerLabel(a, currentUsername).localeCompare(ownerLabel(b, currentUsername), 'ru', { sensitivity: 'base' });
    } else {
      result = String(a.name || a.original_file_name || '').localeCompare(
        String(b.name || b.original_file_name || ''), 'ru', { sensitivity: 'base' },
      );
    }
    return sortDir === 'desc' ? -result : result;
  }, [currentUsername, sortDir, sortField]);

  const visibleFolders = useMemo(
    () => folders.filter((folder) => (
      matchesSearch(folder.name)
      && matchesTypeFilter(folder, 'folder', typeFilter)
      && matchesDateFilter(folder, dateFilter)
    )).sort(compareRows),
    [compareRows, dateFilter, folders, matchesSearch, typeFilter],
  );
  const visibleItems = useMemo(
    () => items.filter((item) => (
      (matchesSearch(item.original_file_name) || matchesSearch(item.download_file_name))
      && matchesTypeFilter(item, 'file', typeFilter)
      && matchesDateFilter(item, dateFilter)
    )).sort(compareRows),
    [compareRows, dateFilter, items, matchesSearch, typeFilter],
  );

  // Per-entry access flags are computed once per data/permission change and
  // shared by every row prop, instead of 3-4 entryAccess() calls per row on
  // every page render.
  const entryAccessById = useMemo(() => {
    const map = new Map();
    for (const folder of visibleFolders) map.set(`folder:${folder.id}`, entryAccess(folder));
    for (const item of visibleItems) map.set(`file:${item.id}`, entryAccess(item));
    return map;
  }, [entryAccess, visibleFolders, visibleItems]);
  const accessOfEntry = useCallback(
    (entry) => (
      entryAccessById.get(`${entry?.original_file_name !== undefined ? 'file' : 'folder'}:${entry?.id}`)
      || entryAccess(entry)
    ),
    [entryAccess, entryAccessById],
  );

  // Flattened rows drive the window-scroll virtualizer: folders stay on top
  // (existing layout), files follow; only the visible slice is mounted.
  const virtualRows = useMemo(
    () => [
      ...visibleFolders.map((entry) => ({ kind: 'folder', entry })),
      ...visibleItems.map((entry) => ({ kind: 'file', entry })),
    ],
    [visibleFolders, visibleItems],
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
  const allSelected = useMemo(
    () => allRowKeys.length > 0 && allRowKeys.every((key) => selectedKeys.has(key)),
    [allRowKeys, selectedKeys],
  );
  const someSelected = useMemo(
    () => allRowKeys.some((key) => selectedKeys.has(key)),
    [allRowKeys, selectedKeys],
  );

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
    () => visibleItems.filter((item) => selectedKeys.has(`file:${item.id}`)),
    [visibleItems, selectedKeys],
  );

  const thumbObserverRef = useRef(null);
  const thumbNodesRef = useRef(new Map());

  const requestThumb = useCallback((item) => {
    const id = String(item?.id || '');
    if (!id || thumbsRef.current[id]) return;
    if (String(item.preview_kind || '') !== 'image' || !item.preview_available) return;
    const requestToken = {};
    thumbsRef.current[id] = requestToken;
    myFilesAPI.downloadPreviewContent(id, { variant: 'thumb' })
      .then((response) => {
        const url = URL.createObjectURL(response.data);
        // Late response: the marker was swept by a folder/view change or replaced
        // by a newer request — the fresh URL must be revoked, not stored.
        if (thumbsRef.current[id] !== requestToken) {
          URL.revokeObjectURL(url);
          return;
        }
        thumbsRef.current[id] = url;
        setThumbs((current) => ({ ...current, [id]: url }));
      })
      .catch(() => {
        if (thumbsRef.current[id] === requestToken) delete thumbsRef.current[id];
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

  const handleBulkDelete = useCallback(() => {
    if (selectedKeys.size === 0 || bulkBusy) return;
    const foldersToDelete = selectedFolders;
    const filesToDelete = selectedFiles;
    const count = foldersToDelete.length + filesToDelete.length;
    if (count === 0) return;
    setConfirmState({
      title: 'Удалить выбранные объекты',
      body: `Будут удалены выбранные объекты (${count} шт.). Содержимое папок будет удалено вместе с ними.`,
      confirmLabel: 'Удалить',
      danger: true,
      action: async () => {
        setBulkBusy(true);
        let done = 0;
        const failed = [];
        const removedIds = new Set();
        try {
          for (const folder of foldersToDelete) {
            try {
              await myFilesAPI.deleteFolder(folder.id);
              done += 1;
              collectFolderSubtreeIds(folder.id).forEach((id) => removedIds.add(id));
            } catch {
              failed.push(`папка «${folder.name || folder.id}»`);
            }
          }
          for (const file of filesToDelete) {
            try {
              await myFilesAPI.deleteFile(file.id);
              done += 1;
              removedIds.add(String(file.id));
            } catch {
              failed.push(`файл «${getMyFileName(file)}»`);
            }
          }
          if (removedIds.size > 0) {
            listingsCacheRef.current.clear();
            setFolders((prev) => prev.filter((entryItem) => !removedIds.has(String(entryItem.id))));
            setAllFolders((prev) => prev.filter((entryItem) => !removedIds.has(String(entryItem.id))));
            setItems((prev) => prev.filter((entryItem) => !removedIds.has(String(entryItem.id))));
            void refreshQuota();
          }
          if (failed.length === 0) {
            notifySuccess(`Удалено объектов: ${done}.`, { source: 'my-files-bulk-delete', dedupeMode: 'none' });
          } else {
            notifyWarning(
              `Удалено ${done} из ${count}. Не удалось: ${failed.slice(0, 5).join('; ')}${failed.length > 5 ? ` и ещё ${failed.length - 5}` : ''}.`,
              { source: 'my-files-bulk-delete', dedupeMode: 'none', durationMs: 9000 },
            );
          }
          clearSelection();
        } finally {
          setBulkBusy(false);
        }
      },
    });
  }, [bulkBusy, clearSelection, collectFolderSubtreeIds, notifySuccess, notifyWarning, refreshQuota, selectedFiles, selectedFolders, selectedKeys.size]);

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
    const foldersToMove = selectedFolders;
    const filesToMove = selectedFiles;
    const count = foldersToMove.length + filesToMove.length;
    setBulkBusy(true);
    let done = 0;
    const failed = [];
    const movedFileIds = new Set();
    const movedFolderIds = new Set();
    try {
      for (const folder of foldersToMove) {
        try {
          await myFilesAPI.updateFolder(folder.id, { parentId: targetFolderId });
          done += 1;
          movedFolderIds.add(String(folder.id));
        } catch {
          failed.push(`папка «${folder.name || folder.id}»`);
        }
      }
      for (const file of filesToMove) {
        try {
          await myFilesAPI.updateFile(file.id, { folderId: targetFolderId });
          done += 1;
          movedFileIds.add(String(file.id));
        } catch {
          failed.push(`файл «${getMyFileName(file)}»`);
        }
      }
      if (movedFileIds.size > 0 || movedFolderIds.size > 0) listingsCacheRef.current.clear();
      if (movedFolderIds.size > 0) {
        setAllFolders((prev) => prev.map((entryItem) => (
          movedFolderIds.has(String(entryItem.id)) ? { ...entryItem, parent_id: targetFolderId } : entryItem
        )));
        const staysVisible = String(targetFolderId || '') === String(currentFolderId || '');
        if (!staysVisible) {
          setFolders((prev) => prev.filter((entryItem) => !movedFolderIds.has(String(entryItem.id))));
        }
      }
      if (movedFileIds.size > 0) {
        const staysVisible = isSpecialView || String(targetFolderId || '') === String(currentFolderId || '');
        setItems((prev) => staysVisible
          ? prev.map((entryItem) => (movedFileIds.has(String(entryItem.id)) ? { ...entryItem, folder_id: targetFolderId } : entryItem))
          : prev.filter((entryItem) => !movedFileIds.has(String(entryItem.id))));
      }
      if (failed.length === 0) {
        notifySuccess('Выбранные объекты перемещены.', { source: 'my-files-bulk-move', dedupeMode: 'none' });
        clearSelection();
        setMoveDialog({ open: false, kind: '', id: '', targetFolderId: '' });
      } else {
        // Диалог и выбор остаются — можно повторить для неперенесённых.
        notifyWarning(
          `Перемещено ${done} из ${count}. Не удалось: ${failed.slice(0, 5).join('; ')}${failed.length > 5 ? ` и ещё ${failed.length - 5}` : ''}.`,
          { source: 'my-files-bulk-move', dedupeMode: 'none', durationMs: 9000 },
        );
      }
    } finally {
      setBulkBusy(false);
    }
  }, [bulkBusy, clearSelection, currentFolderId, isSpecialView, notifySuccess, notifyWarning, selectedFiles, selectedFolders, selectedKeys.size]);

  const quotaUsed = Number(activeQuota?.used_bytes || 0);
  const quotaLimit = Number(activeQuota?.limit_bytes || 0);
  const quotaPercent = quotaLimit > 0 ? Math.min(100, Math.round((quotaUsed / quotaLimit) * 100)) : 0;

  const uploadActiveEntries = Object.entries(uploadProgress);
  const uploadInFlightFraction = uploadActiveEntries
    .reduce((sum, [, item]) => sum + (Number(item?.percent) || 0), 0) / 100;
  const uploadOverallPercent = uploadStats.total > 0
    ? Math.min(100, Math.round(((uploadStats.done + uploadInFlightFraction) / uploadStats.total) * 100))
    : 0;
  const preparePercent = prepareStats.total > 0
    ? Math.min(100, Math.round((prepareStats.done / prepareStats.total) * 100))
    : 0;

  const fileMenuAccess = entryAccess(fileActionsMenu.item);
  const folderMenuAccess = entryAccess(folderActionsMenu.folder);

  const pinnedEntry = detailsPinned
    ? (detailsPinned.kind === 'folder'
        ? (folders.find((entry) => String(entry.id) === detailsPinned.id)
          || allFolders.find((entry) => String(entry.id) === detailsPinned.id))
        : items.find((entry) => String(entry.id) === detailsPinned.id))
    : null;
  const detailsTarget = pinnedEntry
    ? { kind: detailsPinned.kind, entry: pinnedEntry }
    : (selectedFiles.length + selectedFolders.length === 1
        ? (selectedFiles.length === 1
            ? { kind: 'file', entry: selectedFiles[0] }
            : { kind: 'folder', entry: selectedFolders[0] })
        : null);
  const detailsMulti = !pinnedEntry && (selectedFiles.length + selectedFolders.length) > 1
    ? {
      files: selectedFiles.length,
      folders: selectedFolders.length,
      totalBytes: selectedFiles.reduce((sum, file) => sum + Number(file.original_size_bytes || 0), 0),
    }
    : null;
  const detailsContextTitle = isTrashView
    ? (isLibraryView ? `Корзина — ${libraryName}` : 'Корзина')
    : isRecentView
      ? 'Недавние'
      : isFavoritesView
        ? 'Избранное'
        : isSharedView && breadcrumbs.length === 0
          ? 'Доступно мне'
          : breadcrumbs.length > 0
            ? String(breadcrumbs[breadcrumbs.length - 1]?.name || (isSharedView ? 'Доступно мне' : 'Мой диск'))
            : isLibraryView ? libraryName : (isSharedView ? 'Доступно мне' : 'Мой диск');
  const detailsLibraryLabel = (() => {
    const entry = detailsTarget?.entry;
    if (!entry) return '';
    const entryLibraryId = entry.library_id || (isLibraryView ? libraryId : null);
    if (!entryLibraryId) return '';
    const name = String(entry.library_name || (String(entryLibraryId) === String(libraryId) ? libraryName : '') || '');
    const role = String(entry.my_role || (String(entryLibraryId) === String(libraryId) ? libraryRole : '') || '');
    const roleLabel = LIBRARY_ROLE_LABELS[role] || role;
    if (!name) return roleLabel;
    return roleLabel ? `${name} · ${roleLabel}` : name;
  })();
  const detailsRetentionText = detailsTarget?.kind === 'file'
    ? (detailsTarget.entry.library_id || isLibraryView
        ? 'Бессрочно'
        : `${formatMyFilesRetentionLabel(detailsTarget.entry.retention_days)}${detailsTarget.entry.expires_at ? ` · до ${formatDateTime(detailsTarget.entry.expires_at)}` : ''}`)
    : '';
  const detailsLocationLabel = (() => {
    if (!detailsTarget) return '';
    const { kind, entry } = detailsTarget;
    if (kind === 'folder') {
      const parentId = String(entry.parent_id || '');
      if (parentId && folderPathLabels.get(parentId)) return folderPathLabels.get(parentId);
      return (entry.library_id || isLibraryView) ? libraryName : (isSharedView ? 'Доступно мне' : 'Мой диск');
    }
    const folderId = String(entry.folder_id || '');
    if (folderId) return folderPathLabels.get(folderId) || String(entry.folder_name || '') || 'Мой диск';
    return String(entry.folder_name || '')
      || (entry.library_id ? detailsLibraryLabel || libraryName : (isSharedView ? 'Доступно мне' : 'Мой диск'));
  })();
  const detailsActions = (() => {
    if (!detailsTarget || isTrashView) return {};
    const { kind, entry } = detailsTarget;
    const access = entryAccess(entry);
    const sharedWithMe = Boolean(entry.shared_with_me);
    const readyFile = kind === 'file' && READY_STATUSES.has(String(entry.status || '').toLowerCase());
    const processingFile = kind === 'file' && ACTIVE_PROCESSING_STATUSES.has(String(entry.status || '').toLowerCase());
    const editorOpen = kind === 'file' && (sharedWithMe || opensInEditor(entry));
    const canOpenEntry = kind === 'folder' || (readyFile && (editorOpen || isMyFilePreviewSupported(entry)));
    const open = () => {
      if (kind === 'folder') {
        navigateToFolder(entry.id, entry.library_id);
        return;
      }
      if (editorOpen) {
        if (readyFile) openSharedFile(entry);
        return;
      }
      if (readyFile && isMyFilePreviewSupported(entry)) void openDocumentPreview(entry);
    };
    // Скрываем действие только там, где оно бессмысленно (скачивание чужой папки,
    // публикация объекта, который мне просто открыли); во всех остальных случаях
    // кнопка остаётся видимой, но заблокированной с причиной в подсказке.
    const openDisabledReason = canOpenEntry
      ? ''
      : (processingFile ? 'Файл ещё обрабатывается' : 'Предпросмотр недоступен');
    const downloadDisabledReason = kind === 'file' && !readyFile
      ? (processingFile ? 'Файл ещё обрабатывается' : 'Скачивание недоступно')
      : '';
    const shareDisabledReason = sharedWithMe
      ? ''
      : (!access.canShare
          ? 'Недостаточно прав для общего доступа'
          : (kind === 'file' && !readyFile ? 'Файл ещё обрабатывается' : ''));
    const writeDisabledReason = access.canWrite ? '' : 'Недостаточно прав';
    return {
      openLabel: kind === 'folder' ? 'Открыть' : (editorOpen ? sharedOpenLabel(entry) : 'Просмотреть'),
      onOpen: open,
      openDisabledReason,
      downloadLabel: kind === 'folder' ? 'Скачать (ZIP)' : 'Скачать',
      onDownload: kind === 'folder'
        ? (sharedWithMe ? null : () => { void handleFolderArchive(entry); })
        : () => { void handleDownload(entry); },
      downloadDisabledReason,
      downloading: kind === 'file' && downloadingFileId === String(entry.id || ''),
      onShare: sharedWithMe
        ? null
        : () => { void (kind === 'folder' ? handleFolderShare(entry) : handleShare(entry)); },
      shareDisabledReason,
      onRename: sharedWithMe
        ? null
        : () => openRenameDialog(kind, entry.id, kind === 'folder' ? entry.name : entry.original_file_name),
      renameDisabledReason: sharedWithMe ? '' : writeDisabledReason,
      onDelete: sharedWithMe
        ? null
        : () => { void (kind === 'folder' ? handleDeleteFolder(entry) : handleDelete(entry)); },
      deleteDisabledReason: sharedWithMe ? '' : writeDisabledReason,
      onMore: (event) => (kind === 'folder' ? openFolderActionsMenu(event, entry) : openFileActionsMenu(event, entry)),
    };
  })();
  const detailsPanelProps = {
    onClose: () => setDetailsOpen(false),
    kind: detailsTarget?.kind || null,
    item: detailsTarget?.entry || null,
    multi: detailsMulti,
    contextTitle: detailsContextTitle,
    contextChips: isLibraryView && libraryRole
      ? [{ key: 'role', label: LIBRARY_ROLE_LABELS[libraryRole] || libraryRole }]
      : EMPTY_ENTRIES,
    quota: detailsTarget || detailsMulti ? null : activeQuota,
    ownerText: detailsTarget ? ownerLabel(detailsTarget.entry, currentUsername) : '',
    locationLabel: detailsLocationLabel,
    retentionText: detailsRetentionText,
    libraryLabel: detailsLibraryLabel,
    ...detailsActions,
  };

  const handleSidebarCreateFolder = useCallback(() => {
    setFolderNameInput('');
    setCreateFolderOpen(true);
  }, []);
  const handleSidebarUploadFiles = useCallback(() => fileInputRef.current?.click(), []);
  const handleSidebarUploadFolder = useCallback(() => folderInputRef.current?.click(), []);
  const handleSidebarLibraryOpen = useCallback((library) => {
    // An administrator who is not a member can only configure the library, not browse it.
    if (!library.my_role && canManageLibraries) setLibraryDialog({ open: true, library });
    else navigateToLibrary(library.id);
  }, [canManageLibraries, navigateToLibrary]);
  const handleSidebarLibraryCreate = useCallback(() => setLibraryDialog({ open: true, library: null }), []);
  const handleSidebarLibraryFolderOpen = useCallback(
    (folder) => navigateToFolder(folder.id, libraryId),
    [libraryId, navigateToFolder],
  );
  // Memoized props + memo()'d sidebar: search keystrokes and intermediate
  // commits (loading flips, virtualizer corrections) re-render the page often —
  // the folder tree must not pay for each of them.
  const sidebarProps = useMemo(() => ({
    officeEnabled: officeStatus.enabled,
    createDisabled: !canWrite || uploading || readingDrop || creatingDocument || isSpecialView,
    onCreateFolder: handleSidebarCreateFolder,
    onCreateDocument: handleCreateDocument,
    onUploadFiles: handleSidebarUploadFiles,
    onUploadFolder: handleSidebarUploadFolder,
    isDriveActive: !currentFolderId && !isSpecialView && !isLibraryView,
    isRecentView,
    isFavoritesView,
    isTrashView: isTrashView && !isLibraryView,
    isSharedView,
    navigateToView,
    navigateToTrash,
    libraries,
    canManageLibraries,
    activeLibraryId: isLibraryView ? libraryId : null,
    onLibraryOpen: handleSidebarLibraryOpen,
    onLibraryCreate: handleSidebarLibraryCreate,
    // Дерево показываем только под открытой библиотекой из уже загруженного списка папок.
    libraryFolders: isLibraryView ? allFolders : EMPTY_ENTRIES,
    currentFolderId: isLibraryView ? currentFolderId : null,
    onLibraryFolderOpen: handleSidebarLibraryFolderOpen,
    quota: activeQuota,
    quotaLoading: loading,
    isLibraryView,
  }), [
    officeStatus.enabled, canWrite, uploading, readingDrop, creatingDocument, isSpecialView,
    handleSidebarCreateFolder, handleCreateDocument, handleSidebarUploadFiles, handleSidebarUploadFolder,
    currentFolderId, isLibraryView, isRecentView, isFavoritesView, isTrashView, isSharedView,
    navigateToView, navigateToTrash, libraries, canManageLibraries, libraryId,
    handleSidebarLibraryOpen, handleSidebarLibraryCreate, allFolders, handleSidebarLibraryFolderOpen,
    activeQuota, loading,
  ]);

  const folderMenuRun = (fn) => () => {
    const folder = folderActionsMenu.folder;
    closeFolderActionsMenu();
    if (folder) fn(folder);
  };
  // `topLevel` marks rows of the parent menu: hovering one schedules the open
  // flyout's close; rows inside a flyout leave it alone.
  const folderLeaf = (key, testId, disabled, onClick, icon, text, topLevel = false) => (
    <MenuItem
      key={key}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={topLevel ? scheduleFolderSubmenuClose : undefined}
      onMouseLeave={topLevel ? cancelFolderSubmenuClose : undefined}
      sx={{ minHeight: 40 }}
    >
      <ListItemIcon>{icon}</ListItemIcon>
      <ListItemText>{text}</ListItemText>
    </MenuItem>
  );
  const folderSharedWithMe = Boolean(folderActionsMenu.folder?.shared_with_me);
  const folderShareItems = folderSharedWithMe ? [] : [
    folderLeaf('share', 'folder-action-share', !folderMenuAccess.canShare,
      folderMenuRun((folder) => { void handleFolderShare(folder); }),
      <ShareOutlinedIcon fontSize="small" />, 'Поделиться папкой'),
    officeStatus.enabled && !folderMenuAccess.library
      ? folderLeaf('collaborators', 'folder-action-collaborators', !folderMenuAccess.canShare,
        folderMenuRun((folder) => setCollaboratorsFolder(folder)),
        <GroupOutlinedIcon fontSize="small" />, 'Совместный доступ')
      : null,
    folderActionsMenu.folder?.is_shared
      ? folderLeaf('revoke-share', 'folder-action-revoke-share', !folderMenuAccess.canShare,
        folderMenuRun((folder) => { void handleRevokeFolderShare(folder.id); }),
        <LinkOutlinedIcon fontSize="small" />, 'Отключить ссылку')
      : null,
  ].filter(Boolean);
  const folderOrganizeItems = folderSharedWithMe ? [] : [
    folderLeaf('rename', 'folder-action-rename', !folderMenuAccess.canWrite,
      folderMenuRun((folder) => openRenameDialog('folder', folder.id, folder.name)),
      <DriveFileRenameOutlineRoundedIcon fontSize="small" />, 'Переименовать'),
    folderMenuAccess.library
      ? null
      : folderLeaf('favorite', 'folder-action-favorite', !folderMenuAccess.canWrite,
        folderMenuRun((folder) => { void handleToggleFavorite(folder, 'folder'); }),
        folderActionsMenu.folder?.is_favorite
          ? <StarRoundedIcon fontSize="small" sx={{ color: 'warning.main' }} />
          : <StarOutlineRoundedIcon fontSize="small" />,
        folderActionsMenu.folder?.is_favorite ? 'Убрать из избранного' : 'В избранное'),
    folderLeaf('move', 'folder-action-move', !folderMenuAccess.canWrite,
      folderMenuRun((folder) => openMoveDialog('folder', folder.id)),
      <DriveFileMoveOutlinedIcon fontSize="small" />, 'Переместить'),
  ].filter(Boolean);
  const folderMoreItems = [
    folderLeaf('details', 'folder-action-details', false,
      folderMenuRun((folder) => openDetailsFor('folder', folder)),
      <InfoOutlinedIcon fontSize="small" />, 'Сведения'),
  ];
  const folderGroup = (id, label, icon, items) => {
    if (items.length === 0) return null;
    if (items.length === 1) return items[0];
    return (
      <NestedMenuItem
        key={id}
        id={id}
        openSubmenu={folderSubmenu}
        onOpenSubmenu={setFolderSubmenu}
        onSubmenuEnter={cancelFolderSubmenuClose}
        label={label}
        icon={icon}
        testId={`folder-action-group-${id}`}
      >
        {items}
      </NestedMenuItem>
    );
  };

  return (
    <MainLayout showDatabaseSelector={false} headerMode="integrated">
      <PageShell>
        <PageTopBar title="Мои файлы" />
        <Box
          sx={{
            display: 'flex',
            gap: 2.5,
            alignItems: 'stretch',
          }}
        >
          {!isBelowLg ? (
            <MyFilesSidebar
              {...sidebarProps}
              collapsed={navCollapsed}
              onToggleCollapse={toggleNavCollapsed}
            />
          ) : null}
          <Drawer
            variant="temporary"
            anchor="left"
            open={navOpen}
            onClose={() => setNavOpen(false)}
            PaperProps={{
              sx: { width: 280 },
              'data-testid': 'my-files-nav-drawer',
            }}
          >
            <MyFilesSidebar
              {...sidebarProps}
              inDrawer
              onNavigate={() => setNavOpen(false)}
            />
          </Drawer>

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
                      ? `Загрузятся в папку «${breadcrumbs[breadcrumbs.length - 1]?.name || (isLibraryView ? libraryName : 'Мой диск')}»`
                      : `Загрузятся в «${isLibraryView ? libraryName : 'Мой диск'}»`}
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

            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                mb: 1.5,
                flexWrap: 'wrap',
                rowGap: 1,
              }}
            >
              {isBelowLg ? (
                <IconButton
                  aria-label="Открыть навигацию по файлам"
                  data-testid="my-files-nav-toggle"
                  onClick={() => setNavOpen(true)}
                  sx={{ flexShrink: 0 }}
                >
                  <MenuOutlinedIcon />
                </IconButton>
              ) : null}

              <Box sx={{ flex: '1 1 auto', minWidth: 0, display: 'flex', alignItems: 'center', gap: 1.5 }}>
                {isTrashView ? (
                  <>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700, minWidth: 0 }} noWrap>
                      {isLibraryView ? `Корзина — ${libraryName}` : 'Корзина'}
                    </Typography>
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
                  </>
                ) : isRecentView || isFavoritesView || (isSharedView && breadcrumbs.length === 0) ? (
                  <Typography variant="subtitle1" sx={{ fontWeight: 700, minWidth: 0 }} noWrap>
                    {isRecentView ? 'Недавние' : isSharedView ? 'Доступно мне' : 'Избранное'}
                  </Typography>
                ) : breadcrumbs.length > 0 ? (
                  <Breadcrumbs
                    aria-label="Путь по папкам"
                    data-testid="my-files-breadcrumbs"
                    maxItems={isXs ? 4 : 8}
                    itemsBeforeCollapse={1}
                    itemsAfterCollapse={2}
                    sx={{ minWidth: 0, flexShrink: 1 }}
                  >
                    <Link
                      component="button"
                      underline="hover"
                      color="text.secondary"
                      onClick={() => navigateToFolder(null)}
                      sx={{
                        fontWeight: 600,
                        cursor: 'pointer',
                        fontSize: '0.95rem',
                        minWidth: 0,
                        maxWidth: { xs: 140, sm: 260 },
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        display: 'inline-block',
                        verticalAlign: 'bottom',
                      }}
                    >
                      {isSharedView ? 'Доступно мне' : isLibraryView ? libraryName : 'Мой диск'}
                    </Link>
                    {breadcrumbs.map((crumb, index) => {
                      const isLast = index === breadcrumbs.length - 1;
                      return isLast ? (
                        <Typography
                          key={crumb.id}
                          color="text.primary"
                          sx={{
                            fontWeight: 700,
                            fontSize: '0.95rem',
                            minWidth: 0,
                            maxWidth: { xs: 160, sm: 360 },
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                          noWrap
                        >
                          {crumb.name}
                        </Typography>
                      ) : (
                        <Link
                          key={crumb.id}
                          component="button"
                          underline="hover"
                          color="text.secondary"
                          onClick={() => navigateToFolder(crumb.id)}
                          sx={{
                            fontWeight: 600,
                            cursor: 'pointer',
                            fontSize: '0.95rem',
                            minWidth: 0,
                            maxWidth: { xs: 120, sm: 240 },
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            display: 'inline-block',
                            verticalAlign: 'bottom',
                          }}
                        >
                          {crumb.name}
                        </Link>
                      );
                    })}
                  </Breadcrumbs>
                ) : (
                  <Typography variant="subtitle1" sx={{ fontWeight: 700, minWidth: 0 }} noWrap>{isLibraryView ? libraryName : 'Мой диск'}</Typography>
                )}
              </Box>

              <TextField
                size="small"
                placeholder="Поиск по всему диску"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                inputProps={{ 'data-testid': 'my-files-search-input', 'aria-label': 'Поиск файла или папки по всему диску' }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchOutlinedIcon fontSize="small" />
                    </InputAdornment>
                  ),
                  endAdornment: searchQuery ? (
                    <InputAdornment position="end">
                      <IconButton size="small" aria-label="Очистить поиск" onClick={() => setSearchQuery('')}>
                        <ClearRoundedIcon fontSize="small" />
                      </IconButton>
                    </InputAdornment>
                  ) : null,
                }}
                sx={{
                  order: { xs: 3, sm: 0 },
                  // Zoom- и узкоэкрано-устойчиво: резиновая ширина вместо жёстких px —
                  // на xs поле занимает отдельную строку, на sm+ может сжиматься до 140px.
                  flex: { xs: '1 1 100%', sm: '0 1 320px' },
                  minWidth: { xs: 0, sm: 140 },
                  maxWidth: '100%',
                  '& .MuiOutlinedInput-root': {
                    borderRadius: '999px',
                    bgcolor: alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.08 : 0.05),
                    '& fieldset': { borderColor: 'transparent' },
                    '&:hover fieldset': { borderColor: 'transparent' },
                    '&.Mui-focused': { bgcolor: 'background.paper', boxShadow: theme.shadows[3] },
                    '&.Mui-focused fieldset': { borderColor: theme.palette.primary.main },
                  },
                }}
              />

              <Stack
                direction="row"
                spacing={1}
                alignItems="center"
                sx={{
                  // Если кластер не помещается рядом с путём и поиском, он целиком
                  // переезжает на следующую строку и прижимается вправо; при нехватке
                  // места переносятся и его элементы — ничего не уезжает за край.
                  order: { xs: 2, sm: 0 },
                  flex: { xs: '1 1 auto', sm: '0 1 auto' },
                  minWidth: 0,
                  ml: 'auto',
                  flexWrap: 'wrap',
                  justifyContent: 'flex-end',
                  rowGap: 0.5,
                }}
              >
                {isLibraryView && libraryRole ? (
                  <Chip
                    size="small"
                    variant="outlined"
                    label={LIBRARY_ROLE_LABELS[libraryRole] || libraryRole}
                    data-testid="my-files-library-role"
                  />
                ) : null}
                {canManageLibrary && !isTrashView ? (
                  <Tooltip title="Корзина общей папки">
                    <IconButton
                      size="small"
                      aria-label="Корзина общей папки"
                      data-testid="my-files-library-trash"
                      onClick={() => navigateToLibrary(libraryId, { trash: true })}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                ) : null}
                {isLibraryView && (canManageLibraries || canManageLibrary) && activeLibrary ? (
                  <Tooltip title="Настройки общей папки">
                    <IconButton
                      size="small"
                      aria-label="Настройки общей папки"
                      data-testid="my-files-library-settings"
                      onClick={() => setLibraryDialog({ open: true, library: activeLibrary })}
                    >
                      <SettingsOutlinedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                ) : null}
                {!isTrashView ? (
                  <Stack direction="row" spacing={1} alignItems="center" data-testid="my-files-filters">
                    {[
                      ['type', typeFilter, typeFilterLabel(typeFilter) || 'Тип', TYPE_FILTERS, setTypeFilter],
                      ['date', dateFilter, dateFilterLabel(dateFilter) || 'Изменено', DATE_FILTERS, setDateFilter],
                    ].map(([kind, value, label, options, setValue]) => (
                      <Chip
                        key={kind}
                        clickable
                        variant={value ? 'filled' : 'outlined'}
                        color={value ? 'primary' : 'default'}
                        label={label}
                        data-testid={`my-files-filter-${kind}`}
                        onClick={(event) => setFilterMenu({ kind, anchor: event.currentTarget })}
                        onDelete={value ? () => setValue('') : undefined}
                        deleteIcon={value ? <ClearRoundedIcon /> : undefined}
                        icon={value ? undefined : <ArrowDropDownRoundedIcon />}
                        sx={{ borderRadius: '8px', flexDirection: 'row-reverse', pl: value ? 0 : 0.5, '& .MuiChip-icon': { ml: -0.5, mr: 0.5 } }}
                        aria-label={`Фильтр: ${label}`}
                        aria-haspopup="menu"
                        aria-controls={options.length ? `my-files-filter-menu-${kind}` : undefined}
                      />
                    ))}
                  </Stack>
                ) : null}
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
                  <ToggleButton value="grid" aria-label="Сетка" data-testid="my-files-view-grid">
                    <Tooltip title="Сетка"><GridViewOutlinedIcon fontSize="small" /></Tooltip>
                  </ToggleButton>
                </ToggleButtonGroup>
                <Tooltip title="Сведения">
                  <IconButton
                    aria-label="Сведения"
                    aria-pressed={detailsOpen}
                    data-testid="my-files-details-toggle"
                    color={detailsOpen ? 'primary' : 'default'}
                    onClick={() => setDetailsOpen((open) => !open)}
                  >
                    <InfoOutlinedIcon />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Обновить">
                  <IconButton aria-label="Обновить список" onClick={() => loadData({ silent: true })} disabled={refreshing}>
                    {refreshing ? <CircularProgress size={20} /> : <RefreshOutlinedIcon />}
                  </IconButton>
                </Tooltip>
              </Stack>
            </Box>

            {!isTrashView ? (
              <Menu
                id={`my-files-filter-menu-${filterMenu.kind}`}
                anchorEl={filterMenu.anchor}
                open={Boolean(filterMenu.anchor)}
                onClose={() => setFilterMenu({ kind: '', anchor: null })}
                disableScrollLock
              >
                {(filterMenu.kind === 'date' ? DATE_FILTERS : TYPE_FILTERS).map((option) => (
                  <MenuItem
                    key={option.value}
                    selected={(filterMenu.kind === 'date' ? dateFilter : typeFilter) === option.value}
                    data-testid={`my-files-filter-option-${option.value}`}
                    onClick={() => {
                      if (filterMenu.kind === 'date') setDateFilter(option.value);
                      else setTypeFilter(option.value);
                      setFilterMenu({ kind: '', anchor: null });
                    }}
                  >
                    {option.label}
                  </MenuItem>
                ))}
              </Menu>
            ) : null}

            {selectedKeys.size > 0 ? (
              <Paper
                variant="outlined"
                data-testid="my-files-selection-bar"
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 2,
                  py: 0.75,
                  mb: 1.5,
                  flexWrap: 'wrap',
                  borderRadius: '999px',
                  border: 'none',
                  bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.24 : 0.12),
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

            {showRetentionNotice && !isLibraryView ? (
              <Alert
                severity="info"
                sx={{ mb: 1.5 }}
                onClose={() => {
                  setShowRetentionNotice(false);
                  try { window.localStorage.setItem('my-files-retention-notice-dismissed', '1'); } catch { /* noop */ }
                }}
              >
                Файлы хранятся до 30 дней или бессрочно при выборе «Навсегда». Папки открываются как на диске — файлы внутри можно скачивать, делиться и перемещать.
              </Alert>
            ) : null}

            {uploading || readingDrop ? (
              <Paper
                elevation={8}
                data-testid="my-files-upload-card"
                sx={{
                  position: 'fixed',
                  right: { xs: 12, sm: 24 },
                  bottom: { xs: 12, sm: 24 },
                  left: { xs: 12, sm: 'auto' },
                  width: { sm: 360 },
                  maxHeight: '50vh',
                  overflowY: 'auto',
                  zIndex: theme.zIndex.snackbar,
                  borderRadius: 3,
                  p: 2,
                }}
              >
                <Stack spacing={0.75}>
                  {readingDrop ? (
                    <Typography variant="body2" color="text.secondary">Читаем перетащенную папку…</Typography>
                  ) : null}
                  {uploading ? (
                    <Box>
                      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                        <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 0 }}>
                          {uploadStats.total > 0
                            ? `Загрузка файлов: ${Math.min(uploadStats.done, uploadStats.total)} из ${uploadStats.total}`
                            : prepareStats.total > 0
                              ? `Создаём папки: ${Math.min(prepareStats.done, prepareStats.total)} из ${prepareStats.total}`
                              : 'Подготовка к загрузке…'}
                        </Typography>
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
                          {uploadStats.total > 0 ? (
                            <Typography variant="body2" color="text.secondary">{uploadOverallPercent}%</Typography>
                          ) : null}
                          <Button
                            size="small"
                            color="inherit"
                            onClick={cancelUpload}
                            data-testid="my-files-upload-cancel"
                            sx={{ minWidth: 0, px: 1, py: 0.25, lineHeight: 1.4 }}
                          >
                            Отмена
                          </Button>
                        </Stack>
                      </Stack>
                      <LinearProgress
                        variant={uploadStats.total > 0 || prepareStats.total > 0 ? 'determinate' : 'indeterminate'}
                        value={uploadStats.total > 0 ? uploadOverallPercent : preparePercent}
                        data-testid="my-files-upload-overall"
                      />
                    </Box>
                  ) : null}
                  {uploadActiveEntries.map(([key, progress]) => (
                    <Stack key={key} direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0, pl: 0.5 }}>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {progress.name}
                      </Typography>
                      <Typography
                        variant="caption"
                        color={progress.stalled ? 'warning.main' : 'text.secondary'}
                        sx={{ flex: '0 0 auto' }}
                      >
                        {progress.stalled ? 'зависло — восстанавливаем…' : `${progress.percent}%`}
                      </Typography>
                    </Stack>
                  ))}
                </Stack>
              </Paper>
            ) : null}

            {viewMode === 'list' ? (
            <Paper
              variant="outlined"
              // Контейнерная адаптивность колонок: ярусы rowGridColumns и
              // видимость второстепенных ячеек реагируют на ширину ЭТОГО блока
              // (inline-size), а не на viewport — обе боковые панели и панель
              // сведений сжимают таблицу задолго до media query.
              sx={{ ...getOfficePanelSx(ui), overflow: 'hidden', containerType: 'inline-size' }}
            >
              <Box
                sx={{
                  display: 'grid',
                  ...rowGridColumns(isTrashView),
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
                {isTrashView ? null : (
                  <TableSortLabel
                    active={sortField === 'owner'}
                    direction={sortField === 'owner' ? sortDir : 'asc'}
                    onClick={() => toggleSort('owner')}
                    sx={{ fontSize: '0.75rem', fontWeight: 700, color: 'text.secondary', ...secondaryColumnSx(ROW_COL_OWNER_MIN, 'flex') }}
                    data-testid="my-files-sort-owner"
                  >
                    Владелец
                  </TableSortLabel>
                )}
                <TableSortLabel
                  active={sortField === 'updated'}
                  direction={sortField === 'updated' ? sortDir : 'asc'}
                  onClick={() => toggleSort('updated')}
                  sx={{ fontSize: '0.75rem', fontWeight: 700, color: 'text.secondary', ...secondaryColumnSx(isTrashView ? ROW_COL_TRASH_DATE_MIN : ROW_COL_UPDATED_MIN, 'flex') }}
                  data-testid="my-files-sort-updated"
                >
                  {isTrashView ? 'Удалён' : 'Изменён'}
                </TableSortLabel>
                <TableSortLabel
                  active={sortField === 'size'}
                  direction={sortField === 'size' ? sortDir : 'asc'}
                  onClick={() => toggleSort('size')}
                  sx={{ fontSize: '0.75rem', fontWeight: 700, color: 'text.secondary', ...secondaryColumnSx(isTrashView ? ROW_COL_TRASH_RETENTION_MIN : ROW_COL_SIZE_MIN, 'flex') }}
                  data-testid="my-files-sort-size"
                >
                  Размер
                </TableSortLabel>
                <Box />
              </Box>

              {loading ? (
                <Box sx={{ px: 1, py: 0.5 }}>
                  {[0, 1, 2, 3].map((row) => (
                    <Stack key={row} direction="row" spacing={1.25} alignItems="center" sx={{ py: 0.75 }}>
                      {isTrashView ? null : <Skeleton variant="rounded" width={24} height={24} />}
                      <Skeleton variant="rounded" width={34} height={34} />
                      <Skeleton variant="text" sx={{ flex: 1, fontSize: '0.875rem' }} />
                      <Skeleton variant="text" width={110} sx={secondaryColumnSx(ROW_COL_UPDATED_MIN)} />
                      <Skeleton variant="text" width={70} sx={secondaryColumnSx(ROW_COL_SIZE_MIN)} />
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
                        : isSharedView
                          ? (currentFolderId ? 'В этой папке пока нет файлов.' : 'Вам пока никто не открыл файлы и папки для совместной работы.')
                          : isFavoritesView
                            ? 'В избранном пока пусто — отметьте файлы звёздочкой.'
                            : isLibraryView && !canWrite
                              ? 'В этой папке пока нет файлов.'
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

              {!loading && virtualRows.length > 0 ? (
                <VirtualListRows
                  rows={virtualRows}
                  rowHeight={MY_FILES_ROW_HEIGHT}
                  renderRow={(row) => (
                    row.kind === 'folder' ? (
                      <FolderRow
                        key={`folder-${row.entry.id}`}
                        folder={row.entry}
                        isTrashView={isTrashView}
                        currentUsername={currentUsername}
                        canWrite={accessOfEntry(row.entry).canWrite}
                        canShare={accessOfEntry(row.entry).canShare}
                        isSelected={selectedKeys.has(`folder:${row.entry.id}`)}
                        isDropTarget={dropTargetFolderId === String(row.entry.id)}
                        folderDropProps={folderDropProps}
                        folderDragProps={folderDragProps}
                        navigateToFolder={navigateToFolder}
                        openFolderActionsMenu={openFolderActionsMenu}
                        openRenameDialog={openRenameDialog}
                        handleFolderShare={handleFolderShare}
                        onFolderCollaborators={accessOfEntry(row.entry).canShare && officeStatus.enabled && !accessOfEntry(row.entry).library ? setCollaboratorsFolder : undefined}
                        handleDeleteFolder={handleDeleteFolder}
                        handleRestoreEntry={handleRestoreEntry}
                        handlePurgeEntry={handlePurgeEntry}
                        onToggleFavorite={accessOfEntry(row.entry).library ? undefined : handleToggleFavorite}
                        toggleSelected={toggleSelected}
                      />
                    ) : (
                      <FileRow
                        key={row.entry.id}
                        item={row.entry}
                        isTrashView={isTrashView}
                        currentUsername={currentUsername}
                        canWrite={accessOfEntry(row.entry).canWrite}
                        canShare={accessOfEntry(row.entry).canShare}
                        isSelected={selectedKeys.has(`file:${row.entry.id}`)}
                        downloading={downloadingFileId === row.entry.id}
                        fileDragProps={fileDragProps}
                        openDocumentPreview={openDocumentPreview}
                        openFileActionsMenu={openFileActionsMenu}
                        handleRestoreEntry={handleRestoreEntry}
                        handlePurgeEntry={handlePurgeEntry}
                        handleDownload={handleDownload}
                        handleShare={handleShare}
                        handleDelete={handleDelete}
                        onToggleFavorite={accessOfEntry(row.entry).library ? undefined : handleToggleFavorite}
                        onOpenSharedFile={openSharedFile}
                        onOpenVersions={setVersionsFile}
                        officeEditable={row.entry.shared_with_me ? isOfficeEditable(row.entry) : undefined}
                        opensInEditor={opensInEditor(row.entry)}
                        toggleSelected={toggleSelected}
                      />
                    )
                  )}
                />
              ) : null}
            </Paper>
            ) : (
            <MeasuredBox data-testid="my-files-grid">
              {(gridWidth) => (<>
              {!loading && visibleItems.length === 0 && visibleFolders.length === 0 ? (
                <Stack spacing={1.5} alignItems="center" sx={{ py: 6 }}>
                  {isTrashView
                    ? <DeleteOutlineIcon sx={{ fontSize: 44, color: 'text.disabled' }} />
                    : <FolderOutlinedIcon sx={{ fontSize: 44, color: 'text.disabled' }} />}
                  <Typography color="text.secondary" align="center">
                    {isTrashView ? 'Корзина пуста.' : isRecentView ? 'Нет недавних файлов.' : isSharedView ? (currentFolderId ? 'В этой папке пока нет файлов.' : 'Вам пока никто не открыл файлы и папки для совместной работы.') : isFavoritesView ? 'В избранном пока пусто — отметьте файлы звёздочкой.' : isLibraryView && !canWrite ? 'В этой папке пока нет файлов.' : 'Здесь пусто — перетащите файлы или папку.'}
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
                  <VirtualFolderGrid
                    items={visibleFolders}
                    width={gridWidth}
                    sx={{ mb: visibleItems.length > 0 ? 2 : 0 }}
                    renderItem={(folder) => (
                        <FolderCard
                          key={`folder-${folder.id}`}
                          folder={folder}
                          isTrashView={isTrashView}
                          canWrite={accessOfEntry(folder).canWrite}
                          isSelected={selectedKeys.has(`folder:${folder.id}`)}
                          isDropTarget={dropTargetFolderId === String(folder.id)}
                          folderDropProps={folderDropProps}
                          folderDragProps={folderDragProps}
                          navigateToFolder={navigateToFolder}
                          openFolderActionsMenu={openFolderActionsMenu}
                          handleRestoreEntry={handleRestoreEntry}
                          handlePurgeEntry={handlePurgeEntry}
                          onToggleFavorite={accessOfEntry(folder).library ? undefined : handleToggleFavorite}
                          onOpenSharedFile={openSharedFile}
                          toggleSelected={toggleSelected}
                        />
                    )}
                  />
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
                  <VirtualFileGrid
                    items={visibleItems}
                    width={gridWidth}
                    renderItem={(item) => (
                        <FileCard
                          key={item.id}
                          item={item}
                          isTrashView={isTrashView}
                          canWrite={accessOfEntry(item).canWrite}
                          isSelected={selectedKeys.has(`file:${item.id}`)}
                          thumbUrl={thumbs[String(item.id)] || ''}
                          fileDragProps={fileDragProps}
                          observeThumbTarget={observeThumbTarget}
                          openDocumentPreview={openDocumentPreview}
                          openFileActionsMenu={openFileActionsMenu}
                          handleRestoreEntry={handleRestoreEntry}
                          handlePurgeEntry={handlePurgeEntry}
                          onToggleFavorite={accessOfEntry(item).library ? undefined : handleToggleFavorite}
                          onOpenSharedFile={openSharedFile}
                          opensInEditor={opensInEditor(item)}
                          toggleSelected={toggleSelected}
                        />
                    )}
                  />
                </>
              ) : null}
              </>)}
            </MeasuredBox>
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

          {!isBelowLg && detailsOpen ? (
            <MyFilesDetailsPanel {...detailsPanelProps} />
          ) : null}
          <Drawer
            variant="temporary"
            anchor="right"
            open={isBelowLg && detailsOpen}
            onClose={() => setDetailsOpen(false)}
            PaperProps={{ sx: { width: 320 } }}
          >
            <MyFilesDetailsPanel {...detailsPanelProps} inDrawer />
          </Drawer>
        </Box>

          <FileActionsContextMenu
            open={Boolean(fileActionsMenu.anchorPosition)}
            anchorPosition={fileActionsMenu.anchorPosition}
            fileName={getMyFileName(fileActionsMenu.item)}
            onDetails={fileActionsMenu.item
              ? () => openDetailsFor('file', fileActionsMenu.item)
              : undefined}
            canDownload={Boolean(
              fileActionsMenu.item
              && READY_STATUSES.has(String(fileActionsMenu.item.status || '').toLowerCase()),
            )}
            busy={Boolean(
              fileActionsMenu.item
              && (downloadingFileId === String(fileActionsMenu.item.id || '')
                || exportingFileId === String(fileActionsMenu.item.id || '')),
            )}
            onClose={closeFileActionsMenu}
            onPreview={fileActionsMenu.item && !fileActionsMenu.item.shared_with_me && isMyFilePreviewSupported(fileActionsMenu.item)
              ? () => { void openDocumentPreview(fileActionsMenu.item, { forcePreview: true }); }
              : undefined}
            editOnlineLabel={fileActionsMenu.item?.shared_with_me || fileMenuAccess.library ? sharedOpenLabel(fileActionsMenu.item) : undefined}
            onEditOnline={isOfficeEditable(fileActionsMenu.item) && (fileMenuAccess.canWrite || fileMenuAccess.library || fileActionsMenu.item.shared_with_me)
              ? () => openOfficeEditor(fileActionsMenu.item)
              : undefined}
            onCollaborators={fileActionsMenu.item && fileMenuAccess.canManageAccess && READY_STATUSES.has(String(fileActionsMenu.item.status || '').toLowerCase())
              ? () => setCollaboratorsFile(fileActionsMenu.item)
              : undefined}
            onVersions={isOfficeEditable(fileActionsMenu.item) && (fileMenuAccess.canWrite || fileActionsMenu.item.shared_with_me)
              ? () => setVersionsFile(fileActionsMenu.item)
              : undefined}
            onDownload={fileActionsMenu.item
              ? () => { void handleDownload(fileActionsMenu.item); }
              : undefined}
            onExportPdf={isOfficeEditable(fileActionsMenu.item)
              ? () => { void handleExportPdf(fileActionsMenu.item); }
              : undefined}
            onRename={fileActionsMenu.item && fileMenuAccess.canWrite && !fileActionsMenu.item.shared_with_me
              ? () => openRenameDialog('file', fileActionsMenu.item.id, fileActionsMenu.item.original_file_name)
              : undefined}
            onMove={fileActionsMenu.item && fileMenuAccess.canWrite && !fileActionsMenu.item.shared_with_me
              ? () => openMoveDialog('file', fileActionsMenu.item.id)
              : undefined}
            onCopyTo={fileActionsMenu.item && hasPermission('my_files.write') && !isTrashView && !fileActionsMenu.item.shared_with_me && READY_STATUSES.has(String(fileActionsMenu.item.status || '').toLowerCase())
              ? () => setCopyDialogFile(fileActionsMenu.item)
              : undefined}
            onShare={fileActionsMenu.item && fileMenuAccess.canShare && READY_STATUSES.has(String(fileActionsMenu.item.status || '').toLowerCase())
              ? () => { void handleShare(fileActionsMenu.item); }
              : undefined}
            onRevokeShare={fileActionsMenu.item && fileMenuAccess.canShare && fileActionsMenu.item.is_shared
              ? () => { void handleRevokeShare(fileActionsMenu.item); }
              : undefined}
            isShared={Boolean(fileActionsMenu.item?.is_shared)}
            onAudit={fileActionsMenu.item && !fileActionsMenu.item.shared_with_me && (!fileMenuAccess.library || fileMenuAccess.canManage)
              ? () => setAuditDialogFile(fileActionsMenu.item)
              : undefined}
            onToggleFavorite={fileActionsMenu.item && fileMenuAccess.canWrite && !fileMenuAccess.library && !fileActionsMenu.item.shared_with_me
              ? () => { void handleToggleFavorite(fileActionsMenu.item, 'file'); }
              : undefined}
            isFavorite={Boolean(fileActionsMenu.item?.is_favorite)}
            onDelete={fileActionsMenu.item && fileMenuAccess.canWrite && !fileActionsMenu.item.shared_with_me
              ? () => { void handleDelete(fileActionsMenu.item); }
              : undefined}
          />

          <MyFilesCopyDialog
            open={Boolean(copyDialogFile)}
            file={copyDialogFile}
            libraries={libraries}
            onClose={() => setCopyDialogFile(null)}
            onCopied={(_copy, target) => {
              setCopyDialogFile(null);
              notifySuccess('Копия создана.', { source: 'my-files-copy', dedupeMode: 'none' });
              // The copy may land in a different folder — any cached listing can be stale.
              listingsCacheRef.current.clear();
              const sameSpace = String(target.libraryId || '') === String(libraryId || '');
              const sameFolder = String(target.folderId || '') === String(currentFolderId || '');
              if (sameSpace && sameFolder) void postMutationLoadData({ silent: true });
              if (!target.libraryId) void refreshQuota();
            }}
          />

          <MyFilesLibraryDialog
            open={libraryDialog.open}
            library={libraryDialog.library}
            membersOnly={!canManageLibraries}
            onClose={(changed, { removedId } = {}) => {
              setLibraryDialog({ open: false, library: null });
              if (!changed) return;
              void loadLibraries();
              if (removedId && String(removedId) === String(libraryId)) navigateToView(null);
              else if (libraryId) void postMutationLoadData({ silent: true });
            }}
          />

          <MyFileAuditDialog
            open={Boolean(auditDialogFile)}
            file={auditDialogFile}
            onClose={() => setAuditDialogFile(null)}
          />

          <MyFilesOfficeEditorDialog
            open={Boolean(officeEditorFile)}
            file={officeEditorFile}
            compareVersion={officeEditorCompare}
            onClose={closeOfficeEditor}
            onDownload={handleDownload}
          />
          <MyFilesCollaboratorsDialog
            open={Boolean(collaboratorsFile)}
            file={collaboratorsFile}
            onShareLink={(file) => { void handleShare(file); }}
            onClose={(saved) => {
              setCollaboratorsFile(null);
              if (saved) {
                notifySuccess('Совместный доступ обновлён.', { source: 'my-files-collaborators', dedupeMode: 'none' });
                void postMutationLoadData({ silent: true });
              }
            }}
          />
          <MyFilesCollaboratorsDialog
            open={Boolean(collaboratorsFolder)}
            folder={collaboratorsFolder}
            onClose={(saved) => {
              setCollaboratorsFolder(null);
              if (saved) {
                notifySuccess('Доступ к папке обновлён.', { source: 'my-files-collaborators', dedupeMode: 'none' });
                void postMutationLoadData({ silent: true });
              }
            }}
          />
          <MyFilesVersionsDialog
            open={Boolean(versionsFile)}
            file={versionsFile}
            canRestore={!versionsFile?.shared_with_me || versionsFile.my_role === 'edit'}
            onCompare={(row) => {
              setVersionsFile(null);
              void openOfficeEditor(versionsFile, { compare: row.id });
            }}
            onClose={(restored) => {
              setVersionsFile(null);
              if (restored) {
                notifySuccess('Версия возвращена.', { source: 'my-files-versions', dedupeMode: 'none' });
                void postMutationLoadData({ silent: true });
              }
            }}
          />

          <Menu
            open={Boolean(folderActionsMenu.anchorPosition) && Boolean(folderActionsMenu.folder)}
            onClose={closeFolderActionsMenu}
            anchorReference="anchorPosition"
            anchorPosition={folderActionsMenu.anchorPosition || undefined}
            MenuListProps={{ 'aria-label': `Действия с папкой ${folderActionsMenu.folder?.name || 'папка'}` }}
            // См. FileActionsContextMenu: scroll-lock на большом списке даёт
            // синхронный рефлоу всего документа при каждом открытии меню.
            disableScrollLock
            PaperProps={{
              sx: {
                minWidth: 220,
                borderRadius: '10px',
                boxShadow: '0 14px 36px rgba(2, 6, 23, 0.24)',
              },
            }}
          >
            {folderLeaf('open', 'folder-action-open', false,
              folderMenuRun((folder) => navigateToFolder(folder.id, folder.library_id)),
              <FolderOutlinedIcon fontSize="small" />, 'Открыть', true)}
            {folderSharedWithMe ? null : folderLeaf('archive', 'folder-action-archive', false,
              folderMenuRun((folder) => { void handleFolderArchive(folder); }),
              <ArchiveOutlinedIcon fontSize="small" />, 'Скачать папку (ZIP)', true)}
            {folderGroup('share', 'Поделиться', <ShareOutlinedIcon fontSize="small" />, folderShareItems)}
            {folderGroup('organize', 'Организовать', <DriveFileMoveOutlinedIcon fontSize="small" />, folderOrganizeItems)}
            {folderGroup('more', 'Дополнительно', <MoreHorizRoundedIcon fontSize="small" />, folderMoreItems)}
            {folderSharedWithMe ? null : <Divider />}
            {folderSharedWithMe ? null : (
              <MenuItem
                data-testid="folder-action-delete"
                disabled={!folderMenuAccess.canWrite}
                onClick={folderMenuRun((folder) => { void handleDeleteFolder(folder); })}
                onMouseEnter={scheduleFolderSubmenuClose}
                onMouseLeave={cancelFolderSubmenuClose}
                sx={{ minHeight: 40, color: 'error.main' }}
              >
                <ListItemIcon sx={{ color: 'inherit' }}><DeleteOutlineIcon fontSize="small" /></ListItemIcon>
                <ListItemText>Удалить</ListItemText>
              </MenuItem>
            )}
          </Menu>

        <Dialog open={uploadDialogOpen} onClose={closeUploadDialog} maxWidth="sm" fullWidth>
          <DialogTitle>{pendingFolderSummary ? 'Загрузка папки' : 'Загрузка файлов'}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              {isLibraryView ? (
                <Alert severity="info" data-testid="my-files-library-upload-notice">
                  Файлы общей папки «{libraryName}» хранятся бессрочно и занимают её лимит, а не ваш личный.
                  {quotaLimit > 0 ? ` Лимит папки: ${formatFileSize(quotaLimit)}.` : ''}
                </Alert>
              ) : Number(retentionDays) === 0 ? (
                <Alert severity="info">
                  Файлы будут храниться бессрочно, пока вы их не удалите. Они занимают место в квоте.
                  {quotaLimit > 0 ? ` Лимит хранилища: ${formatFileSize(quotaLimit)}.` : ''}
                </Alert>
              ) : (
                <Alert severity="warning">
                  Файлы будут удалены по окончании выбранного срока хранения. Публичные ссылки также перестанут работать.
                  {quotaLimit > 0 ? ` Лимит хранилища: ${formatFileSize(quotaLimit)}.` : ''}
                </Alert>
              )}
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
              <Box sx={isLibraryView ? { display: 'none' } : undefined}>
                <Typography variant="subtitle2" sx={{ mb: 0.75, fontWeight: 700 }}>Срок хранения</Typography>
                <Select
                  fullWidth
                  size="small"
                  value={retentionDays}
                  onChange={(event) => setRetentionDays(Number(event.target.value))}
                  inputProps={{ 'aria-label': 'Срок хранения' }}
                >
                  {myFilesRetentionOptions.map((days) => (
                    <MenuItem key={days} value={days}>{formatMyFilesRetentionLabel(days)}</MenuItem>
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
          subtitle={documentPreview.kind === 'image' ? 'Изображение' : documentPreview.kind === 'office_view' ? 'Просмотр (только чтение)' : documentPreview.kind === 'markdown' ? 'Markdown' : documentPreview.kind === 'csv' ? 'CSV-таблица' : documentPreview.kind === 'text' ? 'Текст' : documentPreview.sourceKind === 'excel' ? 'Excel' : 'PDF-предпросмотр'}
          kind={documentPreview.kind}
          sourceKind={documentPreview.sourceKind}
          objectUrl={documentPreview.objectUrl}
          excelWorkbook={documentPreview.excelWorkbook}
          officeView={documentPreview.officeView}
          textPreview={documentPreview.textPreview}
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
          onRotateShare={shareDialog.item
            ? () => void handleShare(shareDialog.item, { rotate: true })
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
          onRotateShare={folderShareDialog.folder
            ? () => void handleFolderShare(folderShareDialog.folder, { rotate: true })
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

        <Dialog
          open={Boolean(confirmState)}
          onClose={() => (confirmBusy ? undefined : setConfirmState(null))}
          maxWidth="xs"
          fullWidth
        >
          <DialogTitle>{confirmState?.title || 'Подтвердите действие'}</DialogTitle>
          <DialogContent>
            <Typography variant="body2">{confirmState?.body || ''}</Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirmState(null)} disabled={confirmBusy}>Отмена</Button>
            <Button
              variant="contained"
              color={confirmState?.danger ? 'error' : 'primary'}
              onClick={() => void runConfirm()}
              disabled={confirmBusy}
              data-testid="my-files-confirm-action"
            >
              {confirmState?.confirmLabel || 'Подтвердить'}
            </Button>
          </DialogActions>
        </Dialog>
      </PageShell>
    </MainLayout>
  );
}
