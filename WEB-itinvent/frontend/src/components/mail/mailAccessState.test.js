import { describe, expect, it } from 'vitest';

import { resolveMailAccessState } from './mailAccessState';

describe('resolveMailAccessState', () => {
  it('treats a configured mailbox as ready', () => {
    expect(resolveMailAccessState({
      mailbox_email: 'a@b.c',
      auth_mode: 'stored_credentials',
      mail_auth_mode: 'stored_credentials',
      mail_is_configured: true,
    })).toMatchObject({
      mailRequiresRelogin: false,
      mailRequiresPassword: false,
      mailAccessReady: true,
      mailboxUsesPrimaryCredentials: false,
      canSaveMailForAllDevices: false,
      showSaveMailForAllDevicesBanner: false,
    });
  });

  it('requires a password when stored credentials are missing', () => {
    expect(resolveMailAccessState({
      mailbox_email: 'a@b.c',
      mail_auth_mode: 'stored_credentials',
      mail_requires_password: true,
    })).toMatchObject({
      mailRequiresPassword: true,
      mailAccessReady: false,
    });
  });

  it('does not require a password for AD auto mailboxes', () => {
    expect(resolveMailAccessState({
      mailbox_email: 'a@b.c',
      mail_auth_mode: 'ad_auto',
      mail_requires_password: true,
      mail_is_configured: false,
    })).toMatchObject({
      mailRequiresPassword: false,
      mailAccessReady: true,
    });
  });

  it('flags a shared mailbox that uses primary credentials', () => {
    expect(resolveMailAccessState({
      mailbox_email: 'shared@b.c',
      auth_mode: 'primary_credentials',
      mail_requires_relogin: true,
    })).toMatchObject({
      mailRequiresRelogin: true,
      mailAccessReady: false,
      mailboxUsesPrimaryCredentials: true,
      canSaveMailForAllDevices: false,
    });
  });

  it('shows the save-for-all-devices banner for a primary session mailbox', () => {
    expect(resolveMailAccessState({
      mailbox_email: 'user@b.c',
      auth_mode: 'primary_session',
      mail_auth_mode: 'ad_auto',
    })).toMatchObject({
      mailAccessReady: true,
      canSaveMailForAllDevices: true,
      showSaveMailForAllDevicesBanner: true,
    });
  });

  it('returns empty access flags without mailbox info', () => {
    expect(resolveMailAccessState(null)).toMatchObject({
      mailRequiresRelogin: false,
      mailRequiresPassword: false,
      mailAccessReady: false,
      canSaveMailForAllDevices: false,
      showSaveMailForAllDevicesBanner: false,
    });
  });
});
