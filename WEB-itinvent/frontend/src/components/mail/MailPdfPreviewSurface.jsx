import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  CircularProgress,
  IconButton,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material';
import NavigateBeforeRoundedIcon from '@mui/icons-material/NavigateBeforeRounded';
import NavigateNextRoundedIcon from '@mui/icons-material/NavigateNextRounded';
import ZoomInRoundedIcon from '@mui/icons-material/ZoomInRounded';
import ZoomOutRoundedIcon from '@mui/icons-material/ZoomOutRounded';
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded';

const clampPage = (value, totalPages = 1) => {
  const total = Math.max(1, Number(totalPages || 1));
  const page = Number(value || 1);
  if (!Number.isFinite(page)) return 1;
  return Math.min(total, Math.max(1, Math.round(page)));
};

const normalizeSheets = (sheets = []) => (
  Array.isArray(sheets)
    ? sheets.filter((item) => !item?.hidden && Number(item?.page) > 0)
    : []
);

export default function MailPdfPreviewSurface({
  objectUrl = '',
  filename = 'предпросмотр PDF',
  sourceKind = '',
  sheets = [],
  initialPage = 1,
  pageCount = 0,
}) {
  const visibleSheets = useMemo(() => normalizeSheets(sheets), [sheets]);
  const totalPages = Math.max(1, Number(pageCount || 1));
  const [page, setPage] = useState(() => clampPage(initialPage, totalPages));
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    setPage(clampPage(initialPage, totalPages));
    setZoom(1);
  }, [initialPage, objectUrl, totalPages]);

  const activeSheetIndex = useMemo(() => {
    if (!visibleSheets.length) return false;
    const match = visibleSheets.find((item) => Number(item.page) === Number(page));
    return match ? match.index : false;
  }, [page, visibleSheets]);

  const iframeSrc = objectUrl
    ? `${objectUrl}#page=${clampPage(page, totalPages)}&zoom=${Math.round(zoom * 100)}`
    : '';

  return (
    <Stack spacing={1.1} sx={{ minHeight: 0 }}>
      {sourceKind === 'excel' && visibleSheets.length > 0 ? (
        <Tabs
          value={activeSheetIndex}
          onChange={(_event, nextIndex) => {
            const sheet = visibleSheets.find((item) => item.index === nextIndex);
            if (sheet?.page) setPage(sheet.page);
          }}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ minHeight: 38, borderBottom: '1px solid', borderColor: 'divider' }}
        >
          {visibleSheets.map((sheet) => (
            <Tab
              key={`${sheet.index}-${sheet.name}`}
              value={sheet.index}
              label={sheet.name}
              sx={{ minHeight: 38, py: 0.6, textTransform: 'none', fontWeight: 700 }}
            />
          ))}
        </Tabs>
      ) : null}

      <Stack direction="row" spacing={0.6} alignItems="center" justifyContent="space-between">
        <Stack direction="row" spacing={0.4} alignItems="center">
          <Tooltip title="Предыдущая страница">
            <span>
              <IconButton size="small" onClick={() => setPage((current) => current - 1)} disabled={page <= 1}>
                <NavigateBeforeRoundedIcon />
              </IconButton>
            </span>
          </Tooltip>
          <Typography variant="body2" sx={{ minWidth: 74, textAlign: 'center', fontWeight: 700 }}>
            {`${page || 1} / ${totalPages}`}
          </Typography>
          <Tooltip title="Следующая страница">
            <span>
              <IconButton size="small" onClick={() => setPage((current) => current + 1)} disabled={page >= totalPages}>
                <NavigateNextRoundedIcon />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
        <Stack direction="row" spacing={0.4} alignItems="center">
          <Tooltip title="Уменьшить">
            <span>
              <IconButton size="small" onClick={() => setZoom((current) => Math.max(0.5, current - 0.15))}>
                <ZoomOutRoundedIcon />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Сбросить масштаб">
            <span>
              <IconButton size="small" onClick={() => setZoom(1)} disabled={zoom === 1}>
                <RestartAltRoundedIcon />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Увеличить">
            <span>
              <IconButton size="small" onClick={() => setZoom((current) => Math.min(2.5, current + 0.15))}>
                <ZoomInRoundedIcon />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </Stack>

      <Box
        sx={{
          position: 'relative',
          minHeight: { xs: 260, sm: 360 },
          maxHeight: { xs: 'calc(100dvh - 220px)', sm: '65vh' },
          overflow: 'hidden',
          borderRadius: '8px',
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: '#f3f4f6',
          display: 'flex',
          justifyContent: 'center',
          alignItems: objectUrl ? 'stretch' : 'center',
        }}
      >
        {objectUrl ? (
          <Box
            component="iframe"
            title={filename || 'PDF-предпросмотр'}
            src={iframeSrc}
            sx={{
              width: '100%',
              minHeight: { xs: 260, sm: 360 },
              border: 'none',
              bgcolor: '#fff',
            }}
          />
        ) : (
          <Stack spacing={1} alignItems="center">
            <CircularProgress size={26} />
            <Typography variant="caption" color="text.secondary">{filename}</Typography>
          </Stack>
        )}
      </Box>
    </Stack>
  );
}
