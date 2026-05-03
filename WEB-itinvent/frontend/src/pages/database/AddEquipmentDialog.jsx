import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Fade,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';

import { getOfficeSubtlePanelSx } from '../../theme/officeUiTokens';
import LocationAutocompleteField from './LocationAutocompleteField';
import { toIdOrNull, toNumberOrNull } from './databaseRecordModel';
import { toOwnerOption } from './detailModel';

const fieldSizeFor = (isMobile) => (isMobile ? 'medium' : 'small');

function AddEquipmentDialog({
  open,
  onClose,
  isMobile = false,
  ui,
  form,
  employeeOptions = [],
  employeeLoading = false,
  selectedEmployeeOption = null,
  employeeInput = '',
  branchOptions = [],
  locationOptions = [],
  locationsLoading = false,
  typeOptions = [],
  statusOptions = [],
  modelOptions = [],
  modelsLoading = false,
  usesManualEmployee = false,
  usesManualModel = false,
  loading = false,
  error = '',
  success = '',
  onEmployeeInputChange,
  onEmployeeSelect,
  onFormPatch,
  onErrorClear,
  onModelsReset,
  onSubmit,
}) {
  const fieldSize = fieldSizeFor(isMobile);
  const selectedModel = form?.model_no
    ? modelOptions.find((model) => model.model_no === form.model_no) || null
    : null;

  const updateForm = (patch, { clearError = true } = {}) => {
    onFormPatch(patch);
    if (clearError) onErrorClear();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      fullScreen={isMobile}
    >
      <DialogTitle>Добавить оборудование</DialogTitle>
      <DialogContent sx={{ pt: 2 }}>
        <Box sx={{ display: 'grid', gap: 2 }}>
          <Typography variant="body2" color="text.secondary">
            Обязательные поля отмечены `*`. Форма разделена на поля выбора из списка и поля ручного ввода.
          </Typography>
          <Alert severity="info" variant="outlined">
            Если сотрудника или модели нет в списке, вводите полное название:
            ФИО сотрудника полностью и полное имя модели оборудования.
          </Alert>

          <Fade in={open} timeout={280}>
            <Box sx={{
              ...getOfficeSubtlePanelSx(ui, {
                p: 1.5,
                borderRadius: 1,
              }),
              transition: 'transform 220ms ease, background-color 220ms ease',
              '&:hover': { bgcolor: ui?.actionHover, transform: 'translateY(-1px)' },
            }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Chip size="small" color="primary" label="Выбор из списка" />
                <Typography variant="subtitle2">Обязательные поля</Typography>
              </Box>
              <Grid container spacing={2}>
                <Grid item xs={12} md={6}>
                  <Autocomplete
                    options={employeeOptions}
                    loading={employeeLoading}
                    value={selectedEmployeeOption}
                    inputValue={employeeInput}
                    onInputChange={(_, value, reason) => {
                      if (reason !== 'input' && reason !== 'clear') return;
                      const nextValue = String(value || '');
                      onEmployeeInputChange(nextValue);
                      updateForm({
                        employee_name: nextValue,
                        employee_no: null,
                        employee_dept: '',
                      });
                    }}
                    onChange={(_, value) => {
                      const option = toOwnerOption(value);
                      if (!option?.owner_no) return;
                      updateForm({
                        employee_name: option.owner_display_name || '',
                        employee_no: option.owner_no,
                        employee_dept: option.owner_dept || '',
                      });
                      onEmployeeSelect(option.owner_display_name || '');
                    }}
                    getOptionLabel={(option) => {
                      const mapped = toOwnerOption(option);
                      if (!mapped.owner_display_name) return '';
                      return mapped.owner_dept
                        ? `${mapped.owner_display_name} (${mapped.owner_dept})`
                        : mapped.owner_display_name;
                    }}
                    isOptionEqualToValue={(option, value) =>
                      toNumberOrNull(option?.OWNER_NO ?? option?.owner_no) ===
                      toNumberOrNull(value?.OWNER_NO ?? value?.owner_no)
                    }
                    noOptionsText="Сотрудники не найдены"
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Сотрудник *"
                        placeholder="Выберите из списка или введите вручную"
                        size={fieldSize}
                      />
                    )}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <FormControl size={fieldSize} fullWidth required>
                    <InputLabel id="add-equipment-branch-label">Филиал *</InputLabel>
                    <Select
                      labelId="add-equipment-branch-label"
                      id="add-equipment-branch"
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
                    <InputLabel id="add-equipment-type-label">Тип оборудования *</InputLabel>
                    <Select
                      labelId="add-equipment-type-label"
                      id="add-equipment-type"
                      label="Тип оборудования *"
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
                <Grid item xs={12}>
                  <FormControl size={fieldSize} fullWidth required>
                    <InputLabel id="add-equipment-status-label">Статус *</InputLabel>
                    <Select
                      labelId="add-equipment-status-label"
                      id="add-equipment-status"
                      label="Статус *"
                      value={form?.status_no || ''}
                      onChange={(event) => updateForm({ status_no: String(event.target.value || '') })}
                    >
                      <MenuItem value="">
                        <em>Выберите статус</em>
                      </MenuItem>
                      {statusOptions.map((status) => (
                        <MenuItem key={status.status_no} value={String(status.status_no)}>
                          {status.status_name}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
              </Grid>
            </Box>
          </Fade>

          <Fade in={open} timeout={420}>
            <Box
              sx={getOfficeSubtlePanelSx(ui, {
                p: 1.5,
                borderRadius: 1,
                bgcolor: ui?.panelBg,
                transition: 'transform 220ms ease, border-color 220ms ease, background-color 220ms ease',
                '&:hover': {
                  transform: 'translateY(-1px)',
                  borderColor: ui?.borderStrong,
                  bgcolor: ui?.panelInset,
                  boxShadow: 'none',
                },
              })}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Chip size="small" color="secondary" label="Вручную" />
                <Typography variant="subtitle2">Серийный номер и модель обязательны</Typography>
              </Box>
              <Typography variant="caption" color="text.secondary">
                Инвентарный номер генерируется автоматически при сохранении.
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={12} md={6}>
                  <TextField
                    label="Серийный номер *"
                    value={form?.serial_number || ''}
                    onChange={(event) => updateForm({ serial_number: event.target.value })}
                    size={fieldSize}
                    fullWidth
                    required
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    label="Парт-номер (PART_NO)"
                    value={form?.part_no || ''}
                    onChange={(event) => updateForm({ part_no: event.target.value }, { clearError: false })}
                    size={fieldSize}
                    fullWidth
                  />
                </Grid>
                <Grid item xs={12} md={6}>
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
                <Grid item xs={12} md={6}>
                  <TextField
                    label="IP-адрес"
                    value={form?.ip_address || ''}
                    onChange={(event) => updateForm({ ip_address: event.target.value }, { clearError: false })}
                    size={fieldSize}
                    fullWidth
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    label="Описание"
                    value={form?.description || ''}
                    onChange={(event) => updateForm({ description: event.target.value }, { clearError: false })}
                    size={fieldSize}
                    fullWidth
                    multiline
                    minRows={3}
                  />
                </Grid>
              </Grid>
              <Collapse in={usesManualEmployee} timeout={220}>
                <Alert severity="info" sx={{ mt: 1.5 }}>
                  Сотрудник {form?.employee_name} не найден в списке и будет создан автоматически.
                </Alert>
              </Collapse>
              <Collapse in={usesManualModel} timeout={260}>
                <Alert severity="info" sx={{ mt: 1.5 }}>
                  Модель {form?.model_name} не найдена в списке и будет создана автоматически.
                </Alert>
              </Collapse>
            </Box>
          </Fade>

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
          sx={{
            transition: 'transform 180ms ease, background-color 180ms ease',
            boxShadow: 'none',
            '&:hover': { transform: 'translateY(-1px)', boxShadow: 'none' },
          }}
        >
          {loading ? 'Сохранение...' : 'Добавить'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default AddEquipmentDialog;
