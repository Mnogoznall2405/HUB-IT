import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import ArticleOutlinedIcon from '@mui/icons-material/ArticleOutlined';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import PermMediaOutlinedIcon from '@mui/icons-material/PermMediaOutlined';
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined';
import SlideshowOutlinedIcon from '@mui/icons-material/SlideshowOutlined';
import TableChartOutlinedIcon from '@mui/icons-material/TableChartOutlined';

const EXTENSION_KIND_MAP = {
  pdf: 'pdf',
  doc: 'word',
  docx: 'word',
  dot: 'word',
  dotx: 'word',
  rtf: 'word',
  odt: 'word',
  xls: 'excel',
  xlsx: 'excel',
  xlsm: 'excel',
  csv: 'excel',
  ods: 'excel',
  ppt: 'powerpoint',
  pptx: 'powerpoint',
  odp: 'powerpoint',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  bmp: 'image',
  webp: 'image',
  svg: 'image',
  tif: 'image',
  tiff: 'image',
  zip: 'archive',
  rar: 'archive',
  '7z': 'archive',
  tar: 'archive',
  gz: 'archive',
  tgz: 'archive',
  bz2: 'archive',
  txt: 'text',
  log: 'text',
  md: 'text',
  json: 'text',
  xml: 'text',
  yaml: 'text',
  yml: 'text',
  js: 'text',
  jsx: 'text',
  ts: 'text',
  tsx: 'text',
  py: 'text',
  java: 'text',
  cs: 'text',
  cpp: 'text',
  c: 'text',
  h: 'text',
  mp3: 'media',
  wav: 'media',
  ogg: 'media',
  mp4: 'media',
  mov: 'media',
  avi: 'media',
  mkv: 'media',
  webm: 'media',
};

const VISUALS = {
  pdf: {
    kind: 'pdf',
    label: 'PDF',
    color: '#d93025',
    Icon: PictureAsPdfOutlinedIcon,
  },
  word: {
    kind: 'word',
    label: 'Word',
    color: '#185abd',
    Icon: DescriptionOutlinedIcon,
  },
  excel: {
    kind: 'excel',
    label: 'Excel',
    color: '#107c41',
    Icon: TableChartOutlinedIcon,
  },
  powerpoint: {
    kind: 'powerpoint',
    label: 'PowerPoint',
    color: '#d24726',
    Icon: SlideshowOutlinedIcon,
  },
  image: {
    kind: 'image',
    label: 'Изображение',
    color: '#7e57c2',
    Icon: ImageOutlinedIcon,
  },
  archive: {
    kind: 'archive',
    label: 'Архив',
    color: '#8d6e63',
    Icon: ArchiveOutlinedIcon,
  },
  text: {
    kind: 'text',
    label: 'Текст',
    color: '#546e7a',
    Icon: ArticleOutlinedIcon,
  },
  media: {
    kind: 'media',
    label: 'Медиа',
    color: '#00838f',
    Icon: PermMediaOutlinedIcon,
  },
  generic: {
    kind: 'generic',
    label: 'Файл',
    color: '#64748b',
    Icon: InsertDriveFileOutlinedIcon,
  },
};

const normalizeText = (value) => String(value || '').trim();

const getAttachmentExtension = (name) => {
  const normalized = normalizeText(name);
  const match = normalized.match(/\.([a-z0-9]+)$/i);
  return match ? String(match[1] || '').toLowerCase() : '';
};

export function getMailAttachmentKind(attachment) {
  const contentType = normalizeText(attachment?.content_type).toLowerCase();
  const extension = getAttachmentExtension(attachment?.name);

  if (contentType === 'application/pdf' || extension === 'pdf') return 'pdf';
  if (
    contentType.includes('word')
    || contentType.includes('officedocument.wordprocessingml')
    || ['doc', 'docx', 'dot', 'dotx', 'rtf', 'odt'].includes(extension)
  ) {
    return 'word';
  }
  if (
    contentType.includes('excel')
    || contentType.includes('spreadsheetml')
    || contentType.includes('csv')
    || ['xls', 'xlsx', 'xlsm', 'csv', 'ods'].includes(extension)
  ) {
    return 'excel';
  }
  if (
    contentType.includes('powerpoint')
    || contentType.includes('presentationml')
    || ['ppt', 'pptx', 'odp'].includes(extension)
  ) {
    return 'powerpoint';
  }
  if (contentType.startsWith('image/') || EXTENSION_KIND_MAP[extension] === 'image') return 'image';
  if (
    contentType.includes('zip')
    || contentType.includes('compressed')
    || EXTENSION_KIND_MAP[extension] === 'archive'
  ) {
    return 'archive';
  }
  if (
    contentType.startsWith('audio/')
    || contentType.startsWith('video/')
    || EXTENSION_KIND_MAP[extension] === 'media'
  ) {
    return 'media';
  }
  if (
    contentType.startsWith('text/')
    || contentType.includes('json')
    || contentType.includes('xml')
    || EXTENSION_KIND_MAP[extension] === 'text'
  ) {
    return 'text';
  }
  return EXTENSION_KIND_MAP[extension] || 'generic';
}

export function getMailAttachmentVisual(attachment) {
  const kind = getMailAttachmentKind(attachment);
  return VISUALS[kind] || VISUALS.generic;
}
