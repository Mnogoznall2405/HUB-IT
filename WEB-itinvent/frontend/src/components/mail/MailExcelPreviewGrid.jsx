import { useMemo, useState } from 'react';
import { Box, Tab, Tabs, Typography } from '@mui/material';
import {
  EXCEL_PREVIEW_FULL_MAX_COLS,
  EXCEL_PREVIEW_FULL_MAX_ROWS,
  EXCEL_PREVIEW_TEASER_MAX_COLS,
  EXCEL_PREVIEW_TEASER_MAX_ROWS,
  columnLetter,
  sliceExcelRows,
} from '../../lib/excelPreview';

const normalizeWorkbook = (workbook) => {
  const sheets = Array.isArray(workbook?.sheets) ? workbook.sheets : [];
  return sheets.map((sheet, index) => ({
    index: Number.isFinite(Number(sheet?.index)) ? Number(sheet.index) : index,
    name: String(sheet?.name || `Лист${index + 1}`),
    rows: Array.isArray(sheet?.rows) ? sheet.rows : [],
  }));
};

export default function MailExcelPreviewGrid({
  workbook = null,
  compact = false,
  initialSheetIndex = 0,
}) {
  const sheets = useMemo(() => normalizeWorkbook(workbook), [workbook]);
  const [activeSheetIndex, setActiveSheetIndex] = useState(() => {
    const fallback = sheets[0]?.index ?? 0;
    const preferred = Number(initialSheetIndex);
    if (sheets.some((sheet) => sheet.index === preferred)) return preferred;
    return fallback;
  });

  const activeSheet = sheets.find((sheet) => sheet.index === activeSheetIndex) || sheets[0] || null;
  const maxRows = compact ? EXCEL_PREVIEW_TEASER_MAX_ROWS : EXCEL_PREVIEW_FULL_MAX_ROWS;
  const maxCols = compact ? EXCEL_PREVIEW_TEASER_MAX_COLS : EXCEL_PREVIEW_FULL_MAX_COLS;
  const visibleRows = useMemo(
    () => sliceExcelRows(activeSheet?.rows || [], { maxRows, maxCols }),
    [activeSheet?.rows, maxCols, maxRows],
  );
  const colCount = Math.max(1, visibleRows.reduce((max, row) => Math.max(max, row.length), 0));

  if (!activeSheet) {
    return (
      <Typography variant="body2" color="text.secondary">
        Не удалось прочитать лист Excel.
      </Typography>
    );
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        border: '1px solid #d1d5db',
        borderRadius: '6px',
        overflow: 'hidden',
        bgcolor: '#fff',
      }}
    >
      {sheets.length > 1 ? (
        <Tabs
          value={activeSheetIndex}
          onChange={(_event, nextIndex) => setActiveSheetIndex(nextIndex)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            minHeight: 34,
            bgcolor: '#f3f4f6',
            borderBottom: '1px solid #d1d5db',
            '& .MuiTab-root': {
              minHeight: 34,
              py: 0.45,
              px: 1.4,
              textTransform: 'none',
              fontSize: '0.82rem',
              fontWeight: 700,
              color: '#374151',
            },
            '& .Mui-selected': {
              bgcolor: '#fff',
              color: '#107c41',
            },
            '& .MuiTabs-indicator': {
              bgcolor: '#107c41',
              height: 2,
            },
          }}
        >
          {sheets.map((sheet) => (
            <Tab key={`${sheet.index}-${sheet.name}`} value={sheet.index} label={sheet.name} />
          ))}
        </Tabs>
      ) : (
        <Box sx={{ px: 1.2, py: 0.7, bgcolor: '#f3f4f6', borderBottom: '1px solid #d1d5db' }}>
          <Typography variant="caption" sx={{ fontWeight: 700, color: '#107c41' }}>
            {activeSheet.name}
          </Typography>
        </Box>
      )}

      <Box
        sx={{
          overflow: 'auto',
          maxHeight: compact ? 240 : '65vh',
          bgcolor: '#fff',
        }}
      >
        <Box
          component="table"
          sx={{
            borderCollapse: 'collapse',
            tableLayout: 'fixed',
            width: 'max-content',
            minWidth: '100%',
            fontFamily: 'Calibri, "Segoe UI", Arial, sans-serif',
            fontSize: compact ? '0.78rem' : '0.84rem',
            color: '#111827',
          }}
        >
          <Box component="thead">
            <Box component="tr">
              <Box
                component="th"
                sx={{
                  position: 'sticky',
                  top: 0,
                  left: 0,
                  zIndex: 3,
                  width: 42,
                  minWidth: 42,
                  bgcolor: '#f3f4f6',
                  border: '1px solid #d1d5db',
                  color: '#6b7280',
                  fontWeight: 700,
                }}
              />
              {Array.from({ length: colCount }).map((_, colIndex) => (
                <Box
                  component="th"
                  key={`col-${colIndex}`}
                  sx={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 2,
                    minWidth: compact ? 72 : 96,
                    bgcolor: '#f3f4f6',
                    border: '1px solid #d1d5db',
                    color: '#6b7280',
                    fontWeight: 700,
                    px: 0.6,
                    py: 0.35,
                    textAlign: 'center',
                  }}
                >
                  {columnLetter(colIndex)}
                </Box>
              ))}
            </Box>
          </Box>
          <Box component="tbody">
            {visibleRows.map((row, rowIndex) => (
              <Box component="tr" key={`row-${rowIndex}`}>
                <Box
                  component="th"
                  scope="row"
                  sx={{
                    position: 'sticky',
                    left: 0,
                    zIndex: 1,
                    width: 42,
                    minWidth: 42,
                    bgcolor: '#f9fafb',
                    border: '1px solid #e5e7eb',
                    color: '#6b7280',
                    fontWeight: 600,
                    textAlign: 'center',
                  }}
                >
                  {rowIndex + 1}
                </Box>
                {Array.from({ length: colCount }).map((_, colIndex) => (
                  <Box
                    component="td"
                    key={`cell-${rowIndex}-${colIndex}`}
                    sx={{
                      minWidth: compact ? 72 : 96,
                      maxWidth: compact ? 120 : 180,
                      border: '1px solid #e5e7eb',
                      px: 0.7,
                      py: 0.35,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      bgcolor: '#fff',
                    }}
                    title={row[colIndex] || ''}
                  >
                    {row[colIndex] || ''}
                  </Box>
                ))}
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
