import AttachFileIcon from '@mui/icons-material/AttachFile';
import ChecklistOutlinedIcon from '@mui/icons-material/ChecklistOutlined';
import FlagIcon from '@mui/icons-material/Flag';
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined';
import SupervisorAccountOutlinedIcon from '@mui/icons-material/SupervisorAccountOutlined';
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import { toDateInput } from './taskFormatters';

export const createEmptyProjectDraft = () => ({
  name: '',
  code: '',
  description: '',
  is_active: true,
});

export const createEmptyObjectDraft = (projectId = '') => ({
  project_id: String(projectId || ''),
  name: '',
  code: '',
  description: '',
  is_active: true,
});

export const createOptionalSectionOptions = [
  { key: 'priority', label: 'В приоритете', icon: FlagIcon },
  { key: 'files', label: 'Файлы', icon: AttachFileIcon },
  { key: 'checklist', label: 'Чек-листы', icon: ChecklistOutlinedIcon },
  { key: 'project', label: 'Проект', icon: FolderOpenOutlinedIcon },
  { key: 'controller', label: 'Контролёр', icon: SupervisorAccountOutlinedIcon },
  { key: 'observers', label: 'Наблюдатели', icon: VisibilityOutlinedIcon },
  { key: 'advanced', label: 'Полная форма', icon: TuneOutlinedIcon },
];

export const createEmptyOptionalSections = () => ({
  priority: false,
  files: false,
  checklist: false,
  schedule: false,
  project: false,
  controller: false,
  observers: false,
  access: false,
  advanced: false,
});

export const createInitialTaskDraft = (projectId = '') => ({
  title: '',
  description: '',
  assignee_user_ids: [],
  observer_user_ids: [],
  controller_user_id: '',
  project_id: String(projectId || ''),
  object_id: '',
  protocol_date: toDateInput(new Date().toISOString()),
  due_at: '',
  priority: 'normal',
  department_id: '',
  visibility_scope: 'private',
  email_deadline_remind_mode: 'default',
  email_deadline_remind_hours: 24,
});
