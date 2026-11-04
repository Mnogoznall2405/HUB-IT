import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material';

/** Подтверждение «удаления» объекта: на деле он скрывается, всё остальное сохраняется. */
export default function ObjectDeleteDialog({ name, open, busy = false, onCancel, onConfirm }) {
  return (
    <Dialog open={open} onClose={busy ? undefined : onCancel} fullWidth maxWidth="xs">
      <DialogTitle sx={{ fontWeight: 800 }}>Удалить объект «{name}»?</DialogTitle>
      <DialogContent>
        <DialogContentText>
          Объект пропадёт из списка, а его пароли, компьютеры и инвентарь станут недоступны всем. Айтишник, выданные права
          и журнал сохранятся — администратор может вернуть объект из списка «Удалённые».
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={busy}>Отмена</Button>
        <Button color="error" variant="contained" onClick={onConfirm} disabled={busy}>Удалить</Button>
      </DialogActions>
    </Dialog>
  );
}
