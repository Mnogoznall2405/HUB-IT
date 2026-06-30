import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider, createTheme } from '@mui/material/styles';

import ChatComposer from './ChatComposer';

const theme = createTheme();

function renderComposer(overrides = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <ChatComposer
        theme={theme}
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
