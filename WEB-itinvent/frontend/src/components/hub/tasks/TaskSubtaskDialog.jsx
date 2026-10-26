import {
  Alert,
  Autocomplete,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { priorityOptions } from '../../../pages/tasks/taskConstants';
import { areSameTaskUsers, getTaskUserLabel } from '../../../pages/tasks/taskUserUtils';

export default function TaskSubtaskDialog({
  open,
  parent,
  draft,
  onChangeDraft,
  saving = false,
  error = '',
  isMobile = false,
  ui,
  selectedAssignees = [],
  getAssigneePickerOptions,
  onChangeAssigneeIds,
  renderTaskUserOptionMultiple,
  renderTaskUserTags,
  assigneeAutocompleteProps,
  taskUserAutocompleteSlotProps,
  onClose,
  onSubmit,
}) {
  const setField = (key, value) => onChangeDraft((prev) => ({ ...prev, [key]: value }));

  return (
    <Dialog
      open={Boolean(open)}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      fullScreen={isMobile}
      aria-labelledby="task-subtask-dialog-title"
      PaperProps={{ sx: { borderRadius: isMobile ? 0 : '16px', bgcolor: ui?.panelSolid } }}
    >
      <DialogTitle id="task-subtask-dialog-title" sx={{ fontWeight: 900 }}>
        Новая подзадача
        {parent?.title ? (
          <Typography variant="body2" sx={{ color: ui?.mutedText, fontWeight: 600, mt: 0.3 }} noWrap>
            {`К задаче: ${parent.title}`}
          </Typography>
        ) : null}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={1.6} sx={{ pt: 0.8 }}>
          <TextField
            label="Название"
            value={draft.title}
            onChange={(event) => setField('title', event.target.value)}
            size="small"
            fullWidth
            autoFocus
            required
            disabled={saving}
          />
          <TextField
            label="Описание"
            value={draft.description}
            onChange={(event) => setField('description', event.target.value)}
            size="small"
            fullWidth
            multiline
            minRows={3}
            disabled={saving}
          />
          <Autocomplete
            multiple
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
            disabled={saving}
            {...assigneeAutocompleteProps}
            renderOption={renderTaskUserOptionMultiple}
            renderTags={renderTaskUserTags}
            slotProps={taskUserAutocompleteSlotProps}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Исполнители"
                required
                placeholder={selectedAssignees.length === 0 ? 'Фамилия или логин' : ''}
              />
            )}
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.4}>
            <TextField
              label="Срок"
              type="datetime-local"
              value={draft.due_at}
              onChange={(event) => setField('due_at', event.target.value)}
              size="small"
              fullWidth
              disabled={saving}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              select
              label="Приоритет"
              value={draft.priority}
              onChange={(event) => setField('priority', event.target.value)}
              size="small"
              fullWidth
              disabled={saving}
            >
              {priorityOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
              ))}
            </TextField>
          </Stack>
          <Typography variant="caption" sx={{ color: ui?.mutedText }}>
            Подзадача видна автору, исполнителям и контролёру родительской задачи.
          </Typography>
          {error ? <Alert severity="error" role="alert">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={saving} sx={{ textTransform: 'none', fontWeight: 700 }}>
          Отмена
        </Button>
        <Button
          variant="contained"
          onClick={onSubmit}
          disabled={saving}
          sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px' }}
        >
          {saving ? 'Создание…' : 'Создать подзадачу'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
