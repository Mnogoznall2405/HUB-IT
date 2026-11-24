import { useEffect, useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField } from '@mui/material';
import { itObjectsAPI } from '../../api/itObjects';
import { getItObjectsErrorMessage, isItObjectsRequestCancelled } from './itObjectsShared';

const NO_BRANCH = '';

/** Новый объект: название и, по желанию, филиал ITINVENT, из которого берутся инвентарь и компьютеры. */
export default function ObjectCreateDialog({ open, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [linkedRef, setLinkedRef] = useState(NO_BRANCH);
  const [branches, setBranches] = useState([]);
  const [branchesError, setBranchesError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    setName('');
    setLinkedRef(NO_BRANCH);
    setError('');
    setBranchesError('');
    const controller = new AbortController();
    itObjectsAPI.list({ signal: controller.signal })
      .then((payload) => setBranches((Array.isArray(payload?.items) ? payload.items : []).filter((item) => !item.custom)))
      .catch((requestError) => {
        if (isItObjectsRequestCancelled(requestError)) return;
        // Без списка филиалов привязка не выбирается — предупреждаем вместо тихого провала.
        setBranches([]);
        setBranchesError(getItObjectsErrorMessage(requestError, 'Не удалось загрузить список филиалов'));
      });
    return () => controller.abort();
  }, [open]);

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const created = await itObjectsAPI.create({ name: name.trim(), linkedRef });
      onCreated?.(created);
    } catch (requestError) {
      setError(getItObjectsErrorMessage(requestError, 'Не удалось добавить объект'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ fontWeight: 800 }}>Добавить объект</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ pt: 1 }}>
          <TextField
            autoFocus
            size="small"
            label="Название"
            value={name}
            onChange={(event) => setName(event.target.value)}
            inputProps={{ maxLength: 255 }}
            sx={{ '& .MuiInputBase-root': { minHeight: 44 } }}
          />
          <TextField
            select
            size="small"
            label="Филиал ITINVENT"
            value={linkedRef}
            onChange={(event) => setLinkedRef(event.target.value)}
            helperText="Инвентарь и компьютеры берутся из филиала. Без филиала у объекта будут только пароли."
            sx={{ '& .MuiInputBase-root': { minHeight: 44 } }}
          >
            <MenuItem value={NO_BRANCH}>Без привязки</MenuItem>
            {branches.map((branch) => <MenuItem key={branch.object_ref} value={branch.object_ref}>{branch.name}</MenuItem>)}
          </TextField>
          {branchesError ? <Alert severity="warning">{branchesError} Объект можно создать без привязки и привязать позже.</Alert> : null}
          {error ? <Alert severity="warning">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Отмена</Button>
        <Button variant="contained" onClick={() => void submit()} disabled={busy || name.trim().length < 2}>Добавить</Button>
      </DialogActions>
    </Dialog>
  );
}
