import { useEffect, useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  Typography,
} from '@mui/material';

import { formatQrLabelCount } from './equipmentQrPrint';
import { EQUIPMENT_QR_A4_GRID } from './equipmentQrPrintFormats';

export default function EquipmentQrPrintDialog({ open, count = 0, isMobile, onClose, onPrint }) {
  const [format, setFormat] = useState('label');
  useEffect(() => {
    if (open) setFormat('label');
  }, [open]);
  const perSheet = EQUIPMENT_QR_A4_GRID.columns * EQUIPMENT_QR_A4_GRID.rows;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth fullScreen={isMobile}
      aria-labelledby="equipment-qr-print-title">
      <DialogTitle id="equipment-qr-print-title">Печать QR-кодов</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 2 }}>
          Подготовим: {formatQrLabelCount(count)}.
        </Typography>
        <FormControl>
          <FormLabel id="equipment-qr-print-format">Формат печати</FormLabel>
          <RadioGroup aria-labelledby="equipment-qr-print-format" value={format}
            onChange={(event) => setFormat(event.target.value)}>
            <FormControlLabel value="label" control={<Radio />}
              label="Этикетка 56 × 50 мм" />
            <FormControlLabel value="label_small" control={<Radio />}
              label="Малая этикетка 28 × 25 мм" />
            <FormControlLabel value="a4" control={<Radio />}
              label="Лист A4" />
          </RadioGroup>
        </FormControl>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {format === 'a4'
            ? `${perSheet} этикеток на листе (${EQUIPMENT_QR_A4_GRID.columns} × ${EQUIPMENT_QR_A4_GRID.rows}). Листов: ${Math.ceil(count / perSheet)}. Размер каждой этикетки — 56 × 50 мм.`
            : format === 'label_small'
              ? 'По одной этикетке 28 × 25 мм на страницу. В окне печати выберите размер бумаги 28 × 25 мм и масштаб 100%.'
              : 'По одной этикетке на страницу для принтера этикеток.'}
        </Typography>
        {format === 'a4' && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            В окне печати выберите принтер с бумагой A4 и масштаб 100%.
          </Typography>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose} variant="outlined">Отмена</Button>
        <Button onClick={() => onPrint(format)} variant="contained" disabled={!count}>Печать</Button>
      </DialogActions>
    </Dialog>
  );
}
