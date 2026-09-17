import { useCallback, useEffect, useRef, useState } from 'react';
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
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import TrendingFlatIcon from '@mui/icons-material/TrendingFlat';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import DownloadIcon from '@mui/icons-material/Download';
import VisibilityIcon from '@mui/icons-material/Visibility';
import {
  createEmptyAttachmentPreview,
  downloadBlobFile,
} from '../../components/mail/mailMessageFileActions';
import {
  isMeaningful1cRef,
  warehouse1cAPI,
} from '../../api/warehouse1c';
import { NomenclatureCell } from './warehouse1cShared';
import { loadWarehouseMovementFilePreview } from './warehouse1cMovementFilePreview';

export const resolveErrorMessage = (err, fallback) => {
  if (err?.code === 'ECONNABORTED') {
    return '1С не ответила вовремя. Сузьте фильтр (номенклатура/склад) и повторите запрос.';
  }
  const detail = err?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (detail && typeof detail === 'object' && typeof detail.message === 'string' && detail.message.trim()) {
    return detail.message;
  }
  return fallback;
};

export function downloadBlobResponse(response, fallbackName = 'file.bin') {
  const blob = response?.data instanceof Blob
    ? response.data
    : new Blob([response?.data || response], {
      type: response?.headers?.['content-type'] || 'application/octet-stream',
    });
  const disposition = String(response?.headers?.['content-disposition'] || '');
  const utfMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const plainMatch = disposition.match(/filename="?([^";]+)"?/i);
  let filename = fallbackName;
  if (utfMatch?.[1]) {
    try {
      filename = decodeURIComponent(utfMatch[1]);
    } catch {
      filename = utfMatch[1];
    }
  } else if (plainMatch?.[1]) {
    filename = plainMatch[1];
  }
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || fallbackName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

const formatDateTime = (value) => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString('ru-RU');
};

const formatFileSize = (bytes) => {
  const size = Number(bytes || 0);
  if (!size) return '';
  if (size < 1024) return `${size} Б`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} КБ`;
  return `${(size / (1024 * 1024)).toFixed(1)} МБ`;
};

export function MovementDetailDialog({
  open,
  row,
  detail,
  loading,
  error,
  downloadingFileRef,
  previewingFileRef,
  onPreviewFile,
  onDownloadFile,
  onClose,
  fullScreen = false,
}) {
  const fromName = detail?.transfer_from_warehouse_name || row?.transfer_from_warehouse_name;
  const toName = detail?.transfer_to_warehouse_name || row?.transfer_to_warehouse_name;
  const warehouseName = detail?.warehouse_name || row?.warehouse_name;
  const counterpartyName = detail?.counterparty_name;
  const registrarNumber = detail?.registrar_number || row?.registrar_number;
  const registrarDate = detail?.registrar_date || row?.registrar_date;
  const registrarName = detail?.registrar_name || row?.registrar_name;
  const registrarRef = detail?.registrar_ref || row?.registrar_ref;
  const isTransfer = detail?.is_transfer ?? row?.is_transfer;
  const documentTitle = detail?.document_title
    || (isTransfer ? 'Перемещение между складами' : 'Документ склада');
  const files = Array.isArray(detail?.files) ? detail.files : [];
  const filesStatus = detail?.files_status || 'pending';
  const hasRoute = Boolean(fromName || toName);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" fullScreen={fullScreen}>
      <DialogTitle
        sx={{
          pr: 6,
          pt: fullScreen ? 'calc(env(safe-area-inset-top) + 12px)' : undefined,
        }}
      >
        {documentTitle}
        <IconButton
          aria-label="Закрыть"
          onClick={onClose}
          sx={{ position: 'absolute', right: 8, top: fullScreen ? 'calc(env(safe-area-inset-top) + 4px)' : 8 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Box>
            <Typography variant="subtitle2" color="text.secondary">
              Документ
            </Typography>
            <Typography variant="body1" sx={{ fontWeight: 600 }}>
              {registrarNumber ? `№ ${registrarNumber}` : registrarName || '-'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {formatDateTime(registrarDate)}
            </Typography>
            {row?.nomenclature_name ? (
              <Box sx={{ mt: 1 }}>
                <NomenclatureCell
                  code={row.nomenclature_code}
                  name={`${row.nomenclature_name}${row.series_name ? ` · ${row.series_name}` : ''}`}
                />
              </Box>
            ) : null}
          </Box>

          <Divider />

          {hasRoute ? (
            <Box>
              <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                Маршрут перемещения
              </Typography>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Chip label={fromName || 'Не указан'} color="default" variant="outlined" />
                <TrendingFlatIcon fontSize="small" color="action" />
                <Chip label={toName || 'Не указан'} color="primary" variant="outlined" />
              </Stack>
            </Box>
          ) : (
            <Box>
              <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                Склад
              </Typography>
              <Chip label={warehouseName || 'Не указан'} color="primary" variant="outlined" />
              {counterpartyName ? (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  Контрагент: {counterpartyName}
                </Typography>
              ) : null}
            </Box>
          )}

          {detail?.comment ? (
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                Комментарий
              </Typography>
              <Typography variant="body2">{detail.comment}</Typography>
            </Box>
          ) : null}

          <Divider />

          <Box>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
              Прикреплённые файлы
            </Typography>
            {loading ? (
              <Stack direction="row" spacing={1} alignItems="center">
                <CircularProgress size={18} />
                <Typography variant="body2" color="text.secondary">
                  Загрузка списка файлов...
                </Typography>
              </Stack>
            ) : null}
            {error ? <Alert severity="error">{error}</Alert> : null}
            {!loading && !error && filesStatus === 'access_denied' ? (
              <Alert severity="warning">
                {detail?.files_message || 'Нет прав на чтение прикреплённых файлов в 1С.'}
              </Alert>
            ) : null}
            {!loading && !error && (filesStatus === 'unsupported' || filesStatus === 'empty') && files.length === 0 ? (
              <Alert severity="info">
                {detail?.files_message || 'Прикреплённые файлы недоступны.'}
              </Alert>
            ) : null}
            {!loading && !error && filesStatus === 'ok' && files.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                К этому документу файлы не прикреплены.
              </Typography>
            ) : null}
            {!loading && !error && files.length > 0 ? (
              <List dense disablePadding>
                {files.map((file) => {
                  const fileKey = file.ref || file.name;
                  const busy = downloadingFileRef === fileKey || previewingFileRef === fileKey;
                  return (
                    <ListItem
                      key={fileKey}
                      disableGutters
                      secondaryAction={(
                        <Stack direction="row" spacing={0.5}>
                          <Tooltip title="Открыть предпросмотр">
                            <span>
                              <IconButton
                                edge="end"
                                aria-label={`Открыть ${file.name}`}
                                disabled={!file.ref || !registrarRef || busy}
                                onClick={() => onPreviewFile?.(registrarRef, file)}
                              >
                                {previewingFileRef === fileKey
                                  ? <CircularProgress size={18} />
                                  : <VisibilityIcon fontSize="small" />}
                              </IconButton>
                            </span>
                          </Tooltip>
                          <Tooltip title="Скачать">
                            <span>
                              <IconButton
                                edge="end"
                                aria-label={`Скачать ${file.name}`}
                                disabled={!file.ref || !registrarRef || busy}
                                onClick={() => onDownloadFile?.(registrarRef, file)}
                              >
                                {downloadingFileRef === fileKey
                                  ? <CircularProgress size={18} />
                                  : <DownloadIcon fontSize="small" />}
                              </IconButton>
                            </span>
                          </Tooltip>
                        </Stack>
                      )}
                    >
                      <AttachFileIcon fontSize="small" color="action" sx={{ mr: 1 }} />
                      <ListItemText
                        primary={(
                          <Typography
                            variant="body2"
                            component="button"
                            type="button"
                            onClick={() => onPreviewFile?.(registrarRef, file)}
                            disabled={!file.ref || !registrarRef || busy}
                            sx={{
                              border: 0,
                              background: 'none',
                              p: 0,
                              m: 0,
                              cursor: (!file.ref || !registrarRef || busy) ? 'default' : 'pointer',
                              color: 'primary.main',
                              textAlign: 'left',
                              textDecoration: 'underline',
                              textUnderlineOffset: 2,
                              font: 'inherit',
                            }}
                          >
                            {file.name}
                          </Typography>
                        )}
                        secondary={formatFileSize(file.size) || null}
                      />
                    </ListItem>
                  );
                })}
              </List>
            ) : null}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ pb: fullScreen ? 'calc(env(safe-area-inset-bottom) + 8px)' : undefined }}>
        <Button onClick={onClose}>Закрыть</Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * Detail + file preview/download state machine for 1C movement documents.
 * Returns dialogProps for MovementDetailDialog and preview state for
 * MailAttachmentPreviewDialog.
 */
export function useMovementDetail() {
  const [open, setOpen] = useState(false);
  const [row, setRow] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [downloadingFileRef, setDownloadingFileRef] = useState('');
  const [previewingFileRef, setPreviewingFileRef] = useState('');
  const [filePreview, setFilePreview] = useState(createEmptyAttachmentPreview);
  const detailSequenceRef = useRef(0);
  const filePreviewUrlRef = useRef('');
  const filePreviewSequenceRef = useRef(0);

  const close = useCallback(() => {
    detailSequenceRef.current += 1;
    setOpen(false);
    setRow(null);
    setData(null);
    setLoading(false);
    setError('');
    setDownloadingFileRef('');
    setPreviewingFileRef('');
  }, []);

  const openMovement = useCallback((rowValue) => {
    if (!isMeaningful1cRef(rowValue?.registrar_ref)) return;
    const sequence = detailSequenceRef.current + 1;
    detailSequenceRef.current = sequence;
    setRow(rowValue);
    setData(null);
    setError('');
    setDownloadingFileRef('');
    setPreviewingFileRef('');
    setLoading(true);
    setOpen(true);
    warehouse1cAPI.getMovementDetail(rowValue.registrar_ref)
      .then((detailData) => {
        if (detailSequenceRef.current !== sequence) return;
        setData(detailData);
      })
      .catch((err) => {
        if (detailSequenceRef.current !== sequence) return;
        console.error('Failed to load movement detail:', err);
        setError(resolveErrorMessage(err, 'Не удалось загрузить карточку документа.'));
      })
      .finally(() => {
        if (detailSequenceRef.current === sequence) setLoading(false);
      });
  }, []);

  const revokeFilePreviewUrl = useCallback(() => {
    if (filePreviewUrlRef.current && typeof window !== 'undefined' && window.URL?.revokeObjectURL) {
      window.URL.revokeObjectURL(filePreviewUrlRef.current);
    }
    filePreviewUrlRef.current = '';
  }, []);

  const closeFilePreview = useCallback(() => {
    filePreviewSequenceRef.current += 1;
    revokeFilePreviewUrl();
    setFilePreview(createEmptyAttachmentPreview());
  }, [revokeFilePreviewUrl]);

  useEffect(() => () => revokeFilePreviewUrl(), [revokeFilePreviewUrl]);

  const downloadFile = useCallback(async (registrarRef, file) => {
    const fileRef = String(file?.ref || '').trim();
    const fileKey = fileRef || String(file?.name || '').trim();
    if (!registrarRef || !fileRef) return;
    setDownloadingFileRef(fileKey);
    try {
      const response = await warehouse1cAPI.downloadMovementFile(registrarRef, fileRef);
      downloadBlobResponse(response, file?.name || 'file.bin');
    } catch (err) {
      console.error('Failed to download movement file:', err);
      setError(resolveErrorMessage(err, 'Не удалось скачать файл из 1С.'));
    } finally {
      setDownloadingFileRef('');
    }
  }, []);

  const previewFile = useCallback(async (registrarRef, file) => {
    const fileRef = String(file?.ref || '').trim();
    const fileKey = fileRef || String(file?.name || '').trim();
    if (!registrarRef || !fileRef) return;

    const sequence = filePreviewSequenceRef.current + 1;
    filePreviewSequenceRef.current = sequence;
    setPreviewingFileRef(fileKey);
    revokeFilePreviewUrl();
    setFilePreview({
      ...createEmptyAttachmentPreview(),
      open: true,
      loading: true,
      filename: file?.name || 'Файл',
      contentType: file?.content_type || 'application/octet-stream',
      downloadContext: { registrarRef, file },
    });

    try {
      const nextPreview = await loadWarehouseMovementFilePreview({
        registrarRef,
        file,
        api: warehouse1cAPI,
        createObjectUrl: (blob) => {
          const objectUrl = typeof window !== 'undefined' && window.URL?.createObjectURL
            ? window.URL.createObjectURL(blob)
            : '';
          filePreviewUrlRef.current = objectUrl;
          return objectUrl;
        },
      });
      if (filePreviewSequenceRef.current === sequence) {
        setFilePreview(nextPreview);
      } else if (nextPreview?.objectUrl && typeof window.URL?.revokeObjectURL === 'function') {
        window.URL.revokeObjectURL(nextPreview.objectUrl);
      }
    } catch (err) {
      if (filePreviewSequenceRef.current !== sequence) return;
      console.error('Failed to preview movement file:', err);
      setFilePreview((prev) => ({
        ...prev,
        open: true,
        loading: false,
        error: resolveErrorMessage(err, 'Не удалось открыть файл из 1С.'),
        objectUrl: '',
        previewBlob: null,
      }));
    } finally {
      if (filePreviewSequenceRef.current === sequence) setPreviewingFileRef('');
    }
  }, [revokeFilePreviewUrl]);

  const previewDownload = useCallback(() => {
    if (filePreview?.blob instanceof Blob) {
      downloadBlobFile(filePreview.blob, filePreview.filename || 'file.bin', { preferOpenFallback: true });
      return;
    }
    const context = filePreview?.downloadContext;
    if (context) void downloadFile(context.registrarRef, context.file);
  }, [filePreview, downloadFile]);

  const previewDownloadPdf = useCallback(() => {
    if (!(filePreview?.previewBlob instanceof Blob)) return;
    downloadBlobFile(
      filePreview.previewBlob,
      filePreview.pdfFilename || 'preview.pdf',
      { preferOpenFallback: true },
    );
  }, [filePreview]);

  return {
    filePreview,
    openMovement,
    close,
    dialogProps: {
      open,
      row,
      detail: data,
      loading,
      error,
      downloadingFileRef,
      previewingFileRef,
      onPreviewFile: previewFile,
      onDownloadFile: downloadFile,
      onClose: close,
    },
    previewDialogProps: {
      attachmentPreview: filePreview,
      onClose: closeFilePreview,
      onDownload: previewDownload,
      onDownloadPreviewPdf: previewDownloadPdf,
      formatFileSize,
    },
  };
}
