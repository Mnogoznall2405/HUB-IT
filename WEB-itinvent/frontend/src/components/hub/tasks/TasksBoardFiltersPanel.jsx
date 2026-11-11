import SearchIcon from '@mui/icons-material/Search';
import {
  Autocomplete,
  Box,
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { getTaskUnreadFilterLabel } from '../../../lib/taskNavigation';
import { getDepartmentLabel, getTaskUserLabel, areSameTaskUsers, filterTaskUserOptions } from '../../../pages/tasks/taskUserUtils';
import { getOfficeSubtlePanelSx } from '../../../theme/officeUiTokens';

export default function TasksBoardFiltersPanel({
  ui,
  q = '',
  onQChange,
  searchInputRef,
  statusFilter = '',
  onStatusFilterChange,
  statusOptions = [],
  dueState = '',
  onDueStateChange,
  dueStateOptions = [],
  departments = [],
  selectedBoardDepartment = null,
  onDepartmentChange,
  selectedBoardAssignee = null,
  getAssigneePickerOptions,
  onAssigneeChange,
  controllers = [],
  selectedBoardController = null,
  onControllerChange,
  hasAttachments = false,
  onHasAttachmentsChange,
  unreadCommentsOnly = false,
  onUnreadCommentsOnlyChange,
  taskDiscussionChatEnabled = false,
  onResetFilters,
  handleSingleAssigneeAutocompleteChange,
  renderTaskUserOption,
  taskUserAutocompleteSlotProps,
  assigneeAutocompleteProps,
  getAssigneeAutocompleteInputValue,
}) {
  return (
    <Box data-testid="tasks-board-filters-panel" sx={{ ...getOfficeSubtlePanelSx(ui, { p: 1, borderRadius: '14px' }) }}>
      <Grid container spacing={1.1}>
        <Grid item xs={12} md={4}>
          <TextField
            fullWidth
            size="small"
            label="Поиск по задачам"
            value={q}
            inputRef={searchInputRef}
            onChange={(event) => onQChange?.(event.target.value)}
            placeholder="Заголовок, комментарий, участник..."
            InputProps={{ startAdornment: <SearchIcon sx={{ fontSize: 18, color: ui.subtleText, mr: 0.8 }} /> }}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={2}>
          <FormControl fullWidth size="small">
            <InputLabel id="tasks-status-filter-label">Статус</InputLabel>
            <Select
              labelId="tasks-status-filter-label"
              label="Статус"
              value={statusFilter}
              onChange={(event) => onStatusFilterChange?.(event.target.value)}
            >
              {statusOptions.map((item) => <MenuItem key={item.value || 'all'} value={item.value}>{item.label}</MenuItem>)}
            </Select>
          </FormControl>
        </Grid>
        <Grid item xs={12} sm={6} md={2}>
          <FormControl fullWidth size="small">
            <InputLabel id="tasks-due-filter-label">Срок</InputLabel>
            <Select
              labelId="tasks-due-filter-label"
              label="Срок"
              value={dueState}
              onChange={(event) => onDueStateChange?.(event.target.value)}
            >
              {dueStateOptions.map((item) => <MenuItem key={item.value || 'all'} value={item.value}>{item.label}</MenuItem>)}
            </Select>
          </FormControl>
        </Grid>
        <Grid item xs={12} sm={6} md={2}>
          <Autocomplete
            fullWidth
            size="small"
            options={departments}
            value={selectedBoardDepartment}
            onChange={(_, value) => onDepartmentChange?.(String(value?.id || ''))}
            getOptionLabel={getDepartmentLabel}
            isOptionEqualToValue={(option, value) => String(option?.id || '') === String(value?.id || '')}
            clearOnEscape
            renderInput={(params) => (
              <TextField
                {...params}
                label="Отдел"
                placeholder="Любой отдел"
              />
            )}
            noOptionsText="Ничего не найдено"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={2}>
          <Autocomplete
            fullWidth
            size="small"
            options={getAssigneePickerOptions?.(selectedBoardAssignee) || []}
            value={selectedBoardAssignee}
            onChange={handleSingleAssigneeAutocompleteChange?.((value) => {
              onAssigneeChange?.(String(value?.id || ''));
            })}
            getOptionLabel={getTaskUserLabel}
            isOptionEqualToValue={areSameTaskUsers}
            clearOnEscape
            renderOption={renderTaskUserOption}
            slotProps={taskUserAutocompleteSlotProps}
            {...assigneeAutocompleteProps}
            inputValue={getAssigneeAutocompleteInputValue?.(selectedBoardAssignee) || ''}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Исполнитель"
                placeholder="Фамилия или логин"
              />
            )}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={2}>
          <Autocomplete
            fullWidth
            size="small"
            options={controllers}
            value={selectedBoardController}
            onChange={(_, value) => onControllerChange?.(String(value?.id || ''))}
            getOptionLabel={getTaskUserLabel}
            filterOptions={filterTaskUserOptions}
            isOptionEqualToValue={areSameTaskUsers}
            clearOnEscape
            renderOption={renderTaskUserOption}
            slotProps={taskUserAutocompleteSlotProps}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Контролёр"
                placeholder="Фамилия или логин"
              />
            )}
            noOptionsText="Ничего не найдено"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={2.4}>
          <FormControlLabel
            control={(
              <Checkbox
                checked={hasAttachments}
                onChange={(event) => onHasAttachmentsChange?.(event.target.checked)}
              />
            )}
            label="С файлами"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={2.6}>
          <FormControlLabel
            control={(
              <Checkbox
                checked={unreadCommentsOnly}
                onChange={(event) => onUnreadCommentsOnlyChange?.(event.target.checked)}
              />
            )}
            label={getTaskUnreadFilterLabel(taskDiscussionChatEnabled)}
          />
        </Grid>
        <Grid item xs={12} md={7}>
          <Typography variant="caption" sx={{ color: ui.subtleText }}>
            Фильтры и текущая карточка синхронизируются с URL, поэтому состояние страницы можно открыть по ссылке.
          </Typography>
        </Grid>
        <Grid item xs={12} md={5} sx={{ display: 'flex', justifyContent: { xs: 'stretch', md: 'flex-end' } }}>
          <Button
            variant="outlined"
            onClick={onResetFilters}
            sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px', minWidth: 180 }}
          >
            Сбросить фильтры
          </Button>
        </Grid>
      </Grid>
    </Box>
  );
}
