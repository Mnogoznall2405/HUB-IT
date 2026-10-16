import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate';
import CloseIcon from '@mui/icons-material/Close';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import RotateLeftIcon from '@mui/icons-material/RotateLeft';
import RotateRightIcon from '@mui/icons-material/RotateRight';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined';
import ThumbDownOffAltIcon from '@mui/icons-material/ThumbDownOffAlt';
import VerifiedIcon from '@mui/icons-material/Verified';
import VerifiedOutlinedIcon from '@mui/icons-material/VerifiedOutlined';

import { LoadingSpinner } from '../../components/common';
import { equipmentPhotosAPI } from '../../api/equipmentPhotos';
import { normalizeDbId } from './databaseRecordModel';
import { rotateImageFile } from './photoRotate';
import { isPermanentFailure } from '../../lib/resumablePhotoUpload';
import ZoomableImage from './ZoomableImage';
import { MAX_REJECT_REASON, rememberRejectReason } from './photoRejectReasons';
import RejectReasonChips from './RejectReasonChips';

const LIST_ERROR = 'Не удалось загрузить список фотографий.';
const UPLOAD_ERROR = 'Не удалось загрузить фотографию.';
const DELETE_ERROR = 'Не удалось удалить фотографию.';
const VERIFY_ERROR = 'Не удалось изменить отметку проверки.';
const ROTATE_ERROR = 'Не удалось повернуть фотографию.';
const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

// Сколько фото проверено/отклонено; null — отметка недоступна (таблица ещё не создана).
const countVerified = (list, available) => (available ? list.filter((photo) => photo.verified).length : null);
const countRejected = (list, available) => (available ? list.filter((photo) => photo.rejected).length : null);

const readApiError = async (error, fallback) => {
  const apiDetail = error?.response?.data?.detail;
  if (apiDetail instanceof Blob) {
    try {
      const parsed = JSON.parse(await apiDetail.text());
      if (typeof parsed?.detail === 'string') return parsed.detail;
    } catch {
      // keep fallback
    }
  }
  return typeof apiDetail === 'string' ? apiDetail : (error?.message || fallback);
};

const usePhotoObjectUrl = ({ itemId, fileNo, thumb = true, enabled = true, dbId = '', rev = 0 }) => {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!enabled || !itemId || !fileNo) return undefined;
    let cancelled = false;
    let objectUrl = '';
    setFailed(false);
    equipmentPhotosAPI
      .fetchContent(itemId, fileNo, { thumb, params: dbId ? { db_id: dbId } : {}, rev })
      .then((response) => {
        const blob = response?.data instanceof Blob ? response.data : null;
        if (!blob || cancelled) return;
        objectUrl = window.URL?.createObjectURL?.(blob) || '';
        if (objectUrl) setUrl(objectUrl);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      if (objectUrl && window.URL?.revokeObjectURL) window.URL.revokeObjectURL(objectUrl);
    };
  }, [itemId, fileNo, thumb, enabled, dbId, rev]);

  return { url, failed };
};

const formatVerifiedAt = (value) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
};

// Что модель прочитала на фото относительно записанного серийника (пусто, если не распознано).
const OCR_LINES = {
  match: { text: 'Серийный № совпал с фото', color: 'success.main' },
  similar: { text: 'Похож на фото — проверьте глазами', color: 'warning.main' },
  mismatch: { text: 'Не совпал с фото', color: 'error.main' },
};

// Фото, которое человек уже проверил («Проверено»), больше не считается сомнительным.
const effectiveOcrVerdict = (photo) => (
  photo.verified && (photo.ocr_verdict === 'similar' || photo.ocr_verdict === 'mismatch')
    ? 'reviewed'
    : photo.ocr_verdict
);

const PhotoOcrLine = ({ photo }) => {
  const verdict = effectiveOcrVerdict(photo);
  const line = OCR_LINES[verdict];
  if (!line) return null;
  const serials = Array.isArray(photo.ocr_serials) ? photo.ocr_serials.filter(Boolean) : [];
  return (
    <Typography
      variant="caption"
      data-testid="photo-ocr-line"
      title={serials.length ? `На фото: ${serials.join(', ')}` : undefined}
      sx={{ display: 'block', px: 0.75, py: 0.25, color: line.color, fontWeight: 600, lineHeight: 1.3 }}
    >
      {verdict === 'match' || !serials.length ? line.text : `${line.text}: ${serials.slice(0, 2).join(', ')}`}
    </Typography>
  );
};

// Нижняя часть карточки: плашка результата («Проверено» зелёная / «Отклонено» красная
// с причиной) и сплошные кнопки действий.
const PhotoVerifyFooter = memo(function PhotoVerifyFooter({
  photo, verifyPermitted, verificationAvailable, busy, onVerify, onReject, onEditReason, onUnverify,
}) {
  const label = photo.file_name || photo.file_no;
  const canAct = verifyPermitted && verificationAvailable;
  const showVerify = canAct && photo.can_verify && !photo.verified;
  const showReject = canAct && photo.can_reject;
  const showOwnHint = canAct && photo.is_own && !photo.verified && !photo.rejected;

  const withdraw = photo.can_unverify ? (
    <Button
      size="small"
      color="inherit"
      disabled={busy}
      aria-label={`Снять отметку проверки с фото ${label}`}
      onClick={() => onUnverify(photo)}
      sx={{ minWidth: 0, py: 0, px: 0.5, fontSize: 11, lineHeight: 1.6, alignSelf: 'flex-start' }}
    >
      Снять
    </Button>
  ) : null;

  return (
    <Box>
      <PhotoOcrLine photo={photo} />
      {photo.verified ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 0.75, py: 0.5, bgcolor: (theme) => (theme.palette.mode === 'dark' ? theme.palette.success.main : theme.palette.success.dark), color: 'success.contrastText' }}>
          <VerifiedIcon sx={{ fontSize: 16 }} />
          <Typography
            variant="caption"
            title={[photo.verified_by, formatVerifiedAt(photo.verified_at)].filter(Boolean).join(', ')}
            sx={{ flex: 1, minWidth: 0, fontWeight: 600 }}
            noWrap
          >
            {`Проверено: ${photo.verified_by || 'проверено'}`}
          </Typography>
          {withdraw}
        </Box>
      ) : null}
      {photo.rejected ? (
        <Box
          role="note"
          sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, px: 0.75, py: 0.5, bgcolor: (theme) => (theme.palette.mode === 'dark' ? theme.palette.error.main : theme.palette.error.dark), color: 'error.contrastText' }}
        >
          <ReportProblemOutlinedIcon sx={{ fontSize: 16, mt: '2px' }} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
              variant="caption"
              title={photo.reject_reason}
              sx={{
                display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical',
                overflow: 'hidden', fontWeight: 700, lineHeight: 1.3, wordBreak: 'break-word',
              }}
            >
              {`Отклонено: ${photo.reject_reason || 'без причины'}`}
            </Typography>
            <Typography
              variant="caption"
              title={formatVerifiedAt(photo.rejected_at)}
              sx={{ display: 'block', opacity: 0.9, fontSize: 10 }}
              noWrap
            >
              {photo.rejected_by || ''}
            </Typography>
          </Box>
          {photo.can_unverify ? (
            <Button
              size="small"
              color="inherit"
              disabled={busy}
              aria-label={`Изменить причину отказа для фото ${label}`}
              onClick={() => onEditReason(photo)}
              sx={{ minWidth: 0, py: 0, px: 0.5, fontSize: 11, lineHeight: 1.6, alignSelf: 'flex-start' }}
            >
              Изменить
            </Button>
          ) : null}
          {withdraw}
        </Box>
      ) : null}
      {showVerify || showReject ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, px: 0.5, py: 0.5 }}>
          {showVerify ? (
            <Button
              fullWidth
              size="small"
              variant="contained"
              color="success"
              disableElevation
              sx={{ bgcolor: (theme) => (theme.palette.mode === 'dark' ? theme.palette.success.main : theme.palette.success.dark), '&:hover': { bgcolor: 'success.dark' } }}
              disabled={busy}
              startIcon={<VerifiedOutlinedIcon />}
              aria-label={`Подтвердить фото ${label}`}
              onClick={() => onVerify(photo)}
            >
              Подтвердить
            </Button>
          ) : null}
          {showReject ? (
            <Button
              fullWidth
              size="small"
              variant="contained"
              color="error"
              disableElevation
              sx={{ bgcolor: (theme) => (theme.palette.mode === 'dark' ? theme.palette.error.main : theme.palette.error.dark), '&:hover': { bgcolor: 'error.dark' } }}
              disabled={busy}
              startIcon={<ThumbDownOffAltIcon />}
              aria-label={`Отклонить фото ${label}`}
              onClick={() => onReject(photo)}
            >
              Отклонить
            </Button>
          ) : null}
        </Box>
      ) : null}
      {showOwnHint ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 0.75, py: 0.5 }}>
          Загрузили вы — проверит другой
        </Typography>
      ) : null}
    </Box>
  );
});

const PhotoCard = memo(function PhotoCard({
  photo, itemId, dbId, canWrite, deleting, verificationAvailable, verifyPermitted, verifying,
  rev, canRotate, rotating, onRotate,
  onOpen, onDelete, onVerify, onReject, onEditReason, onUnverify,
}) {
  const { url, failed } = usePhotoObjectUrl({
    itemId,
    fileNo: photo.file_no,
    thumb: true,
    enabled: Boolean(itemId && photo.file_no),
    dbId,
    rev,
  });
  const [imgLoaded, setImgLoaded] = useState(false);

  return (
    <Paper
      variant="outlined"
      sx={{ position: 'relative', overflow: 'hidden', borderRadius: 1.5 }}
    >
      <Box
        component="button"
        type="button"
        onClick={() => onOpen(photo)}
        aria-label={`Открыть фото ${photo.file_name || photo.file_no}`}
        sx={{
          display: 'block',
          width: '100%',
          aspectRatio: '1 / 1',
          p: 0,
          border: 0,
          cursor: 'zoom-in',
          bgcolor: 'action.hover',
          color: 'text.disabled',
          alignItems: 'center',
          justifyContent: 'center',
          '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
        }}
      >
        {url && imgLoaded ? null : (
          <Box sx={{ display: 'flex', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
            <ImageOutlinedIcon fontSize="large" />
          </Box>
        )}
        {url ? (
          <Box
            component="img"
            src={url}
            alt={photo.file_name || `Фото ${photo.file_no}`}
            loading="lazy"
            onLoad={() => setImgLoaded(true)}
            sx={{
              position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
              opacity: imgLoaded ? 1 : 0, transition: 'opacity 150ms ease',
            }}
          />
        ) : null}
        {failed ? (
          <Typography variant="caption" sx={{ position: 'absolute', bottom: 4, left: 0, right: 0 }}>
            нет превью
          </Typography>
        ) : null}
      </Box>
      {canWrite ? (
        <IconButton
          aria-label={`Удалить фото ${photo.file_name || photo.file_no}`}
          size="small"
          disabled={deleting}
          onClick={() => onDelete(photo)}
          sx={{
            position: 'absolute', top: 4, right: 4,
            bgcolor: 'rgba(0,0,0,0.45)', color: 'common.white',
            '&:hover': { bgcolor: 'rgba(0,0,0,0.65)' },
          }}
        >
          <DeleteOutlineIcon fontSize="small" />
        </IconButton>
      ) : null}
      {canRotate ? (
        <IconButton
          aria-label={`Повернуть фото ${photo.file_name || photo.file_no}`}
          size="small"
          disabled={rotating}
          onClick={() => onRotate(photo, 90)}
          sx={{
            position: 'absolute', top: 4, left: 4,
            bgcolor: 'rgba(0,0,0,0.45)', color: 'common.white',
            '&:hover': { bgcolor: 'rgba(0,0,0,0.65)' },
          }}
        >
          <RotateRightIcon fontSize="small" />
        </IconButton>
      ) : null}
      <PhotoVerifyFooter
        photo={photo}
        verifyPermitted={verifyPermitted}
        verificationAvailable={verificationAvailable}
        busy={verifying}
        onVerify={onVerify}
        onReject={onReject}
        onEditReason={onEditReason}
        onUnverify={onUnverify}
      />
    </Paper>
  );
});

// Просмотр фото открывается поверх карточки оборудования, которая сама может
// стоять поверх диалога сотрудника (оба используют modal + 2). Иначе фото уходит под них.
const PHOTO_PREVIEW_SX = {
  zIndex: (theme) => `${theme.zIndex.modal + 4} !important`,
};

const PhotoPreviewDialog = memo(function PhotoPreviewDialog({
  photo, itemId, dbId, onClose, footer = null, rev = 0, canRotate = false, rotating = false, onRotate = null,
}) {
  const { url } = usePhotoObjectUrl({
    itemId,
    fileNo: photo?.file_no,
    thumb: false,
    enabled: Boolean(photo),
    dbId,
    rev,
  });
  // Фото занимает весь доступный экран: тёмный фон, изображение вписано (contain),
  // колесо/щипок/«+» приближают до 16×, перетаскивание двигает; кнопка проверки — под ним.
  return (
    <Dialog
      open={Boolean(photo)}
      onClose={onClose}
      fullScreen
      sx={PHOTO_PREVIEW_SX}
      PaperProps={{ sx: { bgcolor: '#0b0d10', color: '#fff', backgroundImage: 'none' } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1, flexShrink: 0 }}>
        <Typography component="span" variant="subtitle1" sx={{ flex: 1, minWidth: 0 }} noWrap>
          {photo?.file_name || 'Фото'}
        </Typography>
        {canRotate && photo && onRotate ? (
          <>
            <IconButton
              aria-label="Повернуть влево"
              size="small"
              disabled={rotating}
              onClick={() => onRotate(photo, 270)}
              sx={{ color: 'inherit' }}
            >
              <RotateLeftIcon />
            </IconButton>
            <IconButton
              aria-label="Повернуть вправо"
              size="small"
              disabled={rotating}
              onClick={() => onRotate(photo, 90)}
              sx={{ color: 'inherit' }}
            >
              <RotateRightIcon />
            </IconButton>
          </>
        ) : null}
        <IconButton aria-label="Закрыть просмотр фото" onClick={onClose} edge="end" size="small" sx={{ color: 'inherit' }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent
        sx={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          flex: 1, minHeight: 0, p: 1, overflow: 'hidden',
        }}
      >
        <Box sx={{ flex: '1 1 0', minHeight: 0, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {url ? (
            <ZoomableImage
              src={url}
              alt={photo?.file_name || 'Фото оборудования'}
              resetKey={`${photo?.file_no}:${rev}`}
            />
          ) : (
            <LoadingSpinner message="Загрузка фото..." />
          )}
        </Box>
        {footer ? (
          <Box sx={{ flexShrink: 0, width: '100%', maxWidth: 360, mt: 1, borderRadius: 1, overflow: 'hidden' }}>
            {footer}
          </Box>
        ) : null}
      </DialogContent>
    </Dialog>
  );
});

const EquipmentDetailPhotosPanel = memo(function EquipmentDetailPhotosPanel({
  itemId = null,
  active = false,
  canWrite = false,
  onCountChange = null,
  onScanNext = null,
  // { remaining, onNext } — очередь «следующая техника без фото».
  queue = null,
}) {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  // Файлы, которые не ушли из-за связи: повтор продолжает загрузку с места обрыва.
  const [retryFiles, setRetryFiles] = useState([]);
  const [deletingNo, setDeletingNo] = useState(null);
  const [previewPhoto, setPreviewPhoto] = useState(null);
  const [deleteCandidate, setDeleteCandidate] = useState(null);
  const [verificationAvailable, setVerificationAvailable] = useState(false);
  const [verifyPermitted, setVerifyPermitted] = useState(false);
  const [verifyingNo, setVerifyingNo] = useState(null);
  const [rejectCandidate, setRejectCandidate] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [editingReason, setEditingReason] = useState(false);
  const [rotatingNo, setRotatingNo] = useState(null);
  const [revs, setRevs] = useState({});
  // Снимок с камеры ждёт подтверждения: можно повернуть до загрузки.
  const [capture, setCapture] = useState(null);
  const [captureUrl, setCaptureUrl] = useState('');
  const [captureBusy, setCaptureBusy] = useState(false);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const loadedForRef = useRef('');

  const dbId = normalizeDbId(
    typeof window !== 'undefined' ? localStorage.getItem('selected_database') : ''
  );

  // Панель переиспользуется при переходе к следующей технике: ответ по прежней
  // карточке не должен затирать фото/счётчик новой.
  const latestItemRef = useRef(itemId);
  latestItemRef.current = itemId;

  useEffect(() => {
    setPhotos([]);
    setError('');
    setPreviewPhoto(null);
    setDeleteCandidate(null);
    setVerificationAvailable(false);
    setVerifyPermitted(false);
    setVerifyingNo(null);
    setRejectCandidate(null);
    setRejectReason('');
    setEditingReason(false);
    setRotatingNo(null);
    setRevs({});
    setCapture(null);
  }, [itemId]);

  useEffect(() => {
    if (!capture?.file) { setCaptureUrl(''); return undefined; }
    const objectUrl = window.URL?.createObjectURL?.(capture.file) || '';
    setCaptureUrl(objectUrl);
    return () => { if (objectUrl) window.URL?.revokeObjectURL?.(objectUrl); };
  }, [capture?.file]);

  const load = useCallback(async () => {
    if (!itemId) return;
    const requestedItemId = itemId;
    setLoading(true);
    setError('');
    try {
      const payload = await equipmentPhotosAPI.list(itemId, dbId ? { db_id: dbId } : {});
      if (latestItemRef.current !== requestedItemId) return;
      const nextPhotos = Array.isArray(payload?.photos) ? payload.photos : [];
      const available = payload?.verification_available === true;
      setPhotos(nextPhotos);
      setVerificationAvailable(available);
      setVerifyPermitted(payload?.verify_permitted === true);
      onCountChange?.(nextPhotos.length, countVerified(nextPhotos, available), countRejected(nextPhotos, available));
    } catch (err) {
      if (latestItemRef.current !== requestedItemId) return;
      setError(await readApiError(err, LIST_ERROR));
    } finally {
      if (latestItemRef.current === requestedItemId) setLoading(false);
    }
  }, [itemId, dbId, onCountChange]);

  useEffect(() => {
    if (!active || !itemId) return;
    const key = `${dbId}:${itemId}`;
    if (loadedForRef.current === key) return;
    loadedForRef.current = key;
    void load();
  }, [active, itemId, dbId, load]);

  const handlePickFile = () => fileInputRef.current?.click();

  const handleFileChange = async (event) => {
    // Копируем до сброса value: FileList «живой» и очищается вместе с input.
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    await uploadFiles(files);
  };

  // Снимок с камеры сначала показываем: если кадр лёг на бок, его повернут до загрузки.
  const handleCameraChange = (event) => {
    const file = Array.from(event.target.files || [])[0] || null;
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_PHOTO_BYTES) {
      setError('Файл больше 15 МБ — уменьшите размер или выберите другое фото.');
      return;
    }
    setCapture({ original: file, file, angle: 0 });
  };

  const handleCaptureRotate = async (delta) => {
    if (!capture || captureBusy) return;
    const angle = (((capture.angle + delta) % 360) + 360) % 360;
    setCaptureBusy(true);
    try {
      const file = await rotateImageFile(capture.original, angle);
      setCapture((current) => (current ? { ...current, file, angle } : current));
    } catch (err) {
      setError(await readApiError(err, ROTATE_ERROR));
    } finally {
      setCaptureBusy(false);
    }
  };

  const handleCaptureUpload = async () => {
    const file = capture?.file;
    if (!file || captureBusy) return;
    setCapture(null);
    await uploadFiles([file]);
  };

  const uploadFiles = async (files) => {
    if (!files.length) return;

    const accepted = files.filter((file) => file.size <= MAX_PHOTO_BYTES);
    const oversized = files.length - accepted.length;
    if (!accepted.length) {
      setError('Файл больше 15 МБ — уменьшите размер или выберите другое фото.');
      return;
    }

    setUploading(true);
    setError('');
    setRetryFiles([]);
    setUploadProgress({ done: 0, total: accepted.length });
    let failed = 0;
    let lastError = null;
    const unsent = [];
    // Последовательно: сервер берёт FILE_NO как MAX+1 под блокировкой таблицы.
    for (let index = 0; index < accepted.length; index += 1) {
      try {
        await equipmentPhotosAPI.upload(itemId, accepted[index], { params: dbId ? { db_id: dbId } : {} });
      } catch (err) {
        failed += 1;
        lastError = err;
        // Отказ сервера (не тот файл, нет прав) повтором не лечится; обрыв связи — лечится.
        if (!isPermanentFailure(err)) unsent.push(accepted[index]);
      }
      setUploadProgress({ done: index + 1, total: accepted.length });
    }

    try {
      await load();
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }

    if (failed > 0) {
      const reason = await readApiError(lastError, UPLOAD_ERROR);
      setRetryFiles(unsent);
      setError(accepted.length > 1
        ? `Не загружено ${failed} из ${accepted.length}. ${reason}`
        : reason);
    } else if (oversized > 0) {
      setError(`Пропущено файлов больше 15 МБ: ${oversized}.`);
    }
  };

  const handleConfirmDelete = async () => {
    const photo = deleteCandidate;
    setDeleteCandidate(null);
    if (!photo) return;
    setDeletingNo(photo.file_no);
    setError('');
    try {
      await equipmentPhotosAPI.remove(itemId, photo.file_no, dbId ? { db_id: dbId } : {});
      const remaining = photos.filter((p) => p.file_no !== photo.file_no);
      setPhotos(remaining);
      onCountChange?.(
        remaining.length,
        countVerified(remaining, verificationAvailable),
        countRejected(remaining, verificationAvailable),
      );
      if (previewPhoto?.file_no === photo.file_no) setPreviewPhoto(null);
    } catch (err) {
      setError(await readApiError(err, DELETE_ERROR));
    } finally {
      setDeletingNo(null);
    }
  };

  // Поворот сохраняется на сервере (виден везде); картинки перечитываем по новой «ревизии».
  const handleRotate = async (photo, degrees) => {
    if (rotatingNo !== null) return;
    setRotatingNo(photo.file_no);
    setError('');
    const requestedItemId = itemId;
    try {
      await equipmentPhotosAPI.rotate(itemId, photo.file_no, degrees, dbId ? { db_id: dbId } : {});
      if (latestItemRef.current !== requestedItemId) return;
      setRevs((current) => ({ ...current, [photo.file_no]: (current[photo.file_no] || 0) + 1 }));
    } catch (err) {
      if (latestItemRef.current === requestedItemId) setError(await readApiError(err, ROTATE_ERROR));
    } finally {
      setRotatingNo(null);
    }
  };

  // Ответ сервера — источник правды: в карточке остаётся только его состояние.
  // action: verify | reject (reason) | unverify (снять любую отметку).
  const applyMark = async (photo, action, reason = '') => {
    if (verifyingNo !== null) return false;
    setVerifyingNo(photo.file_no);
    setError('');
    const requestedItemId = itemId;
    const params = dbId ? { db_id: dbId } : {};
    try {
      let result = null;
      if (action === 'verify') result = await equipmentPhotosAPI.verify(itemId, photo.file_no, params);
      else if (action === 'reject') result = await equipmentPhotosAPI.reject(itemId, photo.file_no, reason, params);
      else if (action === 'edit_reason') {
        result = await equipmentPhotosAPI.updateRejectReason(itemId, photo.file_no, reason, params);
      }
      else await equipmentPhotosAPI.unverify(itemId, photo.file_no, params);
      if (latestItemRef.current !== requestedItemId) return true;
      const verified = action === 'verify' && Boolean(result?.verified);
      const rejected = (action === 'reject' || action === 'edit_reason') && Boolean(result?.rejected);
      const marked = verified || rejected;
      const next = photos.map((item) => (item.file_no === photo.file_no
        ? {
          ...item,
          verified,
          verified_by: verified ? (result?.verified_by || '') : '',
          verified_at: verified ? (result?.verified_at || null) : null,
          rejected,
          rejected_by: rejected ? (result?.rejected_by || '') : '',
          rejected_at: rejected ? (result?.rejected_at || null) : null,
          reject_reason: rejected ? (result?.reject_reason || reason) : '',
          // Право действовать после смены отметки: своё фото по-прежнему нельзя.
          can_verify: !verified && !item.is_own,
          can_reject: !rejected && !item.is_own && item.can_reject !== undefined,
          can_unverify: marked,
        }
        : item));
      setPhotos(next);
      onCountChange?.(
        next.length,
        countVerified(next, verificationAvailable),
        countRejected(next, verificationAvailable),
      );
      return true;
    } catch (err) {
      if (latestItemRef.current === requestedItemId) setError(await readApiError(err, VERIFY_ERROR));
      return false;
    } finally {
      setVerifyingNo(null);
    }
  };

  // Просмотр показывает актуальное состояние карточки, а не снимок на момент клика.
  const previewLive = previewPhoto
    ? (photos.find((item) => item.file_no === previewPhoto.file_no) || previewPhoto)
    : null;

  // Итог распознавания по всем фото позиции: любое совпавшее подтверждает серийник.
  const serialNotice = useMemo(() => {
    const verdicts = new Set(photos.map(effectiveOcrVerdict));
    if (verdicts.has('match')) {
      return { severity: 'success', text: 'Серийный номер подтверждён по фото (распознано автоматически).' };
    }
    // Человек уже сверил фото: предупреждение не нужно.
    if (verdicts.has('reviewed')) return null;
    if (verdicts.has('similar')) {
      return { severity: 'warning', text: 'Серийный номер на фото похож на записанный, но отличается — сверьте по этикетке.' };
    }
    if (verdicts.has('mismatch')) {
      return { severity: 'warning', text: 'Серийный номер на фото не совпал с записанным — возможна опечатка в базе.' };
    }
    return null;
  }, [photos]);

  const handleVerify = (photo) => { void applyMark(photo, 'verify'); };
  const handleUnverify = (photo) => { void applyMark(photo, 'unverify'); };
  const handleOpenReject = (photo) => { setRejectReason(''); setEditingReason(false); setRejectCandidate(photo); };
  const handleEditReason = (photo) => {
    setRejectReason(photo.reject_reason || '');
    setEditingReason(true);
    setRejectCandidate(photo);
  };
  const handleConfirmReject = async () => {
    const photo = rejectCandidate;
    const reason = rejectReason.trim();
    if (!photo || !reason) return;
    const ok = await applyMark(photo, editingReason ? 'edit_reason' : 'reject', reason);
    if (ok) {
      rememberRejectReason(reason);
      setRejectCandidate(null);
      setRejectReason('');
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {error ? (
        <Alert severity="error" onClose={() => setError('')}>{error}</Alert>
      ) : null}

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 200 }}>
          {photos.length
            ? `Фотографий: ${photos.length}`
            : 'Фотографии оборудования. Файлы видны и в десктопном IT-Инвент.'}
        </Typography>
        {canWrite ? (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp,image/bmp"
              multiple
              hidden
              onChange={(e) => { void handleFileChange(e); }}
            />
            {/* capture: на телефоне сразу открывает камеру, снимок уходит в карточку без выбора файла. */}
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              data-testid="equipment-photo-camera-input"
              onChange={handleCameraChange}
            />
            <Button
              variant="contained"
              size="small"
              startIcon={<PhotoCameraIcon />}
              onClick={() => cameraInputRef.current?.click()}
              disabled={uploading || loading || !itemId}
            >
              Сделать фото
            </Button>
            <Button
              variant="outlined"
              size="small"
              startIcon={<AddPhotoAlternateIcon />}
              onClick={handlePickFile}
              disabled={uploading || loading || !itemId}
            >
              {uploading
                ? (uploadProgress && uploadProgress.total > 1
                  ? `Загрузка ${Math.min(uploadProgress.done + 1, uploadProgress.total)} из ${uploadProgress.total}...`
                  : 'Загрузка...')
                : 'Добавить фото'}
            </Button>
            {retryFiles.length > 0 && !uploading ? (
              <Button
                variant="contained"
                size="small"
                onClick={() => uploadFiles(retryFiles)}
              >
                {`Повторить загрузку (${retryFiles.length})`}
              </Button>
            ) : null}
            {onScanNext ? (
              <Button
                variant="outlined"
                size="small"
                startIcon={<QrCodeScannerIcon />}
                onClick={onScanNext}
                disabled={uploading}
              >
                Следующий QR
              </Button>
            ) : null}
            {queue?.onNext ? (
              <Button
                variant="outlined"
                size="small"
                startIcon={<SkipNextIcon />}
                onClick={queue.onNext}
                disabled={uploading || !queue.remaining}
              >
                {`Следующая без фото${queue.remaining ? ` (${queue.remaining})` : ''}`}
              </Button>
            ) : null}
          </>
        ) : null}
      </Box>

      {canWrite ? (
        <Typography variant="caption" color="text.secondary">
          Большие фото автоматически уменьшаются до 2560 px по длинной стороне — без видимой потери качества. Лимит файла — 15 МБ.
        </Typography>
      ) : null}

      {loading ? (
        <LoadingSpinner message="Загрузка фотографий..." />
      ) : photos.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
          <ImageOutlinedIcon sx={{ fontSize: 40, color: 'text.disabled', mb: 0.5 }} />
          <Typography variant="body2" color="text.secondary">
            Фотографий пока нет{canWrite ? ' — нажмите «Добавить фото», чтобы прикрепить снимок.' : '.'}
          </Typography>
        </Paper>
      ) : (
        <>
        {serialNotice ? (
          <Alert severity={serialNotice.severity} data-testid="photo-serial-notice" sx={{ py: 0 }}>
            {serialNotice.text}
          </Alert>
        ) : null}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: 'repeat(auto-fill, minmax(110px, 1fr))',
              sm: 'repeat(auto-fill, minmax(150px, 1fr))',
            },
            gap: 1,
          }}
        >
          {photos.map((photo) => (
            <PhotoCard
              key={photo.file_no}
              photo={photo}
              itemId={itemId}
              dbId={dbId}
              canWrite={canWrite}
              deleting={deletingNo === photo.file_no}
              verificationAvailable={verificationAvailable}
              verifyPermitted={verifyPermitted}
              verifying={verifyingNo === photo.file_no}
              rev={revs[photo.file_no] || 0}
              canRotate={canWrite || verifyPermitted}
              rotating={rotatingNo === photo.file_no}
              onRotate={handleRotate}
              onOpen={setPreviewPhoto}
              onDelete={setDeleteCandidate}
              onVerify={handleVerify}
              onReject={handleOpenReject}
              onEditReason={handleEditReason}
              onUnverify={handleUnverify}
            />
          ))}
        </Box>
        </>
      )}

      <PhotoPreviewDialog
        photo={previewLive}
        itemId={itemId}
        dbId={dbId}
        onClose={() => setPreviewPhoto(null)}
        rev={previewLive ? (revs[previewLive.file_no] || 0) : 0}
        canRotate={canWrite || verifyPermitted}
        rotating={previewLive ? rotatingNo === previewLive.file_no : false}
        onRotate={handleRotate}
        footer={previewLive ? (
          <PhotoVerifyFooter
            photo={previewLive}
            verifyPermitted={verifyPermitted}
            verificationAvailable={verificationAvailable}
            busy={verifyingNo === previewLive.file_no}
            onVerify={handleVerify}
            onReject={handleOpenReject}
            onEditReason={handleEditReason}
            onUnverify={handleUnverify}
          />
        ) : null}
      />

      <Dialog
        open={Boolean(capture)}
        onClose={() => (captureBusy ? undefined : setCapture(null))}
        maxWidth="sm"
        fullWidth
        sx={{ zIndex: (theme) => `${theme.zIndex.modal + 5} !important` }}
      >
        <DialogTitle>Проверьте снимок</DialogTitle>
        <DialogContent>
          <Box sx={{ height: { xs: '50vh', sm: 360 }, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'action.hover', borderRadius: 1 }}>
            {captureUrl ? (
              <Box
                component="img"
                src={captureUrl}
                alt="Снимок для загрузки"
                sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
              />
            ) : null}
          </Box>
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap' }}>
          <IconButton aria-label="Повернуть снимок влево" disabled={captureBusy} onClick={() => { void handleCaptureRotate(-90); }}>
            <RotateLeftIcon />
          </IconButton>
          <IconButton aria-label="Повернуть снимок вправо" disabled={captureBusy} onClick={() => { void handleCaptureRotate(90); }}>
            <RotateRightIcon />
          </IconButton>
          <Box sx={{ flex: 1 }} />
          <Button onClick={() => setCapture(null)} disabled={captureBusy}>Отмена</Button>
          <Button variant="contained" disabled={captureBusy} onClick={() => { void handleCaptureUpload(); }}>
            Загрузить
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(rejectCandidate)}
        onClose={() => (verifyingNo === null ? setRejectCandidate(null) : undefined)}
        maxWidth="xs"
        fullWidth
        sx={{ zIndex: (theme) => `${theme.zIndex.modal + 5} !important` }}
      >
        <DialogTitle>{editingReason ? 'Изменить причину отказа' : 'Отклонить фото?'}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {editingReason
              ? 'Новый текст заменит прежнюю причину — отметка отказа останется за проверяющим.'
              : 'Напишите, почему фото не принято — это увидит загрузивший и сможет исправить.'}
          </Typography>
          <RejectReasonChips
            value={rejectReason}
            onChange={setRejectReason}
            disabled={verifyingNo !== null}
          />
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={2}
            maxRows={5}
            label="Причина отказа"
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value.slice(0, MAX_REJECT_REASON))}
            helperText={`${rejectReason.length}/${MAX_REJECT_REASON}`}
            inputProps={{ maxLength: MAX_REJECT_REASON }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectCandidate(null)} disabled={verifyingNo !== null}>Отмена</Button>
          <Button
            color="error"
            variant="contained"
            disableElevation
            disabled={!rejectReason.trim() || verifyingNo !== null}
            onClick={() => { void handleConfirmReject(); }}
          >
            {editingReason ? 'Сохранить' : 'Отклонить'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(deleteCandidate)} onClose={() => setDeleteCandidate(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Удалить фото?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {deleteCandidate?.file_name || 'Фото'} будет удалено из карточки оборудования.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteCandidate(null)}>Отмена</Button>
          <Button
            color="error"
            variant="contained"
            disabled={deletingNo !== null}
            onClick={() => { void handleConfirmDelete(); }}
          >
            Удалить
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
});

export default EquipmentDetailPhotosPanel;
