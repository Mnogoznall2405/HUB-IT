import { memo, useCallback, useMemo } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  IconButton,
  Paper,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CloseIcon from '@mui/icons-material/Close';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';

import { LoadingSpinner, StatusChip } from '../../components/common';
import { readFirst, toIdOrNull, toNumberOrNull } from './databaseRecordModel';
import { getItemCapabilityFlags } from './equipmentModel';
import EquipmentDetailActsPanel from './EquipmentDetailActsPanel';
import EquipmentDetailHistoryPanel from './EquipmentDetailHistoryPanel';
import EquipmentDetailPhotosPanel from './EquipmentDetailPhotosPanel';
import EquipmentDetailWarehouse1CTab from './EquipmentDetailWarehouse1CTab';
import EmployeeNameLink from './EmployeeNameLink';
import LocationAutocompleteField from './LocationAutocompleteField';

const EDIT_PICKER_OVERLAY_SX = {
  zIndex: (theme) => `${theme.zIndex.modal + 3} !important`,
};

const EDIT_POPPER_SLOT_PROPS = { popper: { sx: EDIT_PICKER_OVERLAY_SX } };
const SHRUNK_LABEL_PROPS = { shrink: true };

const getOptionByNumber = (options, field, value) => {
  const numberValue = toNumberOrNull(value);
  return (options || []).find((option) => toNumberOrNull(option?.[field]) === numberValue);
};

// Searchable replacement for MUI Select: type to filter, pick with mouse or Enter.
const SearchField = memo(function SearchField({
  id,
  label,
  options,
  value,
  getKey,
  getLabel,
  onChange,
  size = 'small',
  disabled = false,
  loading = false,
  placeholder = 'Начните вводить для поиска',
  helperText = undefined,
}) {
  const selected = useMemo(
    () => (options || []).find((option) => String(getKey(option)) === String(value ?? '')) || null,
    [options, value, getKey],
  );

  // Stable callbacks: MUI resets the typed text whenever these identities change.
  const optionLabel = useCallback((option) => String(getLabel(option) ?? ''), [getLabel]);
  const sameOption = useCallback(
    (option, current) => String(getKey(option)) === String(getKey(current)),
    [getKey],
  );

  return (
    <Autocomplete
      id={id}
      fullWidth
      size={size}
      options={options || []}
      value={selected}
      disabled={disabled}
      loading={loading}
      disableClearable
      autoHighlight
      getOptionLabel={optionLabel}
      isOptionEqualToValue={sameOption}
      onChange={(_, next) => { if (next) onChange(next); }}
      noOptionsText="Ничего не найдено"
      loadingText="Загрузка..."
      slotProps={EDIT_POPPER_SLOT_PROPS}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={placeholder}
          helperText={helperText}
          InputLabelProps={{ ...params.InputLabelProps, ...SHRUNK_LABEL_PROPS }}
        />
      )}
    />
  );
});

const getStatusKey = (status) => status.status_no;
const getStatusLabel = (status) => status.status_name;
const getTypeKey = (type) => type.type_no;
const getTypeLabel = (type) => type.type_name;
const getModelKey = (model) => model.model_no;
const getModelLabel = (model) => model.model_name;
const getBranchKey = (branch) => branch.branch_no;
const getBranchLabel = (branch) => branch.branch_name;

function ReadOnlyField({ label, value, size = 'small', helperText = undefined }) {
  return (
    <TextField
      fullWidth
      size={size}
      label={label}
      value={value || '-'}
      helperText={helperText}
      InputLabelProps={SHRUNK_LABEL_PROPS}
      InputProps={{ readOnly: true }}
      sx={{ '& .MuiInputBase-input': { color: 'text.secondary' } }}
    />
  );
}

function ViewValue({ label, children }) {
  return (
    <>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="body2" component="div">{children}</Typography>
    </>
  );
}

const EquipmentDetailGeneralTab = memo(function EquipmentDetailGeneralTab({
  data,
  form,
  editMode = false,
  isMobile = false,
  options = {},
  onFormPatch,
  onOpenEmployee = null,
}) {
  const {
    statuses = [],
    types = [],
    models = [],
    modelsLoading = false,
    branches = [],
    locations = [],
    locationsLoading = false,
    showAllLocations = false,
    onShowAllLocationsChange = null,
  } = options;
  const fieldSize = isMobile ? 'medium' : 'small';
  const vendorName = readFirst(data, ['VENDOR_NAME', 'vendor_name', 'MANUFACTURER', 'manufacturer'], '-');

  const textField = (label, name) => (
    <TextField
      fullWidth
      size={fieldSize}
      label={label}
      value={form[name] ?? ''}
      onChange={(event) => onFormPatch?.({ [name]: event.target.value })}
      InputLabelProps={SHRUNK_LABEL_PROPS}
    />
  );

  const employeeBlock = (
    <>
      <Typography variant="caption" color="text.secondary">Сотрудник</Typography>
      <EmployeeNameLink
        name={form.employee_name || '-'}
        ownerNo={form.empl_no}
        onOpenEmployee={onOpenEmployee}
        variant="body2"
      />
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        Отдел: {form.employee_dept || '-'}
      </Typography>
      {editMode ? (
        <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 0.5 }}>
          Изменение сотрудника доступно только через операцию «Перемещение».
        </Typography>
      ) : null}
    </>
  );

  return (
    <>
      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <Chip label={`Инв. № ${readFirst(data, ['INV_NO', 'inv_no'], '-')}`} size="small" />
          <Chip label={`ID ${readFirst(data, ['ID', 'id'], '-')}`} size="small" variant="outlined" />
          {!editMode ? (
            <StatusChip
              status={readFirst(data, ['DESCR', 'status_name', 'status'], '-')}
              size="small"
            />
          ) : (
            <Box sx={{ width: { xs: '100%', sm: 260 } }}>
              <SearchField
                id="equipment-detail-status"
                label="Статус"
                options={statuses}
                value={form.status_no}
                getKey={getStatusKey}
                getLabel={getStatusLabel}
                size={fieldSize}
                onChange={(status) => onFormPatch?.({ status_no: toNumberOrNull(status.status_no) })}
              />
            </Box>
          )}
          <Chip label={form.branch_name || 'Филиал не указан'} size="small" variant="outlined" />
          <Chip label={form.location_name || 'Местоположение не указано'} size="small" variant="outlined" />
        </Box>
      </Paper>

      <Grid container spacing={1.5}>
        <Grid item xs={12} lg={7}>
          <Paper variant="outlined" sx={{ p: 1.5, height: '100%' }}>
            <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600 }}>
              Идентификация
            </Typography>
            {editMode ? (
              <>
                <Grid container spacing={1.5}>
                  <Grid item xs={12} sm={6}>
                    <SearchField
                      id="equipment-detail-type"
                      label="Тип оборудования"
                      options={types}
                      value={form.type_no}
                      getKey={getTypeKey}
                      getLabel={getTypeLabel}
                      size={fieldSize}
                      onChange={(type) => {
                        const typeNo = toNumberOrNull(type.type_no);
                        onFormPatch?.({
                          type_no: typeNo,
                          type_name: type.type_name || '',
                          model_no: null,
                          model_name: '',
                        });
                      }}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <SearchField
                      id="equipment-detail-model"
                      label="Модель"
                      options={models}
                      value={form.model_no}
                      getKey={getModelKey}
                      getLabel={getModelLabel}
                      size={fieldSize}
                      disabled={!form.type_no}
                      loading={modelsLoading}
                      placeholder={form.type_no ? 'Начните вводить для поиска' : 'Сначала выберите тип'}
                      onChange={(model) => onFormPatch?.({
                        model_no: toNumberOrNull(model.model_no),
                        model_name: model.model_name || '',
                      })}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <ReadOnlyField label="Производитель" value={vendorName === '-' ? '' : vendorName} size={fieldSize} />
                  </Grid>
                  <Grid item xs={12} sm={6}>{textField('Part Number', 'part_no')}</Grid>
                  <Grid item xs={12} sm={6}>{textField('Серийный номер', 'serial_no')}</Grid>
                  <Grid item xs={12} sm={6}>{textField('Аппаратный серийный номер', 'hw_serial_no')}</Grid>
                </Grid>

                <Typography variant="subtitle2" sx={{ mt: 2.5, mb: 1.5, fontWeight: 600 }}>
                  Сеть
                </Typography>
                <Grid container spacing={1.5}>
                  <Grid item xs={12} sm={6}>{textField('IP-адрес', 'ip_address')}</Grid>
                  <Grid item xs={12} sm={6}>{textField('MAC-адрес', 'mac_address')}</Grid>
                  <Grid item xs={12} sm={6}>{textField('Имя компьютера', 'network_name')}</Grid>
                  <Grid item xs={12} sm={6}>
                    <ReadOnlyField label="Домен" value={form.domain_name} size={fieldSize} />
                  </Grid>
                </Grid>
              </>
            ) : (
              <Grid container spacing={1.25}>
                <Grid item xs={12} sm={6}><ViewValue label="Тип оборудования">{form.type_name || '-'}</ViewValue></Grid>
                <Grid item xs={12} sm={6}><ViewValue label="Модель">{form.model_name || '-'}</ViewValue></Grid>
                <Grid item xs={12} sm={6}><ViewValue label="Производитель">{vendorName}</ViewValue></Grid>
                <Grid item xs={12} sm={6}>
                  <ViewValue label="Серийный номер">{readFirst(data, ['SERIAL_NO', 'serial_no'], '-')}</ViewValue>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <ViewValue label="HW серийный номер">{readFirst(data, ['HW_SERIAL_NO', 'hw_serial_no'], '-')}</ViewValue>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <ViewValue label="Part Number">{readFirst(data, ['PART_NO', 'part_no'], '-')}</ViewValue>
                </Grid>
                <Grid item xs={12} sm={6}><ViewValue label="IP-адрес">{form.ip_address || '-'}</ViewValue></Grid>
                <Grid item xs={12} sm={6}><ViewValue label="MAC-адрес">{form.mac_address || '-'}</ViewValue></Grid>
                <Grid item xs={12} sm={6}>
                  <ViewValue label="Имя компьютера">{form.network_name || form.domain_name || '-'}</ViewValue>
                </Grid>
                <Grid item xs={12} sm={6}><ViewValue label="Домен">{form.domain_name || '-'}</ViewValue></Grid>
              </Grid>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12} lg={5}>
          <Paper variant="outlined" sx={{ p: 1.5, height: '100%' }}>
            <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600 }}>
              Назначение
            </Typography>
            {editMode ? (
              <Grid container spacing={1.5}>
                <Grid item xs={12}>{employeeBlock}</Grid>
                <Grid item xs={12}>
                  <SearchField
                    id="equipment-detail-branch"
                    label="Филиал"
                    options={branches}
                    value={form.branch_no}
                    getKey={getBranchKey}
                    getLabel={getBranchLabel}
                    size={fieldSize}
                    onChange={(branch) => {
                      const branchNo = toIdOrNull(branch.branch_no);
                      // The room list is per branch, so the old room no longer applies.
                      onFormPatch?.({
                        branch_no: branchNo,
                        branch_name: branch.branch_name || '',
                        ...(String(branchNo) !== String(form.branch_no ?? '')
                          ? { loc_no: null, location_name: '' }
                          : {}),
                      });
                    }}
                  />
                </Grid>
                <Grid item xs={12}>
                  <LocationAutocompleteField
                    label="Местоположение"
                    value={form.loc_no ?? ''}
                    options={locations}
                    disabled={!form.branch_no}
                    loading={locationsLoading}
                    popperSx={EDIT_PICKER_OVERLAY_SX}
                    size={fieldSize}
                    hasBranch={Boolean(form.branch_no)}
                    branchName={form.branch_name}
                    showAll={showAllLocations}
                    onShowAllChange={typeof onShowAllLocationsChange === 'function' ? onShowAllLocationsChange : null}
                    onChange={(locNo) => {
                      const locationNo = toIdOrNull(locNo);
                      const selectedLocation = getOptionByNumber(locations, 'loc_no', locationNo);
                      onFormPatch?.({
                        loc_no: locationNo,
                        location_name: selectedLocation?.loc_name || '',
                      });
                    }}
                  />
                </Grid>
              </Grid>
            ) : (
              <Grid container spacing={1.25}>
                <Grid item xs={12} sm={6}>{employeeBlock}</Grid>
                <Grid item xs={12} sm={6}><ViewValue label="Филиал">{form.branch_name || '-'}</ViewValue></Grid>
                <Grid item xs={12}><ViewValue label="Местоположение">{form.location_name || '-'}</ViewValue></Grid>
              </Grid>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12}>
          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600 }}>
              Описание
            </Typography>
            {editMode ? (
              <TextField
                fullWidth
                multiline
                minRows={3}
                maxRows={10}
                label="Описание"
                value={form.description}
                onChange={(event) => onFormPatch?.({ description: event.target.value })}
                InputLabelProps={SHRUNK_LABEL_PROPS}
              />
            ) : (
              <Typography
                variant="body2"
                sx={{
                  whiteSpace: 'pre-wrap',
                  maxHeight: 140,
                  overflowY: 'auto',
                  pr: 0.5,
                }}
              >
                {form.description || 'Описание отсутствует'}
              </Typography>
            )}
          </Paper>
        </Grid>
      </Grid>
    </>
  );
});

const EquipmentDetailDialog = memo(function EquipmentDetailDialog({
  open = false,
  loading = false,
  data = null,
  form = null,
  tab = 'general',
  editMode = false,
  saving = false,
  hasChanges = false,
  canWrite = false,
  canViewWarehouse1C = false,
  isMobile = false,
  messages = {},
  options = {},
  acts = {},
  history = {},
  onClose,
  onBack = null,
  onKeyDown,
  onTabChange,
  onFormPatch,
  onClearError,
  onClearSuccess,
  onClearActsError,
  onClearHistoryError,
  onStartEdit,
  onCancel,
  onSave,
  onOpenQr,
  onOpenActFields,
  onOpenActFile,
  onPhotoCountChange = null,
  onScanNextPhoto = null,
  photoQueue = null,
  formatDate,
  formatHistoryValue,
  formatHistoryTransition,
  onOpenEmployee = null,
  onConsumeConsumableQr = null,
  buildWarehouseReturnContext = null,
  disableEnforceFocus = false,
  stackAboveParent = false,
}) {
  const showGeneralActions = Boolean(data) && tab === 'general';
  const detailIsPrinterOrMfu = Boolean(data) && getItemCapabilityFlags(data).isPrinterOrMfu;

  const renderTabContent = () => (
    <>
      <Box sx={{ display: tab === 'general' ? 'block' : 'none' }}>
        <EquipmentDetailGeneralTab
          data={data}
          form={form}
          editMode={editMode}
          isMobile={isMobile}
          options={options}
          onFormPatch={onFormPatch}
          onOpenEmployee={onOpenEmployee}
        />
      </Box>
      <Box sx={{ display: tab === 'acts' ? 'block' : 'none' }}>
        <EquipmentDetailActsPanel
          acts={acts.items}
          error={messages.actsError}
          loading={acts.loading}
          openingDocNo={acts.openingDocNo}
          onErrorClose={onClearActsError}
          onOpenFields={onOpenActFields}
          onOpenFile={onOpenActFile}
          formatDate={formatDate}
        />
      </Box>
      <Box sx={{ display: tab === 'photos' ? 'block' : 'none' }}>
        <EquipmentDetailPhotosPanel
          itemId={toNumberOrNull(readFirst(data, ['ID', 'id'], null))}
          active={open && tab === 'photos'}
          canWrite={canWrite && !editMode}
          onCountChange={onPhotoCountChange}
          onScanNext={onScanNextPhoto}
          queue={photoQueue}
        />
      </Box>
      <Box sx={{ display: tab === 'history' ? 'block' : 'none' }}>
        <EquipmentDetailHistoryPanel
          history={history.items}
          error={messages.historyError}
          loading={history.loading}
          isMobile={isMobile}
          onErrorClose={onClearHistoryError}
          formatDate={formatDate}
          formatHistoryValue={formatHistoryValue}
          formatHistoryTransition={formatHistoryTransition}
        />
      </Box>
      {canViewWarehouse1C ? (
        <Box sx={{ display: tab === 'warehouse1c' ? 'block' : 'none' }}>
          <EquipmentDetailWarehouse1CTab
            data={data}
            active={open && tab === 'warehouse1c'}
            detailLoading={loading}
            buildReturnContext={buildWarehouseReturnContext}
            onOpenEmployee={onOpenEmployee}
          />
        </Box>
      ) : null}
    </>
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      fullScreen={isMobile}
      scroll="paper"
      disableEnforceFocus={disableEnforceFocus}
      sx={{
        ...(stackAboveParent ? {
          zIndex: (theme) => `${theme.zIndex.modal + 2} !important`,
        } : {}),
        '& .MuiDialog-paper': {
          height: isMobile ? '100%' : '88vh',
          maxHeight: isMobile ? '100%' : '88vh',
        },
      }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.5 }}>
        {typeof onBack === 'function' ? (
          <Button
            type="button"
            color="inherit"
            size="small"
            startIcon={<ArrowBackIcon />}
            onClick={onBack}
            sx={{ flexShrink: 0 }}
          >
            Назад
          </Button>
        ) : null}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography component="span" variant="h6">
            {readFirst(data, ['MODEL_NAME', 'model_name'], 'Карточка оборудования')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Инв. № {readFirst(data, ['INV_NO', 'inv_no'], '-')} | ID {readFirst(data, ['ID', 'id'], '-')}
          </Typography>
        </Box>
        <IconButton aria-label="Закрыть карточку оборудования" onClick={onClose} edge="end">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <Divider />
      <DialogContent sx={{ p: { xs: 1.5, md: 2 } }} onKeyDown={onKeyDown}>
        {loading ? (
          <LoadingSpinner message="Загрузка..." />
        ) : data && form ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {messages.error && (
              <Alert severity="error" onClose={onClearError}>
                {messages.error}
              </Alert>
            )}
            {messages.success && !editMode && (
              <Alert severity="success" onClose={onClearSuccess}>
                {messages.success}
              </Alert>
            )}

            <Paper variant="outlined" sx={{ p: 0.5 }}>
              <Tabs
                value={tab}
                onChange={(_, value) => onTabChange?.(value)}
                variant="fullWidth"
              >
                <Tab label="Общее" value="general" />
                <Tab label="Текущий акт" value="acts" disabled={editMode} />
                <Tab label="Фото" value="photos" disabled={editMode} />
                <Tab label="История перемещений" value="history" disabled={editMode} />
                {canViewWarehouse1C ? (
                  <Tab label="1С" value="warehouse1c" disabled={editMode} />
                ) : null}
              </Tabs>
            </Paper>

            {renderTabContent()}
          </Box>
        ) : (
          <Typography color="error">Ошибка загрузки данных</Typography>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 2, justifyContent: 'flex-end', gap: 1 }}>
        {showGeneralActions && canWrite && (
          editMode ? (
            <>
              <Button onClick={onCancel} variant="outlined" disabled={saving}>
                Отмена
              </Button>
              <Button onClick={onSave} variant="contained" disabled={saving || !hasChanges}>
                {saving ? 'Сохранение...' : 'Сохранить'}
              </Button>
            </>
          ) : (
            <Button onClick={onStartEdit} variant="contained">
              Редактировать
            </Button>
          )
        )}
        {showGeneralActions && !editMode && canWrite && detailIsPrinterOrMfu && onConsumeConsumableQr ? (
          <Button
            onClick={onConsumeConsumableQr}
            variant="outlined"
            startIcon={<QrCodeScannerIcon />}
          >
            Списать расходник
          </Button>
        ) : null}
        {showGeneralActions && !editMode && (
          <Button
            onClick={onOpenQr}
            variant="outlined"
            startIcon={<QrCode2Icon />}
          >
            Создать QR-code
          </Button>
        )}
        <Button onClick={onClose} variant="outlined">
          Закрыть
        </Button>
      </DialogActions>
    </Dialog>
  );
});

export default EquipmentDetailDialog;
