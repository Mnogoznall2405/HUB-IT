import { useMemo } from 'react';
import { Box, GlobalStyles } from '@mui/material';
import { createPortal } from 'react-dom';

export const EQUIPMENT_QR_PRINT_ROOT_ID = 'equipment-qr-print-root';
export const EQUIPMENT_QR_LABELS_PER_A4_SHEET = 20;

const DEFAULT_GRID = {
  columns: 4,
  rows: 5,
  cellWidthMm: 50,
  cellHeightMm: 50,
};

const toPositiveInt = (value, fallback) => {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
const toPositiveMm = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

function chunkLabelsIntoSheets(labels, perSheet) {
  const sheets = [];
  for (let index = 0; index < labels.length; index += perSheet) {
    sheets.push(labels.slice(index, index + perSheet));
  }
  return sheets;
}

function buildPrintStyles({ columns, rows, cellWidthMm, cellHeightMm }) {
  const cellW = `${cellWidthMm}mm`;
  const cellH = `${cellHeightMm}mm`;
  return {
    '@page': {
      size: 'A4 portrait',
      margin: '5mm',
    },
    '@media print': {
      'html, body': {
        margin: '0 !important',
        padding: '0 !important',
        background: '#fff !important',
      },
      [`body > *:not(#${EQUIPMENT_QR_PRINT_ROOT_ID})`]: {
        display: 'none !important',
      },
      [`#${EQUIPMENT_QR_PRINT_ROOT_ID}`]: {
        display: 'block !important',
        width: '200mm !important',
        margin: '0 !important',
        padding: '0 !important',
        background: '#fff !important',
      },
      [`#${EQUIPMENT_QR_PRINT_ROOT_ID} .equipment-qr-print-sheet`]: {
        display: 'grid !important',
        gridTemplateColumns: `repeat(${columns}, ${cellW})`,
        gridTemplateRows: `repeat(${rows}, ${cellH})`,
        width: '200mm !important',
        height: `${rows * cellHeightMm}mm !important`,
        margin: '0 !important',
        padding: '0 !important',
        overflow: 'hidden !important',
        breakAfter: 'page',
        pageBreakAfter: 'always',
      },
      [`#${EQUIPMENT_QR_PRINT_ROOT_ID} .equipment-qr-print-sheet:last-child`]: {
        breakAfter: 'auto',
        pageBreakAfter: 'auto',
      },
      [`#${EQUIPMENT_QR_PRINT_ROOT_ID} .equipment-qr-print-label`]: {
        width: `${cellW} !important`,
        height: `${cellH} !important`,
        boxSizing: 'border-box !important',
        margin: '0 !important',
        padding: '0 !important',
        overflow: 'hidden !important',
      },
      [`#${EQUIPMENT_QR_PRINT_ROOT_ID} img`]: {
        display: 'block !important',
        width: `${cellW} !important`,
        height: `${cellH} !important`,
        objectFit: 'contain',
      },
    },
  };
}

export async function waitForEquipmentQrPrintImages() {
  if (typeof document === 'undefined') return false;
  const root = document.getElementById(EQUIPMENT_QR_PRINT_ROOT_ID);
  if (!root) return false;

  const images = Array.from(root.querySelectorAll('img'));
  await Promise.all(images.map(async (image) => {
    if (typeof image.decode === 'function') {
      try {
        await image.decode();
        return;
      } catch {
        // Fall through to load/error events for runtimes with partial decode support.
      }
    }
    if (image.complete) return;
    await new Promise((resolve) => {
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', resolve, { once: true });
    });
  }));
  return true;
}

export default function EquipmentQrPrintPortal({ labels = [], columns, rows, cellWidthMm, cellHeightMm }) {
  const grid = useMemo(() => ({
    columns: toPositiveInt(columns, DEFAULT_GRID.columns),
    rows: toPositiveInt(rows, DEFAULT_GRID.rows),
    cellWidthMm: toPositiveMm(cellWidthMm, DEFAULT_GRID.cellWidthMm),
    cellHeightMm: toPositiveMm(cellHeightMm, DEFAULT_GRID.cellHeightMm),
  }), [columns, rows, cellWidthMm, cellHeightMm]);
  const printStyles = useMemo(() => buildPrintStyles(grid), [grid]);

  if (typeof document === 'undefined' || labels.length === 0) return null;
  const sheets = chunkLabelsIntoSheets(labels, grid.columns * grid.rows);

  return (
    <>
      <GlobalStyles styles={printStyles} />
      {createPortal(
        <Box
          id={EQUIPMENT_QR_PRINT_ROOT_ID}
          aria-hidden="true"
          sx={{ display: 'none' }}
        >
          {sheets.map((sheetLabels, sheetIndex) => (
            <Box
              className="equipment-qr-print-sheet"
              data-sheet-index={sheetIndex}
              key={`sheet-${sheetIndex}`}
            >
              {sheetLabels.map((label, labelIndex) => (
                <Box
                  className="equipment-qr-print-label"
                  data-inv-no={label.invNo}
                  key={`${label.invNo}-${sheetIndex}-${labelIndex}`}
                >
                  <img
                    src={label.dataUrl}
                    alt=""
                    draggable={false}
                  />
                </Box>
              ))}
            </Box>
          ))}
        </Box>,
        document.body
      )}
    </>
  );
}
