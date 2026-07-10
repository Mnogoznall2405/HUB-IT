import { memo } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import QrCode2Icon from '@mui/icons-material/QrCode2';

import { LoadingSpinner, StatusChip } from '../../components/common';
import { readFirst, toIdOrNull, toNumberOrNull } from './databaseRecordModel';
import EquipmentDetailActsPanel from './EquipmentDetailActsPanel';
import EquipmentDetailHistoryPanel from './EquipmentDetailHistoryPanel';
import EquipmentDetailWarehouse1CTab from './EquipmentDetailWarehouse1CTab';
import EmployeeNameLink from './EmployeeNameLink';
import LocationAutocompleteField from './LocationAutocompleteField';

const getOptionByNumber = (options, field, value) => {
  const numberValue = toNumberOrNull(value);
  return (options || []).find((option) => toNumberOrNull(option?.[field]) === numberValue);
};

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
  } = options;

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
            <FormControl size="small" sx={{ minWidth: 220 }}>
              <InputLabel id="equipment-detail-status-label">Статус</InputLabel>
              <Select
                labelId="equipment-detail-status-label"
                id="equipment-detail-status"
                value={form.status_no ?? ''}
                onChange={(event) => onFormPatch?.({ status_no: toNumberOrNull(event.target.value) })}
                label="Статус"
              >
                {statuses.map((status) => (
                  <MenuItem key={status.status_no} value={status.status_no}>
                    {status.status_name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
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
            <Grid container spacing={1.25}>
              <Grid item xs={12} sm={editMode ? 12 : 6}>
                {editMode ? (
                  <FormControl fullWidth size={isMobile ? 'medium' : 'small'}>
                    <InputLabel id="equipment-detail-type-label">Тип оборудования</InputLabel>
                    <Select
                      labelId="equipment-detail-type-label"
                      id="equipment-detail-type"
                      value={form.type_no ?? ''}
                      label="Тип оборудования"
                      onChange={(event) => {
                        const typeNo = toNumberOrNull(event.target.value);
                        const selectedType = getOptionByNumber(types, 'type_no', typeNo);
                        onFormPatch?.({
                          type_no: typeNo,
                          type_name: selectedType?.type_name || '',
                          model_no: null,
                          model_name: '',
                        });
                      }}
                    >
                      {types.map((type) => (
                        <MenuItem key={type.type_no} value={type.type_no}>
                          {type.type_name}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                ) : (
                  <>
                    <Typography variant="caption" color="text.secondary">Тип оборудования</Typography>
                    <Typography variant="body2">{form.type_name || '-'}</Typography>
                  </>
                )}
              </Grid>
              <Grid item xs={12} sm={editMode ? 12 : 6}>
                {editMode ? (
                  <FormControl
                    fullWidth
                    size={isMobile ? 'medium' : 'small'}
                    disabled={!form.type_no || modelsLoading}
                  >
                    <InputLabel id="equipment-detail-model-label">Модель</InputLabel>
                    <Select
                      labelId="equipment-detail-model-label"
                      id="equipment-detail-model"
                      value={form.model_no ?? ''}
                      label="Модель"
                      onChange={(event) => {
                        const modelNo = toNumberOrNull(event.target.value);
                        const selectedModel = getOptionByNumber(models, 'model_no', modelNo);
                        onFormPatch?.({
                          model_no: modelNo,
                          model_name: selectedModel?.model_name || '',
                        });
                      }}
                    >
                      {models.map((model) => (
                        <MenuItem key={model.model_no} value={model.model_no}>
                          {model.model_name}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                ) : (
                  <>
                    <Typography variant="caption" color="text.secondary">Модель</Typography>
                    <Typography variant="body2">{form.model_name || '-'}</Typography>
                  </>
                )}
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="caption" color="text.secondary">Производитель</Typography>
                <Typography variant="body2">
                  {readFirst(data, ['VENDOR_NAME', 'vendor_name', 'MANUFACTURER', 'manufacturer'], '-')}
                </Typography>
              </Grid>
              <Grid item xs={12} sm={editMode ? 12 : 6}>
                {editMode ? (
                  <TextField
                    fullWidth
                    size={isMobile ? 'medium' : 'small'}
                    label="Серийный номер"
                    value={form.serial_no}
                    onChange={(event) => onFormPatch?.({ serial_no: event.target.value })}
                  />
                ) : (
                  <>
                    <Typography variant="caption" color="text.secondary">Серийный номер</Typography>
                    <Typography variant="body2">{readFirst(data, ['SERIAL_NO', 'serial_no'], '-')}</Typography>
                  </>
                )}
              </Grid>
              <Grid item xs={12} sm={editMode ? 12 : 6}>
                {editMode ? (
                  <TextField
                    fullWidth
                    size={isMobile ? 'medium' : 'small'}
                    label="Аппаратный серийный номер"
                    value={form.hw_serial_no}
                    onChange={(event) => onFormPatch?.({ hw_serial_no: event.target.value })}
                  />
                ) : (
                  <>
                    <Typography variant="caption" color="text.secondary">HW серийный номер</Typography>
                    <Typography variant="body2">{readFirst(data, ['HW_SERIAL_NO', 'hw_serial_no'], '-')}</Typography>
                  </>
                )}
              </Grid>
              <Grid item xs={12} sm={editMode ? 12 : 6}>
                {editMode ? (
                  <TextField
                    fullWidth
                    size={isMobile ? 'medium' : 'small'}
                    label="Part Number"
                    value={form.part_no}
                    onChange={(event) => onFormPatch?.({ part_no: event.target.value })}
                  />
                ) : (
                  <>
                    <Typography variant="caption" color="text.secondary">Part Number</Typography>
                    <Typography variant="body2">{readFirst(data, ['PART_NO', 'part_no'], '-')}</Typography>
                  </>
                )}
              </Grid>
              <Grid item xs={12} sm={editMode ? 12 : 6}>
                {editMode ? (
                  <TextField
                    fullWidth
                    size={isMobile ? 'medium' : 'small'}
                    label="IP-адрес"
                    value={form.ip_address}
                    onChange={(event) => onFormPatch?.({ ip_address: event.target.value })}
                  />
                ) : (
                  <>
                    <Typography variant="caption" color="text.secondary">IP-адрес</Typography>
                    <Typography variant="body2">{form.ip_address || '-'}</Typography>
                  </>
                )}
              </Grid>
              <Grid item xs={12} sm={editMode ? 12 : 6}>
                {editMode ? (
                  <TextField
                    fullWidth
                    size={isMobile ? 'medium' : 'small'}
                    label="MAC-адрес"
                    value={form.mac_address}
                    onChange={(event) => onFormPatch?.({ mac_address: event.target.value })}
                  />
                ) : (
                  <>
                    <Typography variant="caption" color="text.secondary">MAC-адрес</Typography>
                    <Typography variant="body2">{form.mac_address || '-'}</Typography>
                  </>
                )}
              </Grid>
              <Grid item xs={12} sm={editMode ? 12 : 6}>
                {editMode ? (
                  <TextField
                    fullWidth
                    size={isMobile ? 'medium' : 'small'}
                    label="Имя компьютера"
                    value={form.network_name}
                    onChange={(event) => onFormPatch?.({ network_name: event.target.value })}
                  />
                ) : (
                  <>
                    <Typography variant="caption" color="text.secondary">Имя компьютера</Typography>
                    <Typography variant="body2">{form.network_name || form.domain_name || '-'}</Typography>
                  </>
                )}
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="caption" color="text.secondary">Домен</Typography>
                <Typography variant="body2">{form.domain_name || '-'}</Typography>
              </Grid>
            </Grid>
          </Paper>
        </Grid>

        <Grid item xs={12} lg={5}>
          <Paper variant="outlined" sx={{ p: 1.5, height: '100%' }}>
            <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600 }}>
              Назначение
            </Typography>
            <Grid container spacing={1.25}>
              <Grid item xs={12} sm={editMode ? 12 : 6}>
                <Typography variant="caption" color="text.secondary">Сотрудник</Typography>
                <EmployeeNameLink
                  name={form.employee_name || '-'}
                  ownerNo={form.empl_no}
                  onOpenEmployee={onOpenEmployee}
                  variant="body2"
                />
                <Typography variant="caption" color="text.secondary">
                  Отдел: {form.employee_dept || '-'}
                </Typography>
                <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 0.5 }}>
                  Изменение сотрудника доступно только через операцию «Перемещение».
                </Typography>
              </Grid>

              <Grid item xs={12} sm={editMode ? 12 : 6}>
                {editMode ? (
                  <FormControl fullWidth size={isMobile ? 'medium' : 'small'}>
                    <InputLabel id="equipment-detail-branch-label">Филиал</InputLabel>
                    <Select
                      labelId="equipment-detail-branch-label"
                      id="equipment-detail-branch"
                      value={form.branch_no ?? ''}
                      label="Филиал"
                      onChange={(event) => {
                        const branchNo = toIdOrNull(event.target.value);
                        const selectedBranchOption = getOptionByNumber(branches, 'branch_no', branchNo);
                        onFormPatch?.({
                          branch_no: branchNo,
                          branch_name: selectedBranchOption?.branch_name || '',
                        });
                      }}
                    >
                      {branches.map((branch) => (
                        <MenuItem key={branch.branch_no} value={branch.branch_no}>
                          {branch.branch_name}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                ) : (
                  <>
                    <Typography variant="caption" color="text.secondary">Филиал</Typography>
                    <Typography variant="body2">{form.branch_name || '-'}</Typography>
                  </>
                )}
              </Grid>

              <Grid item xs={12}>
                {editMode ? (
                  <LocationAutocompleteField
                    label="Местоположение"
                    value={form.loc_no ?? ''}
                    options={locations}
                    size={isMobile ? 'medium' : 'small'}
                    onChange={(locNo) => {
                      const locationNo = toIdOrNull(locNo);
                      const selectedLocation = getOptionByNumber(locations, 'loc_no', locationNo);
                      onFormPatch?.({
                        loc_no: locationNo,
                        location_name: selectedLocation?.loc_name || '',
                      });
                    }}
                  />
                ) : (
                  <>
                    <Typography variant="caption" color="text.secondary">Местоположение</Typography>
                    <Typography variant="body2">{form.location_name || '-'}</Typography>
                  </>
                )}
              </Grid>
            </Grid>
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
                minRows={4}
                maxRows={10}
                label="Описание"
                value={form.description}
                onChange={(event) => onFormPatch?.({ description: event.target.value })}
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
  formatDate,
  formatHistoryValue,
  formatHistoryTransition,
  onOpenEmployee = null,
  buildWarehouseReturnContext = null,
}) {
  const showGeneralActions = Boolean(data) && tab === 'general';

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
      sx={{
        '& .MuiDialog-paper': {
          height: isMobile ? '100%' : '88vh',
          maxHeight: isMobile ? '100%' : '88vh',
        },
      }}
    >
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 2, py: 1.5 }}>
        <Box>
          <Typography component="span" variant="h6">
            {readFirst(data, ['MODEL_NAME', 'model_name'], 'Карточка оборудования')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Инв. № {readFirst(data, ['INV_NO', 'inv_no'], '-')} | ID {readFirst(data, ['ID', 'id'], '-')}
          </Typography>
        </Box>
        <IconButton onClick={onClose} edge="end">
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
