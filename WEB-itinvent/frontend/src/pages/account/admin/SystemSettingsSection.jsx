import { Stack } from '@mui/material';
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
