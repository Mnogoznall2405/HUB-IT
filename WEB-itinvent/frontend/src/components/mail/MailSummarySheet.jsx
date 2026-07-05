import { useState } from 'react';
import {
  Box,
  Button,
  Drawer,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import {
  getMailBottomSheetPaperSx,
  getMailSheetHandleSx,
} from './mailUiTokens';

export default function MailSummarySheet({
  open = false,
  onClose,
  tokens,
  summarizeLoading = false,
  summarizeText = '',
  summarySheetText = '',
  summarySheetError = '',
  onCopySummary,
  testId = 'mail-summary-sheet',
}) {
  const theme = useTheme();
  const displayedSummary = summarySheetText || summarizeText;
  const summaryBody = summarySheetError || displayedSummary || 'Пересказ недоступен.';

  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      ModalProps={{ keepMounted: true, sx: { zIndex: theme.zIndex.drawer + 4 } }}
      PaperProps={{
        'data-testid': testId,
        sx: getMailBottomSheetPaperSx(tokens),
      }}
    >
      <Box sx={{ pt: 1, px: 2, pb: 2 }}>
        <Box sx={getMailSheetHandleSx(tokens, { mb: 1.2 })} />
        <Typography sx={{ fontWeight: 800, fontSize: '1rem', mb: 1 }}>Краткий пересказ</Typography>
        {summarizeLoading ? (
          <Typography sx={{ color: tokens.textSecondary }}>Готовим пересказ…</Typography>
        ) : (
          <Typography
            sx={{
              color: summarySheetError ? 'error.main' : tokens.textPrimary,
              whiteSpace: 'pre-wrap',
              lineHeight: 1.45,
            }}
          >
            {summaryBody}
          </Typography>
        )}
        {displayedSummary && !summarySheetError ? (
          <Button
            data-testid="mail-summary-copy"
            startIcon={<ContentCopyRoundedIcon />}
            onClick={() => onCopySummary?.(displayedSummary)}
            sx={{ mt: 1.5, textTransform: 'none', fontWeight: 700 }}
          >
            Скопировать
          </Button>
        ) : null}
      </Box>
    </Drawer>
  );
}

export function useMailSummarySheetState({
  onSummarize,
  summarizeText = '',
} = {}) {
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summarySheetText, setSummarySheetText] = useState('');
  const [summarySheetError, setSummarySheetError] = useState('');

  const openSummary = async () => {
    setSummarySheetText('');
    setSummarySheetError('');
    setSummaryOpen(true);

    if (typeof onSummarize !== 'function') {
      setSummarySheetError('Пересказ недоступен.');
      return;
    }

    const result = await onSummarize();
    if (typeof result === 'string') {
      setSummarySheetText(result.trim());
      if (!result.trim()) {
        setSummarySheetError('Пересказ пустой. Попробуйте ещё раз.');
      }
      return;
    }

    const nextSummary = String(result?.summary || summarizeText || '').trim();
    const nextError = String(result?.error || '').trim();
    setSummarySheetText(nextSummary);
    setSummarySheetError(nextError || (nextSummary ? '' : 'Пересказ недоступен.'));
  };

  return {
    summaryOpen,
    setSummaryOpen,
    summarySheetText,
    summarySheetError,
    openSummary,
  };
}
