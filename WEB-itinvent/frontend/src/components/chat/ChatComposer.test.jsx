import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider, createTheme } from '@mui/material/styles';

import ChatComposer from './ChatComposer';

vi.mock('emoji-picker-react', () => ({ default: () => null }));

const theme = createTheme();

function renderComposer(overrides = {}, composerTheme = theme) {
  return render(
    <ThemeProvider theme={composerTheme}>
      <ChatComposer
        theme={composerTheme}
        ui={{
          accentText: '#1976d2',
          textPrimary: '#111',
          textSecondary: '#666',
          borderSoft: '#ddd',
          surfaceMuted: '#f5f5f5',
          composerInputBg: '#ffffff',
          composerDockBg: '#f8fafc',
          shadowSoft: '0 2px 8px rgba(0,0,0,0.08)',
          density: { touchTarget: 44 },
        }}
        compactMobile={false}
        messageText=""
        onMessageTextChange={vi.fn()}
        onSendMessage={vi.fn()}
        mentionCandidates={[]}
        disabled={false}
        {...overrides}
      />
    </ThemeProvider>,
  );
}

describe('ChatComposer', () => {
  it('renders composer surface without crashing', () => {
    renderComposer();
    expect(screen.getByTestId('chat-composer-dock')).toBeTruthy();
    expect(screen.queryByTestId('chat-emoji-panel')).not.toBeInTheDocument();
  });

  it('mounts the deferred emoji panel only when it is opened on mobile', async () => {
    renderComposer({
      compactMobile: true,
      mobileEmojiPickerOpen: true,
      activeConversationId: 'conv-1',
    });

    expect(await screen.findByTestId('chat-emoji-panel')).toBeInTheDocument();
  });

  it('does not render a Retina separator above the mobile composer', () => {
    const darkTheme = createTheme({ palette: { mode: 'dark' } });

    renderComposer({
      compactMobile: true,
      activeConversationId: 'conv-1',
    }, darkTheme);

    expect(screen.getByTestId('chat-composer-dock')).toHaveStyle({
      borderTop: 'none',
      boxShadow: 'none',
    });
  });

  it('enables emoji, attach and voice controls when conversation is active', () => {
    renderComposer({
      activeConversationId: 'conv-1',
      onOpenEmojiPicker: vi.fn(),
      onOpenComposerMenu: vi.fn(),
      onStartVoiceRecording: vi.fn(),
    });
    expect(screen.getByTestId('chat-composer-emoji-button')).not.toBeDisabled();
    expect(screen.getByTestId('chat-composer-menu-button')).not.toBeDisabled();
    expect(screen.getByTestId('chat-composer-voice-button')).not.toBeDisabled();
  });

  it('renders the desktop composer as a rectangle with attachment before text and emoji after it', () => {
    renderComposer({
      activeConversationId: 'conv-1',
      onOpenEmojiPicker: vi.fn(),
      onOpenComposerMenu: vi.fn(),
    });

    const capsule = screen.getByTestId('chat-composer-capsule');
    const attachment = screen.getByTestId('chat-composer-menu-button');
    const textarea = screen.getByTestId('chat-composer-textarea');
    const emoji = screen.getByTestId('chat-composer-emoji-button');

    expect(capsule).toHaveStyle({ borderRadius: '8px' });
    expect(attachment.compareDocumentPosition(textarea) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(textarea.compareDocumentPosition(emoji) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('disables emoji, attach and voice controls without active conversation', () => {
    renderComposer({
      activeConversationId: '',
      onOpenEmojiPicker: vi.fn(),
      onOpenComposerMenu: vi.fn(),
      onStartVoiceRecording: vi.fn(),
    });
    expect(screen.getByTestId('chat-composer-emoji-button')).toBeDisabled();
    expect(screen.getByTestId('chat-composer-menu-button')).toBeDisabled();
    expect(screen.getByTestId('chat-composer-voice-button')).toBeDisabled();
  });
});
