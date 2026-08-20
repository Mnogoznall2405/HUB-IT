export function resolveMailAccessState(mailboxInfo) {
  const mailRequiresRelogin = Boolean(mailboxInfo?.mail_requires_relogin);
  const mailRequiresPassword = Boolean(
    mailboxInfo
    && mailboxInfo?.mail_auth_mode !== 'ad_auto'
    && (
      mailboxInfo?.mail_requires_password
      || mailboxInfo.mail_is_configured === false
    )
  );
  const mailAccessReady = Boolean(mailboxInfo && !mailRequiresPassword && !mailRequiresRelogin);
  const authMode = String(mailboxInfo?.auth_mode || '').trim().toLowerCase();
  const mailboxUsesPrimaryCredentials = authMode === 'primary_credentials';
  const canSaveMailForAllDevices = Boolean(
    mailboxInfo
    && authMode === 'primary_session'
    && (
      mailboxInfo?.mailbox_email
      || mailboxInfo?.effective_mailbox_login
      || mailboxInfo?.mailbox_login
    )
  );
  return {
    mailRequiresRelogin,
    mailRequiresPassword,
    mailAccessReady,
    mailboxUsesPrimaryCredentials,
    canSaveMailForAllDevices,
    showSaveMailForAllDevicesBanner: Boolean(canSaveMailForAllDevices && mailAccessReady),
  };
}
