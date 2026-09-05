import { render } from '@testing-library/react-native';
import { BrandedLoader } from './BrandedLoader';

let mockVpnActive = false;

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ vpnActive: mockVpnActive }),
}));

describe('BrandedLoader', () => {
  beforeEach(() => {
    mockVpnActive = false;
  });

  it('shows a calm branded session-loading state', async () => {
    const view = await render(<BrandedLoader />);

    expect(view.getByText('HUB-IT')).toBeTruthy();
    expect(view.getByText('Проверяем защищённую сессию')).toBeTruthy();
    expect(view.queryByTestId('startup-vpn-notice')).toBeNull();
  });

  it('warns only when Android reports an active VPN transport', async () => {
    mockVpnActive = true;
    const view = await render(<BrandedLoader />);

    expect(view.getByTestId('startup-vpn-notice')).toBeTruthy();
    expect(view.getByText('VPN может замедлять подключение')).toBeTruthy();
    expect(view.getByText('Если HUB загружается долго, временно отключите VPN.')).toBeTruthy();
  });
});
