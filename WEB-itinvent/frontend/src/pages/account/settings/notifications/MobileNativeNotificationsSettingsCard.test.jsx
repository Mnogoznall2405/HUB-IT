import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MobileNativeNotificationsSettingsCard } from './MobileNativeNotificationsSettingsCard';

const requestMobileAppCommand = vi.hoisted(() => vi.fn());

vi.mock('../../../../lib/mobileAppBridge', () => ({ requestMobileAppCommand }));

describe('MobileNativeNotificationsSettingsCard', () => {
  beforeEach(() => {
    requestMobileAppCommand.mockReset();
    requestMobileAppCommand.mockResolvedValue({
      status: 'denied',
      message: 'Разрешение на уведомления не выдано',
    });
  });

  it('shows Android permission state and requests permission explicitly', async () => {
    render(<MobileNativeNotificationsSettingsCard embedded />);

    expect(await screen.findByText('Запрещены в Android')).toBeInTheDocument();
    expect(requestMobileAppCommand).toHaveBeenCalledTimes(1);
    requestMobileAppCommand.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Разрешить уведомления' }));

    await waitFor(() => {
      expect(requestMobileAppCommand).toHaveBeenCalledWith('notifications.requestPermission');
      expect(requestMobileAppCommand).toHaveBeenCalledWith('haptics.perform', { kind: 'selection' });
    });
  });
});
