import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Box, Skeleton, Stack, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { getMailAttachmentVisual } from './mailAttachmentVisuals';
import { getOfficeAttachmentSourceKind } from './mailMessageFileActions';
import MailOfficePreviewTeaser from './MailOfficePreviewTeaser';

const MailExcelPreviewGrid = lazy(() => import('./MailExcelPreviewGrid'));

export default function MailOfficeAttachmentInlinePreview({
  attachment,
  message,
  loadOfficeInlinePreview,
  onOpenFull,
  mine = false,
}) {
  const theme = useTheme();
  const visual = useMemo(() => getMailAttachmentVisual(attachment), [attachment]);
  const IconComponent = visual.Icon;
  const sourceKind = useMemo(
    () => getOfficeAttachmentSourceKind({
      filename: attachment?.name,
      contentType: attachment?.content_type || attachment?.contentType,
    }),
    [attachment],
  );
  const [loading, setLoading] = useState(sourceKind === 'excel');
  const [inlineState, setInlineState] = useState(null);
  const [inlineError, setInlineError] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (sourceKind !== 'excel' || typeof loadOfficeInlinePreview !== 'function') {
      setLoading(false);
      setInlineState(null);
      setInlineError('');
      return undefined;
    }

    setLoading(true);
    setInlineError('');
    loadOfficeInlinePreview(message, attachment)
      .then((data) => {
        if (cancelled) return;
        setInlineState(data);
      })
      .catch(() => {
        if (cancelled) return;
        setInlineError('Не удалось подготовить краткий предпросмотр.');
        setInlineState(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [attachment, loadOfficeInlinePreview, message, sourceKind]);

  const placeholder = (
    <Stack
      spacing={1}
      alignItems="center"
      justifyContent="center"
      sx={{
        minHeight: 168,
        px: 2,
        py: 2,
        bgcolor: '#fff',
        borderRadius: '6px',
        border: '1px solid',
        borderColor: mine ? alpha(theme.palette.common.white, 0.18) : '#e5e7eb',
      }}
    >
      <IconComponent sx={{ fontSize: 42, color: visual.color }} />
      <Typography
        variant="body2"
        sx={{
          fontWeight: 700,
          color: mine ? 'rgba(255,255,255,0.96)' : 'text.primary',
          textAlign: 'center',
        }}
      >
        {visual.label}
      </Typography>
      <Typography
        variant="caption"
        sx={{
          color: mine ? alpha(theme.palette.common.white, 0.72) : 'text.secondary',
          textAlign: 'center',
        }}
      >
        Наведите курсор и нажмите «Просмотреть» для полного просмотра
      </Typography>
    </Stack>
  );

  const body = (() => {
    if (loading) {
      return <Skeleton variant="rectangular" height={180} sx={{ borderRadius: '6px' }} />;
    }
    if (inlineState?.kind === 'office_excel' && inlineState?.excelWorkbook) {
      return (
        <Suspense fallback={<Skeleton variant="rectangular" height={180} sx={{ borderRadius: '6px' }} />}>
          <MailExcelPreviewGrid workbook={inlineState.excelWorkbook} compact />
        </Suspense>
      );
    }
    if (inlineError) {
      return placeholder;
    }
    return placeholder;
  })();

  return (
    <Box sx={{ width: 'min(100%, 520px)' }}>
      <MailOfficePreviewTeaser onOpenFull={() => onOpenFull?.()}>
        {body}
      </MailOfficePreviewTeaser>
    </Box>
  );
}
