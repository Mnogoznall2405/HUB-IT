import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import VoiceVoicesSection from './VoiceVoicesSection';

let originalMatchMedia;

afterEach(() => {
  if (originalMatchMedia) window.matchMedia = originalMatchMedia;
  originalMatchMedia = undefined;
});

vi.mock('../../api/voiceVoices', () => ({
  voiceVoicesAPI: {
    sampleUrl: vi.fn((name, sample) => `/voice/voices/${name}/samples/${sample}`),
  },
}));

describe('VoiceVoicesSection: accessible audio names (T15)', () => {
  it('names each sample playback button with its voice and filename', () => {
    render(
      <VoiceVoicesSection
        voices={[{
          name: 'Иван',
          samples: ['sample-a.wav', 'sample-b.wav'],
          samples_count: 2,
          has_embedding: true,
        }]}
      />,
    );

    expect(screen.getByRole('button', { name: 'Прослушать запись голоса Иван, sample-a.wav' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Прослушать запись голоса Иван, sample-b.wav' })).toBeInTheDocument();
  });
});

// Ближайший предок с flex-direction:row — «строка», в которой лежит элемент.
const rowOf = (el, boundary) => {
  let node = el.parentElement;
  while (node && node !== boundary) {
    if (window.getComputedStyle(node).flexDirection === 'row') return node;
    node = node.parentElement;
  }
  return null;
};

const mockMobile = () => {
  originalMatchMedia = window.matchMedia;
  window.matchMedia = (query) => ({
    matches: /max-width:\s*599/.test(query),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
};

describe('VoiceVoicesSection: мобильные карточки (T17)', () => {
  it('shows voice actions inside cards instead of a horizontally overflowing table', () => {
    mockMobile();

    render(
      <VoiceVoicesSection
        canManage
        voices={[{
          name: 'Иван',
          samples: ['sample-a.wav'],
          samples_count: 1,
          has_embedding: true,
        }]}
      />,
    );

    expect(screen.getByRole('group', { name: 'Голос Иван' })).toBeInTheDocument();
    // T26: действия карточки собраны в меню «⋮» вместо ряда кнопок.
    fireEvent.click(screen.getByRole('button', { name: 'Действия с голосом Иван' }));
    expect(screen.getByRole('menuitem', { name: 'Заменить запись' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Удалить голос' })).toBeVisible();
    expect(screen.queryByRole('columnheader', { name: 'Имя' })).not.toBeInTheDocument();
  });

  it('keeps the card to two compact rows: actions in the title line, samples with the count (N13)', () => {
    mockMobile();

    render(
      <VoiceVoicesSection
        canManage
        voices={[{
          name: 'Иван',
          samples: ['sample-a.wav'],
          samples_count: 1,
          has_embedding: true,
        }]}
      />,
    );

    const card = screen.getByRole('group', { name: 'Голос Иван' });
    const heading = screen.getByRole('heading', { name: 'Иван' });
    const actions = screen.getByRole('button', { name: 'Действия с голосом Иван' });
    // «⋮» живёт в строке заголовка, а не в отдельной строке под карточкой.
    expect(rowOf(heading, card)?.contains(actions)).toBe(true);

    // «Сэмплы» и кнопки прослушивания — в одной строке с «Записей: N».
    const count = screen.getByText('Записей: 1');
    const metaRow = rowOf(count, card);
    expect(metaRow).not.toBeNull();
    expect(metaRow.contains(screen.getByText('Сэмплы'))).toBe(true);
    expect(metaRow.contains(screen.getByRole('button', {
      name: 'Прослушать запись голоса Иван, sample-a.wav',
    }))).toBe(true);
  });
});

describe('VoiceVoicesSection: меню действий голоса (T26)', () => {
  it('moves replace and delete into a single overflow menu for managers', () => {
    render(
      <VoiceVoicesSection
        canManage
        voices={[{
          name: 'Иван',
          samples: ['sample-a.wav'],
          samples_count: 1,
          has_embedding: true,
        }]}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Заменить запись голоса Иван' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Удалить голос Иван' })).not.toBeInTheDocument();

    const menu = screen.getByRole('button', { name: 'Действия с голосом Иван' });
    expect(menu).toHaveAttribute('aria-haspopup', 'menu');
    fireEvent.click(menu);

    expect(screen.getByRole('menuitem', { name: 'Заменить запись' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Удалить голос' })).toBeInTheDocument();
  });

  it('keeps the action menu out of the table for users without voice.manage', () => {
    render(
      <VoiceVoicesSection
        canManage={false}
        voices={[{
          name: 'Иван',
          samples: ['sample-a.wav'],
          samples_count: 1,
          has_embedding: true,
        }]}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Действия с голосом Иван' })).not.toBeInTheDocument();
  });
});