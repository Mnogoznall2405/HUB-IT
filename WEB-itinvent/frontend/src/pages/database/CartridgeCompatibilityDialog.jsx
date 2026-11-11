import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';

import jsonAPI from '../../api/json_client';

const MAX_VISIBLE_ROWS = 150;
const MODEL_LINE_SEPARATOR = '|';

// "CF283A | Черный" -> { model: 'CF283A', color: 'Черный' }
export const parseCompatibleModelsText = (text) =>
  String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [model, color] = line.split(MODEL_LINE_SEPARATOR).map((part) => part.trim());
      return color ? { model, color } : { model };
    })
    .filter((item) => item.model);

export const serializeCompatibleModels = (models) =>
  (Array.isArray(models) ? models : [])
    .map((item) => {
      const model = String(item?.model || '').trim();
      if (!model) return '';
      const color = String(item?.color || '').trim();
      return color ? `${model} ${MODEL_LINE_SEPARATOR} ${color}` : model;
    })
    .filter(Boolean)
    .join('\n');

const entryMatchesQuery = (entry, query) => {
  const haystacks = [
    entry?.printer_model,
    entry?.oem_cartridge,
    ...(Array.isArray(entry?.compatible_models)
      ? entry.compatible_models.map((item) => item?.model)
      : []),
  ];
  return haystacks.some((value) => String(value || '').toLowerCase().includes(query));
};

const readApiError = (error, fallback) =>
  (typeof error?.response?.data?.detail === 'string' && error.response.data.detail.trim())
    || fallback;

// Management table for cartridge_database.json: which cartridge models fit
// which printer. Edits feed the "Подходит к" hints and the MFU suggestions
// used by the QR consumable write-off flow.
function CartridgeCompatibilityDialog({
  open,
  onClose,
  isMobile = false,
  canWrite = false,
}) {
  const [entries, setEntries] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState('');
  const [deleting, setDeleting] = useState(false);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await jsonAPI.getCartridgeDatabase();
      setEntries(Array.isArray(response?.data) ? response.data : []);
    } catch (loadError) {
      setError(readApiError(loadError, 'Не удалось загрузить таблицу совместимости.'));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setEditing(null);
    setDeleteArmed('');
    void loadEntries();
  }, [loadEntries, open]);

  const filteredEntries = useMemo(() => {
    const list = Array.isArray(entries) ? entries : [];
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return list;
    return list.filter((entry) => entryMatchesQuery(entry, normalizedQuery));
  }, [entries, query]);

  const visibleEntries = filteredEntries.slice(0, MAX_VISIBLE_ROWS);
  const hiddenCount = filteredEntries.length - visibleEntries.length;

  const openEditor = useCallback((entry = null) => {
    setDeleteArmed('');
    setError('');
    setEditing({
      printer_model: String(entry?.printer_model || ''),
      oem_cartridge: String(entry?.oem_cartridge || ''),
      is_color: Boolean(entry?.is_color),
      modelsText: serializeCompatibleModels(entry?.compatible_models),
      isNew: !entry,
    });
  }, []);

  const closeEditor = useCallback(() => {
    setEditing(null);
    setSaving(false);
  }, []);

  const handleSave = useCallback(async () => {
    const printerModel = String(editing?.printer_model || '').trim();
    if (!printerModel) {
      setError('Укажите модель принтера/МФУ.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await jsonAPI.upsertCartridgeDatabaseEntry(printerModel, {
        oem_cartridge: String(editing?.oem_cartridge || '').trim(),
        is_color: Boolean(editing?.is_color),
        compatible_models: parseCompatibleModelsText(editing?.modelsText),
      });
      setEditing(null);
      await loadEntries();
    } catch (saveError) {
      setError(readApiError(saveError, 'Не удалось сохранить запись совместимости.'));
    } finally {
      setSaving(false);
    }
  }, [editing, loadEntries]);

  const handleDelete = useCallback(async (printerModel) => {
    setDeleting(true);
    setError('');
    try {
      await jsonAPI.deleteCartridgeDatabaseEntry(printerModel);
      setDeleteArmed('');
      await loadEntries();
    } catch (deleteError) {
      setError(readApiError(deleteError, 'Не удалось удалить запись совместимости.'));
    } finally {
      setDeleting(false);
    }
  }, [loadEntries]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth fullScreen={isMobile}>
      <DialogTitle>Совместимость картриджей</DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        {editing ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <TextField
              size="small"
              label="Модель принтера/МФУ"
              value={editing.printer_model}
              onChange={(event) => setEditing((prev) => ({ ...prev, printer_model: event.target.value }))}
              disabled={!editing.isNew || saving}
              helperText={editing.isNew
                ? 'Именно эта строка должна совпадать с моделью из базы техники.'
                : 'Ключ записи — чтобы переименовать, удалите строку и создайте новую.'}
              required
            />
            <TextField
              size="small"
              label="OEM картридж"
              value={editing.oem_cartridge}
              onChange={(event) => setEditing((prev) => ({ ...prev, oem_cartridge: event.target.value }))}
              disabled={saving}
            />
            <TextField
              size="small"
              label="Совместимые картриджи"
              value={editing.modelsText}
              onChange={(event) => setEditing((prev) => ({ ...prev, modelsText: event.target.value }))}
              disabled={saving}
              multiline
              minRows={4}
              maxRows={10}
              helperText="По одной модели в строке. Цвет — через «|»: CF283A | Черный"
            />
            <FormControlLabel
              control={(
                <Checkbox
                  checked={Boolean(editing.is_color)}
                  onChange={(event) => setEditing((prev) => ({ ...prev, is_color: event.target.checked }))}
                  disabled={saving}
                />
              )}
              label="Цветное устройство"
            />
            {error ? <Alert severity="error">{error}</Alert> : null}
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <TextField
                size="small"
                fullWidth
                placeholder="Поиск по принтеру или картриджу"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                inputProps={{ 'aria-label': 'Поиск в таблице совместимости' }}
              />
              {canWrite ? (
                <Button
                  variant="contained"
                  startIcon={<AddRoundedIcon />}
                  onClick={() => openEditor(null)}
                  sx={{ whiteSpace: 'nowrap' }}
                >
                  Добавить
                </Button>
              ) : null}
            </Box>

            {loading ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 3, justifyContent: 'center' }}>
                <CircularProgress size={20} />
                <Typography variant="body2" color="text.secondary">Загружаем таблицу…</Typography>
              </Box>
            ) : filteredEntries.length === 0 && !error ? (
              <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                {(entries || []).length
                  ? 'По запросу ничего не найдено.'
                  : 'Таблица совместимости пуста.'}
              </Typography>
            ) : (
              <>
                {error ? <Alert severity="error">{error}</Alert> : null}
                <Box sx={{ overflowX: 'auto' }}>
                  <Table size="small" sx={{ minWidth: 520 }}>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 700 }}>Принтер/МФУ</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>OEM картридж</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Совместимые картриджи</TableCell>
                        {canWrite ? <TableCell align="right" sx={{ fontWeight: 700 }}>Действия</TableCell> : null}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {visibleEntries.map((entry) => {
                        const printerModel = String(entry?.printer_model || '');
                        const models = Array.isArray(entry?.compatible_models) ? entry.compatible_models : [];
                        return (
                          <TableRow key={printerModel} hover>
                            <TableCell sx={{ fontWeight: 600 }}>
                              {printerModel}
                              {entry?.is_color ? (
                                <Chip label="цветной" size="small" variant="outlined" sx={{ ml: 1 }} />
                              ) : null}
                            </TableCell>
                            <TableCell>{entry?.oem_cartridge || '—'}</TableCell>
                            <TableCell>
                              {models.length ? (
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                  {models.map((item, index) => (
                                    <Chip
                                      key={`${item?.model || 'model'}-${index}`}
                                      label={item?.color && item.color !== 'Черный'
                                        ? `${item?.model} · ${item.color}`
                                        : item?.model}
                                      size="small"
                                      variant="outlined"
                                    />
                                  ))}
                                </Box>
                              ) : '—'}
                            </TableCell>
                            {canWrite ? (
                              <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                                {deleteArmed === printerModel ? (
                                  <Button
                                    size="small"
                                    color="error"
                                    variant="contained"
                                    disabled={deleting}
                                    onClick={() => handleDelete(printerModel)}
                                  >
                                    Удалить?
                                  </Button>
                                ) : (
                                  <>
                                    <IconButton
                                      size="small"
                                      aria-label={`Изменить ${printerModel}`}
                                      onClick={() => openEditor(entry)}
                                    >
                                      <EditOutlinedIcon fontSize="small" />
                                    </IconButton>
                                    <IconButton
                                      size="small"
                                      aria-label={`Удалить ${printerModel}`}
                                      onClick={() => setDeleteArmed(printerModel)}
                                    >
                                      <DeleteOutlineRoundedIcon fontSize="small" />
                                    </IconButton>
                                  </>
                                )}
                              </TableCell>
                            ) : null}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </Box>
                {hiddenCount > 0 ? (
                  <Typography variant="caption" color="text.secondary">
                    Показаны первые {MAX_VISIBLE_ROWS} строк, ещё {hiddenCount} — уточните поиск.
                  </Typography>
                ) : null}
              </>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1 }}>
        {editing ? (
          <>
            <Button onClick={closeEditor} variant="outlined" disabled={saving}>Назад</Button>
            <Button onClick={handleSave} variant="contained" disabled={saving}>
              {saving ? 'Сохранение…' : 'Сохранить'}
            </Button>
          </>
        ) : (
          <Button onClick={onClose} variant="outlined">Закрыть</Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

export default CartridgeCompatibilityDialog;
