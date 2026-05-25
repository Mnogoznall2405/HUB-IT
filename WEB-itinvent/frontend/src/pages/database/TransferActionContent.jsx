import { memo } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';

import { getOfficeQuietActionSx, getOfficeSubtlePanelSx } from '../../theme/officeUiTokens';
import LocationAutocompleteField from './LocationAutocompleteField';
import {
  TRANSFER_OPERATION_ACT_ONLY,
  TRANSFER_OPERATION_LOCATION_ONLY,
  TRANSFER_OPERATION_MOVE,
} from './equipmentModel';
import {
  toTransferNumberOrNull,
  toTransferOwnerOption,
} from './transferModel';

export const formatTransferOwnerOptionLabel = (option, createLabel = '') => {
  if (option?.__create) {
    return createLabel;
  }
  const mapped = toTransferOwnerOption(option);
  if (!mapped.owner_display_name) return '';
  return mapped.owner_dept
    ? `${mapped.owner_display_name} (${mapped.owner_dept})`
    : mapped.owner_display_name;
};

export const isSameTransferOwnerOption = (option, value) =>
  toTransferNumberOrNull(option?.OWNER_NO ?? option?.owner_no) ===
  toTransferNumberOrNull(value?.OWNER_NO ?? value?.owner_no);

export const isTransferResultPending = (result) =>
  ['queued', 'processing'].includes(String(result?.job_status || '').toLowerCase());

export const getTransferResultSeverity = ({ result, jobPolling = false } = {}) => {
  if (String(result?.job_status || '').toLowerCase() === 'failed') return 'error';
  if (jobPolling || isTransferResultPending(result)) return 'info';
  if (Number(result?.failed_count || 0) > 0) return 'warning';
  return 'success';
};

export const isTransferEmailSendDisabled = ({
  canDatabaseWrite,
  emailLoading,
  jobPolling,
  result,
} = {}) => (
  !canDatabaseWrite ||
  emailLoading ||
  jobPolling ||
  isTransferResultPending(result) ||
  !Array.isArray(result?.acts) ||
  result.acts.length === 0
);

const TransferActionContent = memo(function TransferActionContent({
  isMobile = false,
  canDatabaseWrite = false,
  ui,
  theme,
  branchOptions = [],
  locationOptions = [],
  sourceDefaults = {},
  transfer = {},
  email = {},
  actions = {},
}) {
  const mode = transfer.mode || TRANSFER_OPERATION_MOVE;
  const result = transfer.result || null;
  const isActOnly = mode === TRANSFER_OPERATION_ACT_ONLY;
  const isLocationOnly = mode === TRANSFER_OPERATION_LOCATION_ONLY;
  const usesLocationFields = mode === TRANSFER_OPERATION_MOVE || isLocationOnly;
  const createLabel = `Добавить сотрудника: ${transfer.employeeInputTrimmed || ''}`;

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      {!result && (
        <>
          <FormControl size={isMobile ? 'medium' : 'small'} fullWidth>
            <InputLabel id="database-transfer-action-label">Действие</InputLabel>
            <Select
              labelId="database-transfer-action-label"
              id="database-transfer-action"
              label="Действие"
              value={mode}
              onChange={(event) => actions.onModeChange?.(event.target.value)}
            >
              <MenuItem
                value={TRANSFER_OPERATION_LOCATION_ONLY}
                title="Меняет только филиал и локацию в базе. Сотрудник и акты не меняются."
              >
                Перемещение
              </MenuItem>
              <MenuItem
                value={TRANSFER_OPERATION_MOVE}
                title="Меняет сотрудника/филиал/локацию, создаёт акт и напоминание на загрузку подписанного акта."
              >
                Перемещение с актом
              </MenuItem>
              <MenuItem
                value={TRANSFER_OPERATION_ACT_ONLY}
                title="Создаёт акт по выбранной технике без изменения данных в базе."
              >
                Акт без перемещения
              </MenuItem>
            </Select>
          </FormControl>
          <Typography variant="caption" color="text.secondary">
            {isActOnly
              ? 'Получатель в акте будет взят из текущего владельца выбранной техники.'
              : isLocationOnly
                ? `Будут изменены только филиал и местоположение. Текущие значения: ${sourceDefaults.branch_name || '-'} / ${sourceDefaults.location_name || '-'}`
              : `Текущие значения по умолчанию: ${sourceDefaults.branch_name || '-'} / ${sourceDefaults.location_name || '-'}`}
          </Typography>
          {usesLocationFields && (sourceDefaults.mixed_branch || sourceDefaults.mixed_location) && (
            <Alert severity="info">
              Выбраны позиции из разных филиалов или локаций. Указанные ниже значения будут применены ко всем выбранным позициям.
            </Alert>
          )}
          {!isLocationOnly && (
            <Autocomplete
              options={transfer.employeeOptions || []}
              loading={Boolean(transfer.employeeLoading)}
              value={transfer.selectedEmployeeOption || null}
              inputValue={transfer.employeeInput || ''}
              clearOnBlur={false}
              onInputChange={(_, value, reason) => {
                if (reason !== 'input' && reason !== 'clear') {
                  return;
                }
                actions.onEmployeeInputChange?.(String(value || ''));
              }}
              onChange={(_, value) => {
                if (value?.__create) {
                  actions.onCreateEmployee?.();
                  return;
                }
                actions.onEmployeeChange?.(value);
              }}
              getOptionLabel={(option) => formatTransferOwnerOptionLabel(option, createLabel)}
              renderOption={(props, option) => {
                const { key, ...restProps } = props;
                if (option?.__create) {
                  return (
                    <li key={key} {...restProps}>
                      <Button
                        variant="outlined"
                        size="small"
                        fullWidth
                        sx={{ pointerEvents: 'none', justifyContent: 'flex-start' }}
                      >
                        {createLabel}
                      </Button>
                    </li>
                  );
                }
                return (
                  <li key={key} {...restProps}>
                    {formatTransferOwnerOptionLabel(option)}
                  </li>
                );
              }}
              isOptionEqualToValue={isSameTransferOwnerOption}
              noOptionsText={
                isActOnly
                  ? 'Можно ввести вручную'
                  : 'Сотрудники не найдены'
              }
              renderInput={(params) => (
                <TextField
                  {...params}
                  autoFocus
                  label={isActOnly ? 'Кто выдал' : 'Новый сотрудник'}
                  placeholder="Начните вводить ФИО"
                  size={isMobile ? 'medium' : 'small'}
                  helperText={
                    isActOnly
                      ? 'Можно выбрать из списка или ввести вручную, например: Без владельца'
                      : 'Введите минимум 2 символа для поиска'
                  }
                />
              )}
            />
          )}
          {mode === TRANSFER_OPERATION_MOVE && transfer.usesManualEmployee && (
            <Alert severity="info">
              Сотрудник {transfer.newEmployee} будет создан автоматически при перемещении, если его нет в базе.
            </Alert>
          )}
          {mode === TRANSFER_OPERATION_MOVE && transfer.usesManualEmployee && (
            <FormControl
              size={isMobile ? 'medium' : 'small'}
              fullWidth
              required
              error={!transfer.department}
              disabled={Boolean(transfer.departmentLoading)}
            >
              <InputLabel>Отдел нового сотрудника</InputLabel>
              <Select
                label="Отдел нового сотрудника"
                value={transfer.department || ''}
                onChange={(event) => actions.onDepartmentChange?.(String(event.target.value || '').trim())}
              >
                <MenuItem value="">
                  <em>Выберите отдел</em>
                </MenuItem>
                {(transfer.departmentOptions || []).map((dept) => (
                  <MenuItem key={dept} value={dept}>
                    {dept}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
          {usesLocationFields && (
            <>
              <FormControl size={isMobile ? 'medium' : 'small'} fullWidth>
                <InputLabel id="database-transfer-branch-label">Филиал назначения</InputLabel>
                <Select
                  labelId="database-transfer-branch-label"
                  id="database-transfer-branch"
                  label="Филиал назначения"
                  value={transfer.branchNo ?? ''}
                  onChange={(event) => actions.onBranchChange?.(event.target.value)}
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
              <FormControl
                size={isMobile ? 'medium' : 'small'}
                fullWidth
                disabled={!transfer.branchNo || transfer.locationsLoading}
              >
                <LocationAutocompleteField
                  label="Местоположение назначения"
                  value={transfer.locationNo ?? ''}
                  options={locationOptions}
                  disabled={!transfer.branchNo || transfer.locationsLoading}
                  loading={Boolean(transfer.locationsLoading)}
                  size={isMobile ? 'medium' : 'small'}
                  onChange={(locNo) => actions.onLocationChange?.(locNo)}
                />
              </FormControl>
              {transfer.locationsLoading && (
                <Typography variant="caption" color="text.secondary">
                  Загрузка списка местоположений...
                </Typography>
              )}
            </>
          )}
        </>
      )}

      {result && (
        <Box sx={{ display: 'grid', gap: 1.5 }}>
          <Alert severity={getTransferResultSeverity({ result, jobPolling: transfer.jobPolling })}>
            {transfer.jobPolling || isTransferResultPending(result)
              ? (result.job_status_text || 'Акты создаются, обновите статус через несколько секунд')
              : `${isActOnly ? 'Подготовлено позиций' : 'Перемещено'}: ${result.success_count}, ошибок: ${result.failed_count}`}
          </Alert>
          {result.job_id && !transfer.jobPolling && isTransferResultPending(result) && (
            <Button
              size="small"
              variant="outlined"
              onClick={() => actions.onRefreshJob?.(result.job_id, {
                refreshEquipment: mode !== TRANSFER_OPERATION_ACT_ONLY,
              })}
            >
              Обновить статус
            </Button>
          )}

          {(result.upload_reminder_created || result.upload_reminder_warning) && (
            <Box sx={{ display: 'grid', gap: 1 }}>
              {result.upload_reminder_created && (
                <Alert severity="info">
                  Создано напоминание о загрузке подписанного акта.
                  {result.upload_reminder_controller_username
                    ? ` Контролёр: ${result.upload_reminder_controller_username}.`
                    : ''}
                  {result.upload_reminder_controller_fallback_used ? ' Использован fallback-контролёр.' : ''}
                </Alert>
              )}
              {result.upload_reminder_warning && (
                <Alert severity="warning">{result.upload_reminder_warning}</Alert>
              )}
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {result.upload_reminder_task_id && (
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => actions.onOpenReminderTask?.(result.upload_reminder_task_id)}
                  >
                    Открыть задачу
                  </Button>
                )}
                <Button
                  size="small"
                  variant="contained"
                  onClick={() => actions.onOpenUploadReminder?.({
                    reminderId: result.upload_reminder_id,
                    sourceTaskId: result.upload_reminder_task_id,
                  })}
                >
                  Загрузить подписанный акт
                </Button>
              </Box>
            </Box>
          )}

          {Array.isArray(result.failed) && result.failed.length > 0 && (
            <Box>
              {result.failed.slice(0, 5).map((failedItem, idx) => (
                <Typography key={`${failedItem.inv_no}-${idx}`} variant="body2" color="error">
                  {failedItem.inv_no}: {failedItem.error}
                </Typography>
              ))}
            </Box>
          )}

          {Array.isArray(result.acts) && result.acts.length > 0 && (
            <Box sx={{ display: 'grid', gap: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                Сформированные акты
              </Typography>
              {result.acts.map((act) => (
                <Box
                  key={act.act_id}
                  sx={getOfficeSubtlePanelSx(ui, {
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 1,
                    p: 1,
                    borderRadius: 1,
                    bgcolor: ui?.actionBg,
                  })}
                >
                  <Typography variant="body2">
                    {isActOnly && act.new_employee
                      ? `${act.old_employee} → ${act.new_employee} (${act.equipment_count})`
                      : `${act.old_employee} (${act.equipment_count})`}
                  </Typography>
                  <Button
                    size="small"
                    variant="outlined"
                    sx={theme ? getOfficeQuietActionSx(ui, theme, 'primary') : undefined}
                    onClick={() => actions.onDownloadAct?.(act)}
                  >
                    Скачать
                  </Button>
                </Box>
              ))}
            </Box>
          )}

          {!isLocationOnly && (
            <>
              <Divider />

              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                Отправка акта по email
              </Typography>
              <FormControl size={isMobile ? 'medium' : 'small'} fullWidth>
            <InputLabel>Кому отправить</InputLabel>
            <Select
              label="Кому отправить"
              value={email.mode || 'old'}
              onChange={(event) => actions.onEmailModeChange?.(event.target.value)}
            >
              <MenuItem value="old">
                {isActOnly ? 'Выдавшему' : 'Старому сотруднику'}
              </MenuItem>
              <MenuItem value="new">
                {isActOnly ? 'Получателю' : 'Новому сотруднику'}
              </MenuItem>
              <MenuItem value="employee">Выбрать сотрудника</MenuItem>
              <MenuItem value="manual">Ввести email вручную</MenuItem>
            </Select>
          </FormControl>

          {email.mode === 'manual' && (
            <TextField
              fullWidth
              label="Email получателя"
              value={email.manualEmail || ''}
              onChange={(event) => actions.onManualEmailChange?.(event.target.value)}
              size={isMobile ? 'medium' : 'small'}
            />
          )}

          {email.mode === 'employee' && (
            <Autocomplete
              options={email.recipientOptions || []}
              loading={Boolean(email.recipientLoading)}
              value={email.recipient || null}
              inputValue={email.recipientInput || ''}
              onInputChange={(_, value) => actions.onRecipientInputChange?.(value)}
              onChange={(_, value) => actions.onRecipientChange?.(value)}
              getOptionLabel={formatTransferOwnerOptionLabel}
              isOptionEqualToValue={isSameTransferOwnerOption}
              noOptionsText="Сотрудники не найдены"
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Сотрудник-получатель"
                  placeholder="Введите ФИО"
                  size={isMobile ? 'medium' : 'small'}
                />
              )}
            />
          )}

          {email.status && (
            <Alert severity="success">{email.status}</Alert>
          )}
          {email.error && (
            <Alert severity="error">{email.error}</Alert>
          )}

          <Button
            variant="contained"
            onClick={() => actions.onSendEmail?.()}
            disabled={isTransferEmailSendDisabled({
              canDatabaseWrite,
              emailLoading: email.loading,
              jobPolling: transfer.jobPolling,
              result,
            })}
          >
            {email.loading ? 'Отправка...' : 'Отправить акт'}
          </Button>
            </>
          )}
        </Box>
      )}
    </Box>
  );
});

export default TransferActionContent;
