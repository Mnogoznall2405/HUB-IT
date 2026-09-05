import { useEffect, useRef, useState } from 'react';
import {
  Autocomplete,
  Avatar,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
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
import CreateDuePickerPanel from '../CreateDuePickerPanel';
import EmailDeadlineRemindFields from './EmailDeadlineRemindFields';
import LocalTaskDescriptionField from './LocalTaskDescriptionField';
import { TaskDueFields, TaskPeopleFields, TaskProjectFields } from './TaskCreateFormSections';
import { formatEmailRemindSummary } from '../../../pages/tasks/taskEmailRemindUtils';

export default function TasksCreateDialog({
  mode = 'create',
  open = false,
  onClose,
  isMobile = false,
  ui,
  createData: createDataProp,
  setCreateData: setCreateDataProp,
  createSaving: createSavingProp = false,
  onCreate: onCreateProp,
  onCreateDescriptionDraftChange: onCreateDescriptionDraftChangeProp,
  onOpenOptionalSection: onOpenOptionalSectionProp,
  createDescriptionSummary: createDescriptionSummaryProp = '',
  createAssigneeSummary: createAssigneeSummaryProp = '',
  createEmailRemindSummary: createEmailRemindSummaryProp = '',
  createDueLabel: createDueLabelProp = 'Без срока',
  createDueAnchorRef: createDueAnchorRefProp,
  onOpenDuePicker: onOpenDuePickerProp,
  selectedCreateAssignees: selectedCreateAssigneesProp = [],
  selectedCreateController: selectedCreateControllerProp = null,
  selectedCreateObservers: selectedCreateObserversProp = [],
  selectedCreateDepartment: selectedCreateDepartmentProp = null,
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
  effectiveCreateProjectId: effectiveCreateProjectIdProp = '',
  effectiveCreateProject: effectiveCreateProjectProp = null,
  createOptionalSections: createOptionalSectionsProp = {},
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
  editData,
  setEditData,
  editSaving = false,
  editLoading = false,
  onSave,
  onEditDescriptionDraftChange,
  selectedEditAssignees = [],
  selectedEditController = null,
  selectedEditObservers = [],
  selectedEditDepartment = null,
  editProjectObjects = [],
  editDueLabel = 'Без срока',
  editDueCustomOpen = false,
  onEditDueCustomOpenChange,
  onSelectEditDuePreset,
  onEditDueAtChange,
  createDuePresets = [],
}) {
  const theme = useTheme();
  const isEditing = mode === 'edit';
  const [editOptionalSections, setEditOptionalSections] = useState({});
  const [editDuePickerOpen, setEditDuePickerOpen] = useState(false);
  const editDueAnchorRef = useRef(null);
  const editAssigneeIds = Array.isArray(editData?.assignee_user_ids) ? editData.assignee_user_ids : [];
  const createData = isEditing
    ? {
      id: '',
      title: '',
      description: '',
      observer_user_ids: [],
      controller_user_id: '',
      project_id: '',
      object_id: '',
      protocol_date: '',
      due_at: '',
      priority: 'normal',
      department_id: '',
      visibility_scope: 'private',
      email_deadline_remind_mode: 'default',
      email_deadline_remind_hours: 24,
      ...(editData || {}),
      assignee_user_ids: editAssigneeIds,
    }
    : createDataProp;
  const setCreateData = isEditing
    ? (updater) => setEditData?.((previous) => {
      const compatiblePrevious = {
        ...previous,
        assignee_user_ids: Array.isArray(previous?.assignee_user_ids) ? previous.assignee_user_ids : [],
      };
      const next = typeof updater === 'function' ? updater(compatiblePrevious) : updater;
      const assigneeIds = Array.isArray(next?.assignee_user_ids) ? next.assignee_user_ids : [];
      return {
        ...(next || {}),
        assignee_user_ids: assigneeIds,
      };
    })
    : setCreateDataProp;
  const createSaving = isEditing ? editSaving : createSavingProp;
  const createLoading = isEditing ? editLoading : false;
  const onCreate = isEditing ? onSave : onCreateProp;
  const onCreateDescriptionDraftChange = isEditing
    ? onEditDescriptionDraftChange
    : onCreateDescriptionDraftChangeProp;
  const selectedCreateAssignees = isEditing
    ? selectedEditAssignees
    : selectedCreateAssigneesProp;
  const selectedCreateController = isEditing ? selectedEditController : selectedCreateControllerProp;
  const selectedCreateObservers = isEditing ? selectedEditObservers : selectedCreateObserversProp;
  const selectedCreateDepartment = isEditing ? selectedEditDepartment : selectedCreateDepartmentProp;
  const effectiveCreateProjectId = isEditing
    ? String(createData?.project_id || '')
    : effectiveCreateProjectIdProp;
  const effectiveCreateProject = isEditing
    ? activeTaskProjects.find((item) => String(item?.id || '') === effectiveCreateProjectId) || null
    : effectiveCreateProjectProp;
  const createOptionalSections = isEditing ? editOptionalSections : createOptionalSectionsProp;
  const createDescriptionSummary = isEditing
    ? String(createData?.description || '').trim()
    : createDescriptionSummaryProp;
  const createAssigneeSummary = isEditing
    ? selectedCreateAssignees.map(getTaskUserLabel).filter(Boolean).join(', ')
    : createAssigneeSummaryProp;
  const createEmailRemindSummary = isEditing
    ? formatEmailRemindSummary(
      createData?.email_deadline_remind_mode,
      createData?.email_deadline_remind_hours,
      taskEmailDeadlineDefaultHours,
    )
    : createEmailRemindSummaryProp;
  const createDueLabel = isEditing ? editDueLabel : createDueLabelProp;
  const createDueAnchorRef = isEditing ? editDueAnchorRef : createDueAnchorRefProp;
  const onOpenDuePicker = isEditing
    ? () => setEditDuePickerOpen((current) => !current)
    : onOpenDuePickerProp;
  const onChangeAssigneeIdsEffective = isEditing
    ? (ids) => setCreateData((previous) => ({ ...previous, assignee_user_ids: ids }))
    : onChangeAssigneeIds;
  const onChangeObserverIdsEffective = isEditing
    ? (ids) => setCreateData((previous) => ({ ...previous, observer_user_ids: ids }))
    : onChangeObserverIds;
  const usesMobileSheets = isMobile && !isEditing;
  const onOpenOptionalSection = isEditing
    ? (key) => setEditOptionalSections((previous) => {
      if (key === 'priority') {
        return { ...previous, advanced: true, schedule: true };
      }
      if (key === 'advanced') {
        const nextAdvanced = !previous.advanced;
        return {
          ...previous,
          advanced: nextAdvanced,
          schedule: nextAdvanced,
          access: nextAdvanced,
          project: nextAdvanced ? true : previous.project,
          controller: nextAdvanced ? true : previous.controller,
        };
      }
      return { ...previous, [key]: !previous[key] };
    })
    : onOpenOptionalSectionProp;

  useEffect(() => {
    if (!open || !isEditing) return;
    setEditOptionalSections({});
    setEditDuePickerOpen(false);
  }, [editData?.id, isEditing, open]);

  const visibleCreateOptionalSectionOptions = usesMobileSheets
    ? createOptionalSectionOptions
    : createOptionalSectionOptions.filter((option) => option.key !== 'observers');
  const supportedOptionalSectionOptions = isEditing
    ? visibleCreateOptionalSectionOptions.filter((option) => !['files', 'checklist'].includes(option.key))
    : visibleCreateOptionalSectionOptions;

  return (
        <Dialog
          open={open}
          onClose={onClose}
          fullScreen={isMobile}
          fullWidth
          maxWidth="sm"
          PaperProps={{ sx: getOfficeDialogPaperSx(ui) }}
        >
          <DialogContent sx={{ px: { xs: 1.2, sm: 2.2 }, py: { xs: 1.2, sm: 1.8 }, position: 'relative' }}>
            {createLoading ? (
              <Box
                sx={{
                  position: 'absolute',
                  inset: 0,
                  zIndex: 2,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  bgcolor: alpha(ui.panelSolid, 0.74),
                }}
              >
                <CircularProgress size={28} />
              </Box>
            ) : null}
            <Stack spacing={1.35} sx={{ opacity: createLoading ? 0.55 : 1, pointerEvents: createLoading ? 'none' : 'auto' }}>
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
                        disabled={createSaving || createLoading}
                        aria-label={isEditing ? 'Закрыть редактирование задачи' : 'Закрыть создание задачи'}
                        sx={{ mt: 0.1, width: { xs: 44, sm: 'auto' }, height: { xs: 44, sm: 'auto' } }}
                      >
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Stack>

                {usesMobileSheets ? (
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
                    resetKey={isEditing ? String(createData.id || '') : (open ? 'open' : 'closed')}
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
                    isMobile={usesMobileSheets}
                    ui={ui}
                    assigneeSummary={createAssigneeSummary}
                    selectedAssignees={selectedCreateAssignees}
                    titleTrimmed={createData.title.trim()}
                    getAssigneePickerOptions={getAssigneePickerOptions}
                    onChangeAssigneeIds={onChangeAssigneeIdsEffective}
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
                  {isEditing ? (
                    <Collapse in={editDuePickerOpen} unmountOnExit>
                      <CreateDuePickerPanel
                        presets={createDuePresets}
                        dueAt={createData.due_at}
                        customOpen={editDueCustomOpen}
                        onCustomOpenChange={onEditDueCustomOpenChange}
                        onSelectPreset={(value) => {
                          onSelectEditDuePreset?.(value);
                          setEditDuePickerOpen(false);
                        }}
                        onDueAtChange={onEditDueAtChange}
                        onClose={() => setEditDuePickerOpen(false)}
                        testIdPrefix="edit-due"
                      />
                    </Collapse>
                  ) : null}
                </Stack>

                <Divider sx={{ my: 1.25, borderColor: ui.borderSoft }} />

                <Stack direction="row" spacing={0.8} useFlexGap flexWrap="wrap">
                  {supportedOptionalSectionOptions.map((option) => {
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

              <Collapse in={Boolean((!isMobile || isEditing) && (createOptionalSections.controller || createOptionalSections.advanced))} unmountOnExit>
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

              <Collapse in={Boolean(!isMobile || isEditing)} unmountOnExit>
                <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: { xs: 1, sm: 1.2 }, borderRadius: '12px', mt: 1 }) }}>
                  <Autocomplete
                    fullWidth
                    multiple
                    size="small"
                    options={getAssigneePickerOptions(selectedCreateObservers)}
                    value={selectedCreateObservers}
                    onChange={(_, value) => onChangeObserverIdsEffective(
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
                        helperText="Наблюдатели видят задачу и участвуют в обсуждении, но не являются её исполнителями."
                      />
                    )}
                  />
                </Box>
              </Collapse>

              <Collapse in={Boolean((!isMobile || isEditing) && createOptionalSections.checklist)} unmountOnExit>
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

              <Collapse in={Boolean((!isMobile || isEditing) && createOptionalSections.files)} unmountOnExit>
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

              <Collapse in={Boolean((!isMobile || isEditing) && createOptionalSections.schedule)} unmountOnExit>
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

              <Collapse in={Boolean((!isMobile || isEditing) && createOptionalSections.project)} unmountOnExit>
                <TaskProjectFields
                  projectId={effectiveCreateProjectId}
                  projects={activeTaskProjects}
                  onProjectChange={(nextProjectId) => setCreateData((prev) => ({
                    ...prev,
                    project_id: nextProjectId,
                    object_id: '',
                  }))}
                  labelId="create-project-label"
                  showCreateRow={!isEditing}
                  projectName={createProjectName}
                  onProjectNameChange={setCreateProjectName}
                  onCreateProject={onCreateProject}
                  createProjectSaving={createProjectSaving}
                  showObject={isEditing}
                  objectId={String(createData.object_id || '')}
                  objects={editProjectObjects}
                  onObjectChange={(nextObjectId) => setCreateData((prev) => ({ ...prev, object_id: nextObjectId }))}
                />
              </Collapse>

              <Collapse in={Boolean((!isMobile || isEditing) && createOptionalSections.access)} unmountOnExit>
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
            <Button onClick={onClose} disabled={createSaving || createLoading} sx={{ textTransform: 'none', fontWeight: 700 }}>
              Отмена
            </Button>
            <Button
              variant="contained"
              onClick={onCreate}
              disabled={
                createSaving
                || createLoading
                || String(createData.title || '').trim().length < 3
                || createData.assignee_user_ids.length === 0
                || (!isEditing && !effectiveCreateProjectId)
                || (!isEditing && !String(createData.protocol_date || '').trim())
              }
              sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px', boxShadow: 'none' }}
            >
              {createLoading
                ? 'Загрузка...'
                : (createSaving
                  ? (isEditing ? 'Сохранение...' : 'Создание...')
                  : (isEditing
                    ? 'Сохранить изменения'
                    : 'Создать задачу'))}
            </Button>
          </DialogActions>
        </Dialog>
  );
}
