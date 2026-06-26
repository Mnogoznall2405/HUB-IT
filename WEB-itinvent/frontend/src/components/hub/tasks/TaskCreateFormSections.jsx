import {
  Autocomplete,
  Box,
  Button,
  Collapse,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined';

import {
  areSameTaskUsers,
  getDepartmentLabel,
  getTaskUserLabel,
} from '../../../pages/tasks/taskUserUtils';
import EmailDeadlineRemindFields from './EmailDeadlineRemindFields';

export function TaskDueFields({
  dueLabel = 'Без срока',
  dueAt = '',
  dueAnchorRef,
  onOpenDuePicker,
  emailRemindMode,
  emailRemindHours,
  emailRemindDefaultHours = 24,
  onEmailRemindModeChange,
  onEmailRemindHoursChange,
  testIdPrefix = 'task-due',
  compact = false,
  ui,
}) {
  const theme = useTheme();

  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 0.45, sm: 1.4 }} alignItems={{ xs: 'stretch', sm: 'center' }}>
      <Typography sx={{ width: { sm: 120 }, flexShrink: 0, color: ui.subtleText, fontSize: '0.86rem', fontWeight: 700 }}>
        Крайний срок
      </Typography>
      <Button
        ref={dueAnchorRef}
        type="button"
        fullWidth
        variant="text"
        data-testid={`${testIdPrefix}-open`}
        onClick={onOpenDuePicker}
        startIcon={<CalendarMonthOutlinedIcon />}
        sx={{
          justifyContent: 'flex-start',
          minHeight: 34,
          px: 0,
          color: ui.text,
          textTransform: 'none',
          fontWeight: 800,
          borderRadius: '10px',
          '& .MuiButton-startIcon': { color: theme.palette.primary.main },
        }}
      >
        {dueLabel}
      </Button>
      <Collapse in={Boolean(String(dueAt || '').trim())} unmountOnExit sx={{ width: '100%' }}>
        <Box
          sx={{
            mt: compact ? 1 : 0,
            p: 1.2,
            borderRadius: '12px',
            border: '1px solid',
            borderColor: ui.borderSoft,
            bgcolor: alpha(theme.palette.primary.main, 0.04),
          }}
        >
          <EmailDeadlineRemindFields
            dueAt={dueAt}
            mode={emailRemindMode}
            hours={emailRemindHours}
            defaultHours={emailRemindDefaultHours}
            onModeChange={onEmailRemindModeChange}
            onHoursChange={onEmailRemindHoursChange}
            testIdPrefix={`${testIdPrefix}-email-remind`}
            compact={compact}
          />
        </Box>
      </Collapse>
    </Stack>
  );
}

export function TaskPeopleFields({
  isMobile = false,
  ui,
  assigneeSummary = '',
  selectedAssignees = [],
  titleTrimmed = '',
  getAssigneePickerOptions,
  onChangeAssigneeIds,
  onOpenAssignees,
  renderTaskUserOptionMultiple,
  renderTaskUserTags,
  assigneeAutocompleteProps,
  taskUserAutocompleteSlotProps,
}) {
  const theme = useTheme();

  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 0.45, sm: 1.4 }} alignItems={{ xs: 'stretch', sm: 'center' }}>
      <Typography sx={{ width: { sm: 120 }, flexShrink: 0, color: ui.subtleText, fontSize: '0.86rem', fontWeight: 700 }}>
        Исполнитель
      </Typography>
      {isMobile ? (
        <Button
          type="button"
          fullWidth
          data-testid="create-assignees-mobile-open"
          onClick={onOpenAssignees}
          sx={{
            justifyContent: 'flex-start',
            minHeight: 38,
            px: 0,
            textAlign: 'left',
            textTransform: 'none',
            color: assigneeSummary ? ui.text : ui.mutedText,
            borderRadius: '10px',
            outline: selectedAssignees.length === 0 && titleTrimmed.length > 0 ? `1px solid ${alpha(theme.palette.error.main, 0.65)}` : 'none',
            outlineOffset: 2,
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 900, fontSize: '0.95rem', lineHeight: 1.25 }} noWrap>
              {assigneeSummary || 'Выбрать исполнителя'}
            </Typography>
            {selectedAssignees.length === 0 && titleTrimmed.length > 0 ? (
              <Typography variant="caption" sx={{ color: theme.palette.error.main, fontWeight: 800 }}>
                Выберите хотя бы одного исполнителя
              </Typography>
            ) : null}
          </Box>
        </Button>
      ) : (
        <Autocomplete
          multiple
          fullWidth
          size="small"
          options={getAssigneePickerOptions(selectedAssignees)}
          value={selectedAssignees}
          onChange={(_, value) => onChangeAssigneeIds(
            Array.isArray(value) ? value.map((item) => String(item?.id || '')).filter(Boolean) : [],
          )}
          getOptionLabel={getTaskUserLabel}
          isOptionEqualToValue={areSameTaskUsers}
          disableCloseOnSelect
          filterSelectedOptions
          {...assigneeAutocompleteProps}
          renderOption={renderTaskUserOptionMultiple}
          renderTags={renderTaskUserTags}
          slotProps={taskUserAutocompleteSlotProps}
          renderInput={(params) => (
            <TextField
              {...params}
              variant="standard"
              placeholder={selectedAssignees.length === 0 ? 'Фамилия или логин' : ''}
              InputProps={{ ...params.InputProps, disableUnderline: true }}
              inputProps={{ ...params.inputProps, 'aria-label': 'Исполнители' }}
              sx={{
                '& .MuiInputBase-root': { minHeight: 34 },
                '& .MuiChip-root': { borderRadius: '999px', fontWeight: 800 },
              }}
            />
          )}
        />
      )}
    </Stack>
  );
}

export function TaskProjectFields({
  projectId = '',
  projects = [],
  onProjectChange,
  labelId = 'task-project-label',
  showCreateRow = false,
  projectName = '',
  onProjectNameChange,
  onCreateProject,
  createProjectSaving = false,
  showDepartment = false,
  departments = [],
  selectedDepartment = null,
  onDepartmentChange,
  showObject = false,
  objectId = '',
  objects = [],
  onObjectChange,
  layout = 'stack',
}) {
  const projectSelect = (
    <FormControl fullWidth size="small">
      <InputLabel id={labelId}>Проект</InputLabel>
      <Select
        labelId={labelId}
        label="Проект"
        value={projectId}
        onChange={(event) => onProjectChange(String(event.target.value || ''))}
      >
        {projects.map((item) => (
          <MenuItem key={item.id} value={String(item.id)}>
            {item.name}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );

  const createProjectRow = showCreateRow ? (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
      <TextField
        label="Новый проект"
        value={projectName}
        onChange={(event) => onProjectNameChange?.(event.target.value)}
        size="small"
        fullWidth
        placeholder="Например: Переезд бухгалтерии"
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void onCreateProject?.();
          }
        }}
      />
      <Button
        variant="outlined"
        onClick={() => void onCreateProject?.()}
        disabled={createProjectSaving || String(projectName || '').trim().length < 2}
        sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px', whiteSpace: 'nowrap' }}
      >
        {createProjectSaving ? 'Создание...' : 'Добавить'}
      </Button>
    </Stack>
  ) : null;

  const objectSelect = showObject ? (
    <FormControl fullWidth size="small">
      <InputLabel id={`${labelId}-object`}>Объект</InputLabel>
      <Select
        labelId={`${labelId}-object`}
        label="Объект"
        value={objectId}
        onChange={(event) => onObjectChange?.(String(event.target.value || ''))}
        disabled={!projectId}
      >
        <MenuItem value="">Без объекта</MenuItem>
        {objects.map((item) => (
          <MenuItem key={item.id} value={String(item.id)}>{item.name}</MenuItem>
        ))}
      </Select>
    </FormControl>
  ) : null;

  const departmentField = showDepartment ? (
    <Autocomplete
      fullWidth
      size="small"
      options={departments}
      value={selectedDepartment}
      onChange={(_, value) => onDepartmentChange?.(value)}
      getOptionLabel={getDepartmentLabel}
      isOptionEqualToValue={(option, value) => String(option?.id || '') === String(value?.id || '')}
      clearOnEscape
      noOptionsText="Ничего не найдено"
      renderInput={(params) => (
        <TextField
          {...params}
          label="Отдел"
          placeholder="Автоматически по исполнителю"
        />
      )}
    />
  ) : null;

  if (layout === 'grid') {
    return (
      <Grid container spacing={1.2} alignItems="flex-start">
        <Grid item xs={12} md={showObject ? 4 : 12}>
          {projectSelect}
        </Grid>
        {showObject ? (
          <Grid item xs={12} md={4}>
            {objectSelect}
          </Grid>
        ) : null}
        {showCreateRow ? (
          <Grid item xs={12}>
            {createProjectRow}
          </Grid>
        ) : null}
        {showDepartment ? (
          <Grid item xs={12} md={6}>
            {departmentField}
          </Grid>
        ) : null}
      </Grid>
    );
  }

  return (
    <Stack spacing={1}>
      {projectSelect}
      {createProjectRow}
      {objectSelect}
      {departmentField}
    </Stack>
  );
}
