import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  type ListRenderItemInfo,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  createMyFileShare,
  deleteMyFile,
  getMyFilePreview,
  getMyFilesQuota,
  listMyFiles,
  revokeMyFileShare,
  type MyFileRecord,
  type MyFilesQuota,
} from '../../api/myFilesApi';
import { formatApiError } from '../../api/formatError';
import { HUB_WEB_ORIGIN } from '../../api/config';
import { useAuth } from '../../auth/AuthContext';
import {
  readNativeEntitySnapshot,
  readNativeSnapshot,
  writeNativeEntitySnapshot,
  writeNativeSnapshot,
} from '../../cache/nativeSnapshotCache';
import {
  NativeMyFileCard,
  type MyFileCardAction,
} from '../../components/myFiles/NativeMyFileCard';
import {
  NativeMyFilePreviewModal,
  type NativeMyFilePreviewState,
} from '../../components/myFiles/NativeMyFilePreviewModal';
import { openNativeFile, shareNativeFile } from '../../files/nativeAttachmentDownloads';
import {
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
  removeNativeMyFileOffline,
} from '../../myFiles/nativeMyFilesOfflineStore';
import {
  type NativeMyFileDetailSnapshot,
  type NativeMyFilesInboxSnapshot,
} from '../../myFiles/nativeMyFilesSnapshot';
import { usePreferences } from '../../preferences/PreferencesContext';
import { shareNativeText } from '../../share/nativeOutgoingShare';
import { useFluentTokens } from '../../theme/fluentTokens';
import { AccountScreenScaffold, AccountSectionCard } from '../account/AccountChrome';

const PROCESSING_POLL_MS = 4_000;

type BusyFile = { id: string; action: MyFileCardAction } | null;
type UploadState = { name: string; index: number; totalFiles: number; progress: number | null } | null;

export function NativeMyFilesScreen() {
  const { user, hasPermission, offlineMode } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const canRead = hasPermission('my_files.read');
  const canWrite = hasPermission('my_files.write');
  const canShare = hasPermission('my_files.share');
  const userId = Number(user?.id || 0);
  const [items, setItems] = useState<MyFileRecord[]>([]);
  const [offlineFileIds, setOfflineFileIds] = useState<Set<string>>(() => new Set());
  const [quota, setQuota] = useState<MyFilesQuota | null>(null);
  const [retentionDays, setRetentionDays] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploadState, setUploadState] = useState<UploadState>(null);
  const [packingFolder, setPackingFolder] = useState(false);
  const [busyFile, setBusyFile] = useState<BusyFile>(null);
  const [preview, setPreview] = useState<NativeMyFilePreviewState>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const uploadAbortRef = useRef<AbortController | null>(null);
  const uploadLockRef = useRef(false);
  const fileActionLockRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      uploadAbortRef.current?.abort();
    };
  }, []);

  const loadData = useCallback(async ({ refresh = false, silent = false } = {}) => {
    if (!canRead) {
      setLoading(false);
      return;
    }
    if (refresh) setRefreshing(true);
    else if (!silent) setLoading(true);
    if (!silent) setError('');
    let cached = false;
    if (userId) {
      const snapshot = await readNativeSnapshot<NativeMyFilesInboxSnapshot>('my-files-inbox', userId);
      if (!mountedRef.current) return;
      if (snapshot) {
        cached = true;
        setItems(snapshot.data.items);
        setQuota(snapshot.data.quota);
        setLoading(false);
      }
    }
    if (offlineMode) {
      if (!cached && !silent) setError('Нет подключения и сохранённого списка файлов.');
      setLoading(false);
      setRefreshing(false);
      return;
    }
    const [filesResult, quotaResult] = await Promise.allSettled([listMyFiles(), getMyFilesQuota()]);
    if (!mountedRef.current) return;
    const errors: string[] = [];
    if (filesResult.status === 'fulfilled') setItems(filesResult.value);
    else errors.push(formatApiError(filesResult.reason, 'Не удалось загрузить список файлов.'));
    if (quotaResult.status === 'fulfilled') setQuota(quotaResult.value);
    else errors.push(formatApiError(quotaResult.reason, 'Не удалось загрузить квоту.'));
    setError(errors.join(' '));
    if (userId && filesResult.status === 'fulfilled' && quotaResult.status === 'fulfilled') {
      void writeNativeSnapshot<NativeMyFilesInboxSnapshot>('my-files-inbox', userId, {
        items: filesResult.value,
        quota: quotaResult.value,
      });
    }
    setLoading(false);
    setRefreshing(false);
  }, [canRead, offlineMode, userId]);

  useEffect(() => { void loadData(); }, [loadData]);

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
      if (state === 'active') void loadData({ silent: true });
    });
    return () => subscription.remove();
  }, [loadData]);

  const hasProcessing = useMemo(() => items.some(isMyFileProcessing), [items]);
  useEffect(() => {
    if (!hasProcessing || offlineMode || !appActive) return undefined;
    const timer = setInterval(() => { void loadData({ silent: true }); }, PROCESSING_POLL_MS);
    return () => clearInterval(timer);
  }, [appActive, hasProcessing, loadData, offlineMode]);

  const startUpload = useCallback(async (source: 'files' | 'folder' = 'files') => {
    if (!canWrite || offlineMode || uploadState || packingFolder || uploadLockRef.current) return;
    uploadLockRef.current = true;
    setError('');
    setNotice('');
    try {
      if (source === 'folder') setPackingFolder(true);
      const files = source === 'folder'
        ? [await pickNativeMyFilesFolder()].filter((file): file is NonNullable<typeof file> => Boolean(file))
        : await pickNativeMyFiles();
      setPackingFolder(false);
      if (!files.length) return;
      const selectedBytes = files.reduce((sum, file) => sum + file.size, 0);
      if (quota && selectedBytes > quota.remaining_bytes) {
        throw new Error(`Недостаточно места: выбрано ${formatMyFileSize(selectedBytes)}, свободно ${formatMyFileSize(quota.remaining_bytes)}`);
      }
      const controller = new AbortController();
      uploadAbortRef.current = controller;
      let uploaded = 0;
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        setUploadState({ name: file.name, index: index + 1, totalFiles: files.length, progress: 0 });
        await uploadNativeMyFile(file, retentionDays, {
          signal: controller.signal,
          onProgress: ({ progress }) => {
            if (mountedRef.current) setUploadState({ name: file.name, index: index + 1, totalFiles: files.length, progress });
          },
        });
        uploaded += 1;
      }
      if (mountedRef.current) setNotice(`Файлов добавлено в очередь: ${uploaded}. Идёт проверка безопасности.`);
    } catch (cause) {
      if (!mountedRef.current) return;
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
        await loadData({ silent: true });
      }
    }
  }, [canWrite, loadData, offlineMode, packingFolder, quota, retentionDays, uploadState]);

  const runFileAction = useCallback(async (
    item: MyFileRecord,
    action: MyFileCardAction,
    operation: () => Promise<void>,
    options: { allowOffline?: boolean } = {},
  ) => {
    if (busyFile || (offlineMode && !options.allowOffline) || fileActionLockRef.current) return;
    fileActionLockRef.current = true;
    setBusyFile({ id: item.id, action });
    setError('');
    setNotice('');
    try {
      await operation();
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось выполнить действие с файлом.'));
    } finally {
      fileActionLockRef.current = false;
      if (mountedRef.current) setBusyFile(null);
    }
  }, [busyFile, offlineMode]);

  const openFile = useCallback((item: MyFileRecord) => {
    void runFileAction(item, 'open', async () => {
      const file = await downloadNativeMyFile(item, { userId });
      await openNativeFile(file, myFileMimeType(item));
    }, { allowOffline: true });
  }, [runFileAction, userId]);

  const openPreview = useCallback((item: MyFileRecord) => {
    void runFileAction(item, 'preview', async () => {
      const previewKind = nativeMyFilePreviewKind(item);
      if (!previewKind) throw new Error('Предпросмотр этого файла недоступен');
      if (previewKind === 'text') {
        const file = await downloadNativeMyFile(item, { userId });
        const text = await readNativeMyFileTextPreview(file);
        if (mountedRef.current) setPreview({ kind: 'text', fileName: myFileName(item), text });
        return;
      }
      const offlineFile = userId ? await getNativeMyFilesOfflineFile(userId, item) : null;
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
      let metadata = cached?.data.preview;
      if (!offlineMode) {
        metadata = await getMyFilePreview(item.id);
        if (userId) {
          void writeNativeEntitySnapshot<NativeMyFileDetailSnapshot>('my-file-details', userId, item.id, {
            preview: metadata,
          });
        }
      }
      if (!metadata) throw new Error('Предпросмотр ещё не сохранён. Откройте файл один раз при наличии интернета');
      const downloaded = await downloadNativeMyFilePreview(item, metadata);
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
      const file = await downloadNativeMyFile(item, { userId });
      await shareNativeFile(file, myFileName(item), myFileMimeType(item));
    }, { allowOffline: true });
  }, [runFileAction, userId]);

  const saveOffline = useCallback((item: MyFileRecord) => {
    void runFileAction(item, 'save-offline', async () => {
      if (!userId) throw new Error('Не удалось определить владельца файла');
      const source = await downloadNativeMyFile(item, { userId });
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
        setOfflineFileIds((current) => {
          const next = new Set(current);
          next.delete(item.id);
          return next;
        });
        setNotice(`Офлайн-копия «${myFileName(item)}» удалена; файл на сервере сохранён.`);
      }
    }, { allowOffline: true });
  }, [runFileAction, userId]);

  const deliverShareLink = useCallback(async (item: MyFileRecord, rotate: boolean) => {
    const share = await createMyFileShare(item.id, rotate);
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

  const confirmDelete = useCallback((item: MyFileRecord) => {
    Alert.alert('Удалить файл?', myFileName(item), [
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
              setNotice('Файл удалён.');
              await loadData({ silent: true });
            }
          });
        },
      },
    ]);
  }, [loadData, runFileAction, userId]);

  const refreshFiles = useCallback(() => {
    void loadData({ refresh: true });
  }, [loadData]);

  const renderFile = useCallback(({ item }: ListRenderItemInfo<MyFileRecord>) => (
    <NativeMyFileCard
      item={item}
      tokens={tokens}
      canWrite={canWrite}
      canShare={canShare}
      offline={offlineMode}
      availableOffline={offlineFileIds.has(item.id)}
      actionsLocked={Boolean(busyFile)}
      busyAction={busyFile?.id === item.id ? busyFile.action : null}
      onPreview={openPreview}
      onOpen={openFile}
      onShareFile={shareFile}
      onSaveOffline={saveOffline}
      onRemoveOffline={removeOffline}
      onShareLink={shareLink}
      onRotate={confirmRotate}
      onRevoke={confirmRevoke}
      onDelete={confirmDelete}
    />
  ), [
    busyFile,
    canShare,
    canWrite,
    confirmDelete,
    confirmRevoke,
    confirmRotate,
    offlineFileIds,
    offlineMode,
    openFile,
    openPreview,
    removeOffline,
    saveOffline,
    shareFile,
    shareLink,
    tokens,
  ]);

  if (!canRead) {
    return (
      <AccountScreenScaffold title="Мой диск" tokens={tokens}>
        <AccountSectionCard tokens={tokens} title="Нет доступа" description="Для раздела нужно право my_files.read.">{null}</AccountSectionCard>
      </AccountScreenScaffold>
    );
  }

  const quotaPercent = quota?.limit_bytes ? Math.min(100, Math.round((quota.used_bytes / quota.limit_bytes) * 100)) : 0;
  return (
    <AccountScreenScaffold
      title="Мой диск"
      tokens={tokens}
      scroll={false}
    >
      <NativeMyFilePreviewModal preview={preview} tokens={tokens} onClose={() => setPreview(null)} />
      {offlineMode ? <Text accessibilityRole="alert" style={[styles.warning, { color: tokens.warning }]}>Автономный режим: показан сохранённый список. Файлы со статусом «Офлайн» можно открыть и отправить без сети.</Text> : null}
      {error ? <Text accessibilityRole="alert" style={[styles.error, { color: tokens.error }]}>{error}</Text> : null}
      {notice ? <Text accessibilityLiveRegion="polite" style={[styles.notice, { color: tokens.success }]}>{notice}</Text> : null}

      <View style={[styles.quotaCard, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
        <View style={styles.quotaHeading}>
          <View>
            <Text style={[styles.quotaTitle, { color: tokens.textPrimary }]}>Личное хранилище</Text>
            <Text style={[styles.quotaValue, { color: tokens.textSecondary }]}>
              {quota ? `${formatMyFileSize(quota.used_bytes)} из ${formatMyFileSize(quota.limit_bytes)}` : 'Квота временно недоступна'}
            </Text>
          </View>
          <Text style={[styles.quotaPercent, { color: tokens.primary }]}>{quota ? `${quotaPercent}%` : '—'}</Text>
        </View>
        <View style={[styles.quotaTrack, { backgroundColor: tokens.panelInset }]}>
          <View style={[styles.quotaFill, { backgroundColor: quotaPercent >= 90 ? tokens.warning : tokens.primary, width: `${quotaPercent}%` }]} />
        </View>
        <Text style={[styles.retentionHint, { color: tokens.textTertiary }]}>Файлы автоматически удаляются после выбранного срока, максимум через 30 дней.</Text>
      </View>

      {canWrite ? (
        <View style={styles.uploadBlock}>
          <Text style={[styles.sectionLabel, { color: tokens.textSecondary }]}>Срок хранения нового файла</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.retentionRow} accessibilityRole="tablist">
            {MY_FILES_RETENTION_OPTIONS.map((days) => {
              const selected = retentionDays === days;
              return (
                <Pressable
                  key={days}
                  onPress={() => setRetentionDays(days)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected, disabled: Boolean(uploadState) }}
                  disabled={Boolean(uploadState)}
                  style={[styles.retentionChip, { backgroundColor: selected ? tokens.primary : tokens.panelSolid, borderColor: selected ? tokens.primary : tokens.border }]}
                >
                  <Text style={[styles.retentionText, { color: selected ? '#fff' : tokens.textPrimary }]}>{days} {days === 1 ? 'день' : 'дней'}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
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

      <View style={styles.listHeading}>
        <Text style={[styles.sectionTitle, { color: tokens.textPrimary }]}>Файлы · {items.length}</Text>
        <Pressable onPress={refreshFiles} disabled={refreshing || offlineMode} accessibilityRole="button" accessibilityLabel="Обновить список файлов" style={styles.refreshButton}>
          {refreshing ? <ActivityIndicator size="small" color={tokens.primary} /> : <MaterialCommunityIcons name="refresh" size={21} color={tokens.primary} />}
        </Pressable>
      </View>

      {loading && !items.length ? (
        <View style={styles.loading}><ActivityIndicator color={tokens.primary} /></View>
      ) : (
        <FlatList
          testID="native-my-files-list"
          data={items}
          keyExtractor={(item) => item.id}
          refreshing={refreshing}
          onRefresh={refreshFiles}
          contentContainerStyle={items.length ? styles.listContent : styles.emptyContent}
          ListEmptyComponent={(
            <View style={styles.emptyBody}>
              <MaterialCommunityIcons name="folder-open-outline" size={42} color={tokens.iconMuted} />
              <Text style={[styles.emptyTitle, { color: tokens.textPrimary }]}>{error ? 'Список не загрузился' : 'Файлов пока нет'}</Text>
              <Text style={[styles.emptyText, { color: tokens.textSecondary }]}>{error ? 'Проверьте соединение и повторите.' : 'Загрузите файлы — после проверки безопасности они появятся здесь.'}</Text>
            </View>
          )}
          renderItem={renderFile}
        />
      )}
    </AccountScreenScaffold>
  );
}

const styles = StyleSheet.create({
  headerAction: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  warning: { marginBottom: 7, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  error: { marginBottom: 7, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  notice: { marginBottom: 7, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  quotaCard: { borderRadius: 15, borderWidth: 1, padding: 13, marginBottom: 10 },
  quotaHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  quotaTitle: { fontSize: 15, fontWeight: '800' },
  quotaValue: { marginTop: 3, fontSize: 12 },
  quotaPercent: { fontSize: 18, fontWeight: '900' },
  quotaTrack: { height: 8, borderRadius: 4, overflow: 'hidden', marginTop: 10 },
  quotaFill: { height: 8, borderRadius: 4 },
  retentionHint: { marginTop: 8, fontSize: 11, lineHeight: 15 },
  uploadBlock: { marginBottom: 9 },
  sectionLabel: { fontSize: 11, fontWeight: '700', marginBottom: 6 },
  retentionRow: { gap: 7, paddingBottom: 8 },
  retentionChip: { minHeight: 44, borderRadius: 22, borderWidth: 1, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  retentionText: { fontSize: 12, fontWeight: '800' },
  uploadActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  uploadButton: { minHeight: 46, borderRadius: 12, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
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
  sectionTitle: { fontSize: 15, fontWeight: '900' },
  refreshButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingBottom: 8 },
  emptyContent: { flexGrow: 1, paddingBottom: 8 },
  emptyBody: { minHeight: 220, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  emptyTitle: { marginTop: 10, fontSize: 16, fontWeight: '800' },
  emptyText: { marginTop: 4, textAlign: 'center', fontSize: 13, lineHeight: 18 },
  webFallback: { minHeight: 76, borderRadius: 14, borderWidth: 1, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4, marginBottom: 10 },
  webFallbackTitle: { fontSize: 13, fontWeight: '800' },
  webFallbackText: { marginTop: 3, fontSize: 11, lineHeight: 15 },
});
