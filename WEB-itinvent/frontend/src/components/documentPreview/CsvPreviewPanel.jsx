import { useEffect, useState } from 'react';
import { Alert, Box, Skeleton } from '@mui/material';
import { decodeTextBuffer } from '../../lib/textPreview';
import { parseCsvTextToWorkbook } from '../../lib/excelPreview';
import MailExcelPreviewGrid from '../mail/MailExcelPreviewGrid';

/**
 * CSV/TSV preview surface: decodes the attachment bytes (UTF-8/Windows-1251
 * aware) and renders the existing Excel-style grid without any server
 * conversion.
 */
export default function CsvPreviewPanel({ blob, compact = false }) {
  const [state, setState] = useState({ loading: true, error: '', workbook: null, encoding: '' });

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, error: '', workbook: null, encoding: '' });
    (async () => {
      try {
        const buffer = await blob.arrayBuffer();
        const { text, encoding } = decodeTextBuffer(buffer);
        const workbook = await parseCsvTextToWorkbook(text);
        if (!cancelled) setState({ loading: false, error: '', workbook, encoding });
      } catch {
        if (!cancelled) {
          setState({
            loading: false,
            error: 'Не удалось разобрать CSV-файл. Скачайте оригинал.',
            workbook: null,
            encoding: '',
          });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [blob]);

  if (state.loading) {
    return <Skeleton variant="rectangular" height={360} sx={{ borderRadius: '8px' }} />;
  }
  if (state.error) {
    return <Alert severity="warning">{state.error}</Alert>;
  }
  return (
    <Box sx={{ minHeight: 0, flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
      <MailExcelPreviewGrid workbook={state.workbook} compact={compact} />
    </Box>
  );
}
