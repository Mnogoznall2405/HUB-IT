import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const srcPath = path.join(root, 'src/pages/AccountWorkspace.jsx');
const src = fs.readFileSync(srcPath, 'utf8');
const lines = src.split(/\r?\n/);

function slice(start, end) {
  return lines.slice(start - 1, end).join('\n');
}

function body(start, end, fnName) {
  const chunk = slice(start, end);
  const re = new RegExp(`^function ${fnName}\\([^)]*\\) \\{`);
  return chunk.replace(re, '').replace(/\n\}$/, '');
}

const base = path.join(root, 'src/pages/account');
for (const dir of [
  base,
  path.join(base, 'shared'),
  path.join(base, 'settings'),
  path.join(base, 'settings/notifications'),
  path.join(base, 'profile'),
  path.join(base, 'admin'),
  path.join(base, 'hooks'),
]) {
  fs.mkdirSync(dir, { recursive: true });
}

function write(rel, content) {
  const full = path.join(base, rel);
  fs.writeFileSync(full, content, 'utf8');
  console.log(`Wrote ${rel} (${content.split('\n').length} lines)`);
}

write('accountConstants.js', `import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import PaletteOutlinedIcon from '@mui/icons-material/PaletteOutlined';
import GroupOutlinedIcon from '@mui/icons-material/GroupOutlined';
import SecurityOutlinedIcon from '@mui/icons-material/SecurityOutlined';
import SettingsApplicationsOutlinedIcon from '@mui/icons-material/SettingsApplicationsOutlined';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';

${slice(139, 190)}

${slice(192, 338)}

${slice(4333, 4442)}
`);

write('accountUserModel.js', slice(340, 529) + '\n');

write('shared/SectionCard.jsx', `import { useMemo } from 'react';
import { Box, Divider, Paper, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { buildOfficeUiTokens, getOfficeHeaderBandSx, getOfficePanelSx } from '../../../theme/officeUiTokens';

export default function SectionCard({ title, description, action, children, sx, headerSx, contentSx }) {
${body(531, 580, 'SectionCard')}
}
`);

write('shared/MetricTile.jsx', `import { useMemo } from 'react';
import { Box, Paper, Stack, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { buildOfficeUiTokens, getOfficeMetricBlockSx } from '../../../theme/officeUiTokens';

export default function MetricTile({ icon, label, value, caption, compact = false }) {
${body(582, 637, 'MetricTile')}
}
`);

write('shared/ProfileField.jsx', `import { Box, Typography } from '@mui/material';

export default function ProfileField({ label, value }) {
${body(639, 650, 'ProfileField')}
}
`);

write('settings/notifications/NotificationChannelsSettingsCard.jsx', `import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Chip,
  FormControlLabel,
  FormGroup,
  Paper,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import NotificationsActiveOutlinedIcon from '@mui/icons-material/NotificationsActiveOutlined';
import { useTheme } from '@mui/material/styles';
import { settingsAPI } from '../../../api/client';
import { getChatNotificationState, subscribeChatNotificationState } from '../../../lib/chatNotifications';
import { buildOfficeUiTokens, getOfficeSubtlePanelSx } from '../../../theme/officeUiTokens';
import SectionCard from '../../shared/SectionCard';

export function NotificationChannelsSettingsCard() {
${body(2153, 2263, 'NotificationChannelsSettingsCard')}
}
`);

write('settings/notifications/ChatNotificationsSettingsCard.jsx', `import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  CircularProgress,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import NotificationsActiveOutlinedIcon from '@mui/icons-material/NotificationsActiveOutlined';
import { useTheme } from '@mui/material/styles';
import { useAuth } from '../../../contexts/AuthContext';
import { useNotification } from '../../../contexts/NotificationContext';
import {
  getChatNotificationState,
  refreshChatNotificationState,
  requestChatNotificationPermission,
  setChatNotificationsEnabled,
  subscribeChatNotificationState,
  syncChatPushSubscription,
} from '../../../lib/chatNotifications';
import { isNativeShellRuntime } from '../../../lib/platform';
import { buildOfficeUiTokens, getOfficeSubtlePanelSx } from '../../../theme/officeUiTokens';
import { CHAT_FOREGROUND_DIAGNOSTIC_LABELS, CHAT_FOREGROUND_ONLY_REASON_LABELS } from '../../accountConstants';
import { formatDateTime } from '../../accountUserModel';
import SectionCard from '../../shared/SectionCard';

export function ChatNotificationsSettingsCard() {
${body(2265, 2534, 'ChatNotificationsSettingsCard')}
}
`);

write('settings/notifications/BrowserNotificationsSettingsCard.jsx', `import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import NotificationsActiveOutlinedIcon from '@mui/icons-material/NotificationsActiveOutlined';
import { useTheme } from '@mui/material/styles';
import {
  getWindowsNotificationState,
  requestBrowserNotificationPermission,
  setWindowsNotificationsEnabled,
  WINDOWS_NOTIFICATIONS_CHANGED_EVENT,
} from '../../../lib/windowsNotifications';
import { isNativeShellRuntime } from '../../../lib/platform';
import { buildOfficeUiTokens, getOfficeSubtlePanelSx } from '../../../theme/officeUiTokens';
import SectionCard from '../../shared/SectionCard';

export function BrowserNotificationsSettingsCard() {
${body(2536, 2676, 'BrowserNotificationsSettingsCard')}
}
`);

write('settings/MobileBottomNavSettingsCard.jsx', `import { useCallback, useMemo } from 'react';
import {
  Box,
  Button,
  ButtonBase,
  Chip,
  Stack,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { DEFAULT_MOBILE_BOTTOM_NAV_ITEMS } from '../../contexts/PreferencesContext';
import { buildOfficeUiTokens, getOfficeSubtlePanelSx } from '../../theme/officeUiTokens';
import SectionCard from '../shared/SectionCard';

export function MobileBottomNavSettingsCard({
  availableItems,
  selectedPaths,
  resolvedItems,
  onChange,
}) {
${body(1909, 2079, 'MobileBottomNavSettingsCard')}
}
`);

write('settings/HubItPwaSettingsCard.jsx', `import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import ExpandMoreOutlinedIcon from '@mui/icons-material/ExpandMoreOutlined';
import GetAppOutlinedIcon from '@mui/icons-material/GetAppOutlined';
import PhoneIphoneOutlinedIcon from '@mui/icons-material/PhoneIphoneOutlined';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import { useNotification } from '../../contexts/NotificationContext';
import { getChatNotificationState, subscribeChatNotificationState } from '../../lib/chatNotifications';
import { isNativeShellRuntime } from '../../lib/platform';
import {
  applyPwaUpdate,
  getPwaInstallState,
  promptPwaInstall,
  refreshPwaInstallState,
  subscribePwaInstallState,
} from '../../lib/pwaInstall';
import { buildOfficeUiTokens, getOfficeSubtlePanelSx } from '../../theme/officeUiTokens';
import { formatDateTime } from '../accountUserModel';
import SectionCard from '../shared/SectionCard';

export default function HubItPwaSettingsCard() {
${body(1607, 1907, 'HubItPwaSettingsCard')}
}
`);

write('settings/AppearanceTab.jsx', `import {
  Box,
  Button,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Slider,
  Typography,
} from '@mui/material';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import SectionCard from '../shared/SectionCard';
import { MobileBottomNavSettingsCard } from './MobileBottomNavSettingsCard';

export default function AppearanceTab({
  themeMode,
  setThemeMode,
  fontFamily,
  setFontFamily,
  fontScale,
  setFontScale,
  availableNavigationItems,
  mobileBottomNavItems,
  resolvedMobileNavigationItems,
  setMobileBottomNavItems,
  handleSavePreferences,
  saving,
}) {
${body(2081, 2151, 'AppearanceTab')}
}
`);

write('settings/SecurityTab.jsx', `import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Grid,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddOutlinedIcon from '@mui/icons-material/AddOutlined';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import GetAppOutlinedIcon from '@mui/icons-material/GetAppOutlined';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import { formatDateTime } from '../accountUserModel';
import ProfileField from '../shared/ProfileField';
import SectionCard from '../shared/SectionCard';

export default function SecurityTab({
  user,
  trustedDevices,
  loading,
  resettingTwoFactor,
  linkingTrustedDevice,
  linkTrustedDeviceOpen,
  linkTrustedDeviceLabel,
  linkTrustedDeviceError,
  passkeyLinkAvailable,
  onLinkTrustedDeviceLabelChange,
  onOpenLinkTrustedDevice,
  onCloseLinkTrustedDevice,
  onConfirmLinkTrustedDevice,
  onReload,
  onRegenerateBackupCodes,
  onRevokeTrustedDevice,
  onResetTwoFactor,
}) {
${body(1227, 1384, 'SecurityTab')}
}
`);

// Profile - AvatarUploadBlock + ProfileTab
write('profile/ProfileTab.jsx', `import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import AddOutlinedIcon from '@mui/icons-material/AddOutlined';
import CameraAltOutlinedIcon from '@mui/icons-material/CameraAltOutlined';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import ExpandMoreOutlinedIcon from '@mui/icons-material/ExpandMoreOutlined';
import { PresenceAvatar } from '../../components/chat/ChatCommon';
import OverflowMenu from '../../components/common/OverflowMenu';
import {
  getAccountDisplayName,
  getAccountSubtitle,
} from '../../components/account/AccountIdentity';
import { authAPI, mailAPI } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { buildOfficeUiTokens } from '../../theme/officeUiTokens';
import { roleOptions } from '../accountConstants';
import {
  buildDefaultExchangeLoginPreview,
  createEmptyMailboxDraft,
  createMailboxDraftFromEntry,
  formatDateTime,
  getDbName,
  MAILBOX_AUTH_LABELS,
  MAILBOX_AUTH_SHORT_LABELS,
  normalizeMailboxAuthMode,
  summarizePermissions,
} from '../accountUserModel';
import SectionCard from '../shared/SectionCard';
import ProfileField from '../shared/ProfileField';

function AvatarUploadBlock({ user }) {
${body(652, 771, 'AvatarUploadBlock')}
}

export function ProfileTab({ user, dbOptions, canAccessMail }) {
${body(773, 1225, 'ProfileTab')}
}
`);

write('admin/SessionsTab.jsx', `import { useMemo } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Grid,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import BuildCircleOutlinedIcon from '@mui/icons-material/BuildCircleOutlined';
import CheckCircleOutlineOutlinedIcon from '@mui/icons-material/CheckCircleOutlineOutlined';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import OverflowMenu from '../../components/common/OverflowMenu';
import { buildOfficeUiTokens } from '../../theme/officeUiTokens';
import { sessionStatusMeta } from '../accountConstants';
import { formatDateTime } from '../accountUserModel';
import MetricTile from '../shared/MetricTile';
import SectionCard from '../shared/SectionCard';

export default function SessionsTab({ sessions, loading, cleanupResult, cleaning, purging, onCleanup, onPurge, onTerminate }) {
${body(3542, 3677, 'SessionsTab')}
}
`);

write('admin/DepartmentsTab.jsx', `import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import SyncOutlinedIcon from '@mui/icons-material/SyncOutlined';
import { departmentsAPI } from '../../api/departments';
import { buildOfficeUiTokens, getOfficePanelSx } from '../../theme/officeUiTokens';

export default function DepartmentsTab({ canManageDepartments }) {
${body(5226, 5457, 'DepartmentsTab')}
}
`);

write('admin/UserDraftFields.jsx', `import { useCallback, useMemo } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  FormGroup,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import ExpandMoreOutlinedIcon from '@mui/icons-material/ExpandMoreOutlined';
import { SETTINGS_PERMISSION_GROUPS, roleOptions } from '../accountConstants';
import {
  buildDefaultExchangeLoginPreview,
  formatDateTime,
  normalizePermissions,
  normalizeTaskDelegateLinks,
} from '../accountUserModel';
import SectionCard from '../shared/SectionCard';

export default function UserDraftFields({ draft, onChange, dbOptions, linkedSessions, users }) {
${body(2678, 2988, 'UserDraftFields')}
}
`);

write('admin/UsersTab.jsx', `import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Drawer,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import AddOutlinedIcon from '@mui/icons-material/AddOutlined';
import CheckCircleOutlineOutlinedIcon from '@mui/icons-material/CheckCircleOutlineOutlined';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import ExpandMoreOutlinedIcon from '@mui/icons-material/ExpandMoreOutlined';
import GroupOutlinedIcon from '@mui/icons-material/GroupOutlined';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import SyncOutlinedIcon from '@mui/icons-material/SyncOutlined';
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined';
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import OverflowMenu from '../../components/common/OverflowMenu';
import { buildOfficeUiTokens } from '../../theme/officeUiTokens';
import {
  DEFAULT_USER_ROWS_PER_PAGE,
  USER_ROWS_PER_PAGE_OPTIONS,
  roleOptions,
} from '../accountConstants';
import {
  buildDefaultExchangeLoginPreview,
  createEmptyUserDraft,
  createUserDraftFromItem,
  getDbName,
  matchesUserSearch,
  normalizePermissions,
} from '../accountUserModel';
import MetricTile from '../shared/MetricTile';
import SectionCard from '../shared/SectionCard';
import UserDraftFields from './UserDraftFields';

export default function UsersTab({
  currentUserId,
  isAdmin,
  users,
  sessions,
  dbOptions,
  loading,
  savingUser,
  onCreateUser,
  onUpdateUser,
  onDeleteUser,
  isVeryWide,
}) {
${body(2990, 3540, 'UsersTab')}
}
`);

write('admin/appSettingsModel.js', slice(3984, 4008) + '\n');

write('admin/AdminLoginAllowlistSettingsCard.jsx', `import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import { buildOfficeUiTokens, getOfficeSubtlePanelSx } from '../../theme/officeUiTokens';
import { normalizeIpListForSettings } from './appSettingsModel';
import SectionCard from '../shared/SectionCard';

export function AdminLoginAllowlistSettingsCard({ appSettings, loading, saving, onSave }) {
${body(4010, 4121, 'AdminLoginAllowlistSettingsCard')}
}
`);

write('admin/TransferActReminderSettingsCard.jsx', `import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import { buildOfficeUiTokens, getOfficeSubtlePanelSx } from '../../theme/officeUiTokens';
import SectionCard from '../shared/SectionCard';

export function TransferActReminderSettingsCard({ appSettings, loading, saving, onSave }) {
${body(4123, 4233, 'TransferActReminderSettingsCard')}
}
`);

write('admin/PasswordVaultGroupsSettingsCard.jsx', `import { useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  Paper,
  Stack,
  TextField,
} from '@mui/material';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import SectionCard from '../shared/SectionCard';

export function PasswordVaultGroupsSettingsCard({
  groups,
  loading,
  saving,
  onRefresh,
  onCreate,
  onUpdate,
  onArchive,
}) {
${body(4235, 4331, 'PasswordVaultGroupsSettingsCard')}
}
`);

write('admin/EnvVariablesTab.jsx', `import { useEffect, useMemo, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import ExpandMoreOutlinedIcon from '@mui/icons-material/ExpandMoreOutlined';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';
import { ENV_HELP_WIDE_QUERY, staticRunbook } from '../accountConstants';
import { formatDateTime } from '../accountUserModel';
import { buildOfficeUiTokens, getOfficeSubtlePanelSx } from '../../theme/officeUiTokens';
import SectionCard from '../shared/SectionCard';

export default function EnvVariablesTab({ envState, loading, saving, onRefresh, onSave }) {
${body(3679, 3982, 'EnvVariablesTab')}
}
`);

write('admin/SystemSettingsSection.jsx', `import { Stack } from '@mui/material';
import { AdminLoginAllowlistSettingsCard } from './AdminLoginAllowlistSettingsCard';
import EnvVariablesTab from './EnvVariablesTab';
import { PasswordVaultGroupsSettingsCard } from './PasswordVaultGroupsSettingsCard';
import { TransferActReminderSettingsCard } from './TransferActReminderSettingsCard';

export default function SystemSettingsSection({
  appSettings,
  appSettingsLoading,
  savingAppSettings,
  onSaveAppSettings,
  envState,
  envLoading,
  savingEnv,
  onRefreshEnv,
  onSaveEnv,
  passwordGroups,
  passwordGroupsLoading,
  passwordGroupsSaving,
  onRefreshPasswordGroups,
  onCreatePasswordGroup,
  onUpdatePasswordGroup,
  onArchivePasswordGroup,
}) {
  return (
    <Stack spacing={1.1}>
      <AdminLoginAllowlistSettingsCard
        appSettings={appSettings}
        loading={appSettingsLoading}
        saving={savingAppSettings}
        onSave={onSaveAppSettings}
      />
      <TransferActReminderSettingsCard
        appSettings={appSettings}
        loading={appSettingsLoading}
        saving={savingAppSettings}
        onSave={onSaveAppSettings}
      />
      <EnvVariablesTab
        envState={envState}
        loading={envLoading}
        saving={savingEnv}
        onRefresh={onRefreshEnv}
        onSave={onSaveEnv}
      />
      <PasswordVaultGroupsSettingsCard
        groups={passwordGroups}
        loading={passwordGroupsLoading}
        saving={passwordGroupsSaving}
        onRefresh={onRefreshPasswordGroups}
        onCreate={onCreatePasswordGroup}
        onUpdate={onUpdatePasswordGroup}
        onArchive={onArchivePasswordGroup}
      />
    </Stack>
  );
}
`);

write('admin/aiBotModel.js', `${slice(4444, 4481)}
`);

write('admin/AiBotsAdminSection.jsx', `import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  FormControl,
  FormControlLabel,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Slider,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import AddOutlinedIcon from '@mui/icons-material/AddOutlined';
import ExpandMoreOutlinedIcon from '@mui/icons-material/ExpandMoreOutlined';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import { buildOfficeUiTokens, getOfficePanelSx, getOfficeSubtlePanelSx } from '../../theme/officeUiTokens';
import {
  AI_AD_TOOL_OPTIONS,
  AI_FILE_TOOL_OPTIONS,
  AI_ITINVENT_DEFAULT_TOOLS,
  AI_ITINVENT_MULTI_DB_TOOL_ID,
  AI_ITINVENT_TOOL_OPTIONS,
  AI_MFU_TOOL_OPTIONS,
  AI_NETWORK_TOOL_OPTIONS,
  AI_OFFICE_ACTION_TOOL_OPTIONS,
  AI_OFFICE_TOOL_OPTIONS,
} from '../accountConstants';
import {
  createAiBotDraft,
  getAiBotAdTools,
  getAiBotEnabledTools,
  getAiBotFileTools,
  getAiBotItinventTools,
  getAiBotMfuTools,
  getAiBotNetworkTools,
  getAiBotOfficeTools,
  isAiBotLiveDataEnabled,
  shouldWarnAiBotLiveDataDisabled,
} from './aiBotModel';

export function AiBotsAdminSection({
  bots,
  loading,
  savingBotId,
  runsByBotId,
  onRefresh,
  onCreate,
  onSave,
  openrouterConfigured,
  dbOptions = [],
}) {
${body(4483, 5224, 'AiBotsAdminSection')}
}
`);

console.log('Extraction complete');
