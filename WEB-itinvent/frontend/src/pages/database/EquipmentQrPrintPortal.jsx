import { Box, GlobalStyles } from '@mui/material';
import { createPortal } from 'react-dom';

export const EQUIPMENT_QR_PRINT_ROOT_ID = 'equipment-qr-print-root';
export const EQUIPMENT_QR_LABELS_PER_A4_SHEET = 20;

function chunkLabelsIntoSheets(labels) {
  const sheets = [];
  for (let index = 0; index < labels.length; index += EQUIPMENT_QR_LABELS_PER_A4_SHEET) {
    sheets.push(labels.slice(index, index + EQUIPMENT_QR_LABELS_PER_A4_SHEET));
  }
  return sheets;
}

const printStyles = {
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
      gridTemplateColumns: 'repeat(4, 50mm)',
      gridTemplateRows: 'repeat(5, 50mm)',
      width: '200mm !important',
      height: '250mm !important',
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
      width: '50mm !important',
      height: '50mm !important',
      boxSizing: 'border-box !important',
      margin: '0 !important',
      padding: '0 !important',
      overflow: 'hidden !important',
    },
    [`#${EQUIPMENT_QR_PRINT_ROOT_ID} img`]: {
      display: 'block !important',
      width: '50mm !important',
      height: '50mm !important',
      objectFit: 'contain',
    },
  },
};

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

export default function EquipmentQrPrintPortal({ labels = [] }) {
  if (typeof document === 'undefined' || labels.length === 0) return null;
  const sheets = chunkLabelsIntoSheets(labels);

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
