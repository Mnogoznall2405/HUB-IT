import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const accountState = vi.hoisted(() => ({ activeSection: 'app' }));

vi.mock('../../components/account/AccountCategoryLayout', () => ({
  default: ({ children }) => <main>{children}</main>,
}));

vi.mock('../../components/desktop/DesktopInstallerDownload', () => ({
  default: ({ variant }) => <div data-testid="desktop-download" data-variant={variant} />,
}));

vi.mock('./settings/HubItPwaSettingsCard', () => ({
  default: () => <div data-testid="pwa-settings" />,
}));

vi.mock('../About', () => ({
  default: ({ mode }) => <div data-testid="about-presentation" data-mode={mode} />,
}));

vi.mock('./hooks/useAccountSectionData', () => ({
  useAccountSectionData: () => ({
    activeSection: accountState.activeSection,
    backupCodes: [],
    backupCodesDialogOpen: false,
    blockingError: '',
    setBackupCodesDialogOpen: vi.fn(),
    setBlockingError: vi.fn(),
    user: {},
  }),
}));

import Settings from './AccountWorkspace';

describe('Desktop application settings', () => {
  beforeEach(() => {
    accountState.activeSection = 'app';
  });

  it('keeps the Desktop installer and PWA as separate application choices', () => {
    render(<Settings />);

    expect(screen.getByTestId('desktop-download')).toHaveAttribute('data-variant', 'settings');
    expect(screen.getByTestId('pwa-settings')).toBeInTheDocument();
  });

  it('embeds the full HUB-IT presentation in the About section', () => {
    accountState.activeSection = 'about';
    render(<Settings />);

    expect(screen.getByTestId('about-presentation')).toHaveAttribute('data-mode', 'embedded');
  });
});
