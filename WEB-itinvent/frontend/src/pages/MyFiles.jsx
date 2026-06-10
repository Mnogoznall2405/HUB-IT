import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import ArticleOutlinedIcon from '@mui/icons-material/ArticleOutlined';
import AudioFileOutlinedIcon from '@mui/icons-material/AudioFileOutlined';
import CloudUploadOutlinedIcon from '@mui/icons-material/CloudUploadOutlined';
import CodeOutlinedIcon from '@mui/icons-material/CodeOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import LinkOutlinedIcon from '@mui/icons-material/LinkOutlined';
import MovieOutlinedIcon from '@mui/icons-material/MovieOutlined';
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import ShareOutlinedIcon from '@mui/icons-material/ShareOutlined';
import TableChartOutlinedIcon from '@mui/icons-material/TableChartOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import MainLayout from '../components/layout/MainLayout';
import MyFilesShareDialog from '../components/myFiles/MyFilesShareDialog';
import DocumentPreviewDialog from '../components/documentPreview/DocumentPreviewDialog';
import PageShell from '../components/layout/PageShell';
import {
  formatMyFilesUploadLimitLabel,
  myFilesAPI,
  MY_FILES_MAX_UPLOAD_BYTES,
  myFilesRetentionOptions,
} from '../api/myFiles';
import {
  buildAttachmentBlobPayload,
  downloadBlobFile,
  getOfficeAttachmentSourceKind,
  normalizeAttachmentPreviewMetadata,
} from '../components/mail/mailMessageFileActions';
import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';
import { parseExcelWorkbookFromBlob } from '../lib/excelPreview';
import { buildOfficeUiTokens, getOfficePanelSx } from '../theme/officeUiTokens';

const READY_STATUSES = new Set(['ready']);
const ACTIVE_PROCESSING_STATUSES = new Set(['uploading', 'queued', 'scanning', 'processing']);

const formatFileSize = (bytes) => {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return '0 Б';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let current = value;
  let index = 0;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  return `${current >= 10 || index === 0 ? current.toFixed(0) : current.toFixed(1)} ${units[index]}`;
};

const formatDateTime = (value) => {
  const text = String(value || '').trim();
  if (!text) return '-';
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;
  return parsed.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const normalizeFiles = (value) => Array.from(value || []).filter(Boolean);

const FILE_TYPE_META = {
  image: { label: 'Изображение', icon: ImageOutlinedIcon, palette: 'success' },
  video: { label: 'Видео', icon: MovieOutlinedIcon, palette: 'secondary' },
  audio: { label: 'Аудио', icon: AudioFileOutlinedIcon, palette: 'secondary' },
  pdf: { label: 'PDF', icon: PictureAsPdfOutlinedIcon, palette: 'error' },
  document: { label: 'Документ', icon: DescriptionOutlinedIcon, palette: 'primary' },
  sheet: { label: 'Таблица', icon: TableChartOutlinedIcon, palette: 'success' },
  archive: { label: 'Архив', icon: ArchiveOutlinedIcon, palette: 'warning' },
  code: { label: 'Код', icon: CodeOutlinedIcon, palette: 'info' },
  text: { label: 'Текст', icon: ArticleOutlinedIcon, palette: 'info' },
  file: { label: 'Файл', icon: InsertDriveFileOutlinedIcon, palette: 'neutral' },
};

const getFileExtension = (fileName = '') => {
  const normalized = String(fileName || '').toLowerCase();
  const dotIndex = normalized.lastIndexOf('.');
  return dotIndex >= 0 ? normalized.slice(dotIndex + 1) : '';
};

const getMyFileName = (item) => String(item?.download_file_name || item?.original_file_name || 'file.bin');

const getMyFileContentType = (item) => String(item?.download_mime_type || item?.mime_type || 'application/octet-stream');

const getMyFilePreviewKind = (item) => {
  const explicitKind = String(item?.preview_kind || '').trim();
  if (explicitKind && explicitKind !== 'unsupported') return explicitKind;
  const fileName = getMyFileName(item);
  const contentType = getMyFileContentType(item).toLowerCase();
  const extension = getFileExtension(fileName);
  if (contentType.includes('pdf') || extension === 'pdf') return 'pdf';
  const sourceKind = getOfficeAttachmentSourceKind({ filename: fileName, contentType });
  if (sourceKind === 'excel') return 'office_excel';
  if (sourceKind) return 'office_pdf';
  return 'unsupported';
};

const isMyFilePreviewSupported = (item) => getMyFilePreviewKind(item) !== 'unsupported';

const createEmptyDocumentPreviewState = () => ({
  open: false,
  item: null,
  loading: false,
  error: '',
  kind: 'unsupported',
  sourceKind: '',
  objectUrl: '',
  previewBlob: null,
  excelWorkbook: null,
  pageCount: 0,
  sheets: [],
  pdfFilename: '',
});

const resolveMyFilePreviewError = (error, item) => {
  const detail = String(error?.response?.data?.detail || error?.message || '').trim();
  const previewStatus = String(item?.preview_status || '').toLowerCase();
  if (previewStatus === 'queued' || previewStatus === 'processing') {
    return 'Предпросмотр готовится. Обновите через несколько секунд или скачайте оригинал.';
  }
  if (/too large/i.test(detail)) {
    const limit = Number(item?.preview_max_bytes || 0);
    return limit > 0
      ? `Файл слишком большой для предпросмотра. Лимит: ${formatFileSize(limit)}.`
      : 'Файл слишком большой для предпросмотра.';
  }
  if (
    !detail
    || /preview is temporarily unavailable/i.test(detail)
    || /not available/i.test(detail)
    || /failed/i.test(detail)
  ) {
    return 'Предпросмотр готовится или временно недоступен. Оригинал можно скачать.';
  }
  return detail;
};

const getFileVisualMeta = (item) => {
  const fileName = String(item?.download_file_name || item?.original_file_name || '');
  const mimeType = String(item?.download_mime_type || item?.mime_type || '').toLowerCase();
  const extension = getFileExtension(fileName);
  if (mimeType.startsWith('image/')) return FILE_TYPE_META.image;
  if (mimeType.startsWith('video/')) return FILE_TYPE_META.video;
  if (mimeType.startsWith('audio/')) return FILE_TYPE_META.audio;
  if (mimeType.includes('pdf') || extension === 'pdf') return FILE_TYPE_META.pdf;
  if (['doc', 'docx', 'rtf', 'odt'].includes(extension)) return FILE_TYPE_META.document;
  if (['xls', 'xlsx', 'csv', 'ods'].includes(extension)) return FILE_TYPE_META.sheet;
  if (['zip', 'rar', '7z', 'tar', 'gz', 'zst'].includes(extension)) return FILE_TYPE_META.archive;
  if (['js', 'jsx', 'ts', 'tsx', 'py', 'ps1', 'sql', 'json', 'xml', 'html', 'css', 'md'].includes(extension)) return FILE_TYPE_META.code;
  if (mimeType.startsWith('text/') || ['txt', 'log'].includes(extension)) return FILE_TYPE_META.text;
  return FILE_TYPE_META.file;
};

const getFileVisualColors = (theme, meta) => {
  const palette = theme.palette[meta.palette] || theme.palette.primary;
  const main = palette.main || theme.palette.text.secondary;
  return {
    color: main,
    background: alpha(main, theme.palette.mode === 'dark' ? 0.18 : 0.1),
    border: alpha(main, theme.palette.mode === 'dark' ? 0.35 : 0.18),
  };
};

const statusChip = (status, errorText = '') => {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'ready') return { label: 'Готов', color: 'success' };
  if (normalized === 'uploading') return { label: 'Загрузка', color: 'info' };
  if (normalized === 'scanning') return { label: 'Проверка безопасности', color: 'warning' };
  if (normalized === 'processing') return { label: 'Сжатие', color: 'info' };
  if (normalized === 'queued') return { label: 'В очереди', color: 'warning' };
  if (normalized === 'failed') return { label: errorText || 'Ошибка', color: 'error' };
  return { label: normalized || 'Неизвестно', color: 'default' };
};

export default function MyFiles() {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('my_files.write');
  const canShare = hasPermission('my_files.share');
  const fileInputRef = useRef(null);
  const [items, setItems] = useState([]);
  const [quota, setQuota] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [retentionDays, setRetentionDays] = useState(1);
  const [pendingUploadFiles, setPendingUploadFiles] = useState([]);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({});
  const [downloadingFileId, setDownloadingFileId] = useState('');
  const [shareDialog, setShareDialog] = useState({
    open: false,
    fileId: '',
    url: '',
    expiresAt: null,
    fileName: '',
    linkCopied: false,
  });
  const previewObjectUrlRef = useRef('');
  const [documentPreview, setDocumentPreview] = useState(createEmptyDocumentPreviewState);
  const { notifySuccess, notifyWarning, notifyApiError } = useNotification();

  const hasProcessingFiles = useMemo(
    () => items.some((item) => ACTIVE_PROCESSING_STATUSES.has(String(item?.status || '').toLowerCase())),
    [items],
  );

  const loadData = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setRefreshing(true);
    try {
      const [filesPayload, quotaPayload] = await Promise.all([
        myFilesAPI.listFiles(),
        myFilesAPI.getQuota(),
      ]);
      setItems(Array.isArray(filesPayload?.items) ? filesPayload.items : []);
      setQuota(quotaPayload || null);
    } catch (error) {
      notifyApiError(error, 'Не удалось загрузить список файлов.', { dedupeMode: 'recent' });
    } finally {
      if (!silent) setLoading(false);
      setRefreshing(false);
    }
  }, [notifyApiError]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!hasProcessingFiles) return undefined;
    const timer = window.setInterval(() => {
      void loadData({ silent: true });
    }, 4000);
    return () => window.clearInterval(timer);
  }, [hasProcessingFiles, loadData]);

  const revokePreviewObjectUrl = useCallback(() => {
    const currentUrl = previewObjectUrlRef.current;
    if (currentUrl && typeof window !== 'undefined' && typeof window.URL?.revokeObjectURL === 'function') {
      window.URL.revokeObjectURL(currentUrl);
    }
    previewObjectUrlRef.current = '';
  }, []);

  useEffect(() => () => {
    revokePreviewObjectUrl();
  }, [revokePreviewObjectUrl]);

  const queueUploads = useCallback(async (files, selectedRetentionDays = retentionDays) => {
    const selected = normalizeFiles(files);
    if (selected.length === 0) return;
    setUploading(true);
    setUploadProgress({});
    try {
      for (const file of selected) {
        if (Number(file?.size || 0) > MY_FILES_MAX_UPLOAD_BYTES) {
          notifyWarning(`Файл «${file.name}» больше 1 ГБ и не может быть загружен.`, {
            source: 'my-files-upload',
            dedupeMode: 'none',
          });
          continue;
        }
        await myFilesAPI.uploadFile({
          file,
          retentionDays: selectedRetentionDays,
          onUploadProgress: (event) => {
            const total = Number(event?.total || file.size || 0);
            const loaded = Number(event?.loaded || 0);
            setUploadProgress((current) => ({
              ...current,
              [file.name]: total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0,
            }));
          },
        });
      }
      notifySuccess('Файлы добавлены в очередь обработки.', { source: 'my-files-upload', dedupeMode: 'none' });
      await loadData({ silent: true });
    } catch (error) {
      const status = Number(error?.response?.status || 0);
      if (status === 413) {
        notifyWarning(
          'Сервер отклонил загрузку: слишком большой файл для лимита IIS. После обновления web.config на сайте допустимо до 1 ГБ на файл. Обратитесь к администратору, если ошибка повторяется.',
          { source: 'my-files-upload-413', dedupeMode: 'none', durationMs: 8000 },
        );
      } else {
        notifyApiError(error, 'Не удалось загрузить файл.', { dedupeMode: 'none' });
      }
    } finally {
      setUploading(false);
      setUploadProgress({});
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [loadData, notifyApiError, notifySuccess, notifyWarning, retentionDays]);

  const openUploadDialog = useCallback((files) => {
    if (!canWrite) return;
    const selected = normalizeFiles(files);
    if (selected.length === 0) return;
    setRetentionDays(1);
    setPendingUploadFiles(selected);
    setUploadDialogOpen(true);
  }, [canWrite]);

  const closeUploadDialog = useCallback(() => {
    if (uploading) return;
    setUploadDialogOpen(false);
    setPendingUploadFiles([]);
  }, [uploading]);

  const confirmUpload = useCallback(() => {
    const selected = pendingUploadFiles;
    if (selected.length === 0) return;
    const selectedRetentionDays = retentionDays;
    setUploadDialogOpen(false);
    setPendingUploadFiles([]);
    void queueUploads(selected, selectedRetentionDays);
  }, [pendingUploadFiles, queueUploads, retentionDays]);

  const handleInputChange = useCallback((event) => {
    openUploadDialog(event.target.files);
    event.target.value = '';
  }, [openUploadDialog]);

  const handleDrop = useCallback((event) => {
    event.preventDefault();
    setDragActive(false);
    openUploadDialog(event.dataTransfer.files);
  }, [openUploadDialog]);

  const handleDownload = useCallback(async (item) => {
    const fileId = String(item?.id || '').trim();
    if (!fileId) return;
    setDownloadingFileId(fileId);
    try {
      const grant = await myFilesAPI.createDownloadGrant(fileId);
      const downloadUrl = myFilesAPI.buildDownloadGrantUrl(grant?.download_path);
      if (!downloadUrl) {
        notifyWarning('Не удалось получить ссылку для скачивания.', { source: 'my-files-download', dedupeMode: 'none' });
        return;
      }
      if (!myFilesAPI.triggerNativeDownload(downloadUrl)) {
        notifyWarning('Браузер не смог начать скачивание.', { source: 'my-files-download', dedupeMode: 'none' });
        return;
      }
      notifySuccess('Скачивание запущено — смотрите панель загрузок браузера.', { source: 'my-files-download', dedupeMode: 'none', durationMs: 4000 });
    } catch (error) {
      notifyApiError(error, 'Не удалось скачать файл.', { dedupeMode: 'none' });
    } finally {
      setDownloadingFileId('');
    }
  }, [notifyApiError, notifySuccess, notifyWarning]);

  const openDocumentPreview = useCallback(async (item) => {
    const fileId = String(item?.id || '').trim();
    if (!fileId) return;

    const fileName = getMyFileName(item);
    const contentType = getMyFileContentType(item);
    const fallbackSourceKind = getOfficeAttachmentSourceKind({ filename: fileName, contentType });
    const fallbackKind = getMyFilePreviewKind(item);

    revokePreviewObjectUrl();
    setDocumentPreview({
      ...createEmptyDocumentPreviewState(),
      open: true,
      item,
      loading: true,
      kind: fallbackKind,
      sourceKind: fallbackSourceKind,
    });

    try {
      const metadata = normalizeAttachmentPreviewMetadata(await myFilesAPI.getPreviewMeta(fileId));
      const resolvedSourceKind = metadata.sourceKind || fallbackSourceKind;
      const previewResponse = await myFilesAPI.downloadPreviewContent(fileId);
      const {
        blob: previewBlob,
        filename: previewFilename,
      } = buildAttachmentBlobPayload({
        response: previewResponse,
        attachment: {
          name: metadata.pdfFilename || fileName,
          content_type: 'application/pdf',
        },
      });
      const objectUrl = typeof window !== 'undefined' && typeof window.URL?.createObjectURL === 'function'
        ? window.URL.createObjectURL(previewBlob)
        : '';
      previewObjectUrlRef.current = objectUrl;

      let excelWorkbook = null;
      if (resolvedSourceKind === 'excel') {
        try {
          const sourceResponse = await myFilesAPI.downloadPreviewSource(fileId);
          const { blob: sourceBlob } = buildAttachmentBlobPayload({
            response: sourceResponse,
            attachment: { name: fileName, content_type: contentType },
          });
          excelWorkbook = await parseExcelWorkbookFromBlob(sourceBlob);
        } catch {
          excelWorkbook = null;
        }
      }

      setDocumentPreview({
        open: true,
        item,
        loading: false,
        error: '',
        kind: resolvedSourceKind === 'excel' && excelWorkbook ? 'office_excel' : (metadata.previewKind || fallbackKind),
        sourceKind: resolvedSourceKind,
        objectUrl,
        previewBlob,
        excelWorkbook,
        pageCount: metadata.pageCount,
        sheets: metadata.sheets,
        pdfFilename: previewFilename || metadata.pdfFilename,
      });
    } catch (error) {
      setDocumentPreview((current) => ({
        ...current,
        loading: false,
        error: resolveMyFilePreviewError(error, item),
        objectUrl: '',
        previewBlob: null,
        excelWorkbook: null,
      }));
    }
  }, [revokePreviewObjectUrl]);

  const closeDocumentPreview = useCallback(() => {
    revokePreviewObjectUrl();
    setDocumentPreview(createEmptyDocumentPreviewState());
  }, [revokePreviewObjectUrl]);

  const refreshDocumentPreview = useCallback(() => {
    if (!documentPreview.item) return;
    void openDocumentPreview(documentPreview.item);
  }, [documentPreview.item, openDocumentPreview]);

  const downloadDocumentPreviewPdf = useCallback(() => {
    if (!documentPreview.previewBlob) return;
    const fileName = getMyFileName(documentPreview.item);
    downloadBlobFile(
      documentPreview.previewBlob,
      documentPreview.pdfFilename || `${fileName.replace(/\.[^.]+$/, '') || 'preview'}.pdf`,
      { preferOpenFallback: true },
    );
  }, [documentPreview.item, documentPreview.pdfFilename, documentPreview.previewBlob]);

  const handleShare = useCallback(async (item, { rotate = false } = {}) => {
    try {
      const payload = await myFilesAPI.createShare(item.id, { rotate });
      const publicUrl = myFilesAPI.buildPublicUrl(payload.token);
      let linkCopied = false;
      try {
        await navigator.clipboard?.writeText(publicUrl);
        linkCopied = true;
      } catch {
        notifyWarning('Ссылка создана. Скопируйте её из окна.', { source: 'my-files-share', dedupeMode: 'none' });
      }
      setShareDialog({
        open: true,
        fileId: item.id,
        url: publicUrl,
        expiresAt: payload.expires_at || item.expires_at,
        fileName: item.download_file_name || item.original_file_name || 'файл',
        linkCopied,
      });
      if (rotate) {
        notifySuccess('Создана новая публичная ссылка.', { source: 'my-files-share-rotate', dedupeMode: 'none' });
      }
      await loadData({ silent: true });
    } catch (error) {
      notifyApiError(error, 'Не удалось создать публичную ссылку.', { dedupeMode: 'none' });
    }
  }, [loadData, notifyApiError, notifySuccess, notifyWarning]);

  const handleRevokeShare = useCallback(async (item) => {
    try {
      await myFilesAPI.revokeShare(item.id);
      notifySuccess('Публичная ссылка отключена.', { source: 'my-files-share', dedupeMode: 'none' });
      await loadData({ silent: true });
    } catch (error) {
      notifyApiError(error, 'Не удалось отключить ссылку.', { dedupeMode: 'none' });
    }
  }, [loadData, notifyApiError, notifySuccess]);

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

  const quotaUsed = Number(quota?.used_bytes || 0);
  const quotaLimit = Number(quota?.limit_bytes || 0);
  const quotaPercent = quotaLimit > 0 ? Math.min(100, Math.round((quotaUsed / quotaLimit) * 100)) : 0;

  return (
    <MainLayout showDatabaseSelector={false}>
      <PageShell>
        <Stack spacing={2.5}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} justifyContent="space-between" alignItems={{ xs: 'stretch', md: 'center' }}>
            <Box>
              <Typography variant="h4" sx={{ fontWeight: 700 }}>Мои файлы</Typography>
              <Typography variant="body2" color="text.secondary">Личное хранилище с публичной ссылкой на выбранный файл.</Typography>
            </Box>
            <Stack direction="row" spacing={1} alignItems="center">
              <Button
                variant="contained"
                startIcon={<CloudUploadOutlinedIcon />}
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || !canWrite}
              >
                Загрузить
              </Button>
              <Tooltip title="Обновить">
                <IconButton onClick={() => loadData({ silent: true })} disabled={refreshing}>
                  {refreshing ? <CircularProgress size={20} /> : <RefreshOutlinedIcon />}
                </IconButton>
              </Tooltip>
            </Stack>
          </Stack>

          <Alert severity="info">
            Файлы хранятся в системе до 30 дней. После окончания срока файл и публичная ссылка удаляются.
          </Alert>

          <Paper
            variant="outlined"
            onDragOver={(event) => {
              event.preventDefault();
              if (!canWrite) return;
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            sx={{
              ...getOfficePanelSx(ui),
              p: 2,
              borderStyle: 'dashed',
              borderColor: dragActive ? 'primary.main' : ui.border,
              bgcolor: dragActive ? alpha(theme.palette.primary.main, 0.08) : undefined,
            }}
          >
            <input ref={fileInputRef} data-testid="my-files-input" type="file" multiple hidden disabled={!canWrite} onChange={handleInputChange} />
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ xs: 'stretch', md: 'center' }} justifyContent="space-between">
              <Stack direction="row" spacing={1.5} alignItems="center">
                <InsertDriveFileOutlinedIcon color="primary" />
                <Box>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Перетащите файлы сюда</Typography>
                  <Typography variant="body2" color="text.secondary">Срок хранения выбирается перед загрузкой.</Typography>
                </Box>
              </Stack>
              <Box sx={{ minWidth: { xs: '100%', md: 260 } }}>
                <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
                  <Typography variant="body2" color="text.secondary">Квота</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{formatFileSize(quotaUsed)} / {formatFileSize(quotaLimit)}</Typography>
                </Stack>
                <LinearProgress variant="determinate" value={quotaPercent} sx={{ height: 8, borderRadius: 1 }} />
              </Box>
            </Stack>
            {uploading ? (
              <Stack spacing={0.75} sx={{ mt: 2 }}>
                {Object.entries(uploadProgress).map(([name, progress]) => (
                  <Box key={name}>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography variant="body2">{name}</Typography>
                      <Typography variant="body2" color="text.secondary">{progress}%</Typography>
                    </Stack>
                    <LinearProgress variant="determinate" value={progress} />
                  </Box>
                ))}
              </Stack>
            ) : null}
          </Paper>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: '1fr',
                sm: 'repeat(2, minmax(0, 1fr))',
                lg: 'repeat(3, minmax(0, 1fr))',
                xl: 'repeat(4, minmax(0, 1fr))',
              },
              gap: 1.5,
            }}
          >
            {loading ? (
              <Paper variant="outlined" sx={{ ...getOfficePanelSx(ui), gridColumn: '1 / -1', py: 4 }}>
                <Stack direction="row" spacing={1} alignItems="center" justifyContent="center">
                  <CircularProgress size={22} />
                  <Typography color="text.secondary">Загрузка...</Typography>
                </Stack>
              </Paper>
            ) : null}
            {!loading && items.length === 0 ? (
              <Paper variant="outlined" sx={{ ...getOfficePanelSx(ui), gridColumn: '1 / -1', py: 4 }}>
                <Typography color="text.secondary" align="center">Файлов нет</Typography>
              </Paper>
            ) : null}
            {!loading && items.map((item) => {
              const chip = statusChip(item.status, item.error_text);
              const ready = READY_STATUSES.has(String(item.status || '').toLowerCase());
              const previewSupported = ready && isMyFilePreviewSupported(item);
              const meta = getFileVisualMeta(item);
              const Icon = meta.icon;
              const colors = getFileVisualColors(theme, meta);
              const savedSize = Number(item.saved_size_bytes || 0);
              const fileName = item.original_file_name || item.download_file_name || 'file.bin';
              return (
                <Paper
                  key={item.id}
                  variant="outlined"
                  data-testid={`my-files-card-${item.id}`}
                  sx={{
                    ...getOfficePanelSx(ui),
                    p: 1.5,
                    minHeight: 238,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 1.25,
                    overflow: 'hidden',
                    transition: theme.transitions.create(['border-color', 'box-shadow', 'transform'], {
                      duration: theme.transitions.duration.shorter,
                    }),
                    '&:hover': {
                      borderColor: colors.border,
                      boxShadow: theme.palette.mode === 'dark'
                        ? `0 14px 34px ${alpha('#000', 0.26)}`
                        : `0 14px 34px ${alpha(theme.palette.common.black, 0.08)}`,
                      transform: 'translateY(-1px)',
                    },
                  }}
                >
                  <Stack direction="row" spacing={1.25} alignItems="flex-start">
                    <Box
                      sx={{
                        width: 54,
                        height: 54,
                        flex: '0 0 auto',
                        borderRadius: 2,
                        display: 'grid',
                        placeItems: 'center',
                        color: colors.color,
                        bgcolor: colors.background,
                        border: `1px solid ${colors.border}`,
                      }}
                    >
                      <Icon sx={{ fontSize: 30 }} />
                    </Box>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography
                        variant="subtitle2"
                        title={fileName}
                        sx={{
                          fontWeight: 800,
                          lineHeight: 1.25,
                          minHeight: 40,
                          wordBreak: 'break-word',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {fileName}
                      </Typography>
                      <Stack direction="row" spacing={0.75} flexWrap="wrap" sx={{ mt: 0.75, rowGap: 0.75 }}>
                        <Chip size="small" label={meta.label} variant="outlined" sx={{ color: colors.color, borderColor: colors.border }} />
                        <Chip size="small" label={chip.label} color={chip.color} />
                        {item.is_shared ? <Chip size="small" icon={<LinkOutlinedIcon />} label="ссылка" variant="outlined" /> : null}
                      </Stack>
                    </Box>
                  </Stack>

                  {item.download_file_name && item.download_file_name !== item.original_file_name ? (
                    <Box sx={{ px: 1, py: 0.75, borderRadius: 1.5, bgcolor: 'action.hover' }}>
                      <Typography variant="caption" color="text.secondary">Скачивание</Typography>
                      <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>{item.download_file_name}</Typography>
                    </Box>
                  ) : null}

                  <Stack direction="row" spacing={1} sx={{ mt: 'auto' }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="caption" color="text.secondary">Исходный</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>{formatFileSize(item.original_size_bytes)}</Typography>
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="caption" color="text.secondary">На диске</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>{formatFileSize(item.stored_size_bytes || item.original_size_bytes)}</Typography>
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="caption" color="text.secondary">Экономия</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700, color: savedSize > 0 ? 'success.main' : 'text.primary' }}>
                        {savedSize > 0 ? `-${formatFileSize(savedSize)}` : '0 Б'}
                      </Typography>
                    </Box>
                  </Stack>

                  <Stack direction="row" spacing={1} alignItems="flex-end" justifyContent="space-between">
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="caption" color="text.secondary">Хранится до</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>{formatDateTime(item.expires_at)}</Typography>
                    </Box>
                    <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                      <Tooltip title={previewSupported ? 'Просмотреть' : 'Предпросмотр недоступен'}>
                        <span>
                          <IconButton
                            size="small"
                            data-testid={`my-files-preview-${item.id}`}
                            disabled={!previewSupported}
                            onClick={() => openDocumentPreview(item)}
                          >
                            <VisibilityOutlinedIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title="Скачать">
                        <span>
                          <IconButton
                            size="small"
                            data-testid={`my-files-download-${item.id}`}
                            disabled={!ready || downloadingFileId === item.id}
                            onClick={() => handleDownload(item)}
                          >
                            {downloadingFileId === item.id
                              ? <CircularProgress size={18} />
                              : <DownloadOutlinedIcon fontSize="small" />}
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title={item.is_shared ? 'Поделиться ссылкой' : 'Создать публичную ссылку'}>
                        <span>
                          <IconButton size="small" data-testid={`my-files-share-${item.id}`} disabled={!ready || !canShare} onClick={() => handleShare(item)}>
                            <ShareOutlinedIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title="Отключить публичную ссылку">
                        <span>
                          <IconButton size="small" data-testid={`my-files-revoke-share-${item.id}`} disabled={!item.is_shared || !canShare} onClick={() => handleRevokeShare(item)}>
                            <LinkOutlinedIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title="Удалить">
                        <IconButton size="small" data-testid={`my-files-delete-${item.id}`} color="error" disabled={!canWrite} onClick={() => handleDelete(item)}>
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </Stack>
                </Paper>
              );
            })}
          </Box>
        </Stack>

        <Dialog open={uploadDialogOpen} onClose={closeUploadDialog} maxWidth="sm" fullWidth>
          <DialogTitle>Загрузка файлов</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Alert severity="warning">
                Файлы будут удалены по окончании выбранного срока хранения. Публичные ссылки также перестанут работать.
                Лимит: {formatMyFilesUploadLimitLabel()}.
              </Alert>
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
                  {pendingUploadFiles.map((file, index) => {
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
            <Button variant="contained" onClick={confirmUpload} disabled={uploading || pendingUploadFiles.length === 0}>
              Загрузить
            </Button>
          </DialogActions>
        </Dialog>

        <DocumentPreviewDialog
          open={documentPreview.open}
          title={getMyFileName(documentPreview.item)}
          subtitle={documentPreview.sourceKind === 'excel' ? 'Excel' : 'PDF-предпросмотр'}
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
          canDownloadPdf={Boolean(documentPreview.previewBlob && documentPreview.kind !== 'pdf')}
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
      </PageShell>
    </MainLayout>
  );
}
