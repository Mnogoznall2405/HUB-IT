import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockUseDesktopInstallerFeed,
  mockIsNativeShellRuntime,
  mockDetectPlatform,
  mockRequestDesktopCheckForUpdates,
} = vi.hoisted(() => ({
  mockUseDesktopInstallerFeed: vi.fn(),
  mockIsNativeShellRuntime: vi.fn(),
  mockDetectPlatform: vi.fn(),
  mockRequestDesktopCheckForUpdates: vi.fn(),
}));

vi.mock('../../hooks/useDesktopInstallerFeed', () => ({ default: mockUseDesktopInstallerFeed }));
vi.mock('../../lib/platform', () => ({ isNativeShellRuntime: mockIsNativeShellRuntime }));
vi.mock('../../lib/desktopBridge', () => ({
  requestDesktopCheckForUpdates: mockRequestDesktopCheckForUpdates,
}));
vi.mock('../../lib/desktopInstallerFeed', async () => {
  const actual = await vi.importActual('../../lib/desktopInstallerFeed');
  return { ...actual, detectDesktopDownloadPlatform: mockDetectPlatform };
});

import DesktopInstallerDownload from './DesktopInstallerDownload';

describe('DesktopInstallerDownload', () => {
  beforeEach(() => {
    mockIsNativeShellRuntime.mockReturnValue(false);
    mockDetectPlatform.mockReturnValue({ windows: true, mobile: false, supported: true });
    mockRequestDesktopCheckForUpdates.mockReturnValue(true);
    mockUseDesktopInstallerFeed.mockReturnValue({
      status: 'ready',
      feed: {
        version: '0.1.12',
        sizeBytes: 413_449_628,
        downloadUrl: 'https://hubit.zsgp.ru/desktop-updates/stable/0.1.12/HUB-Desktop-Setup-0.1.12-win-x64.exe',
      },
    });
  });

  it('renders a direct Setup link with version and size on Windows', () => {
    render(<DesktopInstallerDownload variant="hero" />);

    const link = screen.getByRole('link', { name: /Скачать для Windows/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('/desktop-updates/stable/0.1.12/'));
    expect(link).toHaveAttribute('download');
    expect(screen.getByText(/Windows 10\/11 · x64 · версия 0\.1\.12 · 394 МБ/)).toBeInTheDocument();
  });

  it('shows guidance without an active download on mobile and non-Windows devices', () => {
    mockDetectPlatform.mockReturnValue({ windows: false, mobile: true, supported: false });
    render(<DesktopInstallerDownload />);

    expect(screen.queryByRole('link', { name: /Скачать для Windows/i })).toBeNull();
    expect(screen.getByText('Откройте эту страницу на компьютере с Windows.')).toBeInTheDocument();
    expect(mockUseDesktopInstallerFeed).toHaveBeenCalledWith({ enabled: false });
  });

  it('shows the native update action in application settings inside HUB Desktop', () => {
    mockIsNativeShellRuntime.mockReturnValue(true);
    render(<DesktopInstallerDownload variant="settings" />);

    fireEvent.click(screen.getByRole('button', { name: 'Проверить обновления' }));

    expect(screen.getByText('HUB Desktop для Windows')).toBeInTheDocument();
    expect(mockRequestDesktopCheckForUpdates).toHaveBeenCalledTimes(1);
    expect(mockUseDesktopInstallerFeed).toHaveBeenCalledWith({ enabled: false });
  });

  it('stays hidden on non-settings surfaces inside HUB Desktop', () => {
    mockIsNativeShellRuntime.mockReturnValue(true);
    const { container } = render(<DesktopInstallerDownload variant="hero" />);

    expect(container).toBeEmptyDOMElement();
    expect(mockUseDesktopInstallerFeed).toHaveBeenCalledWith({ enabled: false });
  });

  it('shows a recovery path when the Desktop update command is unavailable', () => {
    mockIsNativeShellRuntime.mockReturnValue(true);
    mockRequestDesktopCheckForUpdates.mockReturnValue(false);
    render(<DesktopInstallerDownload variant="settings" />);

    fireEvent.click(screen.getByRole('button', { name: 'Проверить обновления' }));

    expect(screen.getByRole('status')).toHaveTextContent('О программе и обновления');
  });

  it('keeps the login surface usable when the feed cannot be loaded', () => {
    mockUseDesktopInstallerFeed.mockReturnValue({ status: 'unavailable', feed: null });
    render(<DesktopInstallerDownload />);

    expect(screen.getByText('Загрузка временно недоступна')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'О HUB-IT' })).not.toBeInTheDocument();
  });
});
