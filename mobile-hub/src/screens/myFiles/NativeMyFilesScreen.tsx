import { russianPlural } from '../../utils/russianPlural';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  type ListRenderItemInfo,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  createMyFileFolder,
  createMyFileFolderArchiveGrant,
  createMyFileFolderShare,
  createMyFileShare,
  deleteMyFile,
  deleteMyFileFolder,
  emptyMyFilesTrash,
  getMyFilePreview,
  getMyFilesQuota,
  listMyFileFolders,
  listMyFiles,
  listMyFilesTrash,
  purgeMyFile,
  purgeMyFileFolder,
  restoreMyFile,
  restoreMyFileFolder,
  revokeMyFileFolderShare,
  revokeMyFileShare,
  updateMyFile,
  updateMyFileFolder,
  type MyFileFolder,
  type MyFileRecord,
  type MyFilesQuota,
} from '../../api/myFilesApi';
import { formatApiError } from '../../api/formatError';
import { HUB_WEB_ORIGIN } from '../../api/config';
import { useAuth } from '../../auth/AuthContext';
import {
  readNativeEntitySnapshot,
  readNativeCollectionSnapshot,
  readNativeSnapshot,
  writeNativeEntitySnapshot,
  writeNativeCollectionSnapshot,
  writeNativeSnapshot,
} from '../../cache/nativeSnapshotCache';
import {
  NativeMyFileCard,
  type MyFileCardAction,
} from '../../components/myFiles/NativeMyFileCard';
import { NativeMyFileFolderCard } from '../../components/myFiles/NativeMyFileFolderCard';
import {
  NativeMyFilePreviewModal,
  type NativeMyFilePreviewState,
} from '../../components/myFiles/NativeMyFilePreviewModal';
import {
  NativeMyFilesActionSheet,
  NativeMyFilesMoveSheet,
  NativeMyFilesPromptSheet,
  type MyFilesSheetAction,
} from '../../components/myFiles/NativeMyFilesSheets';
import { useAndroidBackHandler } from '../../chat/useAndroidBackHandler';
import { openNativeFile, shareNativeFile } from '../../files/nativeAttachmentDownloads';
import {
  buildMyFileDownloadGrantUrl,
  buildMyFilePublicFolderUrl,
  buildMyFilePublicUrl,
  formatMyFileSize,
  isMyFileProcessing,
  MY_FILES_RETENTION_OPTIONS,
  myFileMimeType,
  myFileName,
  nativeMyFilePreviewKind,
} from '../../myFiles/nativeMyFilesModel';
import {
  downloadNativeMyFile,
  downloadNativeMyFilePreview,
  pickNativeMyFiles,
  pickNativeMyFilesFolder,
  readNativeMyFileTextPreview,
  uploadNativeMyFile,
} from '../../myFiles/nativeMyFilesTransfers';
import {
  getNativeMyFilesOfflineFile,
  getNativeMyFilesOfflineIds,
  pinNativeMyFileOffline,
  listNativeMyFilesOffline,
  removeNativeMyFileOffline,
} from '../../myFiles/nativeMyFilesOfflineStore';
import {
  type NativeMyFileDetailSnapshot,
  type NativeMyFilesInboxSnapshot,
} from '../../myFiles/nativeMyFilesSnapshot';
import { usePreferences } from '../../preferences/PreferencesContext';
import { shareNativeText } from '../../share/nativeOutgoingShare';
import { useFluentTokens } from '../../theme/fluentTokens';
import { NativeSegmentedControl } from '../../components/ui/NativeFilterControls';
import { AccountScreenScaffold, AccountSectionCard, AccountSubpage } from '../account/AccountChrome';

const PROCESSING_POLL_MS = 4_000;
// Сервер допускает max_uploading_per_user=2; при меньшем лимите сессия ждёт
// свободный слот через 429-retry внутри uploadNativeMyFile.
const MY_FILES_UPLOAD_CONCURRENCY = 2;

type MyFilesViewMode = 'files' | 'recent' | 'favorites' | 'trash' | 'offline';

type BusyFile = { id: string; action: MyFileCardAction } | null;
type UploadState = { name: string; index: number; totalFiles: number; progress: number | null } | null;
type ListRow = { kind: 'folder'; folder: MyFileFolder } | { kind: 'file'; file: MyFileRecord };
type PromptState =
  | { kind: 'create-folder' }
  | { kind: 'rename-file'; file: MyFileRecord }
  | { kind: 'rename-folder'; folder: MyFileFolder }
  | null;

const VIEW_OPTIONS: { value: MyFilesViewMode; label: string }[] = [
  { value: 'offline', label: 'На устройстве' },
  { value: 'files', label: 'Файлы' },
  { value: 'recent', label: 'Недавние' },
  { value: 'favorites', label: 'Избранное' },
  { value: 'trash', label: 'Корзина' },
];

const VIEW_ICONS: Record<MyFilesViewMode, ComponentProps<typeof MaterialCommunityIcons>['name']> = {
  offline: 'cellphone-arrow-down',
  files: 'folder-outline',
  recent: 'history',
  favorites: 'star-outline',
  trash: 'delete-outline',
};

export function NativeMyFilesScreen() {
  const { user, hasPermission } = useAuth();
  const scope = ['my_files.read', 'my_files.write', 'my_files.share'].map(permission => hasPermission(permission)).join('|');
  return <NativeMyFilesContent key={`${user?.id || 0}|${scope}`} />;
}

function NativeMyFilesContent() {
  const { user, hasPermission, offlineMode } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const canRead = hasPermission('my_files.read');
  const canWrite = hasPermission('my_files.write');
  const canShare = hasPermission('my_files.share');
  const userId = Number(user?.id || 0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [viewPickerOpen, setViewPickerOpen] = useState(false);
  const [view, setView] = useState<MyFilesViewMode>('files');
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [currentFolder, setCurrentFolder] = useState<MyFileFolder | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<MyFileFolder[]>([]);
  const [items, setItems] = useState<MyFileRecord[]>([]);
  const [folders, setFolders] = useState<MyFileFolder[]>([]);
  const [allFolders, setAllFolders] = useState<MyFileFolder[]>([]);
  const [fileQuery, setFileQuery] = useState('');
  const [offlineFileIds, setOfflineFileIds] = useState<Set<string>>(() => new Set());
  const [quota, setQuota] = useState<MyFilesQuota | null>(null);
  const [retentionDays, setRetentionDays] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploadState, setUploadState] = useState<UploadState>(null);
  const [packingFolder, setPackingFolder] = useState(false);
  const [busyFile, setBusyFile] = useState<BusyFile>(null);
  const [busyFolderId, setBusyFolderId] = useState<string | null>(null);
  const [preview, setPreview] = useState<NativeMyFilePreviewState>(null);
  const [fileActionsTarget, setFileActionsTarget] = useState<MyFileRecord | null>(null);
  const [folderActionsTarget, setFolderActionsTarget] = useState<MyFileFolder | null>(null);
  const [prompt, setPrompt] = useState<PromptState>(null);
  const [promptBusy, setPromptBusy] = useState(false);
  const [moveTarget, setMoveTarget] = useState<MyFileRecord | null>(null);
  const [moveBusy, setMoveBusy] = useState(false);
  const [error, setError] = useState('');
  const [listUnavailable, setListUnavailable] = useState(false);
  const [notice, setNotice] = useState('');
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const uploadAbortRef = useRef<AbortController | null>(null);
  const uploadLockRef = useRef(false);
  const uploadGeneration = useRef(0);
  const fileActionLockRef = useRef(false);
  const mountedRef = useRef(true);
  const focusedRef = useRef(false);
  const loadAbortRef = useRef<AbortController | null>(null);
  const loadRequestRef = useRef(0);
  const loadedScopeRef = useRef('');

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      uploadAbortRef.current?.abort();
      loadAbortRef.current?.abort();
    };
  }, []);

  useLayoutEffect(() => {
    uploadGeneration.current += 1;
    uploadAbortRef.current?.abort();
  }, [userId, canWrite, offlineMode]);

  const loadData = useCallback(async ({ refresh = false, silent = false, poll = false } = {}) => {
    if (poll && (!focusedRef.current || loadAbortRef.current)) return;
    loadAbortRef.current?.abort();
    const requestId = ++loadRequestRef.current;
    if (!canRead) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    loadAbortRef.current = controller;
    const current = () => mountedRef.current && requestId === loadRequestRef.current && !controller.signal.aborted;
    try {
      if (refresh) setRefreshing(true);
      else if (!silent) setLoading(true);
      if (!silent) setError('');
      const signature = JSON.stringify([view, currentFolderId]);
      if (view === 'offline') {
        const local = await listNativeMyFilesOffline(userId);
        if (!current()) return;
        loadedScopeRef.current = signature;
        setItems(local); setFolders([]); setBreadcrumbs([]); setCurrentFolder(null);
        setOfflineFileIds(new Set(local.map(item => item.id)));
        setListUnavailable(false); setError('');
        return;
      }
      let cached = loadedScopeRef.current === signature;
      if (!cached) {
        loadedScopeRef.current = '';
        setItems([]); setFolders([]); setBreadcrumbs([]); setCurrentFolder(null);
      }
      const cacheable = view === 'files' && !currentFolderId;
      if (userId && !cached) {
        const snapshot = await readNativeCollectionSnapshot<NativeMyFilesInboxSnapshot>('my-files-lists', userId, signature)
          || (cacheable ? await readNativeSnapshot<NativeMyFilesInboxSnapshot>('my-files-inbox', userId) : null);
        if (!current()) return;
        if (snapshot) {
          cached = true;
          loadedScopeRef.current = signature;
          setListUnavailable(false);
          setItems(snapshot.data.items);
          setFolders(snapshot.data.folders || []);
          setQuota(snapshot.data.quota);
          setBreadcrumbs(snapshot.data.breadcrumbs || []);
          setCurrentFolder(snapshot.data.folder || null);
          setLoading(false);
        }
      }
      if (offlineMode) {
        setListUnavailable(!cached);
        if (!cached && !silent) setError('Нет подключения и сохранённого списка файлов.');
        setLoading(false);
        setRefreshing(false);
        return;
      }
      const listPromise = view === 'trash'
        ? listMyFilesTrash(controller.signal).then((trash) => ({
          items: trash.items,
          folders: trash.folders,
          breadcrumbs: [] as MyFileFolder[],
          folder: null as MyFileFolder | null,
        }))
        : listMyFiles({
          folderId: view === 'files' ? currentFolderId : null,
          view: view === 'recent' || view === 'favorites' ? view : '',
          signal: controller.signal,
        });
      const [filesResult, quotaResult] = await Promise.allSettled([listPromise, getMyFilesQuota(controller.signal)]);
      if (!current()) return;
      const errors: string[] = [];
      setListUnavailable(filesResult.status === 'rejected');
      if (filesResult.status === 'fulfilled') {
        loadedScopeRef.current = signature;
        setItems(filesResult.value.items);
        setFolders(filesResult.value.folders);
        setBreadcrumbs(filesResult.value.breadcrumbs);
        setCurrentFolder(filesResult.value.folder);
      } else {
        errors.push(formatApiError(filesResult.reason, 'Не удалось загрузить список файлов.'));
      }
      if (quotaResult.status === 'fulfilled') setQuota(quotaResult.value);
      else errors.push(formatApiError(quotaResult.reason, 'Не удалось загрузить квоту.'));
      setError(errors.join(' '));
      if (userId && filesResult.status === 'fulfilled') {
        void writeNativeCollectionSnapshot<NativeMyFilesInboxSnapshot>('my-files-lists', userId, signature, {
          ...filesResult.value,
          quota: quotaResult.status === 'fulfilled' ? quotaResult.value : null,
        });
      }
      if (userId && cacheable && filesResult.status === 'fulfilled' && quotaResult.status === 'fulfilled') {
        void writeNativeSnapshot<NativeMyFilesInboxSnapshot>('my-files-inbox', userId, {
          items: filesResult.value.items,
          folders: filesResult.value.folders,
          quota: quotaResult.value,
        });
      }
      setLoading(false);
      setRefreshing(false);
    } catch (cause) {
      if (current()) {
        setListUnavailable(true);
        setError(formatApiError(cause, 'Не удалось обновить список файлов.'));
      }
    } finally {
      if (requestId === loadRequestRef.current) {
        loadAbortRef.current = null;
        if (current()) { setLoading(false); setRefreshing(false); }
      }
    }
  }, [canRead, currentFolderId, offlineMode, userId, view]);

  const loadAllFolders = useCallback(async () => {
    if (!canRead || offlineMode) return;
    try {
      const next = await listMyFileFolders();
      if (mountedRef.current) setAllFolders(next);
    } catch {
      // The move picker tolerates an empty list; the error surfaces on retry.
    }
  }, [canRead, offlineMode]);

  useFocusEffect(useCallback(() => {
    focusedRef.current = true;
    void loadData();
    return () => {
      focusedRef.current = false;
      loadAbortRef.current?.abort();
      loadAbortRef.current = null;
      loadRequestRef.current += 1;
    };
  }, [loadData]));

  useEffect(() => {
    let active = true;
    if (!userId || !items.length) {
      setOfflineFileIds(new Set());
      return () => { active = false; };
    }
    void getNativeMyFilesOfflineIds(userId, items)
      .then((ids) => {
        if (active) setOfflineFileIds(ids);
      })
      .catch(() => {
        if (active) setOfflineFileIds(new Set());
      });
    return () => { active = false; };
  }, [items, userId]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setAppActive(state === 'active');
      if (state === 'active' && focusedRef.current) void loadData({ silent: true, poll: true });
    });
    return () => subscription.remove();
  }, [loadData]);

  const hasProcessing = useMemo(() => items.some(isMyFileProcessing), [items]);
  useEffect(() => {
    if (!hasProcessing || offlineMode || !appActive) return undefined;
    const timer = setInterval(() => { void loadData({ silent: true, poll: true }); }, PROCESSING_POLL_MS);
    return () => clearInterval(timer);
  }, [appActive, hasProcessing, loadData, offlineMode]);

  const selectView = useCallback((next: MyFilesViewMode) => {
    setView(next);
    setViewPickerOpen(false);
    setFileQuery('');
    setFileActionsTarget(null);
    setFolderActionsTarget(null);
    if (next !== 'files') {
      setCurrentFolderId(null);
      setBreadcrumbs([]);
      setCurrentFolder(null);
    }
  }, []);

  const openFolder = useCallback((folder: MyFileFolder) => {
    setFileQuery('');
    if (view !== 'files') setView('files');
    setCurrentFolderId(folder.id);
  }, [view]);

  const navigateToFolder = useCallback((folderId: string | null) => {
    setFileQuery('');
    setCurrentFolderId(folderId);
  }, []);

  useAndroidBackHandler(() => {
    if (view === 'files' && currentFolderId) {
      const parent = breadcrumbs.length >= 2 ? breadcrumbs[breadcrumbs.length - 2].id : null;
      navigateToFolder(parent);
      return true;
    }
    return false;
  });

  const uploadFolderId = view === 'files' ? currentFolderId : null;

  const startUpload = useCallback(async (source: 'files' | 'folder' = 'files') => {
    if (!canWrite || offlineMode || uploadState || packingFolder || uploadLockRef.current) return;
    uploadLockRef.current = true;
    const generation = uploadGeneration.current;
    const current = () => mountedRef.current && generation === uploadGeneration.current;
    setError('');
    setNotice('');
    try {
      if (source === 'folder') setPackingFolder(true);
      const files = source === 'folder'
        ? [await pickNativeMyFilesFolder()].filter((file): file is NonNullable<typeof file> => Boolean(file))
        : await pickNativeMyFiles();
      if (!current()) return;
      setPackingFolder(false);
      if (!files.length) return;
      const selectedBytes = files.reduce((sum, file) => sum + file.size, 0);
      if (quota && selectedBytes > quota.remaining_bytes) {
        throw new Error(`Недостаточно места: выбрано ${formatMyFileSize(selectedBytes)}, свободно ${formatMyFileSize(quota.remaining_bytes)}`);
      }
      const controller = new AbortController();
      uploadAbortRef.current = controller;
      const totalBytes = Math.max(1, files.reduce((sum, file) => sum + file.size, 0));
      const inflightBytes = new Map<number, number>();
      const inflightNames = new Map<number, string>();
      let nextIndex = 0;
      let uploaded = 0;
      let completedBytes = 0;
      const failures: string[] = [];
      const reportProgress = () => {
        if (!current()) return;
        const sent = [...inflightBytes.values()].reduce((sum, value) => sum + value, 0);
        setUploadState({
          name: [...inflightNames.values()].slice(0, 2).join(', '),
          index: Math.min(files.length, uploaded + inflightNames.size || 1),
          totalFiles: files.length,
          progress: Math.min(1, (completedBytes + sent) / totalBytes),
        });
      };
      const runNext = async (): Promise<void> => {
        while (current() && !controller.signal.aborted) {
          const index = nextIndex;
          nextIndex += 1;
          if (index >= files.length) return;
          const file = files[index];
          inflightNames.set(index, file.name);
          reportProgress();
          try {
            await uploadNativeMyFile(file, retentionDays, {
              signal: controller.signal,
              folderId: uploadFolderId,
              onProgress: ({ loaded }) => {
                inflightBytes.set(index, Math.max(0, Number(loaded) || 0));
                reportProgress();
              },
            });
            uploaded += 1;
            completedBytes += file.size;
          } catch (cause) {
            if (controller.signal.aborted || (cause instanceof Error && cause.name === 'AbortError')) return;
            failures.push(`«${file.name}» — ${formatApiError(cause, 'ошибка загрузки')}`);
          } finally {
            inflightNames.delete(index);
            inflightBytes.delete(index);
            reportProgress();
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(MY_FILES_UPLOAD_CONCURRENCY, files.length) }, runNext));
      if (!current()) return;
      if (controller.signal.aborted) {
        setNotice('Загрузка отменена. Список обновлён, чтобы проверить состояние файла.');
      } else {
        if (uploaded > 0) setNotice(`Файлов добавлено в очередь: ${uploaded}. Идёт проверка безопасности.`);
        if (failures.length) {
          setError(`Не удалось загрузить: ${failures.slice(0, 3).join('; ')}${failures.length > 3 ? ` и ещё ${failures.length - 3}` : ''}. Загрузку можно повторить.`);
        }
      }
    } catch (cause) {
      if (!current()) return;
      if (cause instanceof Error && cause.name === 'AbortError') {
        setNotice('Загрузка отменена. Список обновлён, чтобы проверить состояние файла.');
      } else {
        setError(formatApiError(cause, 'Не удалось загрузить файл. Результат мог остаться неопределённым — сначала обновите список.'));
      }
    } finally {
      uploadLockRef.current = false;
      uploadAbortRef.current = null;
      if (mountedRef.current) {
        setPackingFolder(false);
        setUploadState(null);
        if (current()) await loadData({ silent: true });
      }
    }
  }, [canWrite, loadData, offlineMode, packingFolder, quota, retentionDays, uploadFolderId, uploadState]);

  const runFileAction = useCallback(async (
    item: MyFileRecord,
    action: MyFileCardAction,
    operation: () => Promise<void>,
    options: { allowOffline?: boolean } = {},
  ) => {
    if (!mountedRef.current || busyFile || (offlineMode && !options.allowOffline) || fileActionLockRef.current) return;
    fileActionLockRef.current = true;
    setBusyFile({ id: item.id, action });
    setError('');
    setNotice('');
    try {
      await operation();
    } catch (cause) {
      if (mountedRef.current) setError(formatApiError(cause, 'Не удалось выполнить действие с файлом.'));
    } finally {
      fileActionLockRef.current = false;
      if (mountedRef.current) setBusyFile(null);
    }
  }, [busyFile, offlineMode]);

  const runFolderAction = useCallback(async (
    folder: MyFileFolder,
    action: string,
    operation: () => Promise<void>,
  ) => {
    if (!mountedRef.current || offlineMode || fileActionLockRef.current) return;
    fileActionLockRef.current = true;
    setBusyFolderId(folder.id);
    setError('');
    setNotice('');
    try {
      await operation();
    } catch (cause) {
      if (mountedRef.current) setError(formatApiError(cause, 'Не удалось выполнить действие с папкой.'));
    } finally {
      fileActionLockRef.current = false;
      if (mountedRef.current) setBusyFolderId(null);
    }
  }, [offlineMode]);

  const openFile = useCallback((item: MyFileRecord) => {
    void runFileAction(item, 'open', async () => {
      const file = view === 'offline'
        ? await getNativeMyFilesOfflineFile(userId, item)
        : await downloadNativeMyFile(item, { userId });
      if (!file) throw new Error('Локальная копия недоступна. Обновите список на устройстве.');
      if (!mountedRef.current) return;
      await openNativeFile(file, myFileMimeType(item));
    }, { allowOffline: true });
  }, [runFileAction, userId, view]);

  const openPreview = useCallback((item: MyFileRecord) => {
    void runFileAction(item, 'preview', async () => {
      const previewKind = nativeMyFilePreviewKind(item);
      if (!previewKind) throw new Error('Предпросмотр этого файла недоступен');
      if (previewKind === 'text') {
        const file = await downloadNativeMyFile(item, { userId });
        if (!mountedRef.current) return;
        const text = await readNativeMyFileTextPreview(file);
        if (mountedRef.current) setPreview({ kind: 'text', fileName: myFileName(item), text });
        return;
      }
      const offlineFile = userId ? await getNativeMyFilesOfflineFile(userId, item) : null;
      if (!mountedRef.current) return;
      const mimeType = myFileMimeType(item).split(';', 1)[0].trim().toLowerCase();
      if (offlineFile && previewKind === 'image' && mimeType.startsWith('image/')) {
        if (mountedRef.current) setPreview({ kind: 'image', fileName: myFileName(item), imageUri: offlineFile.uri });
        return;
      }
      if (offlineFile && previewKind === 'pdf' && mimeType === 'application/pdf') {
        await openNativeFile(offlineFile, mimeType);
        return;
      }
      const cached = userId
        ? await readNativeEntitySnapshot<NativeMyFileDetailSnapshot>('my-file-details', userId, item.id)
        : null;
      if (!mountedRef.current) return;
      let metadata = cached?.data.preview;
      if (!offlineMode) {
        metadata = await getMyFilePreview(item.id);
        if (!mountedRef.current) return;
        if (userId) {
          void writeNativeEntitySnapshot<NativeMyFileDetailSnapshot>('my-file-details', userId, item.id, {
            preview: metadata,
          });
        }
      }
      if (!metadata) throw new Error('Предпросмотр ещё не сохранён. Откройте файл один раз при наличии интернета');
      const downloaded = await downloadNativeMyFilePreview(item, metadata);
      if (!mountedRef.current) return;
      if (previewKind === 'pdf') {
        await openNativeFile(downloaded.file, downloaded.mimeType);
        return;
      }
      if (mountedRef.current) {
        setPreview({ kind: 'image', fileName: myFileName(item), imageUri: downloaded.file.uri });
      }
    }, { allowOffline: true });
  }, [offlineMode, runFileAction, userId]);

  const shareFile = useCallback((item: MyFileRecord) => {
    void runFileAction(item, 'share-file', async () => {
      const file = view === 'offline'
        ? await getNativeMyFilesOfflineFile(userId, item)
        : await downloadNativeMyFile(item, { userId });
      if (!file) throw new Error('Локальная копия недоступна. Обновите список на устройстве.');
      if (!mountedRef.current) return;
      await shareNativeFile(file, myFileName(item), myFileMimeType(item));
    }, { allowOffline: true });
  }, [runFileAction, userId, view]);

  const saveOffline = useCallback((item: MyFileRecord) => {
    void runFileAction(item, 'save-offline', async () => {
      if (!userId) throw new Error('Не удалось определить владельца файла');
      const source = await downloadNativeMyFile(item, { userId });
      if (!mountedRef.current) return;
      await pinNativeMyFileOffline(userId, item, source);
      if (mountedRef.current) {
        setOfflineFileIds((current) => new Set(current).add(item.id));
        setNotice(`«${myFileName(item)}» теперь доступен без сети.`);
      }
    }, { allowOffline: true });
  }, [runFileAction, userId]);

  const removeOffline = useCallback((item: MyFileRecord) => {
    void runFileAction(item, 'remove-offline', async () => {
      if (!userId) return;
      await removeNativeMyFileOffline(userId, item.id);
      if (mountedRef.current) {
        if (view === 'offline') setItems(current => current.filter(row => row.id !== item.id));
        setOfflineFileIds((current) => {
          const next = new Set(current);
          next.delete(item.id);
          return next;
        });
        setNotice(`Офлайн-копия «${myFileName(item)}» удалена; файл на сервере сохранён.`);
      }
    }, { allowOffline: true });
  }, [runFileAction, userId, view]);

  const deliverShareLink = useCallback(async (item: MyFileRecord, rotate: boolean) => {
    const share = await createMyFileShare(item.id, rotate);
    if (!mountedRef.current) return;
    const url = buildMyFilePublicUrl(share.token, HUB_WEB_ORIGIN);
    await shareNativeText({ title: myFileName(item), text: 'Публичная ссылка HUB-IT', url });
    if (mountedRef.current) {
      const expiresAt = share.expires_at || item.expires_at;
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, is_shared: true, share_expires_at: expiresAt } : entry));
      setNotice(rotate ? 'Создана новая публичная ссылка. Предыдущая ссылка отключена.' : 'Публичная ссылка готова.');
    }
  }, []);

  const shareLink = useCallback((item: MyFileRecord) => {
    void runFileAction(item, 'share-link', async () => {
      await deliverShareLink(item, false);
    });
  }, [deliverShareLink, runFileAction]);

  const confirmRotate = useCallback((item: MyFileRecord) => {
    Alert.alert(
      'Создать новую ссылку?',
      'Предыдущая публичная ссылка сразу перестанет работать. Новая будет доступна только до срока хранения файла.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Создать новую',
          onPress: () => runFileAction(item, 'rotate', async () => {
            await deliverShareLink(item, true);
          }),
        },
      ],
    );
  }, [deliverShareLink, runFileAction]);

  const confirmRevoke = useCallback((item: MyFileRecord) => {
    Alert.alert('Отключить публичную ссылку?', 'У получателей ссылка перестанет открываться.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Отключить',
        style: 'destructive',
        onPress: () => {
          void runFileAction(item, 'revoke', async () => {
            await revokeMyFileShare(item.id);
            if (mountedRef.current) setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, is_shared: false, share_expires_at: null } : entry));
          });
        },
      },
    ]);
  }, [runFileAction]);

  const toggleFileFavorite = useCallback((item: MyFileRecord) => {
    const next = !item.is_favorite;
    void runFileAction(item, 'favorite', async () => {
      const updated = await updateMyFile(item.id, { isFavorite: next });
      if (mountedRef.current) {
        setItems((current) => current.map((entry) => entry.id === item.id ? updated : entry));
        setNotice(next ? 'Файл добавлен в избранное.' : 'Файл убран из избранного.');
      }
    });
  }, [runFileAction]);

  const confirmDelete = useCallback((item: MyFileRecord) => {
    Alert.alert('Удалить файл?', `${myFileName(item)} — файл попадёт в корзину.`, [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: () => {
          void runFileAction(item, 'delete', async () => {
            await deleteMyFile(item.id);
            if (userId) await removeNativeMyFileOffline(userId, item.id);
            if (mountedRef.current) {
              setItems((current) => current.filter((entry) => entry.id !== item.id));
              setNotice('Файл перемещён в корзину.');
              await loadData({ silent: true });
            }
          });
        },
      },
    ]);
  }, [loadData, runFileAction, userId]);

  const restoreFile = useCallback((item: MyFileRecord) => {
    void runFileAction(item, 'open', async () => {
      await restoreMyFile(item.id);
      if (mountedRef.current) {
        setItems((current) => current.filter((entry) => entry.id !== item.id));
        setNotice('Файл восстановлен.');
      }
    });
  }, [runFileAction]);

  const confirmPurgeFile = useCallback((item: MyFileRecord) => {
    Alert.alert('Удалить навсегда?', `${myFileName(item)} будет удалён без возможности восстановления.`, [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить навсегда',
        style: 'destructive',
        onPress: () => {
          void runFileAction(item, 'delete', async () => {
            await purgeMyFile(item.id);
            if (userId) await removeNativeMyFileOffline(userId, item.id);
            if (mountedRef.current) {
              setItems((current) => current.filter((entry) => entry.id !== item.id));
              setNotice('Файл удалён навсегда.');
            }
          });
        },
      },
    ]);
  }, [runFileAction, userId]);

  const restoreFolder = useCallback((folder: MyFileFolder) => {
    void runFolderAction(folder, 'restore', async () => {
      await restoreMyFileFolder(folder.id);
      if (mountedRef.current) {
        setFolders((current) => current.filter((entry) => entry.id !== folder.id));
        setNotice('Папка восстановлена.');
      }
    });
  }, [runFolderAction]);

  const confirmPurgeFolder = useCallback((folder: MyFileFolder) => {
    Alert.alert('Удалить папку навсегда?', `«${folder.name}» и всё её содержимое будет удалено без восстановления.`, [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить навсегда',
        style: 'destructive',
        onPress: () => {
          void runFolderAction(folder, 'purge', async () => {
            await purgeMyFileFolder(folder.id);
            if (mountedRef.current) {
              setFolders((current) => current.filter((entry) => entry.id !== folder.id));
              setNotice('Папка удалена навсегда.');
            }
          });
        },
      },
    ]);
  }, [runFolderAction]);

  const confirmEmptyTrash = useCallback(() => {
    Alert.alert('Очистить корзину?', 'Все файлы и папки в корзине будут удалены навсегда.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Очистить',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await emptyMyFilesTrash();
              if (mountedRef.current) {
                setItems([]);
                setFolders([]);
                setNotice('Корзина очищена.');
              }
            } catch (cause) {
              if (mountedRef.current) setError(formatApiError(cause, 'Не удалось очистить корзину.'));
            }
          })();
        },
      },
    ]);
  }, []);

  const toggleFolderFavorite = useCallback((folder: MyFileFolder) => {
    const next = !folder.is_favorite;
    void runFolderAction(folder, 'favorite', async () => {
      const updated = await updateMyFileFolder(folder.id, { isFavorite: next });
      if (mountedRef.current) {
        setFolders((current) => current.map((entry) => entry.id === folder.id ? updated : entry));
        setAllFolders((current) => current.map((entry) => entry.id === folder.id ? updated : entry));
        setNotice(next ? 'Папка добавлена в избранное.' : 'Папка убрана из избранного.');
      }
    });
  }, [runFolderAction]);

  const confirmDeleteFolder = useCallback((folder: MyFileFolder) => {
    Alert.alert('Удалить папку?', `«${folder.name}» и её содержимое попадут в корзину.`, [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: () => {
          void runFolderAction(folder, 'delete', async () => {
            await deleteMyFileFolder(folder.id);
            if (mountedRef.current) {
              setFolders((current) => current.filter((entry) => entry.id !== folder.id));
              setAllFolders((current) => current.filter((entry) => entry.id !== folder.id));
              if (currentFolderId === folder.id) setCurrentFolderId(null);
              setNotice('Папка перемещена в корзину.');
            }
          });
        },
      },
    ]);
  }, [currentFolderId, runFolderAction]);

  const deliverFolderShareLink = useCallback(async (folder: MyFileFolder, rotate: boolean) => {
    const share = await createMyFileFolderShare(folder.id, rotate);
    if (!mountedRef.current) return;
    const url = buildMyFilePublicFolderUrl(share.token, HUB_WEB_ORIGIN);
    await shareNativeText({ title: folder.name, text: 'Публичная ссылка HUB-IT на папку', url });
    if (mountedRef.current) {
      setFolders((current) => current.map((entry) => entry.id === folder.id ? { ...entry, is_shared: true } : entry));
      setNotice(rotate ? 'Создана новая ссылка на папку. Предыдущая отключена.' : 'Публичная ссылка на папку готова.');
    }
  }, []);

  const confirmFolderRotate = useCallback((folder: MyFileFolder) => {
    Alert.alert(
      'Создать новую ссылку на папку?',
      'Предыдущая публичная ссылка сразу перестанет работать.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Создать новую',
          onPress: () => runFolderAction(folder, 'rotate-share', async () => {
            await deliverFolderShareLink(folder, true);
          }),
        },
      ],
    );
  }, [deliverFolderShareLink, runFolderAction]);

  const confirmFolderRevoke = useCallback((folder: MyFileFolder) => {
    Alert.alert('Отключить ссылку на папку?', 'У получателей ссылка перестанет открываться.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Отключить',
        style: 'destructive',
        onPress: () => {
          void runFolderAction(folder, 'revoke-share', async () => {
            await revokeMyFileFolderShare(folder.id);
            if (mountedRef.current) {
              setFolders((current) => current.map((entry) => entry.id === folder.id ? { ...entry, is_shared: false } : entry));
              setNotice('Публичная ссылка на папку отключена.');
            }
          });
        },
      },
    ]);
  }, [runFolderAction]);

  const downloadFolderArchive = useCallback((folder: MyFileFolder) => {
    void runFolderAction(folder, 'archive', async () => {
      const grant = await createMyFileFolderArchiveGrant(folder.id);
      if (!mountedRef.current) return;
      const url = buildMyFileDownloadGrantUrl(grant.download_path);
      if (!url) throw new Error('Не удалось собрать ссылку для скачивания');
      const supported = await Linking.canOpenURL(url).catch(() => false);
      if (!supported) throw new Error('Нет приложения для скачивания архива');
      await Linking.openURL(url);
      if (mountedRef.current) setNotice('Архив папки открыт для скачивания.');
    });
  }, [runFolderAction]);

  const submitPrompt = useCallback((value: string) => {
    const active = prompt;
    if (!active) return;
    setPromptBusy(true);
    const finish = () => {
      if (mountedRef.current) {
        setPromptBusy(false);
        setPrompt(null);
      }
    };
    void (async () => {
      try {
        if (active.kind === 'create-folder') {
          const created = await createMyFileFolder({ name: value, parentId: currentFolderId });
          if (!mountedRef.current) return;
          setFolders((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name, 'ru')));
          setAllFolders((current) => [...current, created]);
          setNotice(`Папка «${created.name}» создана.`);
        } else if (active.kind === 'rename-file') {
          await updateMyFile(active.file.id, { name: value });
          if (!mountedRef.current) return;
          setNotice('Файл переименован.');
          await loadData({ silent: true });
        } else if (active.kind === 'rename-folder') {
          await updateMyFileFolder(active.folder.id, { name: value });
          if (!mountedRef.current) return;
          setNotice('Папка переименована.');
          await loadData({ silent: true });
          await loadAllFolders();
        }
        finish();
      } catch (cause) {
        if (mountedRef.current) {
          setPromptBusy(false);
          setPrompt(null);
          setError(formatApiError(cause, 'Не удалось сохранить.'));
        }
      }
    })();
  }, [currentFolderId, loadAllFolders, loadData, prompt]);

  const openMoveSheet = useCallback((item: MyFileRecord) => {
    if (!allFolders.length) void loadAllFolders();
    setMoveTarget(item);
  }, [allFolders.length, loadAllFolders]);

  const fileActions = useMemo((): MyFilesSheetAction[] => {
    const item = fileActionsTarget;
    if (!item) return [];
    if (view === 'trash') {
      return [
        {
          key: 'restore',
          label: 'Восстановить',
          icon: 'restore',
          testID: `native-my-file-restore-${item.id}`,
          onPress: () => { setFileActionsTarget(null); restoreFile(item); },
        },
        {
          key: 'purge',
          label: 'Удалить навсегда',
          icon: 'delete-forever-outline',
          danger: true,
          testID: `native-my-file-purge-${item.id}`,
          onPress: () => { setFileActionsTarget(null); confirmPurgeFile(item); },
        },
      ];
    }
    const ready = item.status === 'ready' && item.security_scan_status !== 'blocked';
    const offline = offlineFileIds.has(item.id);
    const actions: MyFilesSheetAction[] = [];
    if (ready && !offline && view !== 'offline') {
      actions.push({
        key: 'save-offline',
        label: 'Сохранить офлайн',
        icon: 'cloud-download-outline',
        testID: `native-my-file-save-offline-${item.id}`,
        onPress: () => { setFileActionsTarget(null); saveOffline(item); },
      });
    }
    if (offline || view === 'offline') {
      actions.push({
        key: 'remove-offline',
        label: 'Удалить офлайн-копию',
        icon: 'cloud-off-outline',
        testID: `native-my-file-remove-offline-${item.id}`,
        onPress: () => { setFileActionsTarget(null); removeOffline(item); },
      });
    }
    if (view === 'offline') return actions;
    if (ready && canShare) {
      actions.push({
        key: 'share-link',
        label: item.is_shared ? 'Поделиться ссылкой' : 'Ссылкой',
        icon: 'link-variant',
        testID: `native-my-file-share-link-${item.id}`,
        disabled: offlineMode,
        onPress: () => { setFileActionsTarget(null); shareLink(item); },
      });
      if (item.is_shared) {
        actions.push({
          key: 'rotate',
          label: 'Новая ссылка',
          icon: 'link-variant-plus',
          testID: `native-my-file-rotate-link-${item.id}`,
          disabled: offlineMode,
          onPress: () => { setFileActionsTarget(null); confirmRotate(item); },
        });
        actions.push({
          key: 'revoke',
          label: 'Отключить ссылку',
          icon: 'link-variant-off',
          danger: true,
          disabled: offlineMode,
          onPress: () => { setFileActionsTarget(null); confirmRevoke(item); },
        });
      }
    }
    actions.push({
      key: 'favorite',
      label: item.is_favorite ? 'Убрать из избранного' : 'В избранное',
      icon: item.is_favorite ? 'star-off-outline' : 'star-outline',
      testID: `native-my-file-favorite-${item.id}`,
      disabled: offlineMode,
      onPress: () => { setFileActionsTarget(null); toggleFileFavorite(item); },
    });
    if (canWrite) {
      actions.push({
        key: 'rename',
        label: 'Переименовать',
        icon: 'pencil-outline',
        testID: `native-my-file-rename-${item.id}`,
        disabled: offlineMode,
        onPress: () => { setFileActionsTarget(null); setPrompt({ kind: 'rename-file', file: item }); },
      });
      actions.push({
        key: 'move',
        label: 'Переместить в папку',
        icon: 'folder-move-outline',
        testID: `native-my-file-move-${item.id}`,
        disabled: offlineMode,
        onPress: () => { setFileActionsTarget(null); openMoveSheet(item); },
      });
      actions.push({
        key: 'delete',
        label: 'Удалить',
        icon: 'delete-outline',
        danger: true,
        testID: `native-my-file-delete-${item.id}`,
        disabled: offlineMode,
        onPress: () => { setFileActionsTarget(null); confirmDelete(item); },
      });
    }
    return actions;
  }, [
    canShare, canWrite, confirmDelete, confirmRevoke, confirmRotate, fileActionsTarget,
    offlineFileIds, offlineMode, openMoveSheet, removeOffline, restoreFile, confirmPurgeFile,
    saveOffline, shareLink, toggleFileFavorite, view,
  ]);

  const folderActions = useMemo((): MyFilesSheetAction[] => {
    const folder = folderActionsTarget;
    if (!folder) return [];
    if (view === 'trash') {
      return [
        {
          key: 'restore',
          label: 'Восстановить',
          icon: 'restore',
          testID: `native-my-folder-restore-${folder.id}`,
          onPress: () => { setFolderActionsTarget(null); restoreFolder(folder); },
        },
        {
          key: 'purge',
          label: 'Удалить навсегда',
          icon: 'delete-forever-outline',
          danger: true,
          testID: `native-my-folder-purge-${folder.id}`,
          onPress: () => { setFolderActionsTarget(null); confirmPurgeFolder(folder); },
        },
      ];
    }
    const actions: MyFilesSheetAction[] = [
      {
        key: 'open',
        label: 'Открыть',
        icon: 'folder-open-outline',
        testID: `native-my-folder-open-${folder.id}`,
        onPress: () => { setFolderActionsTarget(null); openFolder(folder); },
      },
    ];
    if (canShare) {
      actions.push({
        key: 'share-link',
        label: 'Ссылкой',
        icon: 'link-variant',
        testID: `native-my-folder-share-link-${folder.id}`,
        disabled: offlineMode,
        onPress: () => { setFolderActionsTarget(null); void runFolderAction(folder, 'share-link', () => deliverFolderShareLink(folder, false)); },
      });
      if (folder.is_shared) {
        actions.push({
          key: 'rotate',
          label: 'Новая ссылка',
          icon: 'link-variant-plus',
          testID: `native-my-folder-rotate-link-${folder.id}`,
          disabled: offlineMode,
          onPress: () => { setFolderActionsTarget(null); confirmFolderRotate(folder); },
        });
        actions.push({
          key: 'revoke',
          label: 'Отключить ссылку',
          icon: 'link-variant-off',
          danger: true,
          disabled: offlineMode,
          onPress: () => { setFolderActionsTarget(null); confirmFolderRevoke(folder); },
        });
      }
      actions.push({
        key: 'archive',
        label: 'Скачать архивом',
        icon: 'archive-arrow-down-outline',
        testID: `native-my-folder-archive-${folder.id}`,
        disabled: offlineMode || folder.file_count === 0,
        onPress: () => { setFolderActionsTarget(null); downloadFolderArchive(folder); },
      });
    }
    actions.push({
      key: 'favorite',
      label: folder.is_favorite ? 'Убрать из избранного' : 'В избранное',
      icon: folder.is_favorite ? 'star-off-outline' : 'star-outline',
      testID: `native-my-folder-favorite-${folder.id}`,
      disabled: offlineMode,
      onPress: () => { setFolderActionsTarget(null); toggleFolderFavorite(folder); },
    });
    if (canWrite) {
      actions.push({
        key: 'rename',
        label: 'Переименовать',
        icon: 'pencil-outline',
        testID: `native-my-folder-rename-${folder.id}`,
        disabled: offlineMode,
        onPress: () => { setFolderActionsTarget(null); setPrompt({ kind: 'rename-folder', folder }); },
      });
      actions.push({
        key: 'delete',
        label: 'Удалить',
        icon: 'delete-outline',
        danger: true,
        testID: `native-my-folder-delete-${folder.id}`,
        disabled: offlineMode,
        onPress: () => { setFolderActionsTarget(null); confirmDeleteFolder(folder); },
      });
    }
    return actions;
  }, [
    canShare, canWrite, confirmDeleteFolder, confirmFolderRevoke, confirmFolderRotate,
    confirmPurgeFolder, deliverFolderShareLink, downloadFolderArchive, folderActionsTarget,
    offlineMode, openFolder, restoreFolder, runFolderAction, toggleFolderFavorite, view,
  ]);

  const refreshFiles = useCallback(() => {
    void loadData({ refresh: true });
  }, [loadData]);

  const normalizedQuery = fileQuery.trim().toLocaleLowerCase('ru-RU');
  const filteredFolders = useMemo(() => {
    if (!normalizedQuery) return folders;
    return folders.filter((folder) => folder.name.toLocaleLowerCase('ru-RU').includes(normalizedQuery));
  }, [folders, normalizedQuery]);
  const filteredFiles = useMemo(() => {
    if (!normalizedQuery) return items;
    return items.filter((item) => `${item.original_file_name}\n${item.download_file_name}`.toLocaleLowerCase('ru-RU').includes(normalizedQuery));
  }, [items, normalizedQuery]);

  const listRows = useMemo<ListRow[]>(() => [
    ...filteredFolders.map((folder): ListRow => ({ kind: 'folder', folder })),
    ...filteredFiles.map((file): ListRow => ({ kind: 'file', file })),
  ], [filteredFiles, filteredFolders]);

  const renderRow = useCallback(({ item }: ListRenderItemInfo<ListRow>) => {
    if (item.kind === 'folder') {
      return (
        <NativeMyFileFolderCard
          folder={item.folder}
          tokens={tokens}
          busy={busyFolderId === item.folder.id}
          onOpen={view === 'trash' ? () => setFolderActionsTarget(item.folder) : openFolder}
          onMore={setFolderActionsTarget}
        />
      );
    }
    const file = item.file;
    return (
      <NativeMyFileCard
        item={file}
        tokens={tokens}
        offline={offlineMode}
        availableOffline={offlineFileIds.has(file.id)}
        actionsLocked={Boolean(busyFile)}
        busyAction={busyFile?.id === file.id ? busyFile.action : null}
        trashed={view === 'trash'}
        onPrimary={view === 'offline' ? openFile : openPreview}
        onOpen={openFile}
        onShareFile={shareFile}
        onMore={setFileActionsTarget}
      />
    );
  }, [busyFile, busyFolderId, offlineFileIds, offlineMode, openFile, openFolder, openPreview, shareFile, tokens, view]);

  if (!canRead) {
    return (
      <AccountScreenScaffold title="Мои файлы" tokens={tokens}>
        <AccountSectionCard tokens={tokens} title="Нет доступа" description="Для раздела нужно право my_files.read.">{null}</AccountSectionCard>
      </AccountScreenScaffold>
    );
  }

  const quotaPercent = quota?.limit_bytes ? Math.min(100, Math.round((quota.used_bytes / quota.limit_bytes) * 100)) : 0;
  const totalEntries = filteredFolders.length + filteredFiles.length;
  const listTitle = normalizedQuery
    ? `Найдено: ${totalEntries} из ${folders.length + items.length}`
    : view === 'files'
      ? (currentFolder ? currentFolder.name : `Файлы · ${items.length + folders.length}`)
      : view === 'trash'
        ? `Корзина · ${items.length + folders.length}`
        : `${VIEW_OPTIONS.find((option) => option.value === view)?.label} · ${items.length}`;

  return (
    <AccountScreenScaffold
      title="Мои файлы"
      tokens={tokens}
      scroll={false}
    >
      <NativeMyFilePreviewModal preview={preview} tokens={tokens} onClose={() => setPreview(null)} />
      {offlineMode ? <Text accessibilityRole="alert" style={[styles.warning, { color: tokens.warning }]}>Автономный режим: показан сохранённый список. Файлы со статусом «Офлайн» можно открыть и отправить без сети.</Text> : null}
      {error && !uploadOpen ? <Text accessibilityRole="alert" style={[styles.error, { color: tokens.error }]}>{error}</Text> : null}
      {notice && !uploadOpen ? <Text accessibilityLiveRegion="polite" style={[styles.notice, { color: tokens.success }]}>{notice}</Text> : null}

      <View style={styles.headerActions}>
        <Text numberOfLines={2} style={[styles.quotaText, { color: quotaPercent >= 90 ? tokens.warning : tokens.textSecondary }]}>
          {view === 'offline' ? `На устройстве: ${items.length} файлов` : quota ? `${formatMyFileSize(quota.used_bytes)} из ${formatMyFileSize(quota.limit_bytes)} · ${quotaPercent}%` : 'Квота временно недоступна'}
        </Text>
        {canWrite && view === 'files' ? (
          <Pressable
            testID="native-my-files-create-folder"
            onPress={() => { if (!offlineMode) setPrompt({ kind: 'create-folder' }); }}
            disabled={offlineMode}
            accessibilityRole="button"
            accessibilityLabel="Создать папку"
            accessibilityState={{ disabled: offlineMode }}
            style={[styles.iconActionButton, { borderColor: tokens.primary, opacity: offlineMode ? 0.55 : 1 }]}
          >
            <MaterialCommunityIcons name="folder-plus-outline" size={19} color={tokens.primary} />
          </Pressable>
        ) : null}
        {canWrite && view !== 'trash' && view !== 'offline' ? (
          <Pressable testID="native-my-files-open-upload" accessibilityRole="button" accessibilityLabel="Загрузить" onPress={() => setUploadOpen(true)} style={[styles.uploadButton, { backgroundColor: tokens.primary }]}>
            <MaterialCommunityIcons name="cloud-upload-outline" size={18} color="#fff" />
            <Text style={styles.uploadButtonText}>{uploadState || packingFolder ? 'Загрузка…' : 'Загрузить'}</Text>
          </Pressable>
        ) : null}
      </View>

      {view === 'trash' && canWrite && (items.length || folders.length) ? (
        <Pressable
          testID="native-my-files-empty-trash"
          onPress={confirmEmptyTrash}
          disabled={offlineMode}
          accessibilityRole="button"
          accessibilityLabel="Очистить корзину"
          accessibilityState={{ disabled: offlineMode }}
          style={[styles.emptyTrashButton, { borderColor: tokens.error, opacity: offlineMode ? 0.55 : 1 }]}
        >
          <MaterialCommunityIcons name="delete-sweep-outline" size={19} color={tokens.error} />
          <Text style={{ color: tokens.error, fontWeight: '800', fontSize: 13 }}>Очистить корзину</Text>
        </Pressable>
      ) : null}

      <AccountSubpage visible={uploadOpen} title="Загрузка файлов" tokens={tokens} onClose={() => { if (!uploadAbortRef.current) uploadGeneration.current += 1; setUploadOpen(false); }}>
        {error ? <Text accessibilityRole="alert" style={{ color: tokens.error }}>{error}</Text> : null}
        {notice ? <Text accessibilityLiveRegion="polite" style={{ color: tokens.success }}>{notice}</Text> : null}
        <Text style={{ color: tokens.textSecondary, marginBottom: 12 }}>
          Выберите срок хранения перед загрузкой. После его окончания файлы автоматически удаляются, максимум через 30 дней.
          {currentFolder ? ` Загрузка в папку «${currentFolder.name}».` : ''}
        </Text>
      {canWrite ? (
        <View style={styles.uploadBlock}>
          <Text style={[styles.sectionLabel, { color: tokens.textSecondary }]}>Срок хранения нового файла</Text>
          <NativeSegmentedControl
            options={MY_FILES_RETENTION_OPTIONS.map((days) => ({ value: String(days), label: `${days} ${russianPlural(days, ['день', 'дня', 'дней'])}` }))}
            selected={String(retentionDays)}
            onSelect={(value) => { if (!uploadState) setRetentionDays(Number(value)); }}
            tokens={tokens}
            testIDPrefix="native-my-files-retention"
          />
          <View style={styles.uploadActions}>
            <Pressable
              testID="native-my-files-upload"
              onPress={() => { void startUpload('files'); }}
              disabled={offlineMode || Boolean(uploadState) || packingFolder}
              accessibilityRole="button"
              accessibilityLabel="Выбрать и загрузить файлы"
              accessibilityState={{ disabled: offlineMode || Boolean(uploadState) || packingFolder, busy: Boolean(uploadState) }}
              style={[styles.uploadButton, { backgroundColor: tokens.primary, opacity: offlineMode || uploadState || packingFolder ? 0.55 : 1 }]}
            >
              <MaterialCommunityIcons name="cloud-upload-outline" size={20} color="#fff" />
              <Text style={styles.uploadButtonText}>Загрузить файлы</Text>
            </Pressable>
            <Pressable
              testID="native-my-files-upload-folder"
              onPress={() => { void startUpload('folder'); }}
              disabled={offlineMode || Boolean(uploadState) || packingFolder}
              accessibilityRole="button"
              accessibilityLabel="Выбрать папку, упаковать в ZIP и загрузить"
              accessibilityState={{ disabled: offlineMode || Boolean(uploadState) || packingFolder, busy: packingFolder }}
              style={[styles.folderUploadButton, { borderColor: tokens.primary, opacity: offlineMode || uploadState || packingFolder ? 0.55 : 1 }]}
            >
              {packingFolder ? <ActivityIndicator size="small" color={tokens.primary} /> : <MaterialCommunityIcons name="folder-zip-outline" size={20} color={tokens.primary} />}
              <Text style={[styles.folderUploadButtonText, { color: tokens.primary }]}>{packingFolder ? 'Упаковка…' : 'Папка в ZIP'}</Text>
            </Pressable>
            {uploadState ? (
              <Pressable onPress={() => uploadAbortRef.current?.abort()} accessibilityRole="button" accessibilityLabel="Отменить загрузку" style={[styles.cancelButton, { borderColor: tokens.error }]}>
                <Text style={{ color: tokens.error, fontWeight: '800' }}>Отмена</Text>
              </Pressable>
            ) : null}
          </View>
          {uploadState ? (
            <View accessibilityLiveRegion="polite" style={styles.uploadProgress}>
              <Text numberOfLines={1} style={[styles.progressName, { color: tokens.textPrimary }]}>{uploadState.index}/{uploadState.totalFiles} · {uploadState.name}</Text>
              <Text style={[styles.progressValue, { color: tokens.textSecondary }]}>{uploadState.progress === null ? 'Загрузка…' : `${Math.round(uploadState.progress * 100)}%`}</Text>
              <View style={[styles.progressTrack, { backgroundColor: tokens.panelInset }]}>
                <View style={[styles.progressFill, { backgroundColor: tokens.primary, width: `${Math.round((uploadState.progress || 0) * 100)}%` }]} />
              </View>
            </View>
          ) : null}
        </View>
      ) : null}

      </AccountSubpage>

      {view === 'files' && breadcrumbs.length ? (
        <View style={styles.breadcrumbs} accessibilityRole="menu">
          <Pressable
            testID="native-my-files-breadcrumb-root"
            onPress={() => navigateToFolder(null)}
            accessibilityRole="button"
            accessibilityLabel="К корню файлов"
            style={styles.breadcrumbItem}
          >
            <MaterialCommunityIcons name="home-outline" size={16} color={tokens.primary} />
            <Text style={[styles.breadcrumbText, { color: tokens.primary }]}>Все файлы</Text>
          </Pressable>
          {breadcrumbs.map((crumb, index) => {
            const isLast = index === breadcrumbs.length - 1;
            return (
              <View key={crumb.id} style={styles.breadcrumbItem}>
                <MaterialCommunityIcons name="chevron-right" size={14} color={tokens.iconMuted} />
                <Pressable
                  testID={`native-my-files-breadcrumb-${crumb.id}`}
                  onPress={() => { if (!isLast) navigateToFolder(crumb.id); }}
                  disabled={isLast}
                  accessibilityRole="button"
                  accessibilityLabel={isLast ? `Текущая папка ${crumb.name}` : `Перейти в ${crumb.name}`}
                  accessibilityState={{ selected: isLast, disabled: isLast }}
                >
                  <Text numberOfLines={1} style={[styles.breadcrumbText, { color: isLast ? tokens.textPrimary : tokens.primary }]}>{crumb.name}</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      ) : null}

      <View style={styles.listHeading}>
        <Pressable
          testID="native-my-files-view-picker"
          onPress={() => setViewPickerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`Выбор раздела файлов. Текущий: ${VIEW_OPTIONS.find((option) => option.value === view)?.label}`}
          accessibilityState={{ expanded: viewPickerOpen }}
          style={({ pressed }) => [styles.viewPickerTrigger, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Text numberOfLines={1} style={[styles.sectionTitle, { color: tokens.textPrimary }]}>{listTitle}</Text>
          <MaterialCommunityIcons name={viewPickerOpen ? 'chevron-up' : 'chevron-down'} size={22} color={tokens.primary} />
        </Pressable>
        <Pressable onPress={refreshFiles} disabled={refreshing || offlineMode} accessibilityRole="button" accessibilityLabel="Обновить список файлов" style={styles.refreshButton}>
          {refreshing ? <ActivityIndicator size="small" color={tokens.primary} /> : <MaterialCommunityIcons name="refresh" size={21} color={tokens.primary} />}
        </Pressable>
      </View>

      <View style={[styles.fileSearch, { borderColor: tokens.borderSoft, backgroundColor: tokens.panelSolid }]}>
        <MaterialCommunityIcons name="magnify" size={22} color={tokens.iconMuted} />
        <TextInput value={fileQuery} onChangeText={setFileQuery} accessibilityLabel="Поиск файлов по названию"
          placeholder="Название файла" placeholderTextColor={tokens.textTertiary} autoCorrect={false}
          style={[styles.fileSearchInput, { color: tokens.textPrimary }]} />
        {fileQuery ? <Pressable accessibilityRole="button" accessibilityLabel="Очистить поиск файлов" onPress={() => setFileQuery('')} style={styles.refreshButton}>
          <MaterialCommunityIcons name="close" size={22} color={tokens.iconMuted} />
        </Pressable> : null}
      </View>

      {loading && !listRows.length ? (
        <View style={styles.loading}><ActivityIndicator color={tokens.primary} /></View>
      ) : (
        <FlatList
          testID="native-my-files-list"
          data={listRows}
          keyboardShouldPersistTaps="handled"
          keyExtractor={(row) => row.kind === 'folder' ? `f:${row.folder.id}` : `i:${row.file.id}`}
          refreshing={refreshing}
          onRefresh={refreshFiles}
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          windowSize={9}
          removeClippedSubviews
          contentContainerStyle={listRows.length ? styles.listContent : styles.emptyContent}
          ListEmptyComponent={(
            <View style={styles.emptyBody}>
              <MaterialCommunityIcons name={view === 'trash' ? 'delete-empty-outline' : 'folder-open-outline'} size={42} color={tokens.iconMuted} />
              <Text style={[styles.emptyTitle, { color: tokens.textPrimary }]}>
                {listUnavailable && !listRows.length ? 'Список не загрузился'
                  : normalizedQuery ? 'Ничего не найдено'
                  : view === 'offline' ? 'На устройстве пока нет файлов'
                  : view === 'trash' ? 'Корзина пуста'
                  : view === 'recent' ? 'Недавних файлов нет'
                  : view === 'favorites' ? 'В избранном пока пусто'
                  : 'Файлов пока нет'}
              </Text>
              <Text style={[styles.emptyText, { color: tokens.textSecondary }]}>
                {listUnavailable && !listRows.length ? 'Проверьте соединение и повторите.'
                  : normalizedQuery ? 'Попробуйте другое название или очистите поиск.'
                  : view === 'offline' ? 'Сохраните нужные файлы офлайн через меню файла при наличии сети.'
                  : view === 'trash' ? 'Удалённые файлы и папки появятся здесь.'
                  : view === 'favorites' ? 'Отмечайте файлы и папки звёздочкой — они соберутся здесь.'
                  : view === 'recent' ? 'Здесь появятся файлы, с которыми вы недавно работали.'
                  : 'Загрузите файлы или создайте папку — после проверки безопасности они появятся здесь.'}
              </Text>
            </View>
          )}
          renderItem={renderRow}
        />
      )}

      {viewPickerOpen ? (
        <NativeMyFilesActionSheet
          title="Раздел файлов"
          actions={VIEW_OPTIONS.map((option) => ({
            key: option.value,
            label: option.label,
            icon: VIEW_ICONS[option.value],
            selected: view === option.value,
            testID: `native-my-files-view-${option.value}`,
            onPress: () => selectView(option.value),
          }))}
          tokens={tokens}
          onClose={() => setViewPickerOpen(false)}
        />
      ) : null}
      {fileActionsTarget ? (
        <NativeMyFilesActionSheet
          title={myFileName(fileActionsTarget)}
          actions={fileActions}
          tokens={tokens}
          onClose={() => setFileActionsTarget(null)}
        />
      ) : null}
      {folderActionsTarget ? (
        <NativeMyFilesActionSheet
          title={folderActionsTarget.name}
          actions={folderActions}
          tokens={tokens}
          onClose={() => setFolderActionsTarget(null)}
        />
      ) : null}

      <NativeMyFilesPromptSheet
        visible={prompt !== null}
        title={prompt?.kind === 'create-folder' ? 'Новая папка' : prompt?.kind === 'rename-file' ? 'Переименовать файл' : 'Переименовать папку'}
        placeholder={prompt?.kind === 'create-folder' ? 'Название папки' : 'Новое название'}
        initialValue={prompt?.kind === 'rename-file' ? myFileName(prompt.file) : prompt?.kind === 'rename-folder' ? prompt.folder.name : ''}
        submitLabel={prompt?.kind === 'create-folder' ? 'Создать' : 'Сохранить'}
        tokens={tokens}
        busy={promptBusy}
        onSubmit={submitPrompt}
        onClose={() => { if (!promptBusy) setPrompt(null); }}
      />

      {moveTarget ? (
        <NativeMyFilesMoveSheet
          visible
          title={`Переместить «${myFileName(moveTarget)}»`}
          folders={allFolders}
          currentFolderId={moveTarget.folder_id}
          tokens={tokens}
          busy={moveBusy}
          onSelect={(folderId) => {
            const target = moveTarget;
            setMoveTarget(null);
            setMoveBusy(true);
            void (async () => {
              try {
                await moveFileToFolderAsync(target, folderId);
              } finally {
                if (mountedRef.current) setMoveBusy(false);
              }
            })();
          }}
          onClose={() => setMoveTarget(null)}
        />
      ) : null}
    </AccountScreenScaffold>
  );

  async function moveFileToFolderAsync(item: MyFileRecord, folderId: string | null) {
    try {
      await updateMyFile(item.id, { folderId });
      if (!mountedRef.current) return;
      setItems((current) => current.filter((entry) => entry.id !== item.id || folderId === currentFolderId));
      setNotice('Файл перемещён.');
      await loadData({ silent: true });
    } catch (cause) {
      if (mountedRef.current) setError(formatApiError(cause, 'Не удалось переместить файл.'));
    }
  }
}

const styles = StyleSheet.create({
  fileSearch: { minHeight: 48, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, paddingLeft: 10, marginBottom: 10 },
  fileSearchInput: { flex: 1, minWidth: 0, minHeight: 48, paddingHorizontal: 8, fontSize: 15 },
  warning: { marginBottom: 7, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  error: { marginBottom: 7, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  notice: { marginBottom: 7, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  viewPickerTrigger: { flexShrink: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4 },
  quotaText: { flex: 1, minWidth: 0, fontSize: 12, fontWeight: '700' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  uploadButton: { minHeight: 44, borderRadius: 12, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  iconActionButton: { width: 44, minHeight: 44, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  emptyTrashButton: { minHeight: 44, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  breadcrumbs: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginBottom: 8 },
  breadcrumbItem: { flexDirection: 'row', alignItems: 'center', gap: 3, minHeight: 32 },
  breadcrumbText: { fontSize: 13, fontWeight: '700', maxWidth: 160 },
  sectionLabel: { fontSize: 11, fontWeight: '700', marginBottom: 6 },
  uploadBlock: { marginBottom: 9 },
  uploadActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  uploadButtonText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  folderUploadButton: { minHeight: 46, borderRadius: 12, borderWidth: 1, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  folderUploadButtonText: { fontSize: 13, fontWeight: '800' },
  cancelButton: { minWidth: 86, minHeight: 46, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  uploadProgress: { marginTop: 8 },
  progressName: { fontSize: 12, fontWeight: '700' },
  progressValue: { marginTop: 2, fontSize: 11 },
  progressTrack: { height: 6, borderRadius: 3, overflow: 'hidden', marginTop: 5 },
  progressFill: { height: 6, borderRadius: 3 },
  listHeading: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { flexShrink: 1, fontSize: 15, fontWeight: '900' },
  refreshButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingBottom: 8 },
  emptyContent: { flexGrow: 1, paddingBottom: 8 },
  emptyBody: { minHeight: 220, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  emptyTitle: { marginTop: 10, fontSize: 16, fontWeight: '800' },
  emptyText: { marginTop: 4, textAlign: 'center', fontSize: 13, lineHeight: 18 },
});
