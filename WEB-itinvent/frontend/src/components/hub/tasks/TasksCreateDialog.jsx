import {
  Autocomplete,
  Avatar,
  Box,
  Button,
  Checkbox,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  Divider,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined';
import CloseIcon from '@mui/icons-material/Close';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';

import { priorityOptions, taskVisibilityOptions } from '../../../pages/tasks/taskConstants';
import { normalizeChecklistItems } from '../../../pages/tasks/taskChecklistUtils';
import { createOptionalSectionOptions } from '../../../pages/tasks/taskCreateModel';
import {
  areSameTaskUsers,
  filterTaskUserOptions,
  getDepartmentLabel,
  getTaskUserLabel,
} from '../../../pages/tasks/taskUserUtils';
import { getFileIdentity } from '../../../pages/tasks/taskApiHelpers';
import { formatFileSize, formatShortDate, priorityMeta } from '../../../pages/tasks/taskFormatters';
import { getOfficeDialogPaperSx, getOfficeSubtlePanelSx } from '../../../theme/officeUiTokens';
import EmailDeadlineRemindFields from './EmailDeadlineRemindFields';
import LocalTaskDescriptionField from './LocalTaskDescriptionField';
import { TaskDueFields, TaskPeopleFields, TaskProjectFields } from './TaskCreateFormSections';

export default function TasksCreateDialog({
  open = false,
  onClose,
  isMobile = false,
  ui,
  createData,
  setCreateData,
  createSaving = false,
  onCreate,
  onCreateDescriptionDraftChange,
  onOpenOptionalSection,
  createDescriptionSummary = '',
  createAssigneeSummary = '',
  createEmailRemindSummary = '',
  createDueLabel = 'Без срока',
  createDueAnchorRef,
  onOpenDuePicker,
  selectedCreateAssignees = [],
  selectedCreateController = null,
  selectedCreateObservers = [],
  selectedCreateDepartment = null,
  getAssigneePickerOptions,
  onChangeAssigneeIds,
  onChangeObserverIds,
  renderTaskUserOption,
  renderTaskUserOptionMultiple,
  renderTaskUserTags,
  renderTaskObserverTags,
  taskUserAutocompleteSlotProps,
  assigneeAutocompleteProps,
  observerAutocompleteProps,
  controllers = [],
  departments = [],
  activeTaskProjects = [],
  effectiveCreateProjectId = '',
  effectiveCreateProject = null,
  createOptionalSections = {},
  createFiles = [],
  createChecklistItems = [],
  createProjectName = '',
  setCreateProjectName,
  onCreateProject,
  createProjectSaving = false,
  onAddChecklistItem,
  onUpdateChecklistItem,
  onRemoveChecklistItem,
  onAddCreateFiles,
  onRemoveCreateFile,
  taskUsersLoading = false,
  taskUsersLoadError = '',
  taskEmailDeadlineDefaultHours = 24,
}) {
  const theme = useTheme();

  return (
        <Dialog
          open={open}
          onClose={onClose}
          fullScreen={isMobile}
          fullWidth
          maxWidth="sm"
          PaperProps={{ sx: getOfficeDialogPaperSx(ui) }}
        >
          <DialogContent sx={{ px: { xs: 1.2, sm: 2.2 }, py: { xs: 1.2, sm: 1.8 } }}>
            <Stack spacing={1.35}>
              <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: { xs: 1.2, sm: 1.6 }, borderRadius: '16px' }) }}>
                <Stack direction="row" alignItems="flex-start" spacing={1}>
                  <TextField
                    value={createData.title}
                    onChange={(event) => setCreateData((prev) => ({ ...prev, title: event.target.value }))}
                    fullWidth
                    required
                    autoFocus={!isMobile}
                    variant="standard"
                    placeholder="Название задачи"
                    inputProps={{ 'aria-label': 'Что нужно сделать' }}
                    InputProps={{ disableUnderline: true }}
                    error={createData.title.length > 0 && createData.title.trim().length < 3}
                    helperText={createData.title.length > 0 && createData.title.trim().length < 3 ? 'Минимум 3 символа' : ' '}
                    sx={{
                      '& .MuiInputBase-input': {
                        py: 0.2,
                        fontSize: { xs: '1.25rem', sm: '1.45rem' },
                        fontWeight: 900,
                        lineHeight: 1.18,
                      },
                      '& .MuiInputBase-input::placeholder': {
                        color: ui.mutedText,
                        opacity: 0.8,
                      },
                      '& .MuiFormHelperText-root': { mx: 0, mt: 0.35 },
                    }}
                  />
                  <Tooltip title="Закрыть">
                    <span>
                      <IconButton
                        size="small"
                        onClick={onClose}
                        disabled={createSaving}
                        aria-label="Закрыть создание задачи"
                        sx={{ mt: 0.1, width: { xs: 44, sm: 'auto' }, height: { xs: 44, sm: 'auto' } }}
                      >
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Stack>

                {isMobile ? (
                  <Button
                    type="button"
                    fullWidth
                    data-testid="create-description-mobile-open"
                    onClick={() => onOpenOptionalSection('description')}
                    sx={{
                      mt: 0.2,
                      px: 0,
                      py: 0.55,
                      justifyContent: 'flex-start',
                      textAlign: 'left',
                      textTransform: 'none',
                      color: createDescriptionSummary ? ui.text : ui.mutedText,
                      borderRadius: '10px',
                    }}
                  >
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 850, fontSize: '0.92rem', lineHeight: 1.25 }}>
                        Описание
                      </Typography>
                      <Typography
                        variant="body2"
                        sx={{
                          color: createDescriptionSummary ? ui.mutedText : ui.subtleText,
                          mt: 0.25,
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {createDescriptionSummary || 'Добавить описание задачи'}
                      </Typography>
                    </Box>
                  </Button>
                ) : (
                  <LocalTaskDescriptionField
                    initialValue={createData.description}
                    onDraftChange={onCreateDescriptionDraftChange}
                    resetKey={open ? 'open' : 'closed'}
                    fullWidth
                    multiline
                    minRows={2}
                    maxRows={5}
                    variant="standard"
                    placeholder="Описание"
                    inputProps={{ 'aria-label': 'Описание' }}
                    InputProps={{ disableUnderline: true }}
                    sx={{
                      mt: 0.2,
                      '& .MuiInputBase-input': { color: ui.text, fontSize: '0.96rem', lineHeight: 1.45 },
                      '& .MuiInputBase-input::placeholder': { color: ui.mutedText, opacity: 0.85 },
                    }}
                  />
                )}

                <Stack spacing={1.05} sx={{ mt: 1.2 }}>
                  <TaskPeopleFields
                    isMobile={isMobile}
                    ui={ui}
                    assigneeSummary={createAssigneeSummary}
                    selectedAssignees={selectedCreateAssignees}
                    titleTrimmed={createData.title.trim()}
                    getAssigneePickerOptions={getAssigneePickerOptions}
                    onChangeAssigneeIds={onChangeAssigneeIds}
                    onOpenAssignees={() => onOpenOptionalSection('assignees')}
                    renderTaskUserOptionMultiple={renderTaskUserOptionMultiple}
                    renderTaskUserTags={renderTaskUserTags}
                    assigneeAutocompleteProps={assigneeAutocompleteProps}
                    taskUserAutocompleteSlotProps={taskUserAutocompleteSlotProps}
                  />

                  <TaskDueFields
                    dueLabel={createDueLabel}
                    dueAt={createData.due_at}
                    dueAnchorRef={createDueAnchorRef}
                    onOpenDuePicker={onOpenDuePicker}
                    emailRemindMode={createData.email_deadline_remind_mode}
                    emailRemindHours={createData.email_deadline_remind_hours}
                    emailRemindDefaultHours={taskEmailDeadlineDefaultHours}
                    onEmailRemindModeChange={(value) => setCreateData((prev) => ({ ...prev, email_deadline_remind_mode: value }))}
                    onEmailRemindHoursChange={(value) => setCreateData((prev) => ({ ...prev, email_deadline_remind_hours: value }))}
                    testIdPrefix="create-due"
                    compact
                    ui={ui}
                  />
                </Stack>

                <Divider sx={{ my: 1.25, borderColor: ui.borderSoft }} />

                <Stack direction="row" spacing={0.8} useFlexGap flexWrap="wrap">
                  {createOptionalSectionOptions.map((option) => {
                    const selected = option.key === 'priority'
                      ? createData.priority !== 'normal'
                      : Boolean(createOptionalSections[option.key]);
                    const IconComponent = option.icon;
                    let label = option.label;
                    if (option.key === 'priority' && createData.priority !== 'normal') {
                      label = priorityMeta(createData.priority).label;
                    } else if (option.key === 'files' && createFiles.length > 0) {
                      label = `${option.label}: ${createFiles.length}`;
                    } else if (option.key === 'checklist') {
                      const count = normalizeChecklistItems(createChecklistItems).length;
                      if (count > 0) label = `Чек-лист: ${count}`;
                    } else if (option.key === 'controller' && selectedCreateController) {
                      label = `Контролёр: ${getTaskUserLabel(selectedCreateController)}`;
                    } else if (option.key === 'observers' && selectedCreateObservers.length > 0) {
                      label = selectedCreateObservers.length === 1
                        ? `Наблюдатель: ${getTaskUserLabel(selectedCreateObservers[0])}`
                        : `Наблюдатели: ${selectedCreateObservers.length}`;
                    } else if (option.key === 'project' && effectiveCreateProject) {
                      label = `Проект: ${effectiveCreateProject.name}`;
                    }
                    return (
                      <Chip
                        key={option.key}
                        clickable
                        icon={IconComponent ? <IconComponent /> : undefined}
                        color={selected ? 'primary' : 'default'}
                        variant={selected ? 'filled' : 'outlined'}
                        label={label}
                        onClick={() => onOpenOptionalSection(option.key)}
                        sx={{
                          fontWeight: 800,
                          borderRadius: '8px',
                          ...(option.key === 'priority' && selected ? {
                            bgcolor: alpha(priorityMeta(createData.priority).dotColor, 0.16),
                            color: priorityMeta(createData.priority).dotColor,
                            '& .MuiChip-icon': { color: `${priorityMeta(createData.priority).dotColor} !important` },
                          } : {}),
                        }}
                      />
                    );
                  })}
                </Stack>

                <Stack direction="row" spacing={0.7} useFlexGap flexWrap="wrap" sx={{ mt: 1.05 }}>
                  <Chip size="small" variant="outlined" label={`Дата постановки: ${createData.protocol_date ? formatShortDate(createData.protocol_date) : 'сегодня'}`} />
                  <Chip size="small" variant="outlined" label={`Приоритет: ${priorityMeta(createData.priority).label}`} />
                  {String(createData.due_at || '').trim() ? (
                    <Chip size="small" variant="outlined" color="primary" label={createEmailRemindSummary} />
                  ) : null}
                  {createFiles.length > 0 ? <Chip size="small" variant="outlined" icon={<AttachFileIcon />} label={`Файлы: ${createFiles.length}`} /> : null}
                </Stack>
              </Box>

              <Collapse in={Boolean(!isMobile && (createOptionalSections.controller || createOptionalSections.advanced))} unmountOnExit>
                <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: { xs: 1, sm: 1.2 }, borderRadius: '12px' }) }}>
                  <Autocomplete
                    fullWidth
                    size="small"
                    options={controllers}
                    value={selectedCreateController}
                    onChange={(_, value) => setCreateData((prev) => ({ ...prev, controller_user_id: String(value?.id || '') }))}
                    getOptionLabel={getTaskUserLabel}
                    filterOptions={filterTaskUserOptions}
                    isOptionEqualToValue={areSameTaskUsers}
                    clearOnEscape
                    loading={taskUsersLoading && controllers.length === 0}
                    noOptionsText={
                      taskUsersLoading && controllers.length === 0
                        ? 'Загрузка списка...'
                        : (taskUsersLoadError || 'Ничего не найдено')
                    }
                    renderOption={renderTaskUserOption}
                    slotProps={taskUserAutocompleteSlotProps}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Контролёр"
                        placeholder="Фамилия или логин"
                      />
                    )}
                  />
                </Box>
              </Collapse>

              <Collapse in={Boolean(!isMobile && createOptionalSections.observers)} unmountOnExit>
                <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: { xs: 1, sm: 1.2 }, borderRadius: '12px', mt: 1 }) }}>
                  <Autocomplete
                    fullWidth
                    multiple
                    size="small"
                    options={getAssigneePickerOptions(selectedCreateObservers)}
                    value={selectedCreateObservers}
                    onChange={(_, value) => onChangeObserverIds(
                      Array.isArray(value) ? value.map((item) => String(item?.id || '')).filter(Boolean) : [],
                    )}
                    getOptionLabel={getTaskUserLabel}
                    isOptionEqualToValue={areSameTaskUsers}
                    clearOnEscape
                    disableCloseOnSelect
                    renderOption={renderTaskUserOptionMultiple}
                    renderTags={renderTaskObserverTags}
                    slotProps={taskUserAutocompleteSlotProps}
                    {...observerAutocompleteProps}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Наблюдатели"
                        placeholder="Фамилия или логин"
                        helperText="Наблюдатели видят задачу и могут писать в чат, но не меняют статус"
                      />
                    )}
                  />
                </Box>
              </Collapse>

              <Collapse in={Boolean(!isMobile && createOptionalSections.checklist)} unmountOnExit>
                <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: { xs: 1, sm: 1.2 }, borderRadius: '12px' }) }}>
                  <Stack spacing={0.9}>
                    <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                      <Typography sx={{ fontWeight: 900 }}>Чек-лист</Typography>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<AddIcon />}
                        onClick={onAddChecklistItem}
                        sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px' }}
                      >
                        Пункт
                      </Button>
                    </Stack>
                    {createChecklistItems.map((item, index) => (
                      <Stack key={item.id} direction="row" spacing={0.8} alignItems="center">
                        <Checkbox
                          checked={Boolean(item.done)}
                          onChange={(event) => onUpdateChecklistItem(item.id, { done: event.target.checked })}
                          inputProps={{ 'aria-label': `Пункт чек-листа ${index + 1}` }}
                          sx={{ p: 0.4 }}
                        />
                        <TextField
                          value={item.text}
                          onChange={(event) => onUpdateChecklistItem(item.id, { text: event.target.value })}
                          placeholder={`Пункт ${index + 1}`}
                          size="small"
                          fullWidth
                        />
                        <Tooltip title="Удалить пункт">
                          <span>
                            <IconButton
                              size="small"
                              onClick={() => onRemoveChecklistItem(item.id)}
                              aria-label={`Удалить пункт ${index + 1}`}
                            >
                              <DeleteOutlineIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </Stack>
                    ))}
                  </Stack>
                </Box>
              </Collapse>

              <Collapse in={Boolean(!isMobile && createOptionalSections.files)} unmountOnExit>
                <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: { xs: 1, sm: 1.2 }, borderRadius: '12px' }) }}>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }} justifyContent="space-between">
                    <Typography sx={{ fontWeight: 900 }}>Файлы к задаче</Typography>
                    <Button
                      component="label"
                      size="small"
                      variant="outlined"
                      startIcon={<AttachFileIcon />}
                      disabled={createSaving}
                      sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px', alignSelf: { xs: 'stretch', sm: 'center' } }}
                    >
                      {createFiles.length > 0 ? 'Добавить файлы' : 'Выбрать файлы'}
                      <input
                        type="file"
                        hidden
                        multiple
                        onChange={(event) => {
                          onAddCreateFiles(event.target.files);
                          event.target.value = '';
                        }}
                      />
                    </Button>
                  </Stack>

                  {createFiles.length === 0 ? (
                    <Typography variant="body2" sx={{ color: ui.mutedText, mt: 1 }}>
                      Файлы можно выбрать до постановки задачи. После создания они прикрепятся автоматически.
                    </Typography>
                  ) : (
                    <Stack spacing={0.7} sx={{ mt: 1 }}>
                      {createFiles.map((file, index) => (
                        <Box
                          key={`${getFileIdentity(file)}:${index}`}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1,
                            minHeight: 44,
                            px: 1,
                            py: 0.7,
                            border: '1px solid',
                            borderColor: ui.borderSoft,
                            borderRadius: '10px',
                            bgcolor: ui.panelSolid,
                          }}
                        >
                          <Avatar sx={{ width: 28, height: 28, bgcolor: alpha(theme.palette.primary.main, 0.14), color: theme.palette.primary.main }}>
                            <AttachFileIcon sx={{ fontSize: 15 }} />
                          </Avatar>
                          <Box sx={{ minWidth: 0, flex: 1 }}>
                            <Typography sx={{ fontWeight: 800, fontSize: '0.86rem' }} noWrap title={file?.name || 'file'}>
                              {file?.name || 'file'}
                            </Typography>
                            <Typography variant="caption" sx={{ color: ui.subtleText }}>
                              {formatFileSize(file?.size)}
                            </Typography>
                          </Box>
                          <Tooltip title="Убрать файл">
                            <span>
                              <IconButton
                                size="small"
                                aria-label={`Убрать файл ${file?.name || index + 1}`}
                                onClick={() => onRemoveCreateFile(index)}
                                disabled={createSaving}
                              >
                                <DeleteOutlineIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                        </Box>
                      ))}
                    </Stack>
                  )}
                </Box>
              </Collapse>

              <Collapse in={Boolean(!isMobile && createOptionalSections.schedule)} unmountOnExit>
                <Grid container spacing={1.2}>
                  <Grid item xs={12} md={4}>
                    <TextField
                      label="Дата постановки задачи"
                      type="date"
                      value={createData.protocol_date}
                      onChange={(event) => setCreateData((prev) => ({ ...prev, protocol_date: event.target.value }))}
                      InputLabelProps={{ shrink: true }}
                      fullWidth
                      size="small"
                    />
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <FormControl fullWidth size="small">
                      <InputLabel id="create-priority-label">Приоритет</InputLabel>
                      <Select labelId="create-priority-label" label="Приоритет" value={createData.priority} onChange={(event) => setCreateData((prev) => ({ ...prev, priority: event.target.value }))}>
                        {priorityOptions.map((item) => <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>)}
                      </Select>
                    </FormControl>
                  </Grid>
                </Grid>
              </Collapse>

              <Collapse in={Boolean(!isMobile && createOptionalSections.project)} unmountOnExit>
                <TaskProjectFields
                  projectId={effectiveCreateProjectId}
                  projects={activeTaskProjects}
                  onProjectChange={(nextProjectId) => setCreateData((prev) => ({
                    ...prev,
                    project_id: nextProjectId,
                    object_id: '',
                  }))}
                  labelId="create-project-label"
                  showCreateRow
                  projectName={createProjectName}
                  onProjectNameChange={setCreateProjectName}
                  onCreateProject={onCreateProject}
                  createProjectSaving={createProjectSaving}
                />
              </Collapse>

              <Collapse in={Boolean(!isMobile && createOptionalSections.access)} unmountOnExit>
                <Grid container spacing={1.2}>
                  <Grid item xs={12} md={6}>
                    <Autocomplete
                      fullWidth
                      size="small"
                      options={departments}
                      value={selectedCreateDepartment}
                      onChange={(_, value) => setCreateData((prev) => ({
                        ...prev,
                        department_id: String(value?.id || ''),
                        visibility_scope: value?.id ? (prev.visibility_scope || 'department') : 'private',
                      }))}
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
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <FormControl fullWidth size="small">
                      <InputLabel id="create-visibility-label">Видимость</InputLabel>
                      <Select
                        labelId="create-visibility-label"
                        label="Видимость"
                        value={createData.visibility_scope}
                        onChange={(event) => setCreateData((prev) => ({ ...prev, visibility_scope: event.target.value }))}
                      >
                        {taskVisibilityOptions.map((item) => (
                          <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                </Grid>
              </Collapse>
            </Stack>
          </DialogContent>

          <DialogActions sx={{ px: { xs: 1, sm: 2.2 }, py: 1.4, borderTop: '1px solid', borderColor: ui.borderSoft, position: { xs: 'sticky', sm: 'static' }, bottom: 0, bgcolor: ui.pageBg, flexDirection: { xs: 'column-reverse', sm: 'row' }, gap: { xs: 0.8, sm: 0 }, '& > :not(style)': { m: 0, width: { xs: '100%', sm: 'auto' } } }}>
            <Button onClick={onClose} disabled={createSaving} sx={{ textTransform: 'none', fontWeight: 700 }}>
              Отмена
            </Button>
            <Button
              variant="contained"
              onClick={onCreate}
              disabled={
                createSaving
                || String(createData.title || '').trim().length < 3
                || createData.assignee_user_ids.length === 0
                || !effectiveCreateProjectId
                || !String(createData.protocol_date || '').trim()
              }
              sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px', boxShadow: 'none' }}
            >
              {createSaving ? 'Создание...' : `Создать${(Array.isArray(createData.assignee_user_ids) ? createData.assignee_user_ids.length : 0) > 1 ? ` (${createData.assignee_user_ids.length})` : ''}`}
            </Button>
          </DialogActions>
        </Dialog>
  );
}
