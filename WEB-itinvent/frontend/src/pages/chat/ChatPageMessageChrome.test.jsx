import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import ChatPageMessageChrome from './ChatPageMessageChrome';

vi.mock('./AiMailActionEditDialog', () => ({
  default: ({ open }) => (open ? <div data-testid="mail-action-edit-dialog" /> : null),
}));

describe('ChatPageMessageChrome', () => {
  it('renders hidden file inputs', () => {
    const fileInputRef = { current: null };
    const mediaFileInputRef = { current: null };

    render(
      <ChatPageMessageChrome
        fileInputRef={fileInputRef}
        mediaFileInputRef={mediaFileInputRef}
        onSelectFiles={vi.fn()}
        onCloseMailActionEditor={vi.fn()}
        onSubmitMailActionEdit={vi.fn()}
      />,
    );

    expect(screen.getByTestId('chat-file-input')).toBeInTheDocument();
    expect(screen.getByTestId('chat-media-file-input')).toBeInTheDocument();
  });

  it('renders health and AI notice alerts', () => {
    render(
      <ChatPageMessageChrome
        fileInputRef={{ current: null }}
        mediaFileInputRef={{ current: null }}
        onSelectFiles={vi.fn()}
        onCloseMailActionEditor={vi.fn()}
        onSubmitMailActionEdit={vi.fn()}
        healthError="Backend unavailable"
        activeAiLiveDataNotice={{ severity: 'info', text: 'AI data is stale' }}
      />,
    );

    expect(screen.getByText('Backend unavailable')).toBeInTheDocument();
    expect(screen.getByText('AI data is stale')).toBeInTheDocument();
  });

  it('opens mail action editor dialog when editor state is set', () => {
    render(
      <ChatPageMessageChrome
        fileInputRef={{ current: null }}
        mediaFileInputRef={{ current: null }}
        onSelectFiles={vi.fn()}
        onCloseMailActionEditor={vi.fn()}
        onSubmitMailActionEdit={vi.fn()}
        mailActionEditor={{ actionCard: { id: '1' }, message: { id: 'm1' } }}
        chatMailAttachmentOptions={[]}
      />,
    );

    expect(screen.getByTestId('mail-action-edit-dialog')).toBeInTheDocument();
  });
});
