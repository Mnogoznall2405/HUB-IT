import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import ZoomInRoundedIcon from '@mui/icons-material/ZoomInRounded';
import ZoomOutRoundedIcon from '@mui/icons-material/ZoomOutRounded';
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded';
import MailPdfPageTile from './MailPdfPageTile';
import {
  loadPdfDocumentFromUrl,
  renderPdfPage,
  resolveInitialPdfFitZoom,
} from '../../lib/pdfPreview';
import useDocumentPinchPan from '../../lib/useDocumentPinchPan';

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

function CompactPdfPreview({
  objectUrl,
  filename,
  fitScale,
  previewContainerRef,
  canvasRef,
  loadingPdf,
  renderingPage,
  previewError,
}) {
  return (
    <Box
      ref={previewContainerRef}
      sx={{
        position: 'relative',
        minHeight: 220,
        maxHeight: 260,
        overflow: 'auto',
        borderRadius: '8px',
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: '#f3f4f6',
        display: 'flex',
        justifyContent: 'center',
        alignItems: objectUrl ? 'flex-start' : 'center',
        p: 1,
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
  );
}

export default function MailPdfPreviewSurface({
  objectUrl = '',
  filename = 'предпросмотр PDF',
  sourceKind = '',
  sheets = [],
  initialPage = 1,
  pageCount = 0,
  compact = false,
  fillContainer = false,
}) {
  const visibleSheets = useMemo(() => normalizePreviewSheets(sheets), [sheets]);
  const excelSheetMode = sourceKind === 'excel' && visibleSheets.length > 0;
  const totalPages = Math.max(1, Number(pageCount || 1));
  const [visiblePage, setVisiblePage] = useState(() => clampPage(initialPage, totalPages));
  const [selectedSheetIndex, setSelectedSheetIndex] = useState(
    () => visibleSheets[0]?.index ?? false,
  );
  const [fitScale, setFitScale] = useState(1);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [resolvedPageCount, setResolvedPageCount] = useState(totalPages);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [renderingPage, setRenderingPage] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const canvasRef = useRef(null);
  const previewContainerRef = useRef(null);
  const pageAnchorRefs = useRef({});
  const visibilityRatiosRef = useRef(new Map());
  const renderRequestRef = useRef(0);

  const {
    viewportRef,
    contentRef,
    isZoomed,
    resetTransform,
    zoomIn,
    zoomOut,
    viewportProps,
    viewportSx,
    contentSx,
  } = useDocumentPinchPan({
    enabled: !compact,
  });

  const scrollRootRef = compact ? previewContainerRef : viewportRef;
  const pageNumbers = useMemo(
    () => Array.from({ length: Math.max(1, resolvedPageCount || totalPages) }, (_, index) => index + 1),
    [resolvedPageCount, totalPages],
  );

  const activeSheet = useMemo(() => {
    if (!excelSheetMode) return null;
    return findSheetByIndex(visibleSheets, selectedSheetIndex)
      || findSheetByPage(visibleSheets, visiblePage)
      || visibleSheets[0]
      || null;
  }, [excelSheetMode, selectedSheetIndex, visiblePage, visibleSheets]);

  const activeSheetIndex = activeSheet?.index ?? false;

  const updateVisiblePageFromRatios = useCallback(() => {
    let bestPage = 1;
    let bestRatio = 0;
    visibilityRatiosRef.current.forEach((ratio, pageNumber) => {
      if (ratio > bestRatio) {
        bestRatio = ratio;
        bestPage = pageNumber;
      }
    });
    if (bestRatio <= 0) return;
    setVisiblePage((current) => (current === bestPage ? current : bestPage));
    if (excelSheetMode) {
      const sheet = findSheetByPage(visibleSheets, bestPage);
      if (sheet) {
        setSelectedSheetIndex((current) => (current === sheet.index ? current : sheet.index));
      }
    }
  }, [excelSheetMode, visibleSheets]);

  const handlePageVisibilityChange = useCallback((pageNumber, ratio) => {
    if (ratio > 0) {
      visibilityRatiosRef.current.set(pageNumber, ratio);
    } else {
      visibilityRatiosRef.current.delete(pageNumber);
    }
    updateVisiblePageFromRatios();
  }, [updateVisiblePageFromRatios]);

  const scrollToPage = useCallback((pageNumber) => {
    const node = pageAnchorRefs.current[pageNumber];
    if (node?.scrollIntoView) {
      node.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    setVisiblePage(clampPage(pageNumber, resolvedPageCount));
  }, [resolvedPageCount]);

  useEffect(() => {
    const nextTotal = Math.max(1, Number(pageCount || 1));
    setResolvedPageCount(nextTotal);
    setVisiblePage(clampPage(initialPage, nextTotal));
    setFitScale(1);
    resetTransform();
    setSelectedSheetIndex(visibleSheets[0]?.index ?? false);
    setPreviewError('');
    visibilityRatiosRef.current.clear();
  }, [initialPage, objectUrl, pageCount, resetTransform, visibleSheets]);

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
        setVisiblePage((current) => clampPage(current, nextPageCount));
        setLoadingPdf(false);

        try {
          const firstPage = await pdf.getPage(clampPage(initialPage, nextPageCount));
          const viewport = firstPage.getViewport({ scale: 1 });
          const measureFitZoom = () => resolveInitialPdfFitZoom({
            pageWidth: viewport.width,
            containerWidth: (compact ? previewContainerRef.current : viewportRef.current)?.clientWidth || 0,
            horizontalPadding: compact ? 16 : 24,
          });
          let nextFitScale = measureFitZoom();
          if (nextFitScale === 1 && typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            await new Promise((resolve) => {
              window.requestAnimationFrame(resolve);
            });
            if (!cancelled && requestId === renderRequestRef.current) {
              nextFitScale = measureFitZoom();
            }
          }
          if (!cancelled && requestId === renderRequestRef.current) {
            setFitScale(nextFitScale);
          }
        } catch {
          // Keep default fit scale when measurement is unavailable.
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
    if (!compact || !pdfDoc || !canvasRef.current) return undefined;

    let cancelled = false;
    const requestId = renderRequestRef.current + 1;
    renderRequestRef.current = requestId;
    setRenderingPage(true);
    setPreviewError('');

    renderPdfPage({
      pdf: pdfDoc,
      pageNumber: 1,
      canvas: canvasRef.current,
      scale: fitScale,
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
  }, [compact, fitScale, pdfDoc]);

  const pageCounterLabel = `${clampPage(visiblePage, resolvedPageCount)} / ${Math.max(1, resolvedPageCount)}`;

  if (compact) {
    return (
      <CompactPdfPreview
        objectUrl={objectUrl}
        filename={filename}
        fitScale={fitScale}
        previewContainerRef={previewContainerRef}
        canvasRef={canvasRef}
        loadingPdf={loadingPdf}
        renderingPage={renderingPage}
        previewError={previewError}
      />
    );
  }

  return (
    <Stack
      spacing={0}
      sx={{
        minHeight: 0,
        height: fillContainer ? '100%' : 'auto',
        flex: fillContainer ? 1 : undefined,
      }}
    >
      {excelSheetMode ? (
        <Tabs
          value={activeSheetIndex}
          onChange={(_event, nextIndex) => {
            const sheet = findSheetByIndex(visibleSheets, nextIndex);
            if (!sheet?.page) return;
            setSelectedSheetIndex(sheet.index);
            scrollToPage(sheet.page);
          }}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            minHeight: 38,
            borderBottom: '1px solid',
            borderColor: 'divider',
            flexShrink: 0,
            bgcolor: 'background.paper',
          }}
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

      <Stack
        direction="row"
        spacing={0.6}
        alignItems="center"
        justifyContent="space-between"
        sx={{
          px: { xs: 1, sm: 1.25 },
          py: 0.75,
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          flexShrink: 0,
        }}
      >
        <Typography variant="body2" sx={{ fontWeight: 700, color: 'text.secondary' }}>
          {pageCounterLabel}
        </Typography>
        <Stack direction="row" spacing={0.4} alignItems="center">
          <Tooltip title="Уменьшить">
            <span>
              <IconButton size="small" onClick={zoomOut} disabled={loadingPdf || !isZoomed}>
                <ZoomOutRoundedIcon />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Сбросить масштаб">
            <span>
              <IconButton size="small" onClick={resetTransform} disabled={loadingPdf || !isZoomed}>
                <RestartAltRoundedIcon />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Увеличить">
            <span>
              <IconButton size="small" onClick={zoomIn} disabled={loadingPdf}>
                <ZoomInRoundedIcon />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </Stack>

      <Box
        ref={viewportRef}
        {...viewportProps}
        sx={{
          position: 'relative',
          flex: 1,
          minHeight: fillContainer ? 0 : { xs: 260, sm: 360 },
          bgcolor: '#f3f4f6',
          ...viewportSx,
        }}
      >
        {previewError ? (
          <Alert severity="error" sx={{ m: 1.5 }}>{previewError}</Alert>
        ) : loadingPdf ? (
          <Stack spacing={1} alignItems="center" justifyContent="center" sx={{ minHeight: 240, p: 2 }}>
            <CircularProgress size={28} />
            <Typography variant="caption" color="text.secondary">{filename}</Typography>
          </Stack>
        ) : (
          <Box ref={contentRef} sx={contentSx}>
            <Stack
              spacing={1.25}
              alignItems="center"
              sx={{
                width: '100%',
                px: { xs: 1, sm: 1.5 },
                py: { xs: 1, sm: 1.5 },
              }}
            >
              {pageNumbers.map((pageNumber) => (
                <MailPdfPageTile
                  key={pageNumber}
                  ref={(node) => {
                    if (node) {
                      pageAnchorRefs.current[pageNumber] = node;
                    } else {
                      delete pageAnchorRefs.current[pageNumber];
                    }
                  }}
                  pageNumber={pageNumber}
                  pdf={pdfDoc}
                  fitScale={fitScale}
                  scrollRootRef={scrollRootRef}
                  onVisibilityChange={handlePageVisibilityChange}
                />
              ))}
            </Stack>
          </Box>
        )}
      </Box>
    </Stack>
  );
}
