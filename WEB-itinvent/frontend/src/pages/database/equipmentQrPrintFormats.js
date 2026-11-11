import {
  EQUIPMENT_QR_LABEL_WIDTH_MM,
  EQUIPMENT_QR_LABEL_HEIGHT_MM,
  EQUIPMENT_QR_SMALL_LABEL_WIDTH_MM,
  EQUIPMENT_QR_SMALL_LABEL_HEIGHT_MM,
} from './equipmentQrLabel';

// Рулонная этикетка 28 × 25 мм: одна наклейка на страницу.
export const EQUIPMENT_QR_SMALL_LABEL_SIZE = {
  cellWidthMm: EQUIPMENT_QR_SMALL_LABEL_WIDTH_MM,
  cellHeightMm: EQUIPMENT_QR_SMALL_LABEL_HEIGHT_MM,
};

export const EQUIPMENT_QR_A4_GRID = {
  columns: 3,
  rows: 5,
  cellWidthMm: EQUIPMENT_QR_LABEL_WIDTH_MM,
  cellHeightMm: EQUIPMENT_QR_LABEL_HEIGHT_MM,
  gapMm: 2,
  pageMarginMm: 10,
};
