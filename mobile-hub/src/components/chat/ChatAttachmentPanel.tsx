import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as MediaLibrary from 'expo-media-library';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Image,
  Keyboard,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { KeyboardStickyView, useKeyboardState } from 'react-native-keyboard-controller';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useReducedMotion } from '../../accessibility/useReducedMotion';
import { initialWindowMetrics, SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { useContext } from 'react';
import {
  MEDIA_GRID_COLUMNS,
  MEDIA_PAGE_SIZE,
  MEDIA_PANEL_TIMEOUT_MS,
  formatMediaDuration,
  mediaAssetToPickedFile,
  mediaSelectionBadge,
  reorderPanelAssets,
  toggleMediaSelection,
  withMediaPanelTimeout,
  type PanelAlbum,
  type PanelMediaAsset,
} from '../../chat/chatAttachmentPanel';
import type { NativePickedFile } from '../../files/nativeFilePicker';
import { type ChatTokens, useChatStyles } from '../../theme/chatTokens';

const COLLAPSED_HEIGHT = 340;
const EXPAND_MARGIN_TOP = 96;
// R-T8-2: preview-strip drag — thumb 56 + strip gap 6 = one slot pitch.
const SELECTED_PITCH = 62;
const SELECTED_DRAG_DELAY_MS = 300;

type PanelAction = {
  key: string;
  icon: string;
  label: string;
  onPress?: () => void;
};

export function ChatAttachmentPanel({
  visible,
  onClose,
  onSendFiles,
  onOpenCamera,
  onOpenGallery,
  onOpenDocument,
  onOpenTask,
  onOpenStickers,
  onSendLocation,
  onSendContact,
  onOpenPoll,
}: {
  visible: boolean;
  onClose: () => void;
  onSendFiles: (files: NativePickedFile[], caption: string) => void;
  onOpenCamera?: () => void;
  onOpenGallery?: () => void;
  onOpenDocument?: () => void;
  onOpenTask?: () => void;
  onOpenStickers?: () => void;
  onSendLocation?: () => void;
  onSendContact?: () => void;
  onOpenPoll?: () => void;
}) {
  const { styles, chatTokens } = useChatStyles(createStyles);
  const reduceMotion = useReducedMotion();
  const insets = useContext(SafeAreaInsetsContext) ?? initialWindowMetrics?.insets;
  const keyboardState = useKeyboardState();
  const { height: windowHeight } = useWindowDimensions();

  const [assets, setAssets] = useState<PanelMediaAsset[]>([]);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [albums, setAlbums] = useState<PanelAlbum[]>([]);
  const [albumId, setAlbumId] = useState<string | null>(null);
  const [albumPickerOpen, setAlbumPickerOpen] = useState(false);
  const [selected, setSelected] = useState<PanelMediaAsset[]>([]);
  const [caption, setCaption] = useState('');
  const [permissionState, setPermissionState] = useState<'pending' | 'granted' | 'denied' | 'error'>('pending');
  const [canAskAgain, setCanAskAgain] = useState(true);
  // Android 14+ limited photo access: a usable subset is still listable.
  const [limitedAccess, setLimitedAccess] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // R-T8-2: full-screen preview of a selected asset before sending.
  const [previewAsset, setPreviewAsset] = useState<PanelMediaAsset | null>(null);
  const [gridLoading, setGridLoading] = useState(false);
  // Media-store calls serialize on these refs so a reopen during an in-flight
  // page load waits for it instead of dropping the reload onto an empty grid.
  const loadingRef = useRef<Promise<void> | null>(null);
  const pendingLoadsRef = useRef(0);
  const accessRunRef = useRef<Promise<void> | null>(null);
  const accessSessionRef = useRef(0);
  const visibleRef = useRef(false);
  const albumRef = useRef<PanelAlbum | null>(null);
  // AUD-2: offset of the most recent page request — a repeated onEndReached
  // before the in-flight page commits must not queue the same offset again.
  const lastRequestedOffsetRef = useRef(-1);
  // AUD-3: a second «Отправить» tap inside the same commit window must not
  // deliver the selection twice.
  const sendingRef = useRef(false);

  const collapsedHeight = COLLAPSED_HEIGHT;
  const expandedHeight = Math.max(collapsedHeight, windowHeight - EXPAND_MARGIN_TOP);
  const panelHeight = useSharedValue(collapsedHeight);

  useEffect(() => {
    panelHeight.value = reduceMotion
      ? (expanded ? expandedHeight : collapsedHeight)
      : withSpring(expanded ? expandedHeight : collapsedHeight, { damping: 24, stiffness: 280 });
  }, [collapsedHeight, expanded, expandedHeight, panelHeight, reduceMotion]);

  const loadAssets = useCallback((album: PanelAlbum | null, offset = 0) => {
    lastRequestedOffsetRef.current = offset;
    const previous = loadingRef.current ?? Promise.resolve();
    pendingLoadsRef.current += 1;
    setGridLoading(true);
    const task = previous.catch(() => undefined).then(async () => {
      try {
        let query = new MediaLibrary.Query()
          .within(MediaLibrary.AssetField.MEDIA_TYPE, [
            MediaLibrary.MediaType.IMAGE,
            MediaLibrary.MediaType.VIDEO,
          ])
          .orderBy({ key: MediaLibrary.AssetField.CREATION_TIME, ascending: false })
          .limit(MEDIA_PAGE_SIZE)
          .offset(offset);
        if (album) query = query.album(new MediaLibrary.Album(album.id));
        const page = await withMediaPanelTimeout(query.exeForMetadata());
        // On Android the metadata id IS the content:// URI the rest of the
        // upload pipeline already handles.
        const mapped: PanelMediaAsset[] = page.map((asset) => ({
          id: asset.id,
          uri: asset.id,
          filename: asset.filename || `media-${asset.id.split('/').pop() || 'asset'}`,
          mediaType: asset.mediaType === MediaLibrary.MediaType.VIDEO ? 'video' : 'photo',
          duration: Math.max(0, Math.round(Number(asset.duration || 0) / 1000)),
          width: asset.width || undefined,
          height: asset.height || undefined,
        }));
        setAssets((current) => (offset > 0 ? [...current, ...mapped] : mapped));
        setHasNextPage(mapped.length >= MEDIA_PAGE_SIZE);
        if (offset === 0) setPermissionState('granted');
      } catch {
        // A first-page failure is a retryable error state; a failed next page
        // keeps the loaded grid and lets a later scroll retry. A 'denied'
        // result from a concurrent permission re-check is not overwritten.
        if (offset === 0) {
          setAssets([]);
          setHasNextPage(false);
          setPermissionState((state) => (state === 'denied' ? state : 'error'));
        }
      } finally {
        pendingLoadsRef.current -= 1;
        setGridLoading(pendingLoadsRef.current > 0);
      }
    });
    loadingRef.current = task;
    void task.then(() => {
      if (loadingRef.current === task) loadingRef.current = null;
    });
    return task;
  }, []);

  const loadAlbums = useCallback(async (isStale: () => boolean) => {
    try {
      const albumList = await withMediaPanelTimeout(MediaLibrary.Album.getAll());
      if (isStale()) return;
      const mapped = await Promise.all(albumList.slice(0, 40).map(async (album) => ({
        id: album.id,
        title: await album.getTitle().catch(() => 'Альбом'),
      })));
      if (isStale()) return;
      setAlbums(mapped.filter((album) => album.title));
    } catch {
      /* albums stay empty — the default roll still works */
    }
  }, []);

  const applyPermission = useCallback((permission: MediaLibrary.PermissionResponse): boolean => {
    // R-T8-1: Android 14+ may grant 'limited' — the chosen subset is usable.
    const hasAccess = permission.granted || permission.accessPrivileges === 'limited';
    setLimitedAccess(permission.accessPrivileges === 'limited' && !permission.granted);
    setCanAskAgain(permission.canAskAgain !== false);
    setPermissionState(hasAccess ? 'granted' : 'denied');
    return hasAccess;
  }, []);

  // BUG-GALLERY: opening the panel runs a silent getPermissionsAsync — never a
  // system dialog — and every await is timeout-bound so a hung native call
  // lands on an error state with «Повторить» instead of an endless spinner.
  const refreshMediaAccess = useCallback(async (options?: { request?: boolean }) => {
    const session = ++accessSessionRef.current;
    const stale = () => accessSessionRef.current !== session || !visibleRef.current;
    const run = (async () => {
      const previous = accessRunRef.current;
      if (previous) await previous.catch(() => undefined);
      if (stale()) return;
      try {
        setPermissionState((state) => (state === 'granted' ? state : 'pending'));
        const permission = await withMediaPanelTimeout(
          options?.request
            ? MediaLibrary.requestPermissionsAsync(false, ['photo', 'video'])
            : MediaLibrary.getPermissionsAsync(false, ['photo', 'video']),
        );
        if (stale()) return;
        const hasAccess = applyPermission(permission);
        if (!hasAccess) {
          setAssets([]);
          setHasNextPage(false);
          return;
        }
        await loadAssets(albumRef.current);
        if (stale()) return;
        await loadAlbums(stale);
      } catch {
        if (!stale()) setPermissionState('error');
      }
    })();
    accessRunRef.current = run;
    try {
      await run;
    } finally {
      if (accessRunRef.current === run) accessRunRef.current = null;
    }
  }, [applyPermission, loadAlbums, loadAssets]);

  const requestMediaAccess = useCallback(() => {
    void refreshMediaAccess({ request: true });
  }, [refreshMediaAccess]);

  const retryMediaAccess = useCallback(() => {
    void refreshMediaAccess();
  }, [refreshMediaAccess]);

  const openSystemSettings = useCallback(() => {
    void Linking.openSettings().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!visible) {
      setSelected([]);
      setCaption('');
      setExpanded(false);
      setAlbumPickerOpen(false);
      // AUD-4: drop the full-screen preview so a reopen never shows a stale asset.
      setPreviewAsset(null);
      sendingRef.current = false;
      lastRequestedOffsetRef.current = -1;
      return;
    }
    // The panel and the keyboard are mutually exclusive (T8).
    Keyboard.dismiss();
    visibleRef.current = true;
    albumRef.current = null;
    setAlbumId(null);
    void refreshMediaAccess();
    // Returning from Settings/background can carry a fresh grant or a revoke —
    // re-check and reload the first page while the panel stays open.
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') void refreshMediaAccess();
    });
    return () => {
      visibleRef.current = false;
      subscription.remove();
    };
  }, [refreshMediaAccess, visible]);

  useEffect(() => {
    albumRef.current = albumId ? albums.find((album) => album.id === albumId) ?? null : null;
  }, [albumId, albums]);

  const switchAlbum = useCallback((nextAlbumId: string | null) => {
    setAlbumPickerOpen(false);
    if (nextAlbumId === albumId) return;
    setAlbumId(nextAlbumId);
    setAssets([]);
    setHasNextPage(false);
    const nextAlbum = albums.find((album) => album.id === nextAlbumId) || null;
    albumRef.current = nextAlbum;
    void loadAssets(nextAlbum);
  }, [albumId, albums, loadAssets]);

  const closePanel = useCallback(() => {
    setExpanded(false);
    onClose();
  }, [onClose]);

  const handleSwipeDown = useCallback(() => {
    if (expanded) setExpanded(false);
    else closePanel();
  }, [closePanel, expanded]);

  const sendSelection = useCallback(() => {
    // AUD-3: double-tap before the selection state commits must not call
    // onSendFiles twice — the ref clears when the panel closes (visible=false).
    if (sendingRef.current || !selected.length) return;
    sendingRef.current = true;
    const files = selected.map(mediaAssetToPickedFile);
    const captionText = caption.trim();
    setSelected([]);
    setCaption('');
    onSendFiles(files, captionText);
    closePanel();
  }, [caption, closePanel, onSendFiles, selected]);

  // Swipe up on the handle expands to the full gallery; swipe down collapses
  // or closes. The gesture runs on the UI thread; state changes go via runOnJS.
  const handlePan = Gesture.Pan()
    .onEnd((event) => {
      'worklet';
      const dy = event.translationY;
      if (dy <= -48) {
        runOnJS(setExpanded)(true);
      } else if (dy >= 48) {
        runOnJS(handleSwipeDown)();
      }
    });

  const panelStyle = useAnimatedStyle(() => ({ height: panelHeight.value }));

  const actions = useMemo<PanelAction[]>(() => ([
    { key: 'gallery', icon: 'image-multiple-outline', label: 'Галерея', onPress: onOpenGallery },
    { key: 'document', icon: 'file-outline', label: 'Файл', onPress: onOpenDocument },
    { key: 'location', icon: 'map-marker-outline', label: 'Геопозиция', onPress: onSendLocation },
    { key: 'contact', icon: 'account-box-outline', label: 'Контакт', onPress: onSendContact },
    { key: 'poll', icon: 'poll', label: 'Опрос', onPress: onOpenPoll },
    { key: 'task', icon: 'clipboard-check-outline', label: 'Задача', onPress: onOpenTask },
    { key: 'sticker', icon: 'sticker-emoji', label: 'Стикер', onPress: onOpenStickers },
  ].filter((action) => Boolean(action.onPress))),
  [onOpenDocument, onOpenGallery, onOpenPoll, onOpenStickers, onOpenTask, onSendContact, onSendLocation]);

  const gridData: Array<PanelMediaAsset | 'camera'> = useMemo(
    () => ['camera', ...assets],
    [assets],
  );

  // R-T8-2 drag-reorder: `selectedOrder` is the visual slot order while a thumb
  // is dragged; the React list only reorders once the drag commits.
  const selectedOrder = useSharedValue<string[]>([]);
  const selectedDragId = useSharedValue('');
  const selectedDragTx = useSharedValue(0);
  const [stripDragging, setStripDragging] = useState(false);

  useEffect(() => {
    if (!selectedDragId.value) {
      selectedOrder.value = selected.map((item) => item.id);
    }
  }, [selected, selectedDragId, selectedOrder]);

  const commitSelectedOrder = useCallback((nextIds: string[]) => {
    setSelected((current) => reorderPanelAssets(current, nextIds));
    setStripDragging(false);
  }, []);

  const setStripDraggingFlag = useCallback((value: boolean) => {
    setStripDragging(value);
  }, []);

  if (!visible) return null;

  const albumTitle = albums.find((album) => album.id === albumId)?.title || 'Галерея';

  const renderCell = ({ item, index }: { item: PanelMediaAsset | 'camera'; index: number }) => {
    if (item === 'camera') {
      return (
        <Pressable
          style={({ pressed }) => [styles.cell, styles.cameraCell, pressed && styles.pressed]}
          onPress={onOpenCamera}
          accessibilityRole="button"
          accessibilityLabel="Снять на камеру"
        >
          <MaterialCommunityIcons name="camera-outline" size={30} color={chatTokens.textPrimary} />
        </Pressable>
      );
    }
    const badge = mediaSelectionBadge(selected, item.id);
    return (
      <Pressable
        style={({ pressed }) => [styles.cell, pressed && styles.pressed]}
        onPress={() => setSelected((current) => toggleMediaSelection(current, item))}
        accessibilityRole="button"
        accessibilityLabel={`${item.mediaType === 'video' ? 'Видео' : 'Фото'} ${item.filename}`}
        accessibilityState={{ selected: Boolean(badge) }}
      >
        <Image source={{ uri: item.uri }} style={styles.cellImage} />
        {item.mediaType === 'video' ? (
          <View style={styles.durationBadge}>
            <MaterialCommunityIcons name="play" size={12} color="#fff" />
            <Text style={styles.durationText}>{formatMediaDuration(item.duration)}</Text>
          </View>
        ) : null}
        {badge ? (
          <View style={styles.selectBadge}>
            <Text style={styles.selectBadgeText}>{badge}</Text>
          </View>
        ) : null}
      </Pressable>
    );
  };

  return (
    // The panel carries a caption input — ride the keyboard like the composer
    // does, otherwise edge-to-edge keeps the panel pinned under the open IME.
    <KeyboardStickyView>
    <Animated.View style={[styles.panel, panelStyle, { paddingBottom: keyboardState.isVisible ? 0 : Math.max(0, insets?.bottom || 0) }]}>
      <GestureDetector gesture={handlePan}>
        <View style={styles.handleZone}>
          <View style={styles.handle} />
          {expanded ? (
            <Pressable
              onPress={() => setAlbumPickerOpen((value) => !value)}
              style={styles.albumButton}
              accessibilityRole="button"
              accessibilityLabel="Выбрать альбом"
            >
              <Text style={styles.albumButtonText}>{albumTitle}</Text>
              <MaterialCommunityIcons name="chevron-down" size={16} color={chatTokens.textPrimary} />
            </Pressable>
          ) : null}
        </View>
      </GestureDetector>

      {expanded && albumPickerOpen ? (
        <View style={styles.albumList}>
          <Pressable
            onPress={() => switchAlbum(null)}
            style={({ pressed }) => [styles.albumRow, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Все медиа"
          >
            <Text style={styles.albumRowText}>Все медиа</Text>
          </Pressable>
          {albums.map((album) => (
            <Pressable
              key={album.id}
              onPress={() => switchAlbum(album.id)}
              style={({ pressed }) => [styles.albumRow, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={`Альбом ${album.title}`}
            >
              <Text style={styles.albumRowText}>{album.title}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={styles.gridArea}>
        {permissionState === 'denied' ? (
          <View style={styles.permissionBox}>
            <MaterialCommunityIcons
              name={canAskAgain ? 'image-multiple-outline' : 'image-off-outline'}
              size={28}
              color={chatTokens.textSecondary}
            />
            <Text style={styles.permissionText}>
              {canAskAgain
                ? 'Для выбора фото и видео нужен доступ к галерее'
                : 'Нет доступа к медиа — разрешите в настройках'}
            </Text>
            <Pressable
              onPress={canAskAgain ? requestMediaAccess : openSystemSettings}
              style={({ pressed }) => [styles.permissionButton, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={canAskAgain ? 'Разрешить доступ к фото' : 'Открыть настройки'}
            >
              <Text style={styles.permissionButtonText}>
                {canAskAgain ? 'Разрешить доступ к фото' : 'Открыть настройки'}
              </Text>
            </Pressable>
          </View>
        ) : permissionState === 'error' ? (
          <View style={styles.permissionBox}>
            <MaterialCommunityIcons name="image-off-outline" size={28} color={chatTokens.textSecondary} />
            <Text style={styles.permissionText}>Не удалось загрузить медиа</Text>
            <Pressable
              onPress={retryMediaAccess}
              style={({ pressed }) => [styles.permissionButton, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Повторить"
            >
              <Text style={styles.permissionButtonText}>Повторить</Text>
            </Pressable>
          </View>
        ) : (permissionState === 'pending' || gridLoading) && !assets.length ? (
          <ActivityIndicator style={styles.loader} color={chatTokens.accentText} accessibilityLabel="Загрузка медиа" />
        ) : (
          <FlatList
            data={gridData}
            keyExtractor={(item) => (item === 'camera' ? '__camera' : item.id)}
            numColumns={MEDIA_GRID_COLUMNS}
            renderItem={renderCell}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={15}
            maxToRenderPerBatch={12}
            windowSize={5}
            removeClippedSubviews={false}
            onEndReached={() => {
              if (!hasNextPage) return;
              // AUD-2: while a page request is still serialized on loadingRef,
              // a repeated onEndReached would queue the same offset again and
              // duplicate rows (keyExtractor collisions). Skip until it lands.
              if (loadingRef.current && lastRequestedOffsetRef.current === assets.length) return;
              const album = albums.find((item) => item.id === albumId) || null;
              void loadAssets(album, assets.length);
            }}
            onEndReachedThreshold={0.6}
            ListEmptyComponent={
              <Text style={styles.empty}>Нет фото или видео</Text>
            }
            ListHeaderComponent={limitedAccess ? (
              <Pressable
                style={styles.limitedBar}
                onPress={() => {
                  void MediaLibrary.presentPermissionsPicker(['photo', 'video']).then(() => {
                    setAssets([]);
                    setHasNextPage(false);
                    void loadAssets(albums.find((item) => item.id === albumId) || null);
                  }).catch(() => undefined);
                }}
                accessibilityRole="button"
                accessibilityLabel="Выбрать ещё фото"
              >
                <Text style={styles.limitedBarText}>Показаны выбранные фото — нажмите, чтобы расширить доступ</Text>
              </Pressable>
            ) : null}
          />
        )}
      </View>

      {selected.length > 0 ? (
        <View>
          {/* R-T8-2: ordered preview strip — tap opens full-screen preview,
              × removes the item, long-press + drag reorders; order matches
              send order. */}
          <FlatList
            horizontal
            data={selected}
            keyExtractor={(item) => item.id}
            style={styles.selectedStrip}
            contentContainerStyle={styles.selectedStripContent}
            scrollEnabled={!stripDragging}
            extraData={selected}
            renderItem={({ item, index }) => (
              <SelectedThumbCell
                item={item}
                index={index}
                count={selected.length}
                orderSV={selectedOrder}
                dragIdSV={selectedDragId}
                txSV={selectedDragTx}
                onPreview={setPreviewAsset}
                onRemove={(id) => setSelected((items) => items.filter((x) => x.id !== id))}
                onCommit={commitSelectedOrder}
                onDragFlag={setStripDraggingFlag}
                styles={styles}
              />
            )}
          />
          <View style={styles.captionRow}>
          <TextInput
            value={caption}
            onChangeText={setCaption}
            placeholder="Подпись"
            placeholderTextColor={chatTokens.textSecondary}
            style={styles.captionInput}
            accessibilityLabel="Подпись к вложениям"
          />
          <Pressable
            onPress={sendSelection}
            style={({ pressed }) => [styles.sendButton, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`Отправить ${selected.length}`}
          >
            <Text style={styles.sendButtonText}>Отправить ({selected.length})</Text>
          </Pressable>
          </View>
        </View>
      ) : null}

      <View style={styles.actionRow}>
        {actions.map((action) => (
          <Pressable
            key={action.key}
            onPress={action.onPress}
            style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={action.label}
          >
            <MaterialCommunityIcons name={action.icon as never} size={24} color={chatTokens.textPrimary} />
            <Text style={styles.actionLabel}>{action.label}</Text>
          </Pressable>
        ))}
        <Pressable
          onPress={closePanel}
          style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Закрыть панель"
        >
          <MaterialCommunityIcons name="close" size={24} color={chatTokens.textSecondary} />
          <Text style={[styles.actionLabel, { color: chatTokens.textSecondary }]}>Отмена</Text>
        </Pressable>
      </View>

      <Modal
        visible={Boolean(previewAsset)}
        transparent={false}
        animationType={reduceMotion ? 'none' : 'fade'}
        onRequestClose={() => setPreviewAsset(null)}
      >
        <View style={styles.previewBackdrop}>
          {previewAsset ? (
            <Image
              source={{ uri: previewAsset.uri }}
              style={styles.previewImage}
              resizeMode="contain"
              accessibilityLabel={previewAsset.filename}
            />
          ) : null}
          <Pressable
            // AUD-8: edge-to-edge — the fixed 40/20 offsets can sit under the
            // status bar/nav bar; lift them to the safe-area inset.
            style={[styles.previewClose, {
              top: Math.max(40, insets?.top || 0),
              right: Math.max(20, insets?.right || 0),
            }]}
            onPress={() => setPreviewAsset(null)}
            accessibilityRole="button"
            accessibilityLabel="Закрыть предпросмотр"
            hitSlop={12}
          >
            <MaterialCommunityIcons name="close" size={26} color="#fff" />
          </Pressable>
          {previewAsset ? (
            <Pressable
              style={[styles.previewRemove, { bottom: Math.max(40, insets?.bottom || 0) }]}
              onPress={() => {
                setSelected((items) => items.filter((x) => x.id !== previewAsset.id));
                setPreviewAsset(null);
              }}
              accessibilityRole="button"
              accessibilityLabel="Убрать из отправки"
            >
              <MaterialCommunityIcons name="trash-can-outline" size={20} color="#fff" />
              <Text style={styles.previewRemoveText}>Убрать</Text>
            </Pressable>
          ) : null}
        </View>
      </Modal>
    </Animated.View>
    </KeyboardStickyView>
  );
}

type PanelStyles = ReturnType<typeof createStyles>;

function SelectedThumbCell({
  item,
  index,
  count,
  orderSV,
  dragIdSV,
  txSV,
  onPreview,
  onRemove,
  onCommit,
  onDragFlag,
  styles,
}: {
  item: PanelMediaAsset;
  index: number;
  count: number;
  orderSV: SharedValue<string[]>;
  dragIdSV: SharedValue<string>;
  txSV: SharedValue<number>;
  onPreview: (item: PanelMediaAsset) => void;
  onRemove: (id: string) => void;
  onCommit: (ids: string[]) => void;
  onDragFlag: (value: boolean) => void;
  styles: PanelStyles;
}) {
  const drag = useMemo(() => Gesture.Pan()
    .activateAfterLongPress(SELECTED_DRAG_DELAY_MS)
    .onStart(() => {
      'worklet';
      dragIdSV.value = item.id;
      txSV.value = 0;
      runOnJS(onDragFlag)(true);
    })
    .onChange((event) => {
      'worklet';
      txSV.value = event.translationX;
      const target = Math.max(
        0,
        Math.min(count - 1, Math.round((index * SELECTED_PITCH + event.translationX) / SELECTED_PITCH)),
      );
      const ids = orderSV.value.slice();
      const current = ids.indexOf(item.id);
      if (current >= 0 && current !== target) {
        ids.splice(current, 1);
        ids.splice(target, 0, item.id);
        orderSV.value = ids;
      }
    })
    .onEnd(() => {
      'worklet';
      const ids = orderSV.value.slice();
      dragIdSV.value = '';
      txSV.value = withTiming(0, { duration: 140 });
      runOnJS(onCommit)(ids);
    })
    .onFinalize(() => {
      'worklet';
      if (dragIdSV.value === item.id) {
        dragIdSV.value = '';
        txSV.value = withTiming(0, { duration: 120 });
        runOnJS(onDragFlag)(false);
      }
    }), [count, dragIdSV, index, item.id, onCommit, onDragFlag, orderSV, txSV]);

  const dragStyle = useAnimatedStyle(() => {
    const slot = orderSV.value.indexOf(item.id);
    const base = slot < 0 ? index : slot;
    if (dragIdSV.value === item.id) {
      return {
        transform: [{ translateX: (base - index) * SELECTED_PITCH + txSV.value }, { scale: 1.06 }],
        zIndex: 2,
      };
    }
    return {
      transform: [{ translateX: withTiming((base - index) * SELECTED_PITCH, { duration: 120 }) }],
      zIndex: 0,
    };
  });

  return (
    <GestureDetector gesture={drag}>
      <Animated.View style={[styles.selectedThumbWrap, dragStyle]}>
        <Pressable
          style={styles.selectedThumbWrapInner}
          onPress={() => onPreview(item)}
          accessibilityRole="button"
          accessibilityLabel={`Предпросмотр ${index + 1} из ${count}`}
          accessibilityHint="Удерживайте и перетащите, чтобы изменить порядок"
        >
          <Image source={{ uri: item.uri }} style={styles.selectedThumb} />
          {item.mediaType === 'video' ? (
            <MaterialCommunityIcons name="play" size={14} color="#fff" style={styles.selectedThumbVideo} />
          ) : null}
        </Pressable>
        <Pressable
          style={styles.selectedThumbRemove}
          onPress={() => onRemove(item.id)}
          accessibilityRole="button"
          accessibilityLabel={`Убрать ${item.filename}`}
          hitSlop={8}
        >
          <MaterialCommunityIcons name="close" size={12} color="#fff" />
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  panel: {
    backgroundColor: chatTokens.panelBg,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
  },
  handleZone: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 4,
    minHeight: 36,
    justifyContent: 'center',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: chatTokens.textSecondary,
  },
  albumButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  albumButtonText: { color: chatTokens.textPrimary, fontSize: 14, fontWeight: '700' },
  albumList: {
    maxHeight: 220,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: chatTokens.sidebarRowSoftActive,
  },
  albumRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  albumRowText: { color: chatTokens.textPrimary, fontSize: 15, fontWeight: '600' },
  albumRowCount: { color: chatTokens.textSecondary, fontSize: 13 },
  gridArea: { flex: 1 },
  cell: {
    flex: 1,
    aspectRatio: 1,
    margin: 1,
    backgroundColor: chatTokens.sidebarSearchBg,
    overflow: 'hidden',
  },
  cellImage: { width: '100%', height: '100%' },
  cameraCell: { alignItems: 'center', justifyContent: 'center' },
  durationBadge: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  durationText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  selectBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: chatTokens.composerActionBg,
  },
  selectBadgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  permissionBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 24,
  },
  permissionText: { color: chatTokens.textSecondary, fontSize: 14, textAlign: 'center' },
  permissionButton: {
    minHeight: 40,
    borderRadius: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: chatTokens.composerActionBg,
  },
  permissionButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  limitedBar: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: chatTokens.sidebarRowSoftActive,
    borderRadius: 8,
    marginBottom: 4,
  },
  limitedBarText: { color: chatTokens.accentText, fontSize: 12, textAlign: 'center' },
  selectedStrip: { flexGrow: 0, marginBottom: 4 },
  selectedStripContent: { paddingHorizontal: 8, gap: 6, paddingVertical: 4 },
  selectedThumbWrap: {
    width: 56,
    height: 56,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: chatTokens.sidebarSearchBg,
  },
  selectedThumbWrapInner: { flex: 1 },
  selectedThumb: { width: 56, height: 56 },
  selectedThumbVideo: { position: 'absolute', bottom: 2, left: 2 },
  selectedThumbRemove: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewBackdrop: { flex: 1, backgroundColor: '#000', justifyContent: 'center' },
  previewImage: { flex: 1 },
  previewClose: { position: 'absolute', top: 40, right: 20 },
  previewRemove: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: 'rgba(200,60,60,0.85)',
  },
  previewRemoveText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  loader: { marginTop: 32 },
  empty: {
    color: chatTokens.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 24,
  },
  captionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: chatTokens.sidebarRowSoftActive,
  },
  captionInput: {
    flex: 1,
    minHeight: 40,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: chatTokens.sidebarSearchBg,
    color: chatTokens.textPrimary,
    fontSize: 15,
  },
  sendButton: {
    minHeight: 40,
    borderRadius: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: chatTokens.composerActionBg,
  },
  sendButtonText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 4,
    paddingTop: 6,
    paddingBottom: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: chatTokens.sidebarRowSoftActive,
  },
  actionButton: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    minWidth: 60,
    minHeight: 48,
    borderRadius: 12,
    paddingHorizontal: 6,
  },
  actionLabel: { color: chatTokens.textPrimary, fontSize: 11, fontWeight: '600' },
  pressed: { opacity: 0.7 },
});
