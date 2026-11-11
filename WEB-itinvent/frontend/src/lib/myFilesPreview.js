import { getOfficeAttachmentSourceKind } from '../components/mail/mailMessageFileActions';

export const formatFileSize = (bytes) => {
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

export const getFileExtension = (fileName = '') => {
  const normalized = String(fileName || '').toLowerCase();
  const dotIndex = normalized.lastIndexOf('.');
  return dotIndex >= 0 ? normalized.slice(dotIndex + 1) : '';
};

export const getMyFileName = (item) => String(item?.download_file_name || item?.original_file_name || 'file.bin');

export const getMyFileContentType = (item) => String(item?.download_mime_type || item?.mime_type || 'application/octet-stream');

export const getMyFilePreviewKind = (item) => {
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

export const isMyFilePreviewSupported = (item) => getMyFilePreviewKind(item) !== 'unsupported';

export const createEmptyDocumentPreviewState = () => ({
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

export const resolveMyFilePreviewError = (error, item) => {
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
