import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import VoiceJobsSection from './VoiceJobsSection';

vi.mock('../../api/voiceJobs', () => ({
  voiceJobsAPI: { getJobLog: vi.fn() },
}));

describe('VoiceJobsSection: позиция очереди (V07)', () => {
  it('«Впереди: N» считается по created_at возрастанию и только по активным', () => {
    // Сервер отдаёт задачи по created_at DESC (новые сверху) — как в списке.
    const jobs = [
      {
        id: 3, original_filename: 'newest.mp3', kind: 'process', status: 'queued',
        created_at: '2026-09-29T12:00:00Z', created_by: 'tester', file_size: 1000,
      },
      {
        id: 2, original_filename: 'finished.mp3', kind: 'process', status: 'done',
        created_at: '2026-09-29T11:00:00Z', created_by: 'tester', file_size: 1000,
      },
      {
        id: 1, original_filename: 'older.mp3', kind: 'process', status: 'queued',
        created_at: '2026-09-29T10:00:00Z', created_by: 'tester', file_size: 1000,
      },
      {
        id: 0, original_filename: 'worker.mp3', kind: 'process', status: 'processing',
        created_at: '2026-09-29T09:00:00Z', created_by: 'tester', file_size: 1000,
      },
      {
        id: 4, original_filename: 'broken.mp3', kind: 'process', status: 'failed',
        created_at: '2026-09-29T08:00:00Z', created_by: 'tester', file_size: 1000,
      },
    ];
    render(<VoiceJobsSection jobs={jobs} canManage />);
    const rowOf = (name) => screen.getByText(name).closest('tr');
    // FIFO: worker (processing, 09:00) → older (10:00) → newest (12:00);
    // done/failed в очередь не считаются.
    expect(within(rowOf('newest.mp3')).getByText(/^Впереди: 2 ·/)).toBeInTheDocument();
    expect(within(rowOf('older.mp3')).getByText(/^Впереди: 1 ·/)).toBeInTheDocument();
    // У обработающейся задачи позиции нет.
    expect(within(rowOf('worker.mp3')).queryByText(/Впереди/)).not.toBeInTheDocument();
  });
});

describe('VoiceJobsSection: единое меню действий (T26)', () => {
  const jobs = [
    {
      id: 1, original_filename: 'done.mp3', kind: 'process', status: 'done',
      base_filename: 'j123456789012_done', created_at: '2026-09-29T10:00:00Z',
      created_by: 'owner', file_size: 1000,
    },
    {
      id: 2, original_filename: 'failed.mp3', kind: 'process', status: 'failed',
      created_at: '2026-09-29T09:00:00Z', created_by: 'owner', file_size: 1000,
    },
    {
      id: 3, original_filename: 'active.mp3', kind: 'process', status: 'processing',
      created_at: '2026-09-29T08:00:00Z', created_by: 'owner', file_size: 1000,
    },
  ];
  const desktop = (query) => {
    window.matchMedia = (media) => ({
      matches: false, media, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  };

  it('replaces the icon row with one fixed-width overflow menu per job', () => {
    desktop();
    render(<VoiceJobsSection jobs={jobs} canManage canUpload currentActor="owner" />);

    const menus = screen.getAllByRole('button', { name: /^Действия с задачей / });
    expect(menus).toHaveLength(3);
    for (const menu of menus) {
      expect(menu).toHaveAttribute('aria-haspopup', 'menu');
    }
    // Прежние разнотипные иконки в строке больше не выводятся.
    expect(screen.queryByRole('button', { name: 'Показать лог задачи' })).not.toBeInTheDocument();
  });

  it('keeps the actions column at the same position in every row', () => {
    desktop();
    render(<VoiceJobsSection jobs={jobs} canManage canUpload currentActor="owner" />);

    const cells = screen.getAllByRole('cell')
      .filter((c) => c.querySelector('[aria-haspopup="menu"]'));
    expect(cells).toHaveLength(3);
    const widths = cells.map((c) => c.getBoundingClientRect().width);
    expect(new Set(widths.map((w) => Math.round(w))).size).toBe(1);
  });

  it('moves log, open protocol, retry, cancel and delete into menu items with the same rights', () => {
    desktop();
    render(<VoiceJobsSection jobs={jobs} canManage canUpload currentActor="owner" />);

    // Готовая задача: лог, протокол, удаление (повтор недоступен для статуса done).
    fireEvent.click(screen.getByRole('button', { name: 'Действия с задачей done.mp3' }));
    for (const label of ['Показать лог', 'Открыть протокол', 'Удалить задачу']) {
      expect(screen.getByRole('menuitem', { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByRole('menuitem', { name: 'Повторить задачу' })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getAllByRole('menuitem')[0], { key: 'Escape' });

    // Ошибка: доступен повтор, но не отмена и не протокол.
    fireEvent.click(screen.getByRole('button', { name: 'Действия с задачей failed.mp3' }));
    expect(screen.getByRole('menuitem', { name: 'Повторить задачу' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Отменить задачу' })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getAllByRole('menuitem')[0], { key: 'Escape' });

    // Активная задача: отмена владельцу с voice.upload, удаление скрыто.
    fireEvent.click(screen.getByRole('button', { name: 'Действия с задачей active.mp3' }));
    expect(screen.getByRole('menuitem', { name: 'Отменить задачу' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Удалить задачу' })).not.toBeInTheDocument();
  });

  it('hides manager-only items for another user without voice.manage', () => {
    desktop();
    render(<VoiceJobsSection jobs={jobs} canManage={false} canUpload currentActor="owner" />);

    fireEvent.click(screen.getByRole('button', { name: 'Действия с задачей done.mp3' }));
    expect(screen.queryByRole('menuitem', { name: 'Удалить задачу' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Показать лог' })).toBeInTheDocument();
  });

  it('shows the same overflow menu on mobile job cards', () => {
    window.matchMedia = (media) => ({
      matches: true, media, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {},
      dispatchEvent: () => false,
    });
    render(<VoiceJobsSection jobs={jobs} canManage canUpload currentActor="owner" />);

    expect(screen.queryByRole('button', { name: 'Показать лог задачи' })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /^Действия с задачей / })[0]);
    expect(screen.getByRole('menuitem', { name: 'Показать лог' })).toBeInTheDocument();
  });
});