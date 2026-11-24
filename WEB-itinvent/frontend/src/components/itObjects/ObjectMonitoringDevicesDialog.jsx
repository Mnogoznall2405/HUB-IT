import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { itObjectsAPI } from '../../api/itObjects';
import { getItObjectsErrorMessage } from './itObjectsShared';

export default function ObjectMonitoringDevicesDialog({ open, objectRef, attached, onChanged, onClose }) {
  const [free, setFree] = useState([]);
  const [picked, setPicked] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const mountedRef = useRef(true);
  const abortRef = useRef(null);

  useEffect(() => () => {
    mountedRef.current = false;
    abortRef.current?.abort();
  }, []);

  const loadFree = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const payload = await itObjectsAPI.monitoringFreeDevices(objectRef, { signal: controller.signal });
      if (!mountedRef.current || controller.signal.aborted) return;
      setFree(Array.isArray(payload?.items) ? payload.items : []);
    } catch (requestError) {
      if (!mountedRef.current || controller.signal.aborted || requestError?.name === 'CanceledError' || requestError?.code === 'ERR_CANCELED') return;
      setError(getItObjectsErrorMessage(requestError, 'Не удалось загрузить свободные устройства'));
    }
  }, [objectRef]);

  useEffect(() => {
    if (!open) return;
    setPicked(null);
    setError('');
    void loadFree();
  }, [open, loadFree]);

  const change = async (action, fallback) => {
    setBusy(true);
    setError('');
    try {
      await action();
      if (!mountedRef.current) return;
      setPicked(null);
      await Promise.all([loadFree(), onChanged()]);
    } catch (requestError) {
      if (mountedRef.current) setError(getItObjectsErrorMessage(requestError, fallback));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: 2 } }}>
      <DialogTitle>Устройства объекта</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {busy ? <LinearProgress aria-label="Сохранение" /> : null}
          {error ? <Alert severity="error">{error}</Alert> : null}
          <Stack direction="row" spacing={1} alignItems="flex-start">
            <Autocomplete
              fullWidth
              size="small"
              options={free}
              value={picked}
              onChange={(_, value) => setPicked(value)}
              getOptionLabel={(option) => `${option.name} · ${option.address}`}
              isOptionEqualToValue={(option, value) => option.id === value.id}
              noOptionsText="Свободных устройств нет"
              renderInput={(params) => <TextField {...params} label="Добавить устройство" />}
            />
            <Button
              variant="contained"
              disabled={!picked || busy}
              onClick={() => void change(() => itObjectsAPI.assignMonitoringDevice(objectRef, picked.id), 'Не удалось добавить устройство')}
              sx={{ minHeight: 40 }}
            >
              Добавить
            </Button>
          </Stack>
          <Typography variant="subtitle2" fontWeight={800}>Привязаны к объекту · {attached.length}</Typography>
          {attached.length ? attached.map((device) => (
            <Stack key={device.id} direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
              <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{device.name} · {device.address}</Typography>
              <Button
                size="small"
                color="error"
                disabled={busy}
                aria-label={`Убрать ${device.name}`}
                onClick={() => void change(() => itObjectsAPI.releaseMonitoringDevice(objectRef, device.id), 'Не удалось убрать устройство')}
              >
                Убрать
              </Button>
            </Stack>
          )) : <Typography variant="body2" color="text.secondary">Пока ни одного.</Typography>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy}>Закрыть</Button>
      </DialogActions>
    </Dialog>
  );
}
