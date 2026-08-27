import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUseMobileInstallerFeed = vi.hoisted(() => vi.fn());

vi.mock('../../hooks/useMobileInstallerFeed', () => ({ default: mockUseMobileInstallerFeed }));

import MobileInstallerDownload from './MobileInstallerDownload';

describe('MobileInstallerDownload', () => {
  beforeEach(() => {
    mockUseMobileInstallerFeed.mockReturnValue({
      status: 'ready',
      feed: {
        version: '1.1.0',
        sizeBytes: 101_086_778,
        downloadUrl: 'https://hubit.zsgp.ru/desktop-updates/mobile/preview/1.1.0/HUB-IT-Mobile-Preview-1.1.0.apk',
      },
    });
  });

  it('renders the direct APK link with version and size', () => {
    render(<MobileInstallerDownload variant="login" />);

    const link = screen.getByRole('link', { name: 'Скачать для Android' });
    expect(link).toHaveAttribute('href', expect.stringContaining('/desktop-updates/mobile/preview/1.1.0/'));
    expect(link).toHaveAttribute('download');
    expect(screen.getByText(/Android 7\.0\+ · тестовая версия 1\.1\.0 · 96 МБ/)).toBeInTheDocument();
  });

  it('keeps the page usable while the feed is unavailable', () => {
    mockUseMobileInstallerFeed.mockReturnValue({ status: 'unavailable', feed: null });
    render(<MobileInstallerDownload variant="settings" />);

    expect(screen.getByRole('status')).toHaveTextContent('APK временно недоступен');
    expect(screen.queryByRole('link', { name: 'Скачать для Android' })).toBeNull();
  });
});
