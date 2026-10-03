import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import VoiceMeetingSummary, { assignmentProgress, parseDeadlineIso } from './VoiceMeetingSummary';
import { voiceJobsAPI } from '../../api/voiceJobs';

vi.mock('../../api/voiceJobs', () => ({
  voiceJobsAPI: { getSummary: vi.fn(), getAssignmentStatuses: vi.fn() },
}));

const summary = {
  available: true,
  duration: '15:25',
  summary: '## Итог\nДоговорились по смете.',
  decisions: [
    { text: 'Подписать ДС до 29.09', topic: 'Смета', start: 27 },
    { text: 'Сдать ГПР к 25.09', topic: 'ГПР', start: 433 },
  ],
  open_questions: [{ text: 'Кто закрывает замечания?', topic: 'ИД', start: 650 }],
  participants: [
    { name: 'Иванов', share: 60 },
    { name: 'Петрова', share: 40 },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  voiceJobsAPI.getSummary.mockResolvedValue(summary);
  voiceJobsAPI.getAssignmentStatuses.mockResolvedValue({ items: [] });
});

describe('assignmentProgress', () => {
  const items = [
    { num: '1', key: 'a', deadline: '01.01.2020' },
    { num: '2', key: 'b', deadline: '01.01.2020' },
    { num: '3', key: 'c', deadline: '' },
  ];

  it('считает выполненные, в работе и просроченные только среди невыполненных', () => {
    const res = assignmentProgress(
      items,
      [{ key: 'a', status: 'done' }, { key: 'c', status: 'in_progress' }],
      '2026-10-02',
    );
    expect(res).toEqual({ total: 3, done: 1, inProgress: 1, overdue: 1 });
  });

  it('разбирает сроки ДД.ММ и ДД.ММ.ГГГГ', () => {
    expect(parseDeadlineIso('25.09.2026 16:00')).toBe('2026-09-25');
    expect(parseDeadlineIso('до 5.10')).toMatch(/^\d{4}-10-05$/);
    expect(parseDeadlineIso('—')).toBeNull();
  });
});

describe('VoiceMeetingSummary', () => {
  it('показывает решения с таймкодами, перематывает плеер и ведёт на вкладку поручений', async () => {
    const onSeek = vi.fn();
    const onOpenTab = vi.fn();
    render(
      <VoiceMeetingSummary
        base="m1"
        assignmentItems={[{ num: '1', key: 'a', deadline: '' }, { num: '2', key: 'b', deadline: '' }]}
        unresolvedCount={2}
        onSeek={onSeek}
        onOpenTab={onOpenTab}
      />,
    );
    expect(await screen.findByText('Подписать ДС до 29.09')).toBeInTheDocument();
    expect(screen.getByText('Кто закрывает замечания?')).toBeInTheDocument();
    expect(screen.getByText(/Участников без имени: 2/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Перейти к 7:13/ }));
    expect(onSeek).toHaveBeenCalledWith(433);

    fireEvent.click(screen.getByRole('button', { name: 'Все поручения' }));
    expect(onOpenTab).toHaveBeenCalledWith('assign');
    fireEvent.click(screen.getByRole('button', { name: 'Назвать' }));
    expect(onOpenTab).toHaveBeenCalledWith('speakers');
  });

  it('прогресс поручений берёт статусы с сервера', async () => {
    voiceJobsAPI.getAssignmentStatuses.mockResolvedValue({ items: [{ key: 'a', status: 'done' }] });
    render(
      <VoiceMeetingSummary
        base="m1"
        assignmentItems={[{ num: '1', key: 'a', deadline: '' }, { num: '2', key: 'b', deadline: '' }]}
      />,
    );
    const bar = await screen.findByLabelText('Выполнено 1 из 2');
    expect(bar).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('1 / 2')).toBeInTheDocument());
  });

  it('при ошибке даёт «Повторить», при пустой сводке — понятное сообщение', async () => {
    voiceJobsAPI.getSummary.mockRejectedValueOnce(new Error('boom'));
    render(<VoiceMeetingSummary base="m1" assignmentItems={[]} />);
    const alert = await screen.findByRole('alert');
    voiceJobsAPI.getSummary.mockResolvedValue({
      available: false, summary: '', decisions: [], open_questions: [], participants: [],
    });
    fireEvent.click(within(alert).getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText(/сводка не сформирована/i)).toBeInTheDocument();
  });
});
