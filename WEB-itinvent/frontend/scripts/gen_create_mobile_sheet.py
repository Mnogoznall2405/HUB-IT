from pathlib import Path

tasks_path = Path(__file__).resolve().parents[1] / 'src' / 'pages' / 'Tasks.jsx'
out_path = Path(__file__).resolve().parents[1] / 'src' / 'components' / 'hub' / 'tasks' / 'TasksCreateMobileSheet.jsx'
lines = tasks_path.read_text(encoding='utf-8').splitlines()
block = lines[4294:4568]
inner = block[1:-1]
inner_text = '\n'.join(inner)
inner_text = inner_text.replace('createMobileSheet ===', 'sheet ===')
inner_text = inner_text.replace('${createMobileSheet}', '${sheet}')

header = '''import {
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
'''

footer = '''
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
'''

out_path.write_text(header + inner_text + footer, encoding='utf-8')
print(out_path)
