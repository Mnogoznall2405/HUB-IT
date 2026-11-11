import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  deleteEquipmentPhoto,
  listEquipmentPhotos,
  rejectEquipmentPhoto,
  rotateEquipmentPhoto,
  unverifyEquipmentPhoto,
  updateEquipmentPhotoRejectReason,
  uploadEquipmentPhoto,
  verifyEquipmentPhoto,
  type EquipmentPhoto,
} from '../../api/databaseApi';
import { isPermanentFailure } from '../../database/resumablePhotoUpload';
import { formatApiError } from '../../api/formatError';
import { downloadEquipmentPhoto, invalidateEquipmentPhotoCache } from '../../database/nativeDatabaseFiles';
import { asJpegName, rotateLocalPhoto } from '../../database/photoRotate';
import {
  NativeFilePermissionError,
  openAppPermissionSettings,
  pickNativeAttachments,
  type NativePickedFile,
} from '../../files/nativeFilePicker';
import type { FluentTokens } from '../../theme/fluentTokens';
import { NativeModal as Modal } from '../ui/NativeModal';
import { NativeActionSheetItem } from './NativeEquipmentActionBar';
import { NativePhotoRotatePreviewModal } from './NativePhotoRotatePreviewModal';

const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
const VERIFIED_GREEN = '#1b5e20';
const REJECTED_RED = '#8e1b1b';
const MAX_REJECT_REASON = 500;
const PHOTO_EXT = /\.(jpe?g|png|gif|webp|bmp)$/i;

const usePhotoUri = (
  itemId: number,
  photo: EquipmentPhoto | null,
  options: { thumb: boolean; databaseId?: string; enabled: boolean; rev?: number },
) => {
  const [uri, setUri] = useState('');
  const [failed, setFailed] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!options.enabled || !photo) return undefined;
    let cancelled = false;
    const requestId = ++requestRef.current;
    setFailed(false);
    downloadEquipmentPhoto(itemId, photo.file_no, {
      thumb: options.thumb,
      fileName: photo.file_name,
      databaseId: options.databaseId,
      rev: options.rev,
    })
      .then((file) => {
        if (!cancelled && requestId === requestRef.current) setUri(file.uri);
      })
      .catch(() => {
        if (!cancelled && requestId === requestRef.current) setFailed(true);
      });
    return () => { cancelled = true; };
  }, [itemId, photo, options.thumb, options.databaseId, options.enabled, options.rev]);

  return { uri, failed };
};

const EquipmentPhotoThumb = memo(function EquipmentPhotoThumb({
  itemId,
  photo,
  databaseId,
  canWrite,
  online,
  busy,
  verifying,
  tokens,
  onOpen,
  onDelete,
  onVerify,
  onReject,
  onEditReason,
  onUnverify,
  rev,
  canRotate,
  rotating,
  onRotate,
}: {
  itemId: number;
  photo: EquipmentPhoto;
  databaseId?: string;
  canWrite: boolean;
  online: boolean;
  busy: boolean;
  verifying: boolean;
  tokens: FluentTokens;
  onOpen: (photo: EquipmentPhoto) => void;
  onDelete: (photo: EquipmentPhoto) => void;
  onVerify: (photo: EquipmentPhoto) => void;
  onReject: (photo: EquipmentPhoto) => void;
  onEditReason: (photo: EquipmentPhoto) => void;
  onUnverify: (photo: EquipmentPhoto) => void;
  rev: number;
  canRotate: boolean;
  rotating: boolean;
  onRotate: (photo: EquipmentPhoto, degrees: number) => void;
}) {
  const { uri, failed } = usePhotoUri(itemId, photo, { thumb: true, databaseId, enabled: true, rev });
  return (
    <View>
    <View style={[styles.thumbWrap, { backgroundColor: tokens.panelInset, borderColor: tokens.borderSoft }]}>
      <Pressable
        testID={`native-equipment-photo-${photo.file_no}`}
        accessibilityRole="imagebutton"
        accessibilityLabel={`Открыть фото ${photo.file_name || photo.file_no}`}
        onPress={() => onOpen(photo)}
        style={styles.thumbButton}
      >
        {uri ? (
          <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={uri} />
        ) : (
          <View style={styles.thumbState}>
            {failed
              ? <MaterialCommunityIcons name="image-off-outline" size={26} color={tokens.iconMuted} />
              : <ActivityIndicator size="small" color={tokens.primary} />}
          </View>
        )}
      </Pressable>
      {canWrite ? (
        <Pressable
          testID={`native-equipment-photo-delete-${photo.file_no}`}
          accessibilityRole="button"
          accessibilityLabel={`Удалить фото ${photo.file_name || photo.file_no}`}
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={() => onDelete(photo)}
          style={({ pressed }) => [styles.thumbDelete, { opacity: busy ? 0.5 : pressed ? 0.8 : 1 }]}
        >
          {busy
            ? <ActivityIndicator size="small" color="#fff" />
            : <MaterialCommunityIcons name="delete-outline" size={16} color="#fff" />}
        </Pressable>
      ) : null}
      {canRotate ? (
        <Pressable
          testID={`native-equipment-photo-rotate-${photo.file_no}`}
          accessibilityRole="button"
          accessibilityLabel={`Повернуть фото ${photo.file_name || photo.file_no}`}
          accessibilityState={{ disabled: rotating }}
          disabled={rotating}
          onPress={() => onRotate(photo, 90)}
          style={({ pressed }) => [styles.thumbRotate, { opacity: rotating ? 0.5 : pressed ? 0.8 : 1 }]}
        >
          {rotating
            ? <ActivityIndicator size="small" color="#fff" />
            : <MaterialCommunityIcons name="rotate-right" size={16} color="#fff" />}
        </Pressable>
      ) : null}
    </View>
    <PhotoVerifyBar
      photo={photo}
      online={online}
      busy={verifying}
      tokens={tokens}
      onVerify={onVerify}
      onReject={onReject}
      onEditReason={onEditReason}
      onUnverify={onUnverify}
    />
    </View>
  );
});

// «Проверено» — сплошная зелёная плашка, «Отклонено» — красная с причиной;
// «Подтвердить» / «Отклонить» — сплошные кнопки.
const PhotoVerifyBar = memo(function PhotoVerifyBar({
  photo,
  online,
  busy,
  tokens,
  onVerify,
  onReject,
  onEditReason,
  onUnverify,
  large = false,
}: {
  photo: EquipmentPhoto;
  online: boolean;
  busy: boolean;
  tokens: FluentTokens;
  onVerify: (photo: EquipmentPhoto) => void;
  onReject: (photo: EquipmentPhoto) => void;
  onEditReason: (photo: EquipmentPhoto) => void;
  onUnverify: (photo: EquipmentPhoto) => void;
  large?: boolean;
}) {
  const label = photo.file_name || String(photo.file_no);
  const canAct = online && Boolean(photo.verify_permitted) && Boolean(photo.verification_available);
  const showVerify = canAct && Boolean(photo.can_verify) && !photo.verified;
  const showReject = canAct && Boolean(photo.can_reject);
  const showOwnHint = canAct && Boolean(photo.is_own) && !photo.verified && !photo.rejected;
  const withdraw = photo.can_unverify ? (
    <Pressable
      testID={`native-equipment-photo-unverify-${photo.file_no}`}
      accessibilityRole="button"
      accessibilityLabel={`Снять отметку проверки с фото ${label}`}
      disabled={busy}
      hitSlop={8}
      onPress={() => onUnverify(photo)}
    >
      <Text style={styles.unverifyText}>Снять</Text>
    </Pressable>
  ) : null;
  return (
    <View>
      {photo.verified ? (
        <View style={[styles.verifiedBar, large ? styles.verifyBarLarge : null]}>
          <MaterialCommunityIcons name="check-decagram" size={large ? 18 : 14} color="#fff" />
          <Text numberOfLines={1} style={[styles.verifiedText, large ? styles.verifyTextLarge : null]}>
            {photo.verified_by ? `Проверено: ${photo.verified_by}` : 'Проверено'}
          </Text>
          {withdraw}
        </View>
      ) : null}
      {photo.rejected ? (
        <View style={[styles.rejectedBar, large ? styles.verifyBarLarge : null]}>
          <MaterialCommunityIcons name="alert-circle" size={large ? 18 : 14} color="#fff" />
          <Text
            numberOfLines={large ? 6 : 3}
            style={[styles.verifiedText, large ? styles.verifyTextLarge : null]}
          >
            {`Отклонено: ${photo.reject_reason || 'без причины'}`}
          </Text>
          {photo.can_unverify ? (
            <Pressable
              testID={`native-equipment-photo-edit-reason-${photo.file_no}`}
              accessibilityRole="button"
              accessibilityLabel={`Изменить причину отказа для фото ${label}`}
              disabled={busy}
              hitSlop={8}
              onPress={() => onEditReason(photo)}
            >
              <Text style={styles.unverifyText}>Изменить</Text>
            </Pressable>
          ) : null}
          {withdraw}
        </View>
      ) : null}
      {showVerify ? (
        <Pressable
          testID={`native-equipment-photo-verify-${photo.file_no}`}
          accessibilityRole="button"
          accessibilityLabel={`Подтвердить фото ${label}`}
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={() => onVerify(photo)}
          style={({ pressed }) => [
            styles.verifyButton,
            large ? styles.verifyBarLarge : null,
            { opacity: busy ? 0.6 : pressed ? 0.85 : 1 },
          ]}
        >
          {busy
            ? <ActivityIndicator size="small" color="#fff" />
            : <MaterialCommunityIcons name="check-decagram-outline" size={large ? 18 : 14} color="#fff" />}
          <Text style={[styles.verifyButtonText, large ? styles.verifyTextLarge : null]}>Подтвердить</Text>
        </Pressable>
      ) : null}
      {showReject ? (
        <Pressable
          testID={`native-equipment-photo-reject-${photo.file_no}`}
          accessibilityRole="button"
          accessibilityLabel={`Отклонить фото ${label}`}
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={() => onReject(photo)}
          style={({ pressed }) => [
            styles.verifyButton,
            styles.rejectButton,
            large ? styles.verifyBarLarge : null,
            { opacity: busy ? 0.6 : pressed ? 0.85 : 1 },
          ]}
        >
          <MaterialCommunityIcons name="thumb-down-outline" size={large ? 18 : 14} color="#fff" />
          <Text style={[styles.verifyButtonText, large ? styles.verifyTextLarge : null]}>Отклонить</Text>
        </Pressable>
      ) : null}
      {showOwnHint ? (
        <Text style={[styles.ownHint, { color: tokens.textTertiary }]}>Загрузили вы — проверит другой</Text>
      ) : null}
    </View>
  );
});

export const NativeEquipmentPhotosSection = memo(function NativeEquipmentPhotosSection({
  itemId,
  databaseId,
  canWrite = false,
  offline = false,
  tokens,
  reloadKey = 0,
}: {
  itemId: number;
  databaseId?: string;
  canWrite?: boolean;
  offline?: boolean;
  tokens: FluentTokens;
  reloadKey?: number;
}) {
  const [photos, setPhotos] = useState<EquipmentPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  // Снимки, которые не ушли из-за связи: повтор продолжает загрузку с места обрыва.
  const [retryImages, setRetryImages] = useState<NativePickedFile[]>([]);
  const [deletingNo, setDeletingNo] = useState<number | null>(null);
  const [verifyingNo, setVerifyingNo] = useState<number | null>(null);
  const [preview, setPreview] = useState<EquipmentPhoto | null>(null);
  const [rejectTarget, setRejectTarget] = useState<EquipmentPhoto | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [editingReason, setEditingReason] = useState(false);
  const [rotatingNo, setRotatingNo] = useState<number | null>(null);
  const [revs, setRevs] = useState<Record<number, number>>({});
  // Снимок с камеры ждёт подтверждения: до загрузки его можно повернуть.
  const [captured, setCaptured] = useState<NativePickedFile | null>(null);
  const [capturedBusy, setCapturedBusy] = useState(false);
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const { width } = useWindowDimensions();
  const columns = width >= 560 ? 4 : 3;
  // Поворачивать могут и те, кто загружает, и проверяющие (право database.photo_verify).
  const canRotate = !offline && photos.length > 0 && (canWrite || photos.some((entry) => Boolean(entry.verify_permitted)));

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    if (!silent) setError('');
    try {
      setPhotos(await listEquipmentPhotos(itemId, databaseId));
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось загрузить фотографии.'));
    } finally {
      setLoading(false);
    }
  }, [itemId, databaseId]);

  useEffect(() => {
    if (offline) { setLoading(false); return; }
    void load();
  }, [load, offline, reloadKey]);

  const sendImages = useCallback(async (images: NativePickedFile[]) => {
    setUploading(true);
    setError('');
    setRetryImages([]);
    let index = 0;
    try {
      for (; index < images.length; index += 1) {
        await uploadEquipmentPhoto(itemId, images[index], databaseId);
      }
      await load(true);
    } catch (cause) {
      const rest = images.slice(index);
      // Отказ сервера (не тот файл, нет прав) повтором не лечится; обрыв связи — лечится.
      if (rest.length && !isPermanentFailure(cause)) {
        setRetryImages(rest);
        setError(`Связь прервалась: не загружено фото — ${rest.length}. Уже отправленное сохранено, повтор продолжит с места обрыва.`);
      } else {
        setError(formatApiError(cause, 'Не удалось загрузить фотографию.'));
      }
      if (index > 0) await load(true).catch(() => undefined);
    } finally {
      setUploading(false);
    }
  }, [itemId, databaseId, load]);

  const uploadFiles = useCallback(async (source: 'camera' | 'gallery') => {
    let picked: NativePickedFile[];
    try {
      picked = await pickNativeAttachments(source);
    } catch (cause) {
      if (cause instanceof NativeFilePermissionError) {
        Alert.alert('Нет доступа к камере', 'Разрешите доступ к камере в настройках приложения.', [
          { text: 'Отмена', style: 'cancel' },
          { text: 'Настройки', onPress: () => { void openAppPermissionSettings(); } },
        ]);
      } else {
        setError(formatApiError(cause, 'Не удалось выбрать фото.'));
      }
      return;
    }
    const images = picked.filter((file) => PHOTO_EXT.test(file.name) || String(file.mimeType || '').startsWith('image/'));
    if (!images.length) return;
    const oversized = images.find((file) => Number(file.size || 0) > MAX_PHOTO_BYTES);
    if (oversized) {
      setError(`Файл «${oversized.name}» больше 15 МБ — выберите другое фото.`);
      return;
    }
    // Снимок с камеры сначала показываем: если он лёг на бок, его повернут до загрузки.
    if (source === 'camera' && images.length === 1) {
      setCaptured(images[0]);
      return;
    }
    await sendImages(images);
  }, [sendImages]);

  const requestAdd = useCallback(() => {
    if (uploading || offline) return;
    setAddSheetOpen(true);
  }, [uploading, offline]);

  const pickSource = useCallback((source: 'camera' | 'gallery') => {
    setAddSheetOpen(false);
    void uploadFiles(source);
  }, [uploadFiles]);

  // Состояние отметки берём из ответа сервера; список не перечитываем.
  const applyVerification = useCallback(async (
    photo: EquipmentPhoto,
    action: 'verify' | 'reject' | 'edit_reason' | 'unverify',
    reason = '',
  ): Promise<boolean> => {
    setVerifyingNo(photo.file_no);
    setError('');
    const cleared: Partial<EquipmentPhoto> = {
      verified: false, verified_by: '', verified_at: null,
      rejected: false, rejected_by: '', rejected_at: null, reject_reason: '',
    };
    try {
      let patch: Partial<EquipmentPhoto>;
      if (action === 'verify') {
        const result = await verifyEquipmentPhoto(itemId, photo.file_no, databaseId);
        patch = {
          ...cleared,
          verified: result.verified,
          verified_by: result.verified_by,
          verified_at: result.verified_at,
          can_verify: false,
          can_reject: !photo.is_own,
          can_unverify: result.verified,
        };
      } else if (action === 'reject' || action === 'edit_reason') {
        const result = action === 'reject'
          ? await rejectEquipmentPhoto(itemId, photo.file_no, reason, databaseId)
          : await updateEquipmentPhotoRejectReason(itemId, photo.file_no, reason, databaseId);
        patch = {
          ...cleared,
          rejected: result.rejected,
          rejected_by: result.rejected_by,
          rejected_at: result.rejected_at,
          reject_reason: result.reject_reason || reason,
          can_verify: !photo.is_own,
          can_reject: false,
          can_unverify: result.rejected,
        };
      } else {
        await unverifyEquipmentPhoto(itemId, photo.file_no, databaseId);
        patch = { ...cleared, can_verify: !photo.is_own, can_reject: !photo.is_own, can_unverify: false };
      }
      setPhotos((current) => current.map((entry) => (
        entry.file_no === photo.file_no ? { ...entry, ...patch } : entry
      )));
      return true;
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось изменить отметку проверки.'));
      return false;
    } finally {
      setVerifyingNo(null);
    }
  }, [itemId, databaseId]);

  const handleVerify = useCallback((photo: EquipmentPhoto) => { void applyVerification(photo, 'verify'); }, [applyVerification]);
  const handleUnverify = useCallback((photo: EquipmentPhoto) => { void applyVerification(photo, 'unverify'); }, [applyVerification]);
  // Полноэкранный просмотр закрываем, чтобы окно причины не легло поверх другого модального окна.
  const handleRejectRequest = useCallback((photo: EquipmentPhoto) => {
    setPreview(null);
    setRejectReason('');
    setEditingReason(false);
    setRejectTarget(photo);
  }, []);
  const handleEditReason = useCallback((photo: EquipmentPhoto) => {
    setPreview(null);
    setRejectReason(photo.reject_reason || '');
    setEditingReason(true);
    setRejectTarget(photo);
  }, []);
  const handleRejectConfirm = useCallback(async () => {
    const target = rejectTarget;
    const reason = rejectReason.trim();
    if (!target || !reason) return;
    setRejectTarget(null);
    setRejectReason('');
    await applyVerification(target, editingReason ? 'edit_reason' : 'reject', reason);
  }, [rejectTarget, rejectReason, editingReason, applyVerification]);

  const rotateCaptured = useCallback(async (degrees: number) => {
    if (!captured || capturedBusy) return;
    setCapturedBusy(true);
    try {
      const turned = await rotateLocalPhoto(captured.uri, degrees);
      setCaptured({ ...captured, uri: turned.uri, name: asJpegName(captured.name), mimeType: 'image/jpeg' });
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось повернуть снимок.'));
    } finally {
      setCapturedBusy(false);
    }
  }, [captured, capturedBusy]);

  const confirmCaptured = useCallback(() => {
    const file = captured;
    if (!file || capturedBusy) return;
    setCaptured(null);
    void sendImages([file]);
  }, [captured, capturedBusy, sendImages]);

  // Поворот хранится на сервере; локальный кэш файлов фото сбрасываем и перечитываем.
  const handleRotate = useCallback(async (photo: EquipmentPhoto, degrees: number) => {
    if (rotatingNo !== null) return;
    setRotatingNo(photo.file_no);
    setError('');
    try {
      await rotateEquipmentPhoto(itemId, photo.file_no, degrees, databaseId);
      invalidateEquipmentPhotoCache(itemId, photo.file_no);
      setRevs((current) => ({ ...current, [photo.file_no]: (current[photo.file_no] || 0) + 1 }));
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось повернуть фотографию.'));
    } finally {
      setRotatingNo(null);
    }
  }, [itemId, databaseId, rotatingNo]);

  const requestDelete = useCallback((photo: EquipmentPhoto) => {
    Alert.alert('Удалить фото?', `${photo.file_name || 'Фото'} будет удалено из карточки оборудования.`, [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: () => {
          setDeletingNo(photo.file_no);
          setError('');
          void deleteEquipmentPhoto(itemId, photo.file_no, databaseId)
            .then(() => {
              setPhotos((current) => current.filter((entry) => entry.file_no !== photo.file_no));
              setPreview((current) => (current?.file_no === photo.file_no ? null : current));
            })
            .catch((cause) => setError(formatApiError(cause, 'Не удалось удалить фотографию.')))
            .finally(() => setDeletingNo(null));
        },
      },
    ]);
  }, [itemId, databaseId]);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={[styles.headerText, { color: tokens.textSecondary }]}>
          {photos.length ? `Фотографий: ${photos.length}` : 'Фотографии оборудования. Видны и в десктопном IT-Инвент.'}
        </Text>
        {canWrite ? (
          <Pressable
            testID="native-equipment-photos-add"
            accessibilityRole="button"
            accessibilityLabel="Добавить фото оборудования"
            accessibilityState={{ disabled: uploading || offline }}
            disabled={uploading || offline}
            onPress={requestAdd}
            style={({ pressed }) => [styles.addButton, { backgroundColor: tokens.primary, opacity: (uploading || offline) ? 0.5 : pressed ? 0.85 : 1 }]}
          >
            {uploading
              ? <ActivityIndicator size="small" color="#fff" />
              : <MaterialCommunityIcons name="camera-plus-outline" size={18} color="#fff" />}
            <Text style={styles.addButtonText}>{uploading ? 'Загрузка…' : 'Добавить'}</Text>
          </Pressable>
        ) : null}
      </View>
      {canWrite ? (
        <Text style={[styles.hint, { color: tokens.textTertiary }]}>
          Большие фото автоматически уменьшаются до 2560 px. Лимит файла — 15 МБ.
        </Text>
      ) : null}
      {error ? <Text accessibilityRole="alert" style={[styles.error, { color: tokens.error }]}>{error}</Text> : null}
      {retryImages.length > 0 && !uploading ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Повторить загрузку фото"
          onPress={() => { void sendImages(retryImages); }}
          style={({ pressed }) => [styles.addButton, { alignSelf: 'flex-start', backgroundColor: tokens.primary, opacity: pressed ? 0.85 : 1 }]}
        >
          <Text style={styles.addButtonText}>{`Повторить загрузку (${retryImages.length})`}</Text>
        </Pressable>
      ) : null}
      {offline ? (
        <Text style={[styles.hint, { color: tokens.textSecondary }]}>Фотографии доступны только при подключении к сети.</Text>
      ) : loading ? (
        <View style={styles.loading}><ActivityIndicator color={tokens.primary} /></View>
      ) : photos.length === 0 ? (
        <View style={[styles.empty, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
          <MaterialCommunityIcons name="image-outline" size={34} color={tokens.iconMuted} />
          <Text style={[styles.emptyText, { color: tokens.textSecondary }]}>
            Фотографий пока нет{canWrite ? ' — нажмите «Добавить», чтобы прикрепить снимок.' : '.'}
          </Text>
        </View>
      ) : (
        <View style={styles.grid}>
          {photos.map((photo) => (
            <View key={photo.file_no} style={{ width: `${100 / columns}%`, padding: 3 }}>
              <EquipmentPhotoThumb
                itemId={itemId}
                photo={photo}
                databaseId={databaseId}
                canWrite={canWrite && !offline}
                online={!offline}
                busy={deletingNo === photo.file_no}
                verifying={verifyingNo === photo.file_no}
                tokens={tokens}
                onOpen={setPreview}
                onDelete={requestDelete}
                onVerify={handleVerify}
                onReject={handleRejectRequest}
                onEditReason={handleEditReason}
                onUnverify={handleUnverify}
                rev={revs[photo.file_no] || 0}
                canRotate={canRotate}
                rotating={rotatingNo === photo.file_no}
                onRotate={handleRotate}
              />
            </View>
          ))}
        </View>
      )}

      <EquipmentPhotoPreview
        itemId={itemId}
        photo={preview ? (photos.find((entry) => entry.file_no === preview.file_no) || preview) : null}
        databaseId={databaseId}
        tokens={tokens}
        online={!offline}
        verifying={preview ? verifyingNo === preview.file_no : false}
        onVerify={handleVerify}
        onReject={handleRejectRequest}
        onEditReason={handleEditReason}
        onUnverify={handleUnverify}
        rev={preview ? (revs[preview.file_no] || 0) : 0}
        canRotate={canRotate}
        rotating={preview ? rotatingNo === preview.file_no : false}
        onRotate={handleRotate}
        onClose={() => setPreview(null)}
      />

      <NativePhotoRotatePreviewModal
        uri={captured?.uri || null}
        busy={capturedBusy}
        tokens={tokens}
        onRotate={(degrees) => { void rotateCaptured(degrees); }}
        onCancel={() => setCaptured(null)}
        onConfirm={confirmCaptured}
      />

      <Modal visible={Boolean(rejectTarget)} transparent animationType="fade" onRequestClose={() => setRejectTarget(null)}>
        <View style={styles.sheetRoot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Закрыть окно отказа"
            style={styles.sheetScrim}
            onPress={() => setRejectTarget(null)}
          />
          <View style={[styles.sheet, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderStrong }]}>
            <Text style={[styles.sheetTitle, { color: tokens.textPrimary }]}>
              {editingReason ? 'Изменить причину отказа' : 'Отклонить фото?'}
            </Text>
            <Text style={[styles.sheetHint, { color: tokens.textTertiary }]}>
              {editingReason
                ? 'Новый текст заменит прежнюю причину.'
                : 'Напишите, почему фото не принято — это увидит загрузивший.'}
            </Text>
            <TextInput
              testID="native-equipment-photo-reject-reason"
              accessibilityLabel="Причина отказа"
              value={rejectReason}
              onChangeText={(value) => setRejectReason(value.slice(0, MAX_REJECT_REASON))}
              placeholder="Причина отказа"
              placeholderTextColor={tokens.textTertiary}
              multiline
              maxLength={MAX_REJECT_REASON}
              style={[styles.reasonInput, { color: tokens.textPrimary, borderColor: tokens.borderStrong }]}
            />
            <Pressable
              testID="native-equipment-photo-reject-confirm"
              accessibilityRole="button"
              accessibilityLabel={editingReason ? 'Сохранить причину отказа' : 'Отклонить фото'}
              accessibilityState={{ disabled: !rejectReason.trim() }}
              disabled={!rejectReason.trim()}
              onPress={() => { void handleRejectConfirm(); }}
              style={({ pressed }) => [
                styles.verifyButton, styles.rejectButton, styles.verifyBarLarge,
                { opacity: !rejectReason.trim() ? 0.5 : pressed ? 0.85 : 1 },
              ]}
            >
              <Text style={[styles.verifyButtonText, styles.verifyTextLarge]}>
                {editingReason ? 'Сохранить' : 'Отклонить'}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={addSheetOpen} transparent animationType="slide" onRequestClose={() => setAddSheetOpen(false)}>
        <View style={styles.sheetRoot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Закрыть выбор источника фото"
            style={styles.sheetScrim}
            onPress={() => setAddSheetOpen(false)}
          />
          <View style={[styles.sheet, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderStrong }]}>
            <Text style={[styles.sheetTitle, { color: tokens.textPrimary }]}>Добавить фото</Text>
            <Text style={[styles.sheetHint, { color: tokens.textTertiary }]}>
              Большие фото автоматически уменьшаются до 2560 px. Лимит файла — 15 МБ.
            </Text>
            <NativeActionSheetItem
              testID="native-equipment-photo-source-camera"
              icon="camera-outline"
              label="Снять на камеру"
              onPress={() => pickSource('camera')}
              tokens={tokens}
            />
            <NativeActionSheetItem
              testID="native-equipment-photo-source-gallery"
              icon="image-multiple-outline"
              label="Выбрать из галереи"
              onPress={() => pickSource('gallery')}
              tokens={tokens}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
});

function EquipmentPhotoPreview({
  itemId,
  photo,
  databaseId,
  tokens,
  online,
  verifying,
  onVerify,
  onReject,
  onEditReason,
  onUnverify,
  rev,
  canRotate,
  rotating,
  onRotate,
  onClose,
}: {
  itemId: number;
  photo: EquipmentPhoto | null;
  databaseId?: string;
  tokens: FluentTokens;
  online: boolean;
  verifying: boolean;
  onVerify: (photo: EquipmentPhoto) => void;
  onReject: (photo: EquipmentPhoto) => void;
  onEditReason: (photo: EquipmentPhoto) => void;
  onUnverify: (photo: EquipmentPhoto) => void;
  rev: number;
  canRotate: boolean;
  rotating: boolean;
  onRotate: (photo: EquipmentPhoto, degrees: number) => void;
  onClose: () => void;
}) {
  const { uri, failed } = usePhotoUri(itemId, photo, {
    thumb: false,
    databaseId,
    enabled: Boolean(photo),
    rev,
  });
  return (
    <Modal
      visible={Boolean(photo)}
      animationType="fade"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <View style={[styles.previewRoot, { backgroundColor: '#000' }]}>
        <View style={styles.previewHeader}>
          <Text numberOfLines={1} style={styles.previewTitle}>{photo?.file_name || 'Фото'}</Text>
          {canRotate && photo ? (
            <>
              <Pressable
                testID="native-equipment-photo-preview-rotate-left"
                accessibilityRole="button"
                accessibilityLabel="Повернуть фото влево"
                disabled={rotating}
                onPress={() => onRotate(photo, 270)}
                style={styles.previewClose}
              >
                <MaterialCommunityIcons name="rotate-left" size={24} color="#fff" />
              </Pressable>
              <Pressable
                testID="native-equipment-photo-preview-rotate-right"
                accessibilityRole="button"
                accessibilityLabel="Повернуть фото вправо"
                disabled={rotating}
                onPress={() => onRotate(photo, 90)}
                style={styles.previewClose}
              >
                <MaterialCommunityIcons name="rotate-right" size={24} color="#fff" />
              </Pressable>
            </>
          ) : null}
          <Pressable
            testID="native-equipment-photo-preview-close"
            accessibilityRole="button"
            accessibilityLabel="Закрыть просмотр фото"
            onPress={onClose}
            style={styles.previewClose}
          >
            <MaterialCommunityIcons name="close" size={24} color="#fff" />
          </Pressable>
        </View>
        <View style={styles.previewBody}>
          {uri ? (
            <Image source={{ uri }} style={styles.previewImage} contentFit="contain" recyclingKey={uri} />
          ) : (
            <View style={styles.previewState}>
              {failed
                ? <Text style={styles.previewFailed}>Не удалось загрузить фото</Text>
                : <ActivityIndicator color="#fff" />}
            </View>
          )}
        </View>
        {photo?.description ? <Text style={styles.previewCaption}>{photo.description}</Text> : null}
        {photo ? (
          <View style={styles.previewVerify}>
            <PhotoVerifyBar
              photo={photo}
              online={online}
              busy={verifying}
              tokens={tokens}
              onVerify={onVerify}
              onReject={onReject}
              onEditReason={onEditReason}
              onUnverify={onUnverify}
              large
            />
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { gap: 8 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerText: { flex: 1, fontSize: 12, lineHeight: 17, fontWeight: '600' },
  hint: { fontSize: 11, lineHeight: 15, fontWeight: '600' },
  error: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
  addButton: { minHeight: 40, borderRadius: 11, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6 },
  addButtonText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  loading: { minHeight: 120, alignItems: 'center', justifyContent: 'center' },
  empty: { borderWidth: 1, borderRadius: 14, padding: 22, alignItems: 'center', gap: 8 },
  emptyText: { fontSize: 12, lineHeight: 17, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -3 },
  thumbWrap: { aspectRatio: 1, borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  thumbButton: { flex: 1 },
  thumbState: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  thumbDelete: {
    position: 'absolute', top: 6, right: 6,
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },
  thumbRotate: {
    position: 'absolute', top: 6, left: 6,
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },
  previewRoot: { flex: 1 },
  previewHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, minHeight: 56 },
  previewTitle: { flex: 1, color: '#fff', fontSize: 15, fontWeight: '700', paddingHorizontal: 8 },
  previewClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  previewBody: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  previewImage: { width: '100%', height: '100%' },
  previewState: { alignItems: 'center', justifyContent: 'center' },
  previewFailed: { color: '#fff', fontSize: 13, fontWeight: '700' },
  previewVerify: { paddingHorizontal: 16, paddingBottom: 22 },
  verifiedBar: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: 4, borderRadius: 8, paddingHorizontal: 6, minHeight: 26,
    backgroundColor: VERIFIED_GREEN,
  },
  rejectedBar: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: 4, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 4, minHeight: 26,
    backgroundColor: REJECTED_RED,
  },
  rejectButton: { backgroundColor: REJECTED_RED },
  reasonInput: {
    minHeight: 84, maxHeight: 160, borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10, marginHorizontal: 10, marginBottom: 12,
    fontSize: 14, textAlignVertical: 'top',
  },
  verifiedText: { flex: 1, color: '#fff', fontSize: 10, fontWeight: '800' },
  unverifyText: { color: '#fff', fontSize: 10, fontWeight: '800', textDecorationLine: 'underline' },
  verifyButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    marginTop: 4, borderRadius: 8, minHeight: 30,
    backgroundColor: VERIFIED_GREEN,
  },
  verifyButtonText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  verifyBarLarge: { minHeight: 46, borderRadius: 12, paddingHorizontal: 14, justifyContent: 'center' },
  verifyTextLarge: { fontSize: 15 },
  ownHint: { marginTop: 4, fontSize: 10, lineHeight: 13, fontWeight: '600', textAlign: 'center' },
  previewCaption: { color: '#ddd', fontSize: 12, textAlign: 'center', paddingHorizontal: 16, paddingBottom: 18 },
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  sheetScrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.48)' },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, paddingTop: 14, paddingHorizontal: 14, paddingBottom: 26 },
  sheetTitle: { fontSize: 15, fontWeight: '800', paddingHorizontal: 10, marginBottom: 2 },
  sheetHint: { fontSize: 11, lineHeight: 15, fontWeight: '600', paddingHorizontal: 10, marginBottom: 8 },
});
