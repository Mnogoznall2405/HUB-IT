import {
  Autocomplete,
  Avatar,
  Box,
  Button,
  Checkbox,
  Drawer,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { priorityOptions, taskVisibilityOptions } from '../../../pages/tasks/taskConstants';
import { getFileIdentity } from '../../../pages/tasks/taskApiHelpers';
import { formatFileSize, hideMobileScrollbarSx } from '../../../pages/tasks/taskFormatters';
import {
  areSameTaskUsers,
  filterTaskUserOptions,
  getDepartmentLabel,
  getTaskUserLabel,
} from '../../../pages/tasks/taskUserUtils';
import {
  getCreateMobileSheetTitle,
  isCreateDescriptionMobileSheet,
  isCreateTallMobileSheet,
} from '../../../pages/tasks/taskCreateMobileSheet';
import MobileCreateDescriptionEditor from './MobileCreateDescriptionEditor';
import MobileCreateUserPicker from './MobileCreateUserPicker';
import { TaskProjectFields } from './TaskCreateFormSections';

function TasksCreateMobileSheetBody({
  sheet,
  createOpen,
  ui,
  theme,
  createDescriptionRef,
  createDescriptionPreview,
  createData,
  handleCreateDescriptionDraftChange,
  handleCloseCreateMobileSheet,
  handleAddCreateFiles,
  handleChangeCreateAssigneeIds,
  handleClearCreateAssignees,
  searchCreateAssignees,
  resolveCreateAssignees,
  setCreateData,
  setCreateOptionalSections,
  setCreateMobileSheet,
  createSaving,
  createFiles,
  handleRemoveCreateFile,
  createChecklistItems,
  handleAddChecklistItem,
  handleUpdateChecklistItem,
  handleRemoveChecklistItem,
  effectiveCreateProjectId,
  activeTaskProjects,
  createProjectName,
  setCreateProjectName,
  handleCreateProjectFromTaskDialog,
  createProjectSaving,
  controllers,
  handleChangeCreateControllerId,
  handleClearCreateController,
  taskUsersLoading,
  taskUsersLoadError,
  loadTaskUserDirectories,
  handleChangeCreateObserverIds,
  handleClearCreateObservers,
  selectedCreateController,
  renderTaskUserOption,
  taskUserAutocompleteSlotProps,
  departments,
  selectedCreateDepartment,
}) {
    if (sheet === 'description') {
      return (
        <MobileCreateDescriptionEditor
          initialValue={createDescriptionRef.current || createDescriptionPreview || createData.description}
          onDraftChange={handleCreateDescriptionDraftChange}
          onDone={handleCloseCreateMobileSheet}
          onAddFiles={handleAddCreateFiles}
          resetKey={`${createOpen ? 'open' : 'closed'}:mobile-description:${sheet}`}
          ui={ui}
          theme={theme}
        />
      );
    }

    if (sheet === 'assignees') {
      return (
        <MobileCreateUserPicker
          key="create-assignees-mobile-picker"
          selectedIds={createData.assignee_user_ids}
          onChange={handleChangeCreateAssigneeIds}
          onClear={handleClearCreateAssignees}
          onDone={handleCloseCreateMobileSheet}
          onSearchUsers={searchCreateAssignees}
          resolveUsers={resolveCreateAssignees}
          searchAriaLabel="Поиск исполнителей"
          ui={ui}
          theme={theme}
        />
      );
    }

    if (sheet === 'priority') {
      return (
        <Stack spacing={0.35}>
          {priorityOptions.map((item) => {
            const selected = createData.priority === item.value;
            return (
              <Button
                key={item.value}
                data-testid={`create-priority-mobile-${item.value}`}
                onClick={() => {
                  setCreateData((prev) => ({ ...prev, priority: item.value }));
                  setCreateOptionalSections((prev) => ({ ...prev, priority: item.value !== 'normal' }));
                  setCreateMobileSheet('');
                }}
                sx={{
                  minHeight: 56,
                  justifyContent: 'space-between',
                  textTransform: 'none',
                  color: ui.text,
                  borderRadius: '14px',
                  bgcolor: selected ? alpha(item.dotColor, 0.16) : 'transparent',
                  '&:hover': { bgcolor: selected ? alpha(item.dotColor, 0.2) : ui.actionHover },
                }}
              >
                <Stack direction="row" spacing={1} alignItems="center">
                  <Box sx={{ width: 9, height: 9, borderRadius: '999px', bgcolor: item.dotColor }} />
                  <Typography sx={{ fontWeight: 900 }}>{item.label}</Typography>
                </Stack>
                {selected ? <CheckIcon sx={{ color: item.dotColor }} /> : null}
              </Button>
            );
          })}
        </Stack>
      );
    }

    if (sheet === 'files') {
      return (
        <Stack spacing={1}>
          <Button
            component="label"
            variant="outlined"
            startIcon={<AttachFileIcon />}
            disabled={createSaving}
            sx={{ textTransform: 'none', fontWeight: 900, borderRadius: '12px' }}
          >
            {createFiles.length > 0 ? 'Добавить файлы' : 'Выбрать файлы'}
            <input
              type="file"
              hidden
              multiple
              onChange={(event) => {
                handleAddCreateFiles(event.target.files);
                event.target.value = '';
              }}
            />
          </Button>
          {createFiles.length === 0 ? (
            <Typography variant="body2" sx={{ color: ui.mutedText }}>
              Файлы прикрепятся автоматически после создания задачи.
            </Typography>
          ) : (
            <Stack spacing={0.7}>
              {createFiles.map((file, index) => (
                <Box key={`${getFileIdentity(file)}:${index}`} sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 0.75, borderRadius: '12px', bgcolor: ui.actionBg }}>
                  <Avatar sx={{ width: 30, height: 30, bgcolor: alpha(theme.palette.primary.main, 0.14), color: theme.palette.primary.main }}>
                    <AttachFileIcon sx={{ fontSize: 16 }} />
                  </Avatar>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography sx={{ fontWeight: 850, fontSize: '0.88rem' }} noWrap>
                      {file?.name || 'file'}
                    </Typography>
                    <Typography variant="caption" sx={{ color: ui.subtleText }}>
                      {formatFileSize(file?.size)}
                    </Typography>
                  </Box>
                  <IconButton size="small" aria-label={`Убрать файл ${file?.name || index + 1}`} onClick={() => handleRemoveCreateFile(index)} disabled={createSaving}>
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Box>
              ))}
            </Stack>
          )}
          <Button onClick={handleCloseCreateMobileSheet} sx={{ textTransform: 'none', fontWeight: 800 }}>
            Готово
          </Button>
        </Stack>
      );
    }

    if (sheet === 'checklist') {
      return (
        <Stack spacing={1}>
          <Button variant="outlined" startIcon={<AddIcon />} onClick={handleAddChecklistItem} sx={{ textTransform: 'none', fontWeight: 900, borderRadius: '12px' }}>
            Добавить пункт
          </Button>
          <Stack spacing={0.8}>
            {createChecklistItems.map((item, index) => (
              <Stack key={item.id} direction="row" spacing={0.7} alignItems="center">
                <Checkbox checked={Boolean(item.done)} onChange={(event) => handleUpdateChecklistItem(item.id, { done: event.target.checked })} sx={{ p: 0.35 }} />
                <TextField
                  value={item.text}
                  onChange={(event) => handleUpdateChecklistItem(item.id, { text: event.target.value })}
                  placeholder={`Пункт ${index + 1}`}
                  size="small"
                  fullWidth
                />
                <IconButton size="small" aria-label={`Удалить пункт ${index + 1}`} onClick={() => handleRemoveChecklistItem(item.id)}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Stack>
            ))}
          </Stack>
          <Button variant="contained" onClick={handleCloseCreateMobileSheet} sx={{ textTransform: 'none', fontWeight: 900, borderRadius: '12px', boxShadow: 'none' }}>
            Готово
          </Button>
        </Stack>
      );
    }

    if (sheet === 'project') {
      return (
        <Stack spacing={1}>
          <TaskProjectFields
            projectId={effectiveCreateProjectId}
            projects={activeTaskProjects}
            onProjectChange={(nextProjectId) => setCreateData((prev) => ({ ...prev, project_id: nextProjectId, object_id: '' }))}
            labelId="create-project-mobile-label"
            showCreateRow
            projectName={createProjectName}
            onProjectNameChange={setCreateProjectName}
            onCreateProject={handleCreateProjectFromTaskDialog}
            createProjectSaving={createProjectSaving}
          />
          <Button variant="contained" onClick={handleCloseCreateMobileSheet} sx={{ textTransform: 'none', fontWeight: 900, borderRadius: '12px', boxShadow: 'none' }}>
            Готово
          </Button>
        </Stack>
      );
    }

    if (sheet === 'controller') {
      return (
        <MobileCreateUserPicker
          options={controllers}
          selectedIds={createData.controller_user_id ? [createData.controller_user_id] : []}
          onChange={handleChangeCreateControllerId}
          onClear={handleClearCreateController}
          onDone={handleCloseCreateMobileSheet}
          multiple={false}
          loading={taskUsersLoading && controllers.length === 0}
          loadError={taskUsersLoadError}
          onRetry={() => { void loadTaskUserDirectories({ force: true }); }}
          searchAriaLabel="Поиск контролёров"
          testIdPrefix="create-controller-mobile"
          optionTestIdPrefix="create-controller-mobile-option"
          ui={ui}
          theme={theme}
        />
      );
    }

    if (sheet === 'observers') {
      return (
        <MobileCreateUserPicker
          key="create-observers-mobile-picker"
          selectedIds={createData.observer_user_ids}
          onChange={handleChangeCreateObserverIds}
          onClear={handleClearCreateObservers}
          onDone={handleCloseCreateMobileSheet}
          onSearchUsers={searchCreateAssignees}
          resolveUsers={resolveCreateAssignees}
          searchAriaLabel="Поиск наблюдателей"
          testIdPrefix="create-observers-mobile"
          optionTestIdPrefix="create-observers-mobile-option"
          ui={ui}
          theme={theme}
        />
      );
    }

    if (sheet === 'advanced') {
      return (
        <Stack spacing={1.1}>
          <TextField label="Дата постановки задачи" type="date" value={createData.protocol_date} onChange={(event) => setCreateData((prev) => ({ ...prev, protocol_date: event.target.value }))} InputLabelProps={{ shrink: true }} fullWidth size="small" />
          <FormControl fullWidth size="small">
            <InputLabel id="create-priority-mobile-advanced-label">Приоритет</InputLabel>
            <Select labelId="create-priority-mobile-advanced-label" label="Приоритет" value={createData.priority} onChange={(event) => setCreateData((prev) => ({ ...prev, priority: event.target.value }))}>
              {priorityOptions.map((item) => <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>)}
            </Select>
          </FormControl>
          <TaskProjectFields
            projectId={effectiveCreateProjectId}
            projects={activeTaskProjects}
            onProjectChange={(nextProjectId) => setCreateData((prev) => ({ ...prev, project_id: nextProjectId, object_id: '' }))}
            labelId="create-project-mobile-advanced-label"
          />
          <Autocomplete
            fullWidth
            size="small"
            options={controllers}
            value={selectedCreateController}
            onChange={(_, value) => setCreateData((prev) => ({ ...prev, controller_user_id: String(value?.id || '') }))}
            getOptionLabel={getTaskUserLabel}
            filterOptions={filterTaskUserOptions}
            isOptionEqualToValue={areSameTaskUsers}
            renderOption={renderTaskUserOption}
            slotProps={taskUserAutocompleteSlotProps}
            renderInput={(params) => <TextField {...params} label="Контролёр" placeholder="Фамилия или логин" />}
          />
          <Autocomplete
            fullWidth
            size="small"
            options={departments}
            value={selectedCreateDepartment}
            onChange={(_, value) => setCreateData((prev) => ({ ...prev, department_id: String(value?.id || ''), visibility_scope: value?.id ? (prev.visibility_scope || 'department') : 'private' }))}
            getOptionLabel={getDepartmentLabel}
            isOptionEqualToValue={(option, value) => String(option?.id || '') === String(value?.id || '')}
            renderInput={(params) => <TextField {...params} label="Отдел" placeholder="Автоматически по исполнителю" />}
          />
          <FormControl fullWidth size="small">
            <InputLabel id="create-visibility-mobile-advanced-label">Видимость</InputLabel>
            <Select labelId="create-visibility-mobile-advanced-label" label="Видимость" value={createData.visibility_scope} onChange={(event) => setCreateData((prev) => ({ ...prev, visibility_scope: event.target.value }))}>
              {taskVisibilityOptions.map((item) => <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>)}
            </Select>
          </FormControl>
          <Button variant="contained" onClick={handleCloseCreateMobileSheet} sx={{ textTransform: 'none', fontWeight: 900, borderRadius: '12px', boxShadow: 'none' }}>
            Готово
          </Button>
        </Stack>
      );
    }

}

export default function TasksCreateMobileSheet({
  open = false,
  sheet = '',
  onClose,
  ui,
  theme,
  bodyProps,
}) {
  const tall = isCreateTallMobileSheet(sheet);
  const descriptionSheet = isCreateDescriptionMobileSheet(sheet);
  const title = getCreateMobileSheetTitle(sheet);

  return (
    <Drawer
      data-testid="create-mobile-sheet-drawer"
      anchor="bottom"
      open={open}
      onClose={onClose}
      sx={{ zIndex: theme.zIndex.modal + 2 }}
      PaperProps={{
        style: { zIndex: theme.zIndex.modal + 3 },
        sx: {
          borderTopLeftRadius: 22,
          borderTopRightRadius: 22,
          bgcolor: ui.panelSolid,
          color: ui.text,
          borderTop: '1px solid',
          borderColor: ui.borderSoft,
          boxShadow: ui.dialogShadow,
          height: tall ? '90dvh' : 'auto',
          maxHeight: tall ? '92dvh' : '88dvh',
          overflow: 'hidden',
        },
      }}
    >
      <Box
        data-testid="create-mobile-sheet"
        sx={{
          px: 2,
          pt: 1.1,
          pb: tall ? 0 : 'calc(1.4rem + env(safe-area-inset-bottom, 0px))',
          height: tall ? '100%' : 'auto',
          maxHeight: tall ? 'none' : '88dvh',
          overflowY: tall ? 'hidden' : 'auto',
          ...hideMobileScrollbarSx,
        }}
      >
        <Box sx={{ width: 54, height: 5, borderRadius: 999, bgcolor: alpha(ui.mutedText, 0.35), mx: 'auto', mb: 1.4 }} />
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ mb: descriptionSheet ? 1.8 : 1.2 }}>
          <Typography sx={{ fontWeight: 950, fontSize: descriptionSheet ? '1.52rem' : '1.16rem', textAlign: descriptionSheet ? 'center' : 'left', flex: descriptionSheet ? 1 : 'initial' }}>
            {title}
          </Typography>
          <IconButton size="small" aria-label="Закрыть плашку" onClick={onClose} sx={{ visibility: descriptionSheet ? 'hidden' : 'visible' }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
        <Box sx={{ height: tall ? 'calc(100% - 72px)' : 'auto', minHeight: 0 }}>
          <TasksCreateMobileSheetBody sheet={sheet} {...bodyProps} />
        </Box>
      </Box>
    </Drawer>
  );
}
