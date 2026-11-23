import {
  Box,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import GroupOutlinedIcon from '@mui/icons-material/GroupOutlined';
import LinkOutlinedIcon from '@mui/icons-material/LinkOutlined';
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded';
import OpenInNewOutlinedIcon from '@mui/icons-material/OpenInNewOutlined';
import ShareOutlinedIcon from '@mui/icons-material/ShareOutlined';

import { formatFileSize, getMyFileName } from '../../lib/myFilesPreview';
import {
  formatDateTime,
  getFileVisualColors,
  getFileVisualMeta,
  READY_STATUSES,
  statusChip,
} from './myFilesVisual';
import { hasCoEditing, ROLE_CHIP_LABELS } from './MyFilesListItems';
import { buildOfficeUiTokens, getOfficePanelSx } from '../../theme/officeUiTokens';

function DetailRow({ label, value }) {
  if (!value && value !== 0) return null;
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '96px minmax(0,1fr)', gap: 1, alignItems: 'baseline' }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="body2" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{value}</Typography>
    </Box>
  );
}

function EntryTypeIcon({ kind, item, theme }) {
  if (kind === 'folder') {
    return (
      <Box
        sx={{
          width: 56,
          height: 56,
          borderRadius: 2,
          display: 'grid',
          placeItems: 'center',
          color: 'warning.main',
          bgcolor: 'action.hover',
        }}
      >
        <FolderOutlinedIcon sx={{ fontSize: 32 }} />
      </Box>
    );
  }
  const meta = getFileVisualMeta(item);
  const Icon = meta.icon;
  const colors = getFileVisualColors(theme, meta);
  return (
    <Box
      sx={{
        width: 56,
        height: 56,
        borderRadius: 2,
        display: 'grid',
        placeItems: 'center',
        color: colors.color,
        bgcolor: colors.background,
        border: `1px solid ${colors.border}`,
      }}
    >
      <Icon sx={{ fontSize: 32 }} />
    </Box>
  );
}

/**
 * Правая панель сведений «Моих файлов»: одиночный объект, мультивыбор или
 * текущее расположение. Никаких собственных запросов — только данные строк.
 */
export default function MyFilesDetailsPanel({
  onClose,
  inDrawer = false,
  kind = null,
  item = null,
  multi = null,
  contextTitle = '',
  contextChips = [],
  quota = null,
  ownerText = '',
  locationLabel = '',
  retentionText = '',
  libraryLabel = '',
  openLabel = 'Открыть',
  onOpen = null,
  downloadLabel = 'Скачать',
  onDownload = null,
  downloading = false,
  onShare = null,
  onMore = null,
}) {
  const theme = useTheme();
  const ui = buildOfficeUiTokens(theme);

  const hasTarget = Boolean(kind && item);
  const quotaUsed = Number(quota?.used_bytes || 0);
  const quotaLimit = Number(quota?.limit_bytes || 0);
  const quotaPercent = quotaLimit > 0 ? Math.min(100, Math.round((quotaUsed / quotaLimit) * 100)) : 0;

  const name = kind === 'folder' ? String(item?.name || '') : getMyFileName(item);
  const typeLabel = kind === 'folder'
    ? 'Папка'
    : (item ? getFileVisualMeta(item).label : '');
  const ready = item ? READY_STATUSES.has(String(item.status || '').toLowerCase()) : true;
  const chip = item && kind === 'file' ? statusChip(item.status, item.error_text) : null;
  const sharedWithMeRole = item?.shared_with_me && item?.my_role
    ? (ROLE_CHIP_LABELS[String(item.my_role)] || String(item.my_role))
    : '';

  const statusChips = [];
  if (hasTarget) {
    if (item.is_shared && !item.shared_with_me) {
      statusChips.push({ key: 'link', icon: <LinkOutlinedIcon sx={{ fontSize: 14 }} />, label: 'Публичная ссылка', color: 'default' });
    }
    if (hasCoEditing(item) || item.shared_with_me) {
      statusChips.push({ key: 'shared', icon: <GroupOutlinedIcon sx={{ fontSize: 14 }} />, label: 'Совместный доступ', color: 'primary' });
    }
    if (kind === 'file' && !ready) {
      statusChips.push({ key: 'status', label: chip?.label || '', color: chip?.color === 'default' ? 'default' : chip?.color });
    }
  }

  return (
    <Paper
      component="aside"
      variant="outlined"
      aria-label="Панель сведений"
      data-testid="my-files-details-panel"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose?.();
      }}
      sx={{
        ...getOfficePanelSx(ui),
        width: inDrawer ? '100%' : 300,
        height: inDrawer ? '100%' : 'auto',
        maxHeight: inDrawer ? undefined : 'calc(100vh - 140px)',
        flexShrink: 0,
        alignSelf: 'flex-start',
        position: inDrawer ? 'static' : 'sticky',
        top: inDrawer ? 'auto' : 16,
        borderRadius: inDrawer ? 0 : undefined,
        border: inDrawer ? 'none' : undefined,
        boxShadow: inDrawer ? 'none' : undefined,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 2, pt: 1.25, pb: 0.75, flexShrink: 0 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Сведения</Typography>
        <Tooltip title="Закрыть">
          <IconButton size="small" aria-label="Закрыть панель сведений" onClick={onClose}>
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>

      {hasTarget ? (
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ px: 1.5, pb: 1, flexShrink: 0 }}>
          {onOpen ? (
            <Tooltip title={openLabel}>
              <IconButton size="small" aria-label={openLabel} onClick={onOpen}>
                <OpenInNewOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          ) : null}
          {onDownload ? (
            <Tooltip title={downloadLabel}>
              <span>
                <IconButton size="small" aria-label={downloadLabel} disabled={downloading} onClick={onDownload}>
                  {downloading ? <CircularProgress size={16} /> : <DownloadOutlinedIcon fontSize="small" />}
                </IconButton>
              </span>
            </Tooltip>
          ) : null}
          {onShare ? (
            <Tooltip title="Поделиться">
              <IconButton size="small" aria-label="Поделиться" onClick={onShare}>
                <ShareOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          ) : null}
          <Box sx={{ flex: 1 }} />
          {onMore ? (
            <Tooltip title="Ещё действия">
              <IconButton size="small" aria-label="Ещё действия" onClick={onMore}>
                <MoreVertRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          ) : null}
        </Stack>
      ) : null}
      <Divider sx={{ flexShrink: 0 }} />

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 2, py: 2 }}>
        {hasTarget ? (
          <Stack spacing={2}>
            <Stack spacing={1.25} alignItems="center" sx={{ textAlign: 'center' }}>
              <EntryTypeIcon kind={kind} item={item} theme={theme} />
              <Typography variant="body1" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>
                {name || '—'}
              </Typography>
            </Stack>
            {statusChips.length > 0 ? (
              <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" justifyContent="center">
                {statusChips.map((entry) => (
                  <Chip key={entry.key} size="small" icon={entry.icon} label={entry.label} color={entry.color} variant={entry.color === 'default' ? 'outlined' : 'filled'} />
                ))}
              </Stack>
            ) : null}
            <Stack spacing={1}>
              <DetailRow label="Тип" value={typeLabel} />
              <DetailRow label="Владелец" value={ownerText} />
              {item.deleted_at ? <DetailRow label="Удалён" value={formatDateTime(item.deleted_at)} /> : null}
              <DetailRow label="Изменён" value={formatDateTime(item.updated_at || item.created_at)} />
              {item.created_at ? <DetailRow label="Создан" value={formatDateTime(item.created_at)} /> : null}
              <DetailRow
                label="Размер"
                value={kind === 'folder'
                  ? (Number(item.file_count || 0) > 0 ? `${item.file_count} шт.` : 'Пусто')
                  : formatFileSize(item.original_size_bytes)}
              />
              <DetailRow label="Расположение" value={locationLabel} />
              <DetailRow label="Хранится" value={retentionText} />
              <DetailRow label="Общая папка" value={libraryLabel} />
              {sharedWithMeRole ? <DetailRow label="Ваша роль" value={sharedWithMeRole} /> : null}
            </Stack>
          </Stack>
        ) : multi ? (
          <Stack spacing={1.5} alignItems="center" sx={{ textAlign: 'center', pt: 2 }}>
            <Typography variant="body1" sx={{ fontWeight: 700 }}>
              Выбрано {multi.files + multi.folders} {pluralObjects(multi.files + multi.folders)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {[
                multi.folders > 0 ? `${multi.folders} ${pluralFolders(multi.folders)}` : '',
                multi.files > 0 ? `${multi.files} ${pluralFiles(multi.files)}` : '',
              ].filter(Boolean).join(' · ')}
            </Typography>
            {multi.files > 0 ? (
              <Typography variant="body2" color="text.secondary">
                Суммарный размер: {formatFileSize(multi.totalBytes)}
              </Typography>
            ) : null}
          </Stack>
        ) : (
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0 }}>
              <Box
                sx={{
                  width: 44,
                  height: 44,
                  borderRadius: 2,
                  display: 'grid',
                  placeItems: 'center',
                  color: 'primary.main',
                  bgcolor: 'action.hover',
                  flex: '0 0 auto',
                }}
              >
                <FolderOutlinedIcon />
              </Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 700, minWidth: 0, overflowWrap: 'anywhere' }}>
                {contextTitle || 'Мой диск'}
              </Typography>
            </Stack>
            {contextChips.length > 0 ? (
              <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
                {contextChips.map((entry) => (
                  <Chip key={entry.key} size="small" label={entry.label} color={entry.color || 'default'} variant="outlined" />
                ))}
              </Stack>
            ) : null}
            {quota ? (
              <Box>
                <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
                  <Typography variant="caption" color="text.secondary">Хранилище</Typography>
                  <Typography variant="caption" sx={{ fontWeight: 600 }}>
                    {quotaLimit > 0 ? `${formatFileSize(quotaUsed)} / ${formatFileSize(quotaLimit)}` : `${formatFileSize(quotaUsed)} · без лимита`}
                  </Typography>
                </Stack>
                {quotaLimit > 0 ? (
                  <LinearProgress variant="determinate" value={quotaPercent} sx={{ height: 6, borderRadius: 1 }} />
                ) : null}
              </Box>
            ) : null}
            <Typography variant="body2" color="text.secondary">
              Выберите файл или папку, чтобы увидеть сведения.
            </Typography>
          </Stack>
        )}
      </Box>
    </Paper>
  );
}

function pluralObjects(n) {
  const mod10 = n % 10; const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'объект';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'объекта';
  return 'объектов';
}
function pluralFiles(n) {
  const mod10 = n % 10; const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'файл';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'файла';
  return 'файлов';
}
function pluralFolders(n) {
  const mod10 = n % 10; const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'папка';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'папки';
  return 'папок';
}
