import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
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
import { loadPdfDocumentFromUrl, renderPdfPage, resolveInitialPdfFitZoom } from '../../lib/pdfPreview';

export const clampPage = (value, totalPages = 1) => {
  const total = Math.max(1, Number(totalPages || 1));
  const page = Number(value || 1);
  if (!Number.isFinite(page)) return 1;
  return Math.min(total, Math.max(1, Math.round(page)));
};

export const normalizePreviewSheets = (sheets = []) => (
  Array.isArray(sheets)
    ? sheets
      .map((item, index) => {
        const page = Number.isFinite(Number(item?.page)) && Number(item.page) > 0
          ? Number(item.page)
          : null;
        const pageEndRaw = Number(item?.page_end ?? item?.pageEnd);
        const pageCountRaw = Number(item?.page_count ?? item?.pageCount);
        const pageEnd = Number.isFinite(pageEndRaw) && pageEndRaw > 0
          ? pageEndRaw
          : (page && Number.isFinite(pageCountRaw) && pageCountRaw > 0
            ? page + pageCountRaw - 1
            : page);
        return {
          index: Number.isFinite(Number(item?.index)) ? Number(item.index) : index,
          name: String(item?.name || `Лист ${index + 1}`),
          page,
          pageEnd,
          pageCount: page && pageEnd && pageEnd >= page ? pageEnd - page + 1 : 1,
          hidden: Boolean(item?.hidden),
        };
      })
      .filter((item) => !item.hidden && item.page)
    : []
);

const findSheetByPage = (sheets, page) => (
  sheets.find((item) => page >= item.page && page <= (item.pageEnd || item.page)) || null
);

const findSheetByIndex = (sheets, sheetIndex) => (
  sheets.find((item) => item.index === sheetIndex) || null
);

export default function MailPdfPreviewSurface({
  objectUrl = '',
  filename = 'предпросмотр PDF',
  sourceKind = '',
  sheets = [],
  initialPage = 1,
  pageCount = 0,
  compact = false,
}) {
  const visibleSheets = useMemo(() => normalizePreviewSheets(sheets), [sheets]);
  const excelSheetMode = sourceKind === 'excel' && visibleSheets.length > 0;
  const totalPages = Math.max(1, Number(pageCount || 1));
  const [page, setPage] = useState(() => clampPage(initialPage, totalPages));
  const [zoom, setZoom] = useState(1);
  const [selectedSheetIndex, setSelectedSheetIndex] = useState(
    () => visibleSheets[0]?.index ?? false,
  );
  const [pdfDoc, setPdfDoc] = useState(null);
  const [resolvedPageCount, setResolvedPageCount] = useState(totalPages);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [renderingPage, setRenderingPage] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const canvasRef = useRef(null);
  const previewContainerRef = useRef(null);
  const renderRequestRef = useRef(0);

  const activeSheet = useMemo(() => {
    if (!excelSheetMode) return null;
    return findSheetByIndex(visibleSheets, selectedSheetIndex)
      || findSheetByPage(visibleSheets, page)
      || visibleSheets[0]
      || null;
  }, [excelSheetMode, page, selectedSheetIndex, visibleSheets]);

  const navigationRange = useMemo(() => {
    if (excelSheetMode && activeSheet) {
      return {
        minPage: activeSheet.page,
        maxPage: activeSheet.pageEnd || activeSheet.page,
      };
    }
    return {
      minPage: 1,
      maxPage: Math.max(1, resolvedPageCount || totalPages),
    };
  }, [activeSheet, excelSheetMode, resolvedPageCount, totalPages]);

  const sheetRelativePage = activeSheet
    ? Math.max(1, page - activeSheet.page + 1)
    : page;
  const sheetPageTotal = activeSheet?.pageCount || navigationRange.maxPage;

  useEffect(() => {
    const nextTotal = Math.max(1, Number(pageCount || 1));
    setResolvedPageCount(nextTotal);
    setPage(clampPage(initialPage, nextTotal));
    setZoom(1);
    setSelectedSheetIndex(visibleSheets[0]?.index ?? false);
    setPreviewError('');
  }, [initialPage, objectUrl, pageCount, visibleSheets]);

  useEffect(() => {
    if (!objectUrl) {
      setPdfDoc(null);
      setLoadingPdf(false);
      return undefined;
    }

    let cancelled = false;
    let loadedPdf = null;
    const requestId = renderRequestRef.current + 1;
    renderRequestRef.current = requestId;
    setLoadingPdf(true);
    setPreviewError('');
    setPdfDoc(null);

    loadPdfDocumentFromUrl(objectUrl)
      .then(async (pdf) => {
        loadedPdf = pdf;
        if (cancelled || requestId !== renderRequestRef.current) {
          pdf.destroy?.();
          return;
        }
        const nextPageCount = Math.max(1, Number(pdf.numPages || pageCount || 1));
        setPdfDoc(pdf);
        setResolvedPageCount(nextPageCount);
        setPage((current) => clampPage(current, nextPageCount));
        setLoadingPdf(false);

        try {
          const firstPage = await pdf.getPage(clampPage(initialPage, nextPageCount));
          const viewport = firstPage.getViewport({ scale: 1 });
          const measureFitZoom = () => resolveInitialPdfFitZoom({
            pageWidth: viewport.width,
            containerWidth: previewContainerRef.current?.clientWidth || 0,
            horizontalPadding: compact ? 16 : 24,
          });
          let fitZoom = measureFitZoom();
          if (fitZoom === 1 && typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            await new Promise((resolve) => {
              window.requestAnimationFrame(resolve);
            });
            if (!cancelled && requestId === renderRequestRef.current) {
              fitZoom = measureFitZoom();
            }
          }
          if (!cancelled && requestId === renderRequestRef.current && fitZoom !== 1) {
            setZoom(fitZoom);
          }
        } catch {
          // Keep the default zoom when fit-to-width cannot be measured yet.
        }
      })
      .catch((error) => {
        if (cancelled || requestId !== renderRequestRef.current) return;
        setPdfDoc(null);
        setLoadingPdf(false);
        setPreviewError(error?.message || 'Не удалось загрузить PDF-предпросмотр.');
      });

    return () => {
      cancelled = true;
      if (loadedPdf?.destroy) {
        loadedPdf.destroy();
      }
    };
  }, [compact, initialPage, objectUrl, pageCount]);

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return undefined;

    let cancelled = false;
    const requestId = renderRequestRef.current + 1;
    renderRequestRef.current = requestId;
    setRenderingPage(true);
    setPreviewError('');

    renderPdfPage({
      pdf: pdfDoc,
      pageNumber: clampPage(page, resolvedPageCount),
      canvas: canvasRef.current,
      scale: zoom,
    })
      .then(() => {
        if (!cancelled && requestId === renderRequestRef.current) {
          setRenderingPage(false);
        }
      })
      .catch((error) => {
        if (cancelled || requestId !== renderRequestRef.current) return;
        setRenderingPage(false);
        setPreviewError(error?.message || 'Не удалось отрисовать страницу предпросмотра.');
      });

    return () => {
      cancelled = true;
    };
  }, [page, pdfDoc, resolvedPageCount, zoom]);

  useEffect(() => {
    if (!excelSheetMode || !activeSheet) return;
    if (page < navigationRange.minPage || page > navigationRange.maxPage) {
      setPage(navigationRange.minPage);
    }
  }, [activeSheet, excelSheetMode, navigationRange.maxPage, navigationRange.minPage, page]);

  const activeSheetIndex = activeSheet?.index ?? false;

  const goToPreviousPage = () => {
    setPage((current) => Math.max(navigationRange.minPage, current - 1));
  };

  const goToNextPage = () => {
    setPage((current) => Math.min(navigationRange.maxPage, current + 1));
  };

  const pageCounterLabel = excelSheetMode && activeSheet
    ? `${sheetRelativePage} / ${sheetPageTotal}`
    : `${clampPage(page, resolvedPageCount)} / ${Math.max(1, resolvedPageCount)}`;

  return (
    <Stack spacing={compact ? 0 : 1.1} sx={{ minHeight: 0 }}>
      {!compact && excelSheetMode ? (
        <Tabs
          value={activeSheetIndex}
          onChange={(_event, nextIndex) => {
            const sheet = findSheetByIndex(visibleSheets, nextIndex);
            if (!sheet?.page) return;
            setSelectedSheetIndex(sheet.index);
            setPage(sheet.page);
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

      {!compact ? (
      <Stack direction="row" spacing={0.6} alignItems="center" justifyContent="space-between">
        <Stack direction="row" spacing={0.4} alignItems="center">
          <Tooltip title="Предыдущая страница">
            <span>
              <IconButton
                size="small"
                onClick={goToPreviousPage}
                disabled={page <= navigationRange.minPage || loadingPdf || renderingPage}
              >
                <NavigateBeforeRoundedIcon />
              </IconButton>
            </span>
          </Tooltip>
          <Typography variant="body2" sx={{ minWidth: 74, textAlign: 'center', fontWeight: 700 }}>
            {pageCounterLabel}
          </Typography>
          <Tooltip title="Следующая страница">
            <span>
              <IconButton
                size="small"
                onClick={goToNextPage}
                disabled={page >= navigationRange.maxPage || loadingPdf || renderingPage}
              >
                <NavigateNextRoundedIcon />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
        <Stack direction="row" spacing={0.4} alignItems="center">
          <Tooltip title="Уменьшить">
            <span>
              <IconButton
                size="small"
                onClick={() => setZoom((current) => Math.max(0.5, current - 0.15))}
                disabled={loadingPdf}
              >
                <ZoomOutRoundedIcon />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Сбросить масштаб">
            <span>
              <IconButton size="small" onClick={() => setZoom(1)} disabled={zoom === 1 || loadingPdf}>
                <RestartAltRoundedIcon />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Увеличить">
            <span>
              <IconButton
                size="small"
                onClick={() => setZoom((current) => Math.min(2.5, current + 0.15))}
                disabled={loadingPdf}
              >
                <ZoomInRoundedIcon />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </Stack>
      ) : null}

      <Box
        ref={previewContainerRef}
        sx={{
          position: 'relative',
          minHeight: compact ? 220 : { xs: 260, sm: 360 },
          maxHeight: compact ? 260 : { xs: 'calc(100dvh - 220px)', sm: '65vh' },
          overflow: 'auto',
          borderRadius: '8px',
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: '#f3f4f6',
          display: 'flex',
          justifyContent: 'center',
          alignItems: objectUrl ? 'flex-start' : 'center',
          p: { xs: 1, sm: 1.5 },
        }}
      >
        {previewError ? (
          <Alert severity="error" sx={{ width: '100%' }}>{previewError}</Alert>
        ) : objectUrl ? (
          <Box sx={{ position: 'relative', display: 'inline-flex' }}>
            <Box
              component="canvas"
              ref={canvasRef}
              aria-label={filename || 'PDF-предпросмотр'}
              sx={{
                display: 'block',
                bgcolor: '#fff',
                borderRadius: '4px',
                boxShadow: '0 10px 28px rgba(15, 23, 42, 0.18)',
              }}
            />
            {(loadingPdf || renderingPage) ? (
              <Box
                sx={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  bgcolor: 'rgba(255,255,255,0.72)',
                  borderRadius: '4px',
                }}
              >
                <CircularProgress size={26} />
              </Box>
            ) : null}
          </Box>
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
