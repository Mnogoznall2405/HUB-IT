import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ChatMessageList from './ChatMessageList';

// Д2-3: счётчик рендеров пузырей. Мок оборачивается в memo() — как настоящий
// MemoChatBubble — чтобы проверять, что prepend истории не перерисовывает
// уже смонтированные сообщения.
const bubbleRenderCounts = vi.hoisted(() => ({ byId: new Map(), total: 0 }));

vi.mock('./ChatBubble', async () => {
  const { memo } = await import('react');
  const CountingBubble = memo(function CountingBubble({ message }) {
    const id = String(message?.id || '');
    bubbleRenderCounts.byId.set(id, (bubbleRenderCounts.byId.get(id) || 0) + 1);
    bubbleRenderCounts.total += 1;
    return <div data-testid={`bubble-${id}`} />;
  });
  return { MemoChatBubble: CountingBubble };
});

const theme = createTheme();
const ui = {
  textSecondary: '#64748b',
  accentText: '#38bdf8',
  accentSoft: 'rgba(56,189,248,0.16)',
  servicePillBg: 'rgba(23,33,43,0.78)',
  servicePillText: '#94a3b8',
  borderSoft: 'rgba(148,163,184,0.2)',
  composerDockBg: '#17212b',
  panelBg: '#17212b',
};

const renderWithTheme = (node) => render(<ThemeProvider theme={theme}>{node}</ThemeProvider>);

const BASE_TS = Date.parse('2026-09-30T12:00:00.000Z');
const buildMessage = (index, tsOffset = 0) => ({
  id: `msg-${index}`,
  body: `Message ${index}`,
  created_at: new Date(BASE_TS + tsOffset + index * 60 * 1000).toISOString(),
  is_own: index % 2 === 0,
  kind: 'text',
  sender: { id: index % 2 === 0 ? 1 : 2 },
  attachments: [],
});

const buildProps = (overrides = {}) => {
  const scrollRoot = document.createElement('div');
  return {
    theme,
    ui,
    compactMobile: false,
    mobileInteractionsEnabled: false,
    activeConversation: { id: 'conv-1', kind: 'direct' },
    navigate: vi.fn(),
    messages: [],
    messagesLoading: false,
    effectiveLastReadMessageId: '',
    messagesHasMore: true,
    loadingOlder: false,
    onLoadOlder: vi.fn(),
    threadScrollRef: { current: scrollRoot },
    threadContentRef: { current: null },
    bottomRef: { current: null },
    onOpenReads: vi.fn(),
    onOpenAttachmentPreview: vi.fn(),
    onReplyMessage: vi.fn(),
    onOpenMessageMenu: vi.fn(),
    onConfirmAction: vi.fn(),
    onCancelAction: vi.fn(),
    onEditAction: vi.fn(),
    getReadTargetRef: vi.fn(),
    onToggleReaction: vi.fn(),
    onScrollToMessage: vi.fn(),
    currentUserId: 1,
    ...overrides,
  };
};

describe('ChatMessageList — рендеры при догрузке истории (Д2-3)', () => {
  beforeEach(() => {
    bubbleRenderCounts.byId.clear();
    bubbleRenderCounts.total = 0;
  });

  it('prepend 30 старых сообщений не перерисовывает существующие пузыри', () => {
    const initial = Array.from({ length: 160 }, (_, i) => buildMessage(i + 1));
    const older = Array.from(
      { length: 30 },
      (_, i) => buildMessage(i + 1, -160 * 60 * 1000),
    ).map((message) => ({ ...message, id: `old-${message.id}` }));
    // Границу серии разрываем: последний старый от другого автора,
    // иначе groupedWithPrevious у первого старого сообщения законно меняется.
    older[older.length - 1] = { ...older[older.length - 1], sender: { id: 99 }, is_own: true };

    const props = buildProps({ messages: initial });
    const { rerender } = renderWithTheme(<ChatMessageList {...props} />);
    expect(bubbleRenderCounts.total).toBe(160);

    bubbleRenderCounts.byId.clear();
    bubbleRenderCounts.total = 0;

    rerender(
      <ThemeProvider theme={theme}>
        <ChatMessageList {...props} messages={[...older, ...initial]} />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('bubble-old-msg-1')).toBeInTheDocument();
    expect(screen.getByTestId('bubble-msg-160')).toBeInTheDocument();

    const rerenderedExisting = initial
      .map((message) => [message.id, bubbleRenderCounts.byId.get(message.id) || 0])
      .filter(([, count]) => count > 0);
    expect(rerenderedExisting).toEqual([]);
    older.forEach((message) => {
      expect(bubbleRenderCounts.byId.get(message.id)).toBe(1);
    });
  });

  it('повторный рендер с теми же props не перерисовывает пузыри', () => {
    const props = buildProps({ messages: Array.from({ length: 60 }, (_, i) => buildMessage(i + 1)) });
    const { rerender } = renderWithTheme(<ChatMessageList {...props} />);
    expect(bubbleRenderCounts.total).toBe(60);

    bubbleRenderCounts.byId.clear();
    bubbleRenderCounts.total = 0;

    rerender(
      <ThemeProvider theme={theme}>
        <ChatMessageList {...props} />
      </ThemeProvider>,
    );

    expect(bubbleRenderCounts.total).toBe(0);
  });

  it('смена подсветки перерисовывает только затронутый пузырь', () => {
    const messages = Array.from({ length: 60 }, (_, i) => buildMessage(i + 1));
    const props = buildProps({ messages, highlightedMessageId: 'msg-10' });
    const { rerender } = renderWithTheme(<ChatMessageList {...props} />);
    expect(bubbleRenderCounts.total).toBe(60);

    bubbleRenderCounts.byId.clear();
    bubbleRenderCounts.total = 0;

    rerender(
      <ThemeProvider theme={theme}>
        <ChatMessageList {...props} highlightedMessageId="msg-40" />
      </ThemeProvider>,
    );

    const touched = [...bubbleRenderCounts.byId.entries()].filter(([, count]) => count > 0).map(([id]) => id);
    expect(touched.sort()).toEqual(['msg-10', 'msg-40']);
  });

});
