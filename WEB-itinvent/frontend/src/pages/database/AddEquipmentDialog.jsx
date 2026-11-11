import { useEffect, useRef } from 'react';
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
  Grid,
  TextField,
  Typography,
} from '@mui/material';

import { getOfficeSubtlePanelSx } from '../../theme/officeUiTokens';
import LocationAutocompleteField from './LocationAutocompleteField';
import { toIdOrNull, toNumberOrNull } from './databaseRecordModel';
import { formatMacInput, isMacComplete, toOwnerOption } from './detailModel';

const fieldSizeFor = (isMobile) => (isMobile ? 'medium' : 'small');

// Searchable single-choice field: type to filter, Enter picks the highlighted option.
function ChoiceField({ label, options, value, getKey, getLabel, onChange, size, required = true, noOptionsText }) {
  const selected = value === '' || value === null || value === undefined
    ? null
    : options.find((option) => String(getKey(option)) === String(value)) || null;
  return (
    <Autocomplete
      options={options}
      value={selected}
      autoHighlight
      openOnFocus
      noOptionsText={noOptionsText}
      getOptionLabel={(option) => String(getLabel(option) || '')}
      isOptionEqualToValue={(option, current) => String(getKey(option)) === String(getKey(current))}
      onChange={(_, option) => onChange(option)}
      renderInput={(params) => (
        <TextField {...params} label={required ? `${label} *` : label} size={size} />
      )}
    />
  );
}

function SectionPanel({ ui, title, hint, children }) {
  return (
    <Box
      sx={getOfficeSubtlePanelSx(ui, {
        p: 1.5,
        borderRadius: 1,
      })}
    >
      <Box sx={{ mb: 1.25 }}>
        <Typography variant="subtitle2">{title}</Typography>
        {hint ? (
          <Typography variant="caption" color="text.secondary">
            {hint}
          </Typography>
        ) : null}
      </Box>
      {children}
    </Box>
  );
}

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
  showAllLocations = false,
  onShowAllLocationsChange = null,
  typeOptions = [],
  statusOptions = [],
  modelOptions = [],
  modelsLoading = false,
  usesManualEmployee = false,
  usesManualModel = false,
  serialDuplicate = null,
  presets = [],
  onApplyPreset = null,
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
  const serialRef = useRef(null);
  const selectedModel = form?.model_no
    ? modelOptions.find((model) => model.model_no === form.model_no) || null
    : null;

  // After a successful save the shared fields stay filled: jump straight to the next serial number.
  useEffect(() => {
    if (open && success) serialRef.current?.focus();
  }, [open, success]);

  const updateForm = (patch, { clearError = true } = {}) => {
    onFormPatch(patch);
    if (clearError) onErrorClear();
  };

  // Enter in a single-line field saves, so a batch can be entered from the keyboard.
  const submitOnEnter = (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent?.isComposing) return;
    event.preventDefault();
    if (!loading && !serialDuplicate) onSubmit();
  };

  const presetLabel = (preset) => {
    const typeName = typeOptions.find((type) => String(type.type_no) === String(preset.type_no))?.type_name;
    const branchName = branchOptions.find((branch) => String(branch.branch_no) === String(preset.branch_no))?.branch_name;
    return [typeName, preset.model_name, branchName, preset.employee_name].filter(Boolean).join(' · ');
  };

  const macInvalid =Boolean(form?.mac_address) && !isMacComplete(form.mac_address);

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
          <Collapse in={Boolean(success)} timeout={220}>
            <Alert severity="success" variant="outlined">
              {success} Сотрудник, место, тип и модель сохранены: введите следующий серийный номер.
            </Alert>
          </Collapse>

          {onApplyPreset && presets.length > 0 ? (
            <Box>
              <Typography variant="caption" color="text.secondary">
                Как в прошлый раз (одним нажатием заполнит тип, модель, место и сотрудника):
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 0.5 }}>
                {presets.map((preset, index) => (
                  <Chip
                    key={`${index}-${presetLabel(preset)}`}
                    size="small"
                    variant="outlined"
                    label={presetLabel(preset)}
                    onClick={() => onApplyPreset(preset)}
                    sx={{ maxWidth: '100%' }}
                  />
                ))}
              </Box>
            </Box>
          ) : null}

          <SectionPanel ui={ui} title="Что добавляем" hint="Инвентарный номер присвоится автоматически при сохранении.">
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <ChoiceField
                  label="Тип оборудования"
                  options={typeOptions}
                  value={form?.type_no}
                  getKey={(type) => type.type_no}
                  getLabel={(type) => type.type_name}
                  size={fieldSize}
                  noOptionsText="Тип не найден"
                  onChange={(type) => {
                    updateForm({ type_no: type ? String(type.type_no) : '', model_name: '', model_no: null });
                    onModelsReset();
                  }}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <Autocomplete
                  freeSolo
                  autoHighlight
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
                      placeholder={form?.type_no ? 'Выберите из списка или введите новую' : 'Сначала выберите тип'}
                      size={fieldSize}
                      required
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  label="Серийный номер *"
                  value={form?.serial_number || ''}
                  onChange={(event) => updateForm({ serial_number: event.target.value })}
                  onKeyDown={submitOnEnter}
                  inputRef={serialRef}
                  color={serialDuplicate ? 'warning' : undefined}
                  helperText={serialDuplicate
                    ? `Уже в базе: инв. № ${serialDuplicate.inv_no || '—'}${serialDuplicate.model_name ? `, ${serialDuplicate.model_name}` : ''}${serialDuplicate.employee_name ? `, ${serialDuplicate.employee_name}` : ''} — повторно добавить нельзя`
                    : undefined}
                  FormHelperTextProps={serialDuplicate ? { sx: { color: 'warning.main' } } : undefined}
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
                  onKeyDown={submitOnEnter}
                  size={fieldSize}
                  fullWidth
                />
              </Grid>
            </Grid>
            <Collapse in={usesManualModel} timeout={260}>
              <Alert severity="info" sx={{ mt: 1.5 }}>
                Модель {form?.model_name} не найдена в списке и будет создана автоматически.
              </Alert>
            </Collapse>
          </SectionPanel>

          <SectionPanel ui={ui} title="Кому и где">
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <Autocomplete
                  options={employeeOptions}
                  loading={employeeLoading}
                  value={selectedEmployeeOption}
                  inputValue={employeeInput}
                  autoHighlight
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
                      placeholder="Начните вводить ФИО"
                      size={fieldSize}
                    />
                  )}
                />
                <Collapse in={usesManualEmployee} timeout={220}>
                  <Alert severity="info" sx={{ mt: 1 }}>
                    Сотрудник {form?.employee_name} не найден в списке и будет создан автоматически.
                  </Alert>
                </Collapse>
              </Grid>
              <Grid item xs={12} md={6}>
                <ChoiceField
                  label="Статус"
                  options={statusOptions}
                  value={form?.status_no}
                  getKey={(status) => status.status_no}
                  getLabel={(status) => status.status_name}
                  size={fieldSize}
                  noOptionsText="Статус не найден"
                  onChange={(status) => updateForm({ status_no: status ? String(status.status_no) : '' })}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <ChoiceField
                  label="Филиал"
                  options={branchOptions}
                  value={form?.branch_no}
                  getKey={(branch) => branch.branch_no}
                  getLabel={(branch) => branch.branch_name}
                  size={fieldSize}
                  noOptionsText="Филиал не найден"
                  onChange={(branch) => updateForm({ branch_no: branch ? toIdOrNull(branch.branch_no) || '' : '' })}
                />
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
                  hasBranch={Boolean(form?.branch_no)}
                  branchName={branchOptions.find((b) => String(b.branch_no) === String(form?.branch_no))?.branch_name}
                  showAll={showAllLocations}
                  onShowAllChange={onShowAllLocationsChange}
                  onChange={(locNo) => updateForm({ loc_no: toIdOrNull(locNo) || '' })}
                />
              </Grid>
            </Grid>
          </SectionPanel>

          <SectionPanel ui={ui} title="Сеть" hint="Необязательно: для ПК, принтеров, коммутаторов и другой сетевой техники.">
            <Grid container spacing={2}>
              <Grid item xs={12} md={4}>
                <TextField
                  label="IP-адрес"
                  placeholder="10.0.0.15"
                  value={form?.ip_address || ''}
                  onChange={(event) => updateForm({ ip_address: event.target.value }, { clearError: false })}
                  onKeyDown={submitOnEnter}
                  size={fieldSize}
                  fullWidth
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  label="MAC-адрес"
                  placeholder="AA:BB:CC:DD:EE:FF"
                  value={form?.mac_address || ''}
                  onChange={(event) => updateForm({ mac_address: formatMacInput(event.target.value) }, { clearError: false })}
                  onKeyDown={submitOnEnter}
                  error={macInvalid}
                  helperText={macInvalid ? 'Нужно 12 символов 0–9, A–F' : 'Можно вставить в любом формате'}
                  inputProps={{ autoCapitalize: 'characters', spellCheck: false }}
                  size={fieldSize}
                  fullWidth
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  label="Сетевое имя"
                  placeholder="PC-IT-015"
                  value={form?.network_name || ''}
                  onChange={(event) => updateForm({ network_name: event.target.value }, { clearError: false })}
                  onKeyDown={submitOnEnter}
                  size={fieldSize}
                  fullWidth
                />
              </Grid>
            </Grid>
          </SectionPanel>

          <TextField
            label="Описание"
            value={form?.description || ''}
            onChange={(event) => updateForm({ description: event.target.value }, { clearError: false })}
            size={fieldSize}
            fullWidth
            multiline
            minRows={2}
          />

          <Collapse in={Boolean(error)} timeout={220}>
            <Alert severity="error">{error}</Alert>
          </Collapse>
        </Box>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose} variant="outlined" disabled={loading}>
          {success ? 'Готово' : 'Закрыть'}
        </Button>
        <Button
          onClick={onSubmit}
          variant="contained"
          disabled={loading || Boolean(serialDuplicate)}
          sx={{ boxShadow: 'none', '&:hover': { boxShadow: 'none' } }}
        >
          {loading ? 'Сохранение...' : 'Добавить'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default AddEquipmentDialog;
