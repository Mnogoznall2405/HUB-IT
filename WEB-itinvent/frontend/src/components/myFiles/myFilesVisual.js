import { alpha } from '@mui/material/styles';
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import ArticleOutlinedIcon from '@mui/icons-material/ArticleOutlined';
import AudioFileOutlinedIcon from '@mui/icons-material/AudioFileOutlined';
import CodeOutlinedIcon from '@mui/icons-material/CodeOutlined';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import MovieOutlinedIcon from '@mui/icons-material/MovieOutlined';
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined';
import TableChartOutlinedIcon from '@mui/icons-material/TableChartOutlined';
import { getFileExtension } from '../../lib/myFilesPreview';
export const READY_STATUSES = new Set(['ready']);
export const ACTIVE_PROCESSING_STATUSES = new Set(['uploading', 'queued', 'scanning', 'processing']);

export const formatDateTime = (value) => {
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

export const FILE_TYPE_META = {
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

export const getFileVisualMeta = (item) => {
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

export const getFileVisualColors = (theme, meta) => {
  const palette = theme.palette[meta.palette] || theme.palette.primary;
  const main = palette.main || theme.palette.text.secondary;
  return {
    color: main,
    background: alpha(main, theme.palette.mode === 'dark' ? 0.18 : 0.1),
    border: alpha(main, theme.palette.mode === 'dark' ? 0.35 : 0.18),
  };
};

export const statusChip = (status, errorText = '') => {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'ready') return { label: 'Готов', color: 'success' };
  if (normalized === 'uploading') return { label: 'Загрузка', color: 'info' };
  if (normalized === 'scanning') return { label: 'Проверка безопасности', color: 'warning' };
  if (normalized === 'processing') return { label: 'Сжатие', color: 'info' };
  if (normalized === 'queued') return { label: 'В очереди', color: 'warning' };
  if (normalized === 'failed') return { label: errorText || 'Ошибка', color: 'error' };
  return { label: normalized || 'Неизвестно', color: 'default' };
};

export const ROW_ACTIONS_SX = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 0.25,
  opacity: { xs: 1, md: 0 },
  transition: 'opacity 0.15s',
  '@media (hover: none)': { opacity: 1 },
};

export const VIRTUALIZED_ROW_SX = {
  contentVisibility: 'auto',
  containIntrinsicSize: '0 50px',
};

export const VIRTUALIZED_CARD_SX = {
  contentVisibility: 'auto',
  containIntrinsicSize: '0 160px',
};
