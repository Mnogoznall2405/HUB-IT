import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';

import LocationAutocompleteField from './LocationAutocompleteField';
import { toIdOrNull, toNumberOrNull } from './databaseRecordModel';

function AddConsumableDialog({
  open,
  onClose,
  isMobile = false,
  form,
  branchOptions = [],
  locationOptions = [],
  locationsLoading = false,
  typeOptions = [],
  modelOptions = [],
  modelsLoading = false,
  loading = false,
  error = '',
  success = '',
  onFormPatch,
  onErrorClear,
  onModelsReset,
  onSubmit,
}) {
  const fieldSize = isMobile ? 'medium' : 'small';
  const selectedModel = form?.model_no
    ? modelOptions.find((model) => model.model_no === form.model_no) || null
    : null;
  const shouldShowAutoCreateModel = (
    !form?.model_no &&
    String(form?.model_name || '').trim().length >= 2 &&
    toNumberOrNull(form?.type_no) !== null
  );

  const updateForm = (patch, { clearError = true } = {}) => {
    onFormPatch(patch);
    if (clearError) onErrorClear();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      fullScreen={isMobile}
    >
      <DialogTitle>Добавить расходник</DialogTitle>
      <DialogContent sx={{ pt: 2 }}>
        <Box sx={{ display: 'grid', gap: 2 }}>
          <Typography variant="body2" color="text.secondary">
            Обязательные поля: филиал, местоположение, тип, модель и количество.
          </Typography>

          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <FormControl size={fieldSize} fullWidth required>
                <InputLabel id="add-consumable-branch-label">Филиал *</InputLabel>
                <Select
                  labelId="add-consumable-branch-label"
                  id="add-consumable-branch"
                  label="Филиал *"
                  value={form?.branch_no || ''}
                  onChange={(event) => updateForm({ branch_no: toIdOrNull(event.target.value) || '' })}
                >
                  <MenuItem value="">
                    <em>Выберите филиал</em>
                  </MenuItem>
                  {branchOptions.map((branch) => (
                    <MenuItem key={branch.branch_no} value={branch.branch_no}>
                      {branch.branch_name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12} md={6}>
              <LocationAutocompleteField
                label="Местоположение *"
                value={form?.loc_no || ''}
                options={locationOptions}
                disabled={!form?.branch_no || locationsLoading}
                loading={locationsLoading}
                required
                size={fieldSize}
                onChange={(locNo) => updateForm({ loc_no: toIdOrNull(locNo) || '' })}
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <FormControl size={fieldSize} fullWidth required>
                <InputLabel id="add-consumable-type-label">Тип расходника *</InputLabel>
                <Select
                  labelId="add-consumable-type-label"
                  id="add-consumable-type"
                  label="Тип расходника *"
                  value={form?.type_no || ''}
                  onChange={(event) => {
                    const value = String(event.target.value || '');
                    updateForm({ type_no: value, model_name: '', model_no: null });
                    onModelsReset();
                  }}
                >
                  <MenuItem value="">
                    <em>Выберите тип</em>
                  </MenuItem>
                  {typeOptions.map((type) => (
                    <MenuItem key={type.type_no} value={String(type.type_no)}>
                      {type.type_name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                label="Количество *"
                type="number"
                inputProps={{ min: 1, step: 1 }}
                value={form?.qty || ''}
                onChange={(event) => updateForm({ qty: event.target.value })}
                size={fieldSize}
                fullWidth
                required
              />
            </Grid>

            <Grid item xs={12}>
              <Autocomplete
                freeSolo
                options={modelOptions}
                loading={modelsLoading}
                inputValue={form?.model_name || ''}
                value={selectedModel}
                onInputChange={(_, value, reason) => {
                  if (reason !== 'input' && reason !== 'clear') return;
                  updateForm({ model_name: String(value || ''), model_no: null });
                }}
                onChange={(_, value) => {
                  if (!value) {
                    updateForm({ model_name: '', model_no: null }, { clearError: false });
                    return;
                  }
                  if (typeof value === 'string') {
                    updateForm({ model_name: value, model_no: null }, { clearError: false });
                    return;
                  }
                  updateForm({
                    model_name: String(value.model_name || ''),
                    model_no: value.model_no ?? null,
                  });
                }}
                getOptionLabel={(option) => (
                  typeof option === 'string' ? option : String(option?.model_name || '')
                )}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Модель *"
                    placeholder="Введите модель или выберите из списка"
                    size={fieldSize}
                    required
                  />
                )}
              />
            </Grid>
          </Grid>

          <Collapse in={shouldShowAutoCreateModel} timeout={220}>
            <Alert severity="info">
              Модель {form?.model_name} не найдена в списке и будет создана автоматически.
            </Alert>
          </Collapse>

          <Collapse in={Boolean(error)} timeout={220}>
            <Alert severity="error">{error}</Alert>
          </Collapse>

          {success && (
            <Typography variant="caption" color="text.secondary">
              {success}
            </Typography>
          )}
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
          {loading ? 'Сохранение...' : 'Добавить'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default AddConsumableDialog;
