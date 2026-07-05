import {
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import CreateDuePickerPanel from '../CreateDuePickerPanel';
import { priorityOptions, taskVisibilityOptions } from '../../../pages/tasks/taskConstants';
import {
  areSameTaskUsers,
  filterTaskUserOptions,
  getDepartmentLabel,
  getTaskUserLabel,
} from '../../../pages/tasks/taskUserUtils';
import { getOfficeDialogPaperSx, getOfficeHeaderBandSx } from '../../../theme/officeUiTokens';
import EmailDeadlineRemindFields from './EmailDeadlineRemindFields';
import LocalTaskMarkdownEditor from './LocalTaskMarkdownEditor';
import { TaskProjectFields } from './TaskCreateFormSections';

export default function TasksEditDialog({
  open = false,
  onClose,
  isMobile = false,
  ui,
  editData,
  setEditData,
  editSaving = false,
  onSave,
  onEditDescriptionDraftChange,
  onAiTransform,
  onEditObserversChange,
  selectedEditAssignee = null,
  selectedEditController = null,
  selectedEditObservers = [],
  selectedEditDepartment = null,
  getAssigneePickerOptions,
  controllers = [],
  departments = [],
  activeTaskProjects = [],
  editProjectObjects = [],
  onSingleAssigneeAutocompleteChange,
  renderTaskUserOption,
  renderTaskUserOptionMultiple,
  renderTaskObserverTags,
  taskUserAutocompleteSlotProps,
  assigneeAutocompleteProps,
  observerAutocompleteProps,
  getAssigneeAutocompleteInputValue,
  createDuePresets = [],
  editDueLabel = 'Без срока',
  editDueCustomOpen = false,
  onEditDueCustomOpenChange,
  onSelectEditDuePreset,
  onEditDueAtChange,
  taskEmailDeadlineDefaultHours = 24,
}) {
  const titleValid = String(editData?.title || '').trim().length >= 3;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen={isMobile}
      fullWidth
      maxWidth="md"
      PaperProps={{ sx: getOfficeDialogPaperSx(ui) }}
    >
      <Box sx={{ ...getOfficeHeaderBandSx(ui, { px: 2.2, py: 1.7 }), position: { xs: 'sticky', sm: 'static' }, top: 0, zIndex: 2 }}>
        <Typography sx={{ fontWeight: 900, fontSize: '1.05rem' }}>Редактирование задачи</Typography>
        <Typography variant="body2" sx={{ color: ui.mutedText, mt: 0.35 }}>
          Автор и администратор могут менять состав участников, срок, приоритет и описание.
        </Typography>
      </Box>

      <DialogContent sx={{ px: { xs: 1, sm: 2.2 }, py: { xs: 1, sm: 1.6 } }}>
        <Stack spacing={1.5}>
          <TextField
            label="Заголовок"
            value={editData.title}
            onChange={(event) => setEditData((prev) => ({ ...prev, title: event.target.value }))}
            fullWidth
            required
          />

          <LocalTaskMarkdownEditor
            label="Описание"
            initialValue={editData.description}
            onDraftChange={onEditDescriptionDraftChange}
            resetKey={editData.id}
            minRows={6}
            enableAiTransform
            transformContext="task"
            onAiTransform={onAiTransform}
            visualVariant="taskDialog"
          />

          <Grid container spacing={1.2}>
            <Grid item xs={12} md={6}>
              <Autocomplete
                fullWidth
                size="small"
                options={getAssigneePickerOptions(selectedEditAssignee)}
                value={selectedEditAssignee}
                onChange={onSingleAssigneeAutocompleteChange((value) => {
                  setEditData((prev) => ({ ...prev, assignee_user_id: String(value?.id || '') }));
                })}
                getOptionLabel={getTaskUserLabel}
                isOptionEqualToValue={areSameTaskUsers}
                clearOnEscape
                renderOption={renderTaskUserOption}
                slotProps={taskUserAutocompleteSlotProps}
                {...assigneeAutocompleteProps}
                inputValue={getAssigneeAutocompleteInputValue(selectedEditAssignee)}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Исполнитель"
                    placeholder="Введите фамилию или логин"
                  />
                )}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <Autocomplete
                fullWidth
                size="small"
                options={controllers}
                value={selectedEditController}
                onChange={(_, value) => setEditData((prev) => ({ ...prev, controller_user_id: String(value?.id || '') }))}
                getOptionLabel={getTaskUserLabel}
                filterOptions={filterTaskUserOptions}
                isOptionEqualToValue={areSameTaskUsers}
                clearOnEscape
                noOptionsText="Ничего не найдено"
                renderOption={renderTaskUserOption}
                slotProps={taskUserAutocompleteSlotProps}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Контролёр"
                    placeholder="Введите фамилию или логин"
                  />
                )}
              />
            </Grid>
            <Grid item xs={12}>
              <Autocomplete
                fullWidth
                multiple
                size="small"
                options={getAssigneePickerOptions(selectedEditObservers)}
                value={selectedEditObservers}
                onChange={onEditObserversChange}
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
                    helperText="Наблюдатели видят задачу и могут писать в чат"
                  />
                )}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <Autocomplete
                fullWidth
                size="small"
                options={departments}
                value={selectedEditDepartment}
                onChange={(_, value) => setEditData((prev) => ({
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
                    placeholder="Без отдела"
                  />
                )}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth size="small">
                <InputLabel id="edit-visibility-label">Видимость</InputLabel>
                <Select
                  labelId="edit-visibility-label"
                  label="Видимость"
                  value={editData.visibility_scope}
                  onChange={(event) => setEditData((prev) => ({ ...prev, visibility_scope: event.target.value }))}
                >
                  {taskVisibilityOptions.map((item) => (
                    <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={8}>
              <TaskProjectFields
                layout="grid"
                projectId={editData.project_id}
                projects={activeTaskProjects}
                onProjectChange={(nextProjectId) => setEditData((prev) => ({
                  ...prev,
                  project_id: nextProjectId,
                  object_id: '',
                }))}
                labelId="edit-project-label"
                showObject
                objectId={editData.object_id}
                objects={editProjectObjects}
                onObjectChange={(nextObjectId) => setEditData((prev) => ({ ...prev, object_id: nextObjectId }))}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                label="Дата постановки задачи"
                type="date"
                value={editData.protocol_date}
                onChange={(event) => setEditData((prev) => ({ ...prev, protocol_date: event.target.value }))}
                InputLabelProps={{ shrink: true }}
                fullWidth
                size="small"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <Typography sx={{ mb: 0.8, fontWeight: 700, color: ui.subtleText, fontSize: '0.86rem' }}>
                Крайний срок: {editDueLabel}
              </Typography>
              <CreateDuePickerPanel
                presets={createDuePresets}
                dueAt={editData.due_at}
                customOpen={editDueCustomOpen}
                onCustomOpenChange={onEditDueCustomOpenChange}
                onSelectPreset={onSelectEditDuePreset}
                onDueAtChange={onEditDueAtChange}
                showTitle={false}
                testIdPrefix="edit-due"
                emailRemindSlot={String(editData.due_at || '').trim() ? (
                  <Box sx={{ mt: 1.2 }}>
                    <EmailDeadlineRemindFields
                      dueAt={editData.due_at}
                      mode={editData.email_deadline_remind_mode}
                      hours={editData.email_deadline_remind_hours}
                      defaultHours={taskEmailDeadlineDefaultHours}
                      onModeChange={(value) => setEditData((prev) => ({ ...prev, email_deadline_remind_mode: value }))}
                      onHoursChange={(value) => setEditData((prev) => ({ ...prev, email_deadline_remind_hours: value }))}
                      testIdPrefix="edit-email-remind"
                    />
                  </Box>
                ) : null}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth size="small">
                <InputLabel id="edit-priority-label">Приоритет</InputLabel>
                <Select
                  labelId="edit-priority-label"
                  label="Приоритет"
                  value={editData.priority}
                  onChange={(event) => setEditData((prev) => ({ ...prev, priority: event.target.value }))}
                >
                  {priorityOptions.map((item) => (
                    <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: { xs: 1, sm: 2.2 }, py: 1.4, borderTop: '1px solid', borderColor: ui.borderSoft, position: { xs: 'sticky', sm: 'static' }, bottom: 0, bgcolor: ui.pageBg, flexDirection: { xs: 'column-reverse', sm: 'row' }, gap: { xs: 0.8, sm: 0 }, '& > :not(style)': { m: 0, width: { xs: '100%', sm: 'auto' } } }}>
        <Button onClick={onClose} disabled={editSaving} sx={{ textTransform: 'none', fontWeight: 700 }}>
          Отмена
        </Button>
        <Button
          variant="contained"
          onClick={onSave}
          disabled={editSaving || !titleValid}
          sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px', boxShadow: 'none' }}
        >
          {editSaving ? 'Сохранение...' : 'Сохранить изменения'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
