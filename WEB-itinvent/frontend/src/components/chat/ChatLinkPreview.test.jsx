import { render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import ChatLinkPreview from './ChatLinkPreview';
import { buildChatUiTokens } from './chatUiTokens';

const mockGetLinkPreview = vi.fn();

vi.mock('../../api/chatMessageSending', () => ({
  chatMessageSendingAPI: {
    getLinkPreview: (...args) => mockGetLinkPreview(...args),
  },
}));

const renderPreview = ({ isOwn = true, mode = 'light', url = 'https://example.com/article' } = {}) => {
  const theme = createTheme({ palette: { mode } });
  const ui = buildChatUiTokens(theme);

  return render(
    <ThemeProvider theme={theme}>
      <ChatLinkPreview
        url={url}
        theme={theme}
        ui={ui}
        isOwn={isOwn}
      />
    </ThemeProvider>,
  );
};

describe('ChatLinkPreview', () => {
  beforeEach(() => {
    mockGetLinkPreview.mockReset();
    mockGetLinkPreview.mockResolvedValue({
      title: 'Example article',
      description: 'Readable preview text',
      site_name: 'EXAMPLE',
    });
  });

  it('uses dark link colors for own messages on light theme', async () => {
    renderPreview({ isOwn: true, mode: 'light', url: 'https://example.com/article-light' });

    await waitFor(() => {
      expect(screen.getByText('Example article')).toBeInTheDocument();
    });

    const title = screen.getByText('Example article');
    expect(title).toHaveStyle({ color: 'rgb(61, 125, 43)' });
    expect(screen.getByText('Readable preview text')).toHaveStyle({ color: 'rgb(95, 127, 86)' });
  });

  it('uses light link colors for own messages on dark theme', async () => {
    renderPreview({ isOwn: true, mode: 'dark', url: 'https://example.com/article-dark' });

    await waitFor(() => {
      expect(screen.getByText('Example article')).toBeInTheDocument();
    });

    expect(screen.getByText('Example article')).toHaveStyle({ color: 'rgba(255, 255, 255, 0.95)' });
  });

  it('reserves compact card space while the preview loads', async () => {
    mockGetLinkPreview.mockReturnValue(new Promise(() => {}));

    renderPreview({ url: 'https://example.com/pending' });

    const compact = await screen.findByTestId('chat-link-preview-compact');
    expect(compact).toHaveStyle({ minHeight: '64px' });
    expect(screen.getByText('Загрузка превью…')).toBeInTheDocument();
    expect(compact).toHaveAttribute('href', 'https://example.com/pending');
  });

  it('keeps the compact fallback when the preview request fails', async () => {
    mockGetLinkPreview.mockRejectedValue(new Error('preview failed'));

    renderPreview({ url: 'https://example.com/fails' });

    const compact = await screen.findByTestId('chat-link-preview-compact');
    await waitFor(() => {
      expect(screen.queryByText('Загрузка превью…')).not.toBeInTheDocument();
    });
    expect(compact).toHaveStyle({ minHeight: '64px' });
    expect(screen.getByText('example.com')).toBeInTheDocument();
    expect(compact).toHaveAttribute('href', 'https://example.com/fails');
  });
});
