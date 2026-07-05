import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import MainLayout from '../../components/layout/MainLayout';
import PageShell from '../../components/layout/PageShell';
import AccountCategoryLayout from '../../components/account/AccountCategoryLayout';
import { PERSONAL_SETTINGS_SECTIONS } from '../../components/account/accountNavigationConfig';
import AdUsers from '../AdUsers';
import { AiBotsAdminSection } from './admin/AiBotsAdminSection';
import DepartmentsTab from './admin/DepartmentsTab';
import SessionsTab from './admin/SessionsTab';
import SystemSettingsSection from './admin/SystemSettingsSection';
import UsersTab from './admin/UsersTab';
import { useAccountSectionData } from './hooks/useAccountSectionData';
import { ProfileTab } from './profile/ProfileTab';
import AppearanceTab from './settings/AppearanceTab';
import HubItPwaSettingsCard from './settings/HubItPwaSettingsCard';
import SecurityTab from './settings/SecurityTab';
import { BrowserNotificationsSettingsCard } from './settings/notifications/BrowserNotificationsSettingsCard';
import { ChatNotificationsSettingsCard } from './settings/notifications/ChatNotificationsSettingsCard';
import { NotificationChannelsSettingsCard } from './settings/notifications/NotificationChannelsSettingsCard';

function AccountWorkspace({ area = 'settings' }) {
  const data = useAccountSectionData(area);

  const blockingErrorNode = data.blockingError ? (
    <Alert severity="error" onClose={() => data.setBlockingError('')}>
      {data.blockingError}
    </Alert>
  ) : null;

  const securityContent = (
    <SecurityTab
      user={data.user}
      trustedDevices={data.trustedDevices}
      loading={data.securityLoading}
      resettingTwoFactor={data.resettingTwoFactor}
      linkingTrustedDevice={data.linkingTrustedDevice}
      linkTrustedDeviceOpen={data.linkTrustedDeviceOpen}
      linkTrustedDeviceLabel={data.linkTrustedDeviceLabel}
      linkTrustedDeviceError={data.linkTrustedDeviceError}
      passkeyLinkAvailable={data.passkeyLinkAvailable}
      onLinkTrustedDeviceLabelChange={data.setLinkTrustedDeviceLabel}
      onOpenLinkTrustedDevice={data.handleOpenLinkTrustedDevice}
      onCloseLinkTrustedDevice={data.handleCloseLinkTrustedDevice}
      onConfirmLinkTrustedDevice={data.handleConfirmLinkTrustedDevice}
      onReload={data.handleReloadSecurity}
      onRegenerateBackupCodes={data.handleRegenerateBackupCodes}
      onRevokeTrustedDevice={data.handleRevokeTrustedDevice}
      onResetTwoFactor={data.handleResetTwoFactor}
    />
  );

  let page;
  if (area === 'profile') {
    page = (
      <MainLayout>
        <PageShell
          ref={data.pageRef}
          sx={{
            minHeight: 0,
            maxWidth: 1100,
            mx: 'auto',
            width: '100%',
            pb: { xs: 'calc(var(--app-shell-mobile-bottom-nav-height, 64px) + 10px)', md: 2 },
          }}
        >
          <Stack spacing={1.1}>
            {blockingErrorNode}
            <ProfileTab user={data.user} dbOptions={data.dbOptions} canAccessMail={data.canAccessMail} />
          </Stack>
        </PageShell>
      </MainLayout>
    );
  } else if (area === 'admin') {
    let adminContent = null;
    if (data.activeSection === 'users' && data.canManageUsers) {
      adminContent = (
        <UsersTab
          currentUserId={data.user?.id}
          isAdmin={data.isAdmin}
          users={data.users}
          sessions={data.sessions}
          dbOptions={data.dbOptions}
          loading={data.usersLoading}
          savingUser={data.savingUser}
          onCreateUser={data.handleCreateUser}
          onUpdateUser={data.handleUpdateUser}
          onDeleteUser={data.handleDeleteUser}
          isVeryWide={data.isVeryWide}
        />
      );
    } else if (data.activeSection === 'departments' && data.canManageDepartments) {
      adminContent = <DepartmentsTab canManageDepartments={data.canManageDepartments} />;
    } else if (data.activeSection === 'ad-users') {
      adminContent = <AdUsers embedded />;
    } else if (data.activeSection === 'ai-bots' && data.canManageAiBots) {
      adminContent = (
        <AiBotsAdminSection
          bots={data.aiBotsState}
          loading={data.aiBotsLoading}
          savingBotId={data.savingAiBotId}
          runsByBotId={data.aiBotRunsById}
          onRefresh={data.loadAiBotsAdmin}
          onCreate={data.handleCreateAiBot}
          onSave={data.handleUpdateAiBot}
          openrouterConfigured={Boolean(data.aiBotsState.some((item) => item?.openrouter_configured || item?.configured))}
          dbOptions={data.dbOptions}
        />
      );
    } else if (data.activeSection === 'sessions' && data.canManageSessions) {
      adminContent = (
        <SessionsTab
          sessions={data.sessions}
          loading={data.sessionsLoading}
          cleanupResult={data.cleanupResult}
          cleaning={data.cleaningSessions}
          purging={data.purgingSessions}
          onCleanup={data.handleCleanupSessions}
          onPurge={data.handlePurgeInactiveSessions}
          onTerminate={data.handleTerminateSession}
        />
      );
    } else if (data.activeSection === 'system' && data.isAdmin) {
      adminContent = (
        <SystemSettingsSection
          appSettings={data.appSettingsState}
          appSettingsLoading={data.appSettingsLoading}
          savingAppSettings={data.savingAppSettings}
          onSaveAppSettings={data.handleSaveAppSettings}
          envState={data.envState}
          envLoading={data.envLoading}
          savingEnv={data.savingEnv}
          onRefreshEnv={data.loadEnv}
          onSaveEnv={data.handleSaveEnv}
          passwordGroups={data.passwordGroups}
          passwordGroupsLoading={data.passwordGroupsLoading}
          passwordGroupsSaving={data.passwordGroupsSaving}
          onRefreshPasswordGroups={data.loadPasswordGroups}
          onCreatePasswordGroup={data.handleCreatePasswordGroup}
          onUpdatePasswordGroup={data.handleUpdatePasswordGroup}
          onArchivePasswordGroup={data.handleArchivePasswordGroup}
        />
      );
    }

    page = (
      <AccountCategoryLayout
        title="Администрирование"
        description="Пользователи, отделы, интеграции и системные параметры."
        categories={data.adminSections}
        activeKey={data.activeSection}
        basePath="/admin"
        blockingError={blockingErrorNode}
      >
        {adminContent}
      </AccountCategoryLayout>
    );
  } else {
    let settingsContent = null;
    if (data.activeSection === 'appearance') {
      settingsContent = (
        <AppearanceTab
          themeMode={data.themeMode}
          setThemeMode={data.setThemeMode}
          fontFamily={data.fontFamily}
          setFontFamily={data.setFontFamily}
          fontScale={data.fontScale}
          setFontScale={data.setFontScale}
          availableNavigationItems={data.availableNavigationItems}
          mobileBottomNavItems={data.mobileBottomNavItems}
          resolvedMobileNavigationItems={data.resolvedMobileNavigationItems}
          setMobileBottomNavItems={data.setMobileBottomNavItems}
          handleSavePreferences={data.handleSavePreferences}
          saving={data.savingPreferences}
        />
      );
    } else if (data.activeSection === 'notifications') {
      settingsContent = (
        <Stack spacing={1.1}>
          <NotificationChannelsSettingsCard />
          <ChatNotificationsSettingsCard />
          <BrowserNotificationsSettingsCard />
        </Stack>
      );
    } else if (data.activeSection === 'security') {
      settingsContent = securityContent;
    } else if (data.activeSection === 'app') {
      settingsContent = <HubItPwaSettingsCard />;
    }

    page = (
      <AccountCategoryLayout
        title="Настройки"
        description="Персональные параметры интерфейса, уведомлений и входа."
        categories={PERSONAL_SETTINGS_SECTIONS}
        activeKey={data.activeSection}
        basePath="/settings"
        blockingError={blockingErrorNode}
      >
        {settingsContent}
      </AccountCategoryLayout>
    );
  }

  return (
    <>
      {page}
      <Dialog open={data.backupCodesDialogOpen} onClose={() => data.setBackupCodesDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Backup-коды 2FA</DialogTitle>
        <DialogContent dividers>
          <Alert severity="warning" sx={{ mb: 2 }}>
            Сохраните эти коды в безопасном месте. Каждый код одноразовый.
          </Alert>
          <Stack spacing={0.75}>
            {data.backupCodes.map((item) => (
              <Typography key={item} sx={{ fontFamily: 'monospace', fontWeight: 700 }}>
                {item}
              </Typography>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={() => data.setBackupCodesDialogOpen(false)}>
            Закрыть
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

export function ProfilePage() {
  return <AccountWorkspace area="profile" />;
}

export function AdminPage() {
  return <AccountWorkspace area="admin" />;
}

export default function Settings() {
  return <AccountWorkspace area="settings" />;
}
