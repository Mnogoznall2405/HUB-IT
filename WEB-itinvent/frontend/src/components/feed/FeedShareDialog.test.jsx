import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FeedShareDialog from './FeedShareDialog';

const bridge = vi.hoisted(() => ({
  request: vi.fn(),
}));

vi.mock('../../lib/mobileAppBridge', () => ({
  isMobileAppWebViewRuntime: () => true,
  requestMobileAppCommand: bridge.request,
}));

vi.mock('../../lib/chatFeature', () => ({ CHAT_FEATURE_ENABLED: false }));

describe('FeedShareDialog Android bridge', () => {
  beforeEach(() => {
    bridge.request.mockReset();
    bridge.request.mockResolvedValue({ opened: true });
  });

  it('opens the controlled Android share sheet for a HUB-IT publication', async () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <ThemeProvider theme={createTheme()}>
          <FeedShareDialog
            open
            post={{ title: 'Новости', preview: 'Новая публикация' }}
            url="https://hubit.zsgp.ru/feed?post=one"
            onClose={onClose}
          />
        </ThemeProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Другие приложения' }));

    await waitFor(() => expect(bridge.request).toHaveBeenCalledWith('share.text', {
      title: 'Новости',
      text: 'Новая публикация',
      url: 'https://hubit.zsgp.ru/feed?post=one',
    }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
