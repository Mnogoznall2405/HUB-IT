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
