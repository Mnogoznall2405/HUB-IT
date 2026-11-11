import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

import { ChatBubble } from './ChatBubble';
import {
  buildChatLocationOpenUrl,
  getChatContactPreviewText,
  getChatPollPreviewText,
  parseChatContactBody,
  parseChatLocationBody,
  parseChatPollBody,
  resolveChatMessagePoll,
  resolveChatStructuredContent,
} from './chatStructuredContent';
import { getMessagePreview, getReplyPreviewText } from './chatHelpers';

const theme = createTheme();
const ui = {
  textSecondary: '#64748b',
  accentText: '#38bdf8',
  bubbleOwnBg: '#2b5278',
  bubbleOwnText: '#f8fafc',
  bubbleOtherBg: '#182533',
  bubbleOtherText: '#f8fafc',
  composerInputBg: '#223140',
  borderSoft: 'rgba(148,163,184,0.2)',
  threadBg: '#0e1621',
};

const renderWithTheme = (node) => render(<ThemeProvider theme={theme}>{node}</ThemeProvider>);

describe('chatStructuredContent parsers', () => {
  it('parses a valid location body', () => {
    const payload = parseChatLocationBody(JSON.stringify({
      latitude: 55.751244, longitude: 37.618423, title: 'Офис', address: 'Москва',
    }));
    expect(payload).toEqual({ latitude: 55.751244, longitude: 37.618423, title: 'Офис', address: 'Москва' });
  });

  it.each([
    'not-json',
    '{}',
    JSON.stringify({ latitude: 'abc', longitude: 10 }),
    JSON.stringify({ latitude: 120, longitude: 10 }),
    JSON.stringify([1, 2]),
    null,
    undefined,
  ])('rejects invalid location body %j', (body) => {
    expect(parseChatLocationBody(body)).toBeNull();
  });

  it('parses a valid contact body and trims fields', () => {
    expect(parseChatContactBody(JSON.stringify({ name: '  Иван ', phone: '+7 900', organization: ' ООО ' })))
      .toEqual({ name: 'Иван', phone: '+7 900', organization: 'ООО' });
  });

  it.each(['not-json', '{}', JSON.stringify({ name: '  ' }), null])(
    'rejects invalid contact body %j',
    (body) => {
      expect(parseChatContactBody(body)).toBeNull();
    },
  );

  it('parses a poll body with >= 2 options', () => {
    const payload = parseChatPollBody(JSON.stringify({
      question: 'Куда идём?', options: ['Да', 'Нет'],
    }));
    expect(payload).toMatchObject({ question: 'Куда идём?', closed: false, total_voters: 0 });
    expect(payload.options).toEqual([{ text: 'Да', votes: 0 }, { text: 'Нет', votes: 0 }]);
  });

  it('prefers server poll payload over body JSON', () => {
    const message = {
      body: JSON.stringify({ question: 'body', options: ['a', 'b'] }),
      poll: { question: 'server', options: [{ text: 'x', votes: 3 }, { text: 'y', votes: 1 }], total_voters: 4, closed: true },
    };
    expect(resolveChatMessagePoll(message)).toMatchObject({ question: 'server', total_voters: 4, closed: true });
  });

  it('returns null content for deleted messages', () => {
    const resolved = resolveChatStructuredContent({
      kind: 'contact', is_deleted: true, body: JSON.stringify({ name: 'Иван' }),
    });
    expect(resolved).toEqual({ location: null, contact: null, poll: null });
  });

  it('builds a yandex maps url for a location', () => {
    expect(buildChatLocationOpenUrl({ latitude: 55.75, longitude: 37.61 }))
      .toBe('https://yandex.ru/maps/?pt=37.61,55.75&z=16&l=map');
    expect(buildChatLocationOpenUrl({ latitude: 'x' })).toBe('');
  });

  it('formats preview texts', () => {
    expect(getChatContactPreviewText({ name: 'Иван' })).toBe('Контакт: Иван');
    expect(getChatContactPreviewText(null)).toBe('Контакт');
    expect(getChatPollPreviewText({ question: 'Куда?' })).toBe('Опрос: Куда?');
    expect(getChatPollPreviewText(null)).toBe('Опрос');
  });
});

describe('structured previews in chatHelpers', () => {
  it('renders readable previews instead of raw JSON', () => {
    expect(getMessagePreview({ kind: 'location', body: JSON.stringify({ latitude: 1, longitude: 2 }) }))
      .toBe('Геопозиция');
    expect(getMessagePreview({ kind: 'contact', body: JSON.stringify({ name: 'Иван' }) }))
      .toBe('Контакт: Иван');
    expect(getMessagePreview({ kind: 'poll', body: JSON.stringify({ question: 'Q?', options: ['a', 'b'] }) }))
      .toBe('Опрос: Q?');
  });

  it('renders readable reply preview for a contact', () => {
    const text = getReplyPreviewText({
      kind: 'contact',
      body: JSON.stringify({ name: 'Иван', phone: '+7900' }),
    });
    expect(text).toBe('Контакт: Иван');
    expect(text).not.toContain('{');
  });
});

describe('ChatBubble structured rendering', () => {
  it('renders a contact card without raw JSON body', () => {
    renderWithTheme(
      <ChatBubble
        theme={theme}
        ui={ui}
        message={{
          id: 'm-contact', kind: 'contact',
          body: JSON.stringify({ name: 'Иван Петров', phone: '+7 900 123', organization: 'ООО Ромашка' }),
          sender: { id: 2, full_name: 'Пётр' },
          is_own: false,
        }}
        conversationKind="direct"
      />,
    );
    expect(screen.getByTestId('chat-contact-card')).toBeInTheDocument();
    expect(screen.getByText('Иван Петров')).toBeInTheDocument();
    expect(screen.getByText(/900 123/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('"name"');
  });

  it('renders a location card that opens a map on click', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderWithTheme(
      <ChatBubble
        theme={theme}
        ui={ui}
        message={{
          id: 'm-geo', kind: 'location',
          body: JSON.stringify({ latitude: 55.75, longitude: 37.61, title: 'Офис' }),
          sender: { id: 2, full_name: 'Пётр' },
          is_own: false,
        }}
        conversationKind="direct"
      />,
    );
    const card = screen.getByTestId('chat-location-card');
    expect(screen.getByText('Офис')).toBeInTheDocument();
    fireEvent.click(card);
    expect(openSpy).toHaveBeenCalledWith(
      'https://yandex.ru/maps/?pt=37.61,55.75&z=16&l=map',
      '_blank',
      'noopener,noreferrer',
    );
    openSpy.mockRestore();
  });

  it('renders a poll card and calls onPollVote on option click', () => {
    const onPollVote = vi.fn();
    renderWithTheme(
      <ChatBubble
        theme={theme}
        ui={ui}
        message={{
          id: 'm-poll', kind: 'poll',
          body: JSON.stringify({ question: 'Куда идём?', options: ['Домой', 'В кино'] }),
          poll: {
            question: 'Куда идём?',
            options: [{ text: 'Домой', votes: 2 }, { text: 'В кино', votes: 1 }],
            total_voters: 3, closed: false, my_option_index: null,
          },
          sender: { id: 2, full_name: 'Пётр' },
          is_own: false,
        }}
        conversationKind="direct"
        onPollVote={onPollVote}
      />,
    );
    expect(screen.getByTestId('chat-poll-card')).toBeInTheDocument();
    expect(screen.getByText('Куда идём?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Вариант В кино/ }));
    expect(onPollVote).toHaveBeenCalledWith('m-poll', 1);
  });

  it('renders a readable fallback card for malformed structured body', () => {
    renderWithTheme(
      <ChatBubble
        theme={theme}
        ui={ui}
        message={{
          id: 'm-bad', kind: 'contact', body: 'not-json{',
          sender: { id: 2, full_name: 'Пётр' }, is_own: false,
        }}
        conversationKind="direct"
      />,
    );
    expect(screen.getByTestId('chat-contact-card')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('not-json{');
  });

  it('does not render a structured card for a deleted structured message', () => {
    renderWithTheme(
      <ChatBubble
        theme={theme}
        ui={ui}
        message={{
          id: 'm-del', kind: 'contact', is_deleted: true,
          body: 'Сообщение удалено',
          sender: { id: 2, full_name: 'Пётр' }, is_own: false,
        }}
        conversationKind="direct"
      />,
    );
    expect(screen.queryByTestId('chat-contact-card')).not.toBeInTheDocument();
  });
});

describe('Д2-10: single side-colored card without an outer bubble', () => {
  const baseMessage = {
    created_at: '2026-09-30T10:00:00Z',
    sender: { id: 2, full_name: 'Пётр' },
  };

  it('renders an own poll as one card on the own side color, meta inside, reactions below', () => {
    renderWithTheme(
      <ChatBubble
        theme={theme}
        ui={ui}
        message={{
          ...baseMessage,
          id: 'm-poll-own', kind: 'poll', is_own: true,
          body: JSON.stringify({ question: 'Куда?', options: ['Да', 'Нет'] }),
          poll: {
            question: 'Куда?',
            options: [{ text: 'Да', votes: 1 }, { text: 'Нет', votes: 0 }],
            total_voters: 1, closed: false, my_option_index: 0,
          },
          reactions: [{ emoji: '👍', count: 2, user_ids: [3] }],
        }}
        conversationKind="direct"
      />,
    );

    const poll = screen.getByTestId('chat-poll-card');
    const card = poll.closest('[data-chat-card-surface]');
    expect(card).not.toBeNull();
    // Фон карточки — цвет исходящей стороны, у контента нет второй подложки/рамки.
    expect(card).toHaveStyle({ backgroundColor: 'rgb(43, 82, 120)' });
    expect(poll.style.backgroundColor).toBe('');
    expect(poll.style.border).toBe('');
    // Время/галочки внутри карточки справа снизу.
    expect(card.querySelector('[data-chat-meta-layout="bottom"]')).not.toBeNull();
    // Реакции рендерятся под карточкой, а не внутри неё.
    const reactions = screen.getByTestId('chat-reactions-bar');
    expect(card.contains(reactions)).toBe(false);
    expect(card.compareDocumentPosition(reactions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders an incoming file without caption as a side-colored card', () => {
    renderWithTheme(
      <ChatBubble
        theme={theme}
        ui={ui}
        message={{
          ...baseMessage,
          id: 'm-file', kind: 'file', is_own: false, body: '',
          attachments: [{
            id: 'att-1', file_name: 'report.pdf', file_size: 2048,
            mime_type: 'application/pdf', original_url: '/files/report.pdf',
          }],
        }}
        conversationKind="direct"
      />,
    );

    const fileLink = screen.getByRole('link', { name: /Открыть файл report\.pdf/i });
    const card = fileLink.closest('[data-chat-card-surface]');
    expect(card).not.toBeNull();
    expect(card).toHaveStyle({ backgroundColor: 'rgb(24, 37, 51)' });
    // Файловая строка плоская — без внутренней рамки и второй подложки.
    expect(fileLink.style.border).toBe('');
    expect(fileLink.style.backgroundColor).toBe('transparent');
    expect(card.querySelector('[data-chat-meta-layout="bottom"]')).not.toBeNull();
  });

  it('keeps a captioned file inside a regular bubble', () => {
    renderWithTheme(
      <ChatBubble
        theme={theme}
        ui={ui}
        message={{
          ...baseMessage,
          id: 'm-file-caption', kind: 'file', is_own: false, body: 'Смотри файл',
          attachments: [{
            id: 'att-2', file_name: 'report.pdf', file_size: 2048,
            mime_type: 'application/pdf', original_url: '/files/report.pdf',
          }],
        }}
        conversationKind="direct"
      />,
    );

    expect(document.querySelector('[data-chat-card-surface]')).toBeNull();
    const surface = document.querySelector('[data-chat-bubble-surface]');
    expect(surface).toHaveStyle({ backgroundColor: 'rgb(24, 37, 51)' });
    expect(surface.textContent).toContain('Смотри файл');
  });

  it('renders a photo without caption as bare media with a meta overlay', () => {
    renderWithTheme(
      <ChatBubble
        theme={theme}
        ui={ui}
        message={{
          ...baseMessage,
          id: 'm-photo', kind: 'text', is_own: false, body: '',
          attachments: [{
            id: 'att-3', file_name: 'photo.jpg', file_size: 4096,
            mime_type: 'image/jpeg', original_url: '/files/photo.jpg',
            width: 800, height: 1600,
          }],
        }}
        conversationKind="direct"
      />,
    );

    expect(document.querySelector('[data-chat-card-surface]')).toBeNull();
    // R40: time on a photo is visible without hover (desktop included).
    const mediaMeta = screen.getByTestId('chat-media-meta');
    expect(mediaMeta).toBeInTheDocument();
    expect(getComputedStyle(mediaMeta).opacity).not.toBe('0');
    expect(screen.getByTestId('chat-bubble-meta-media')).toHaveTextContent(/\d{1,2}:\d{2}/);
    expect(screen.getByRole('img', { name: 'photo.jpg' })).toBeInTheDocument();
  });
});

describe('R51: time of a single large emoji', () => {
  const emojiMessage = (extra = {}) => ({
    id: 'm-emoji', kind: 'text', is_own: true, body: '😂', created_at: '2026-10-02T04:14:00Z',
    sender: { id: 1, full_name: 'Я' },
    ...extra,
  });

  it('puts the time in a small pill below the emoji instead of over it', () => {
    renderWithTheme(<ChatBubble theme={theme} ui={ui} message={emojiMessage()} conversationKind="direct" />);

    const body = document.querySelector('[data-chat-emoji-only="true"]');
    const meta = screen.getByTestId('chat-bubble-meta-emoji');
    expect(body).not.toBeNull();
    expect(meta).toHaveAttribute('data-chat-meta-layout', 'emoji');
    // In the flow after the emoji, not absolutely positioned over it.
    expect(meta).toHaveStyle({ position: 'relative' });
    expect(body.compareDocumentPosition(meta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(body.contains(meta)).toBe(false);
    expect(getComputedStyle(meta).backgroundColor).toBe('rgba(2, 6, 23, 0.5)');
    // No space reserved for an overlaid time.
    expect(getComputedStyle(body).paddingBottom).toBe('0px');
    expect(screen.queryByTestId('chat-bubble-meta-bottom')).not.toBeInTheDocument();
  });

  it('keeps the pill next to the reactions when the emoji has reactions', () => {
    renderWithTheme(
      <ChatBubble
        theme={theme}
        ui={ui}
        message={emojiMessage({ reactions: [{ emoji: '👍', count: 1, user_ids: [3] }] })}
        conversationKind="direct"
      />,
    );
    const footer = screen.getByTestId('chat-bubble-reaction-footer');
    expect(footer.querySelector('[data-chat-meta-layout="emoji"]')).not.toBeNull();
  });

  it('leaves ordinary text messages on the regular meta layout', () => {
    renderWithTheme(
      <ChatBubble theme={theme} ui={ui} message={emojiMessage({ body: 'Привет всем, это обычное сообщение' })} conversationKind="direct" />,
    );
    expect(screen.queryByTestId('chat-bubble-meta-emoji')).not.toBeInTheDocument();
  });
});

describe('R50: «не голосовал» is not «выбран первый вариант»', () => {
  it('keeps my_option_index null for a server poll and for a body fallback', () => {
    const server = resolveChatMessagePoll({
      poll: { question: 'q', options: [{ text: 'a', votes: 0 }, { text: 'b', votes: 0 }], my_option_index: null },
    });
    expect(server.my_option_index).toBeNull();
    const fromBody = parseChatPollBody(JSON.stringify({ question: 'q', options: ['a', 'b'], my_option_index: null }));
    expect(fromBody.my_option_index).toBeNull();
    expect(parseChatPollBody(JSON.stringify({ question: 'q', options: ['a', 'b'] })).my_option_index).toBeNull();
  });

  it('still returns a real chosen index, including the first option', () => {
    const poll = (index) => resolveChatMessagePoll({
      poll: { question: 'q', options: [{ text: 'a', votes: 1 }, { text: 'b', votes: 0 }], my_option_index: index },
    });
    expect(poll(0).my_option_index).toBe(0);
    expect(poll(1).my_option_index).toBe(1);
  });
});
