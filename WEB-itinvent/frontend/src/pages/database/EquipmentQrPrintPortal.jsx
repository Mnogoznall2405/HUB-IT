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
const toNonNegativeMm = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

function chunkLabelsIntoSheets(labels, perSheet) {
  const sheets = [];
  for (let index = 0; index < labels.length; index += perSheet) {
    sheets.push(labels.slice(index, index + perSheet));
  }
  return sheets;
}

function buildPrintStyles({ columns, rows, cellWidthMm, cellHeightMm, gapMm, pageMarginMm }, rollLabels) {
  const cellW = `${cellWidthMm}mm`;
  const cellH = `${cellHeightMm}mm`;
  const sheetWidth = `${columns * cellWidthMm + (columns - 1) * gapMm}mm`;
  return {
    '@page': {
      size: rollLabels ? `${cellW} ${cellH}` : 'A4 portrait',
      margin: rollLabels ? '0' : `${pageMarginMm}mm`,
    },
    '@media print': {
      'html, body': {
        margin: '0 !important',
        padding: '0 !important',
        minWidth: '0 !important',
        height: 'auto !important',
        overflow: 'visible !important',
        background: '#fff !important',
      },
      [`body > *:not(#${EQUIPMENT_QR_PRINT_ROOT_ID})`]: {
        display: 'none !important',
      },
      [`#${EQUIPMENT_QR_PRINT_ROOT_ID}`]: {
        display: 'block !important',
        width: `${sheetWidth} !important`,
        margin: '0 !important',
        padding: '0 !important',
        background: '#fff !important',
      },
      [`#${EQUIPMENT_QR_PRINT_ROOT_ID} .equipment-qr-print-sheet`]: {
        display: 'grid !important',
        gridTemplateColumns: `repeat(${columns}, ${cellW})`,
        gridTemplateRows: `repeat(${rows}, ${cellH})`,
        gap: `${gapMm}mm`,
        width: `${sheetWidth} !important`,
        height: `${rows * cellHeightMm + (rows - 1) * gapMm}mm !important`,
        margin: '0 !important',
        padding: '0 !important',
        overflow: 'hidden !important',
        breakAfter: 'page',
        pageBreakAfter: 'always',
        breakInside: 'avoid',
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
  if (images.length === 0) return false;
  const loaded = await Promise.all(images.map(async (image) => {
    if (typeof image.decode === 'function') {
      try {
        await image.decode();
        return image.naturalWidth > 0;
      } catch {
        // Fall through to load/error events for runtimes with partial decode support.
      }
    }
    if (image.complete) return image.naturalWidth > 0;
    return new Promise((resolve) => {
      const finish = () => {
        image.removeEventListener('load', finish);
        image.removeEventListener('error', finish);
        resolve(image.naturalWidth > 0);
      };
      image.addEventListener('load', finish, { once: true });
      image.addEventListener('error', finish, { once: true });
      if (image.complete) finish();
    });
  }));
  return loaded.every(Boolean);
}

export default function EquipmentQrPrintPortal({ labels = [], columns, rows, cellWidthMm, cellHeightMm, gapMm, pageMarginMm, rollLabels = false }) {
  const grid = useMemo(() => ({
    columns: rollLabels ? 1 : toPositiveInt(columns, DEFAULT_GRID.columns),
    rows: rollLabels ? 1 : toPositiveInt(rows, DEFAULT_GRID.rows),
    cellWidthMm: toPositiveMm(cellWidthMm, DEFAULT_GRID.cellWidthMm),
    cellHeightMm: toPositiveMm(cellHeightMm, DEFAULT_GRID.cellHeightMm),
    gapMm: rollLabels ? 0 : toNonNegativeMm(gapMm, 0),
    pageMarginMm: toNonNegativeMm(pageMarginMm, 5),
  }), [columns, rows, cellWidthMm, cellHeightMm, gapMm, pageMarginMm, rollLabels]);
  const printStyles = useMemo(() => buildPrintStyles(grid, rollLabels), [grid, rollLabels]);

  if (typeof document === 'undefined' || labels.length === 0) return null;
  const sheets = chunkLabelsIntoSheets(labels, grid.columns * grid.rows);

  return (
    <>
      <GlobalStyles styles={printStyles} />
      {createPortal(
        <Box
          id={EQUIPMENT_QR_PRINT_ROOT_ID}
          data-page-width-mm={rollLabels ? grid.cellWidthMm : 210}
          data-page-height-mm={rollLabels ? grid.cellHeightMm : 297}
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
