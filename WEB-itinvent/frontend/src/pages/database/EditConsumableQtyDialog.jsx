import {
  Alert,
  Box,
  Button,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';

import { readFirst } from './databaseRecordModel';

function EditConsumableQtyDialog({
  open,
  item,
  value,
  error = '',
  loading = false,
  isMobile = false,
  onClose,
  onValueChange,
  onSubmit,
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      fullScreen={isMobile}
    >
      <DialogTitle>Изменить количество</DialogTitle>
      <DialogContent sx={{ pt: 2 }}>
        <Box sx={{ display: 'grid', gap: 1.5 }}>
          <Typography variant="body2" color="text.secondary">
            {String(readFirst(item, ['MODEL_NAME', 'model_name'], 'Расходник'))}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Инв. № {String(readFirst(item, ['INV_NO', 'inv_no'], '-'))} | ID{' '}
            {String(readFirst(item, ['ID', 'id'], '-'))}
          </Typography>
          <TextField
            label="Количество"
            type="number"
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            inputProps={{ min: 0, step: 1 }}
            size={isMobile ? 'medium' : 'small'}
            fullWidth
            required
          />
          <Collapse in={Boolean(error)} timeout={220}>
            <Alert severity="error">{error}</Alert>
          </Collapse>
        </Box>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose} variant="outlined" disabled={loading}>
          Закрыть
        </Button>
        <Button
          onClick={onSubmit}
          variant="contained"
          disabled={loading}
        >
          {loading ? 'Сохранение...' : 'Сохранить'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default EditConsumableQtyDialog;
