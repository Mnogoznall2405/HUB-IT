from pathlib import Path

tasks_path = Path(__file__).resolve().parents[1] / 'src' / 'pages' / 'Tasks.jsx'
out_path = Path(__file__).resolve().parents[1] / 'src' / 'components' / 'hub' / 'tasks' / 'TasksCreateDialog.jsx'
lines = tasks_path.read_text(encoding='utf-8').splitlines()
# Dialog block: lines 4776-5390 (1-based) => indices 4775:5390
block = lines[4775:5390]
inner = '\n'.join(block)

replacements = [
    ('open={createOpen}', 'open={open}'),
    ('onClose={handleCloseCreateDialog}', 'onClose={onClose}'),
    ('onClick={handleCloseCreateDialog}', 'onClick={onClose}'),
    ('resetKey={createOpen ? \'open\' : \'closed\'}', 'resetKey={open ? \'open\' : \'closed\'}'),
    ('onDraftChange={handleCreateDescriptionDraftChange}', 'onDraftChange={onCreateDescriptionDraftChange}'),
    ('onClick={() => handleOpenCreateMobileSheet(', 'onClick={() => onOpenOptionalSection('),
    ('onChange={(_, value) => handleChangeCreateAssigneeIds(', 'onChange={(_, value) => onChangeAssigneeIds('),
    ('onChange={(_, value) => handleChangeCreateObserverIds(', 'onChange={(_, value) => onChangeObserverIds('),
    ('onClick={() => setCreateDuePickerOpen(true)}', 'onClick={onOpenDuePicker}'),
    ('onClick={handleCreateTask}', 'onClick={onCreate}'),
    ('onClick={handleAddChecklistItem}', 'onClick={onAddChecklistItem}'),
    ('onChange={(event) => handleUpdateChecklistItem(item.id, { done: event.target.checked })}',
     'onChange={(event) => onUpdateChecklistItem(item.id, { done: event.target.checked })}'),
    ('onChange={(event) => handleUpdateChecklistItem(item.id, { text: event.target.value })}',
     'onChange={(event) => onUpdateChecklistItem(item.id, { text: event.target.value })}'),
    ('onClick={() => handleRemoveChecklistItem(item.id)}', 'onClick={() => onRemoveChecklistItem(item.id)}'),
    ('handleAddCreateFiles(event.target.files);', 'onAddCreateFiles(event.target.files);'),
    ('onClick={() => handleRemoveCreateFile(index)}', 'onClick={() => onRemoveCreateFile(index)}'),
    ('void handleCreateProjectFromTaskDialog()', 'void onCreateProject()'),
]

for old, new in replacements:
    inner = inner.replace(old, new)

header = '''import {
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
'''

footer = '''
  );
}
'''

out_path.write_text(header + inner + footer, encoding='utf-8')
print(f'Wrote {out_path} ({out_path.stat().st_size} bytes)')
