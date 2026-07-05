import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Box, CircularProgress, Skeleton } from '@mui/material';
import { renderPdfPage } from '../../lib/pdfPreview';

const DEFAULT_PLACEHOLDER_HEIGHT = 420;

const MailPdfPageTile = forwardRef(function MailPdfPageTile({
  pageNumber,
  pdf = null,
  fitScale = 1,
  scrollRootRef = null,
  onVisibilityChange,
}, ref) {
  const tileRef = useRef(null);
  const canvasRef = useRef(null);
  const renderRequestRef = useRef(0);
  const [isNearViewport, setIsNearViewport] = useState(false);
  const [renderedHeight, setRenderedHeight] = useState(DEFAULT_PLACEHOLDER_HEIGHT);
  const [loading, setLoading] = useState(false);
  const [renderError, setRenderError] = useState('');

  useImperativeHandle(ref, () => tileRef.current);

  useEffect(() => {
    const root = scrollRootRef?.current;
    const node = tileRef.current;
    if (!node) return undefined;

    if (!root || typeof IntersectionObserver === 'undefined') {
      setIsNearViewport(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          setIsNearViewport(entry.isIntersecting);
          onVisibilityChange?.(pageNumber, entry.isIntersecting ? entry.intersectionRatio : 0);
        });
      },
      {
        root,
        rootMargin: '240px 0px',
        threshold: [0, 0.15, 0.35, 0.55, 0.75, 1],
      },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [onVisibilityChange, pageNumber, scrollRootRef]);

  useEffect(() => {
    if (!isNearViewport || !pdf || !canvasRef.current) return undefined;

    let cancelled = false;
    const requestId = renderRequestRef.current + 1;
    renderRequestRef.current = requestId;
    setLoading(true);
    setRenderError('');

    renderPdfPage({
      pdf,
      pageNumber,
      canvas: canvasRef.current,
      scale: fitScale,
    })
      .then((result) => {
        if (cancelled || requestId !== renderRequestRef.current) return;
        setRenderedHeight(Math.max(120, Number(result?.height || DEFAULT_PLACEHOLDER_HEIGHT)));
        setLoading(false);
      })
      .catch((error) => {
        if (cancelled || requestId !== renderRequestRef.current) return;
        setLoading(false);
        setRenderError(error?.message || 'Не удалось отрисовать страницу.');
      });

    return () => {
      cancelled = true;
    };
  }, [fitScale, isNearViewport, pageNumber, pdf]);

  return (
    <Box
      ref={tileRef}
      data-testid={`mail-pdf-page-tile-${pageNumber}`}
      data-page-number={pageNumber}
      sx={{
        width: '100%',
        display: 'flex',
        justifyContent: 'center',
        scrollMarginTop: '12px',
      }}
    >
      <Box
        sx={{
          position: 'relative',
          width: '100%',
          maxWidth: '100%',
          minHeight: renderedHeight,
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        {!isNearViewport ? (
          <Skeleton
            variant="rectangular"
            width="100%"
            height={renderedHeight}
            sx={{ borderRadius: '4px', maxWidth: 920 }}
          />
        ) : (
          <>
            <Box
              component="canvas"
              ref={canvasRef}
              aria-label={`PDF page ${pageNumber}`}
              sx={{
                display: 'block',
                bgcolor: '#fff',
                borderRadius: '4px',
                boxShadow: '0 10px 28px rgba(15, 23, 42, 0.18)',
                maxWidth: '100%',
              }}
            />
            {loading ? (
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
                <CircularProgress size={24} />
              </Box>
            ) : null}
            {renderError ? (
              <Box
                sx={{
                  position: 'absolute',
                  inset: 0,
                  display: 'grid',
                  placeItems: 'center',
                  bgcolor: 'rgba(255,255,255,0.9)',
                  borderRadius: '4px',
                  px: 2,
                  textAlign: 'center',
                  color: 'error.main',
                  fontSize: '0.82rem',
                }}
              >
                {renderError}
              </Box>
            ) : null}
          </>
        )}
      </Box>
    </Box>
  );
});

export default MailPdfPageTile;
