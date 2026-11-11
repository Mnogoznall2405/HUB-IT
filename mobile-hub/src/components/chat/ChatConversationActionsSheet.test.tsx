import { fireEvent, render } from '@testing-library/react-native';
import { ChatConversationActionsSheet, formatMutedUntilLabel } from './ChatConversationActionsSheet';

describe('formatMutedUntilLabel', () => {
  it('returns empty for missing or expired deadlines', () => {
    expect(formatMutedUntilLabel(null)).toBe('');
    expect(formatMutedUntilLabel(undefined)).toBe('');
    expect(formatMutedUntilLabel(new Date(Date.now() - 60_000).toISOString())).toBe('');
    expect(formatMutedUntilLabel('not-a-date')).toBe('');
  });

  it('formats minutes, hours and days', () => {
    expect(formatMutedUntilLabel(new Date(Date.now() + 30 * 60_000).toISOString())).toBe('ещё 30 мин');
    expect(formatMutedUntilLabel(new Date(Date.now() + 8 * 3_600_000).toISOString())).toBe('ещё 8 ч');
    expect(formatMutedUntilLabel(new Date(Date.now() + 3 * 24 * 3_600_000).toISOString())).toMatch(/^до /);
  });
});

describe('ChatConversationActionsSheet mute timer', () => {
  const baseConversation = {
    id: 'conv-1',
    title: 'Диалог',
    kind: 'direct' as const,
    is_muted: false,
    muted_until: null as string | null,
  };

  async function renderSheet(overrides?: Partial<typeof baseConversation>) {
    const onToggleMute = jest.fn();
    const view = await render(
      <ChatConversationActionsSheet
        conversation={{ ...baseConversation, ...overrides }}
        onClose={jest.fn()}
        onTogglePin={jest.fn()}
        onToggleMute={onToggleMute}
        onToggleArchive={jest.fn()}
        onFolders={jest.fn()}
      />,
    );
    return { view, onToggleMute };
  }

  it('opens duration options before muting', async () => {
    const { view, onToggleMute } = await renderSheet();
    fireEvent.press(view.getByText('Выключить уведомления'));
    fireEvent.press(await view.findByText('На 8 часов'));
    expect(onToggleMute).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'conv-1' }),
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    );
  });

  it('mutes indefinitely from the picker', async () => {
    const { view, onToggleMute } = await renderSheet();
    fireEvent.press(view.getByText('Выключить уведомления'));
    fireEvent.press(await view.findByText('Навсегда'));
    expect(onToggleMute).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'conv-1' }),
      null,
    );
  });

  it('unmutes a muted conversation directly', async () => {
    const { view, onToggleMute } = await renderSheet({ is_muted: true, muted_until: null });
    fireEvent.press(view.getByText('Включить уведомления'));
    expect(onToggleMute).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'conv-1' }),
    );
  });
});
