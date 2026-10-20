import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUseMobileInstallerFeed = vi.hoisted(() => vi.fn());
const mockBuildQrDataUrl = vi.hoisted(() => vi.fn());

vi.mock('../../hooks/useMobileInstallerFeed', () => ({ default: mockUseMobileInstallerFeed }));
vi.mock('../../lib/qrCodeImage', () => ({ buildQrDataUrl: mockBuildQrDataUrl }));

import MobileAccessQr from './MobileAccessQr';

const ANDROID_URL = 'https://hubit.zsgp.ru/desktop-updates/mobile/preview/1.1.0/HUB-IT-Mobile-Preview-1.1.0.apk';

describe('MobileAccessQr', () => {
  beforeEach(() => {
    mockBuildQrDataUrl.mockReset();
    mockBuildQrDataUrl.mockImplementation(async (text) => `data:image/png;base64,qr-for:${encodeURIComponent(text)}`);
    mockUseMobileInstallerFeed.mockReturnValue({
      status: 'ready',
      feed: { version: '1.1.0', sizeBytes: 101_086_778, downloadUrl: ANDROID_URL },
    });
  });

  it('renders Android QR linked to the current APK from the installer feed', async () => {
    render(<MobileAccessQr />);

    const qr = await screen.findByAltText('QR-код со ссылкой на скачивание приложения HUB-IT для Android');
    expect(qr.getAttribute('src')).toContain(encodeURIComponent(ANDROID_URL));
    expect(mockBuildQrDataUrl).toHaveBeenCalledWith(ANDROID_URL);
    expect(screen.getByRole('link', { name: 'Или скачать APK по ссылке' })).toHaveAttribute('href', ANDROID_URL);
  });

  it('renders iPhone QR pointing at the portal URL', async () => {
    render(<MobileAccessQr />);

    const qr = await screen.findByAltText('QR-код со ссылкой на HUB-IT для открытия на iPhone');
    expect(qr).toBeInTheDocument();
    await waitFor(() => {
      expect(mockBuildQrDataUrl).toHaveBeenCalledWith('https://hubit.zsgp.ru/');
    });
    const link = screen.getByRole('link', { name: 'Или открыть HUB по ссылке' });
    // QR and fallback link encode the same portal URL.
    const qrTarget = mockBuildQrDataUrl.mock.calls
      .map(([text]) => text)
      .find((text) => !text.includes('.apk'));
    expect(link.getAttribute('href')).toBe(qrTarget);
    expect(screen.getByText(/добавьте на экран «Домой»/i)).toBeInTheDocument();
  });

  it('shows a fallback note instead of the Android QR when the feed is unavailable', async () => {
    mockUseMobileInstallerFeed.mockReturnValue({ status: 'unavailable', feed: null });
    render(<MobileAccessQr />);

    // iPhone card stays usable regardless of the APK feed.
    await screen.findByAltText('QR-код со ссылкой на HUB-IT для открытия на iPhone');
    expect(screen.getByText(/Ссылка на APK сейчас недоступна/)).toBeInTheDocument();
    expect(screen.queryByAltText('QR-код со ссылкой на скачивание приложения HUB-IT для Android')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Или скачать APK по ссылке' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Или открыть HUB по ссылке' })).toBeInTheDocument();
  });

  it('keeps a pending placeholder while the APK feed is loading', async () => {
    mockUseMobileInstallerFeed.mockReturnValue({ status: 'loading', feed: null });
    render(<MobileAccessQr />);

    await waitFor(() => expect(screen.getAllByText('Готовим QR-код…').length).toBeGreaterThan(0));
    expect(mockBuildQrDataUrl).not.toHaveBeenCalledWith(expect.stringContaining('.apk'));
  });
});
