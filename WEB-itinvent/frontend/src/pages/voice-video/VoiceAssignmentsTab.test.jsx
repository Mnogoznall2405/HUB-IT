import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import VoiceAssignmentsTab from './VoiceAssignmentsTab';
import { voiceJobsAPI } from '../../api/voiceJobs';
import { hubTaskSupportAPI } from '../../api/hubTaskSupport';
import { hubTasksAPI } from '../../api/hubTasks';

vi.mock('../../api/voiceJobs', () => ({
  voiceJobsAPI: {
    getAssignments: vi.fn().mockResolvedValue({
      items: [
        { num: '1', section: 'Охрана', time: '04:59', clip: 'clip_01.mp4', task: 'Провести инструктаж', assignee: 'Иванов', deadline: '01.10.2026' },
        { num: '2', section: 'Работы', time: '10:11', clip: '', task: 'Сдать отчёт', assignee: '', deadline: '' },
      ],
    }),
    getAssignmentStatuses: vi.fn().mockResolvedValue({ items: [] }),
    updateAssignmentStatus: vi.fn().mockResolvedValue({}),
    clipUrl: vi.fn().mockReturnValue('/api/v1/voice/meetings/base/clips/clip_01.mp4'),
  },
}));

vi.mock('../../api/hubTaskSupport', () => ({
  hubTaskSupportAPI: { getAssignees: vi.fn().mockResolvedValue({ items: [] }) },
}));

vi.mock('../../api/hubTasks', () => ({
  hubTasksAPI: { createTask: vi.fn().mockResolvedValue({}) },
}));

const openRowMenu = async (num) => {
  fireEvent.click(await screen.findByRole('button', { name: `Действия с поручением №${num}` }));
  return screen.findByRole('menu');
};

describe('VoiceAssignmentsTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders assignments with continuous numbering', async () => {
    render(<VoiceAssignmentsTab base="test" />);
    await waitFor(() => {
      expect(screen.getByText('Провести инструктаж')).toBeInTheDocument();
    });
    expect(screen.getByText('Сдать отчёт')).toBeInTheDocument();
    // Нумерация — в мета-строке «№N · ответственный · срок» (P4-1).
    expect(screen.getByText(/№1 ·/)).toBeInTheDocument();
    expect(screen.getByText(/№2 ·/)).toBeInTheDocument();
  });

  it('shows empty state when no assignments', async () => {
    const { voiceJobsAPI } = await import('../../api/voiceJobs');
    voiceJobsAPI.getAssignments.mockResolvedValueOnce({ items: [] });
    render(<VoiceAssignmentsTab base="test2" />);
    await waitFor(() => {
      expect(screen.getByText(/нет реестра поручений/i)).toBeInTheDocument();
    });
  });

  it('exposes completion state and a distinct create-task action', async () => {
    render(<VoiceAssignmentsTab base="test" canCreateTasks />);
    await screen.findByRole('button', { name: 'Действия с поручением №1' });
    const allFilter = screen.getByRole('button', { name: 'Все (2)' });
    const unassignedFilter = screen.getByRole('button', { name: 'Без ответственного (1)' });

    expect(allFilter).toHaveAttribute('aria-pressed', 'true');
    expect(unassignedFilter).toHaveAttribute('aria-pressed', 'false');

    let menu = await openRowMenu('1');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Отметить выполненным (поручение №1)' }));
    await waitFor(() => {
      expect(voiceJobsAPI.updateAssignmentStatus).toHaveBeenCalledWith('test', { num: '1', key: undefined }, 'done', '');
    });

    menu = await openRowMenu('1');
    expect(within(menu).getByRole('menuitem', { name: 'Вернуть в работу (поручение №1)' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Создать задачу (поручение №1)' })).toBeInTheDocument();
    fireEvent.keyDown(menu, { key: 'Escape' });

    fireEvent.click(unassignedFilter);
    expect(unassignedFilter).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows an error when updating an assignment status fails', async () => {
    voiceJobsAPI.updateAssignmentStatus.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), {
      response: { data: { detail: 'Изменение запрещено' } },
    }));
    render(<VoiceAssignmentsTab base="test" />);

    const menu = await openRowMenu('1');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Отметить выполненным (поручение №1)' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Изменение запрещено');
    expect(alert).toHaveClass('MuiAlert-standardError');
  });

  it('shows an error when a completed assignment cannot be returned to work', async () => {
    voiceJobsAPI.getAssignmentStatuses.mockResolvedValueOnce({ items: [{ num: '1', status: 'done' }] });
    voiceJobsAPI.updateAssignmentStatus.mockRejectedValueOnce(new Error('network unavailable'));
    render(<VoiceAssignmentsTab base="test" />);

    const menu = await openRowMenu('1');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Вернуть в работу (поручение №1)' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Не удалось изменить статус поручения');
    expect(voiceJobsAPI.updateAssignmentStatus).toHaveBeenCalledWith('test', { num: '1', key: undefined }, 'pending', '');
  });

  it('shows an error when an assignment cannot be moved to in progress', async () => {
    voiceJobsAPI.updateAssignmentStatus.mockRejectedValueOnce(new Error('network unavailable'));
    render(<VoiceAssignmentsTab base="test" />);

    const menu = await openRowMenu('1');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Взять в работу (поручение №1)' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Не удалось изменить статус поручения');
    expect(voiceJobsAPI.updateAssignmentStatus).toHaveBeenCalledWith('test', { num: '1', key: undefined }, 'in_progress', '');
  });

  it('keeps the comment dialog open and shows save errors', async () => {
    voiceJobsAPI.updateAssignmentStatus.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), {
      response: { data: { detail: 'Комментарий не сохранён' } },
    }));
    render(<VoiceAssignmentsTab base="test" />);

    const menu = await openRowMenu('1');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Комментарий (поручение №1)' }));
    fireEvent.change(screen.getByPlaceholderText('Статус, что сделано, что осталось...'), {
      target: { value: 'Обновление запланировано' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Комментарий не сохранён');
    expect(screen.getByRole('dialog', { name: 'Комментарий к поручению 1' })).toBeInTheDocument();
  });

  it('shows task creation failures with explicit error severity', async () => {
    hubTaskSupportAPI.getAssignees.mockResolvedValueOnce({
      items: [{ id: 'user-1', username: 'ivanov', full_name: 'Иванов Иван' }],
    });
    hubTasksAPI.createTask.mockRejectedValueOnce(Object.assign(new Error('Conflict'), {
      response: { data: { detail: 'Не удалось сохранить задачу' } },
    }));
    render(<VoiceAssignmentsTab base="test" canCreateTasks />);

    const menu = await openRowMenu('1');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Создать задачу (поручение №1)' }));
    const assigneeInput = screen.getByRole('combobox', { name: 'Исполнитель' });
    fireEvent.change(assigneeInput, { target: { value: 'Иванов' } });
    fireEvent.click(await screen.findByRole('option', { name: 'Иванов Иван' }));
    fireEvent.click(screen.getByRole('button', { name: 'Создать задачу' }));

    const errorText = await screen.findByText('Не удалось сохранить задачу');
    expect(errorText.closest('.MuiAlert-root')).toHaveClass('MuiAlert-standardError');
  });

  // --- P4-1: компактный список вместо таблицы, действия в меню «⋮» ---
  it('P4-1: строка поручения — время + задача (≤2 строки, полный текст в title) + мета-строка', async () => {
    render(<VoiceAssignmentsTab base="test" />);
    const task = await screen.findByText('Провести инструктаж');
    expect(task).toHaveAttribute('title', 'Провести инструктаж');
    expect(screen.getByText(/№1 · Иванов · 01\.10\.2026/)).toBeInTheDocument();
    // P5-4: у поручения без срока пустое поле не выводится («—» нет).
    const meta2 = screen.getByText(/^№2 · Без ответственного ·$/);
    expect(within(meta2).getByText('Новое')).toBeInTheDocument();
    expect(screen.queryByText(/№2 · Без ответственного · —/)).not.toBeInTheDocument();
    // Табличной разметки нет — список не должен выходить за ширину панели.
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('P5-4/время: «0:01:00» показывается как «1:00», пустые поля не выводятся', async () => {
    render(<VoiceAssignmentsTab base="test" items={[
      { num: '3', time: '0:01:00', task: 'Проверить смету', assignee: 'Иванов', deadline: '' },
    ]} />);
    await screen.findByText('Проверить смету');
    expect(screen.getByText('1:00')).toBeInTheDocument();
    expect(screen.queryByText('0:01:00')).not.toBeInTheDocument();
    // Статус — чип внутри мета-строки (вложенный элемент).
    const meta = screen.getByText(/^№3 · Иванов ·$/);
    expect(within(meta).getByText('Новое')).toBeInTheDocument();
  });

  it('P4-1: все действия поручения доступны через меню «⋮» с уникальными именами', async () => {
    render(<VoiceAssignmentsTab base="test" canCreateTasks />);
    const menu = await openRowMenu('1');
    expect(within(menu).getByRole('menuitem', { name: 'Отметить выполненным (поручение №1)' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Взять в работу (поручение №1)' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Комментарий (поручение №1)' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Создать задачу (поручение №1)' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Открыть фрагмент (поручение №1)' })).toBeInTheDocument();
    const download = within(menu).getByRole('menuitem', { name: 'Скачать фрагмент (поручение №1)' });
    expect(download).toHaveAttribute('href', expect.stringContaining('clip_01.mp4'));
    expect(download).toHaveAttribute('download');
  });

  it('P4-1: без права tasks.create в меню нет «Создать задачу»', async () => {
    render(<VoiceAssignmentsTab base="test" />);
    const menu = await openRowMenu('1');
    expect(within(menu).queryByRole('menuitem', { name: /Создать задачу/ })).not.toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Комментарий (поручение №1)' })).toBeInTheDocument();
  });

  it('P4-1: клик по времени перематывает основной плеер через onSeekTime', async () => {
    const onSeekTime = vi.fn();
    render(<VoiceAssignmentsTab base="test" items={[
      { num: '1', time: '04:59', clip: 'clip_01.mp4', task: 'Провести инструктаж', assignee: 'Иванов', deadline: '01.10.2026' },
    ]} onSeekTime={onSeekTime} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Перейти к 04:59 (поручение №1)' }));
    expect(onSeekTime).toHaveBeenCalledWith('04:59');
  });

  it('P4-1: без основной записи время открывает диалог фрагмента (T34)', async () => {
    render(<VoiceAssignmentsTab base="test" items={[
      { num: '1', time: '04:59', clip: 'clip_01.mp4', task: 'Провести инструктаж', assignee: 'Иванов', deadline: '01.10.2026' },
    ]} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Фрагмент поручения №1, 04:59' }));
    expect(await screen.findByRole('dialog', { name: /Фрагмент поручения №1/ })).toBeInTheDocument();
  });

  // --- T41: сводка-чипы, группы по разделам, чип статуса, ближайшее ---
  const t41Items = [
    { num: '1', section: 'Охрана', time: '04:59', task: 'Провести инструктаж', assignee: 'Иванов', deadline: '01.10.2099' },
    { num: '2', section: 'Работы', time: '10:11', task: 'Сдать отчёт', assignee: '', deadline: '' },
  ];

  it('T41: сводка-чипы считают поручения, просроченные и без ответственного', async () => {
    render(<VoiceAssignmentsTab base="test" items={t41Items} />);
    await screen.findByText('Провести инструктаж');
    // Сводка = сами чипы-фильтры со счётчиками (отдельной строки нет).
    expect(screen.getByRole('button', { name: 'Все (2)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Просроченные (0)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Без ответственного (1)' })).toBeInTheDocument();
    // Разделы показаны заголовками групп.
    expect(screen.getByRole('heading', { name: 'Охрана' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Работы' })).toBeInTheDocument();
    // Клик по чипу-фильтру «Без ответственного» оставляет только №2.
    fireEvent.click(screen.getByRole('button', { name: 'Без ответственного (1)' }));
    expect(screen.queryByText('Провести инструктаж')).not.toBeInTheDocument();
    expect(screen.getByText('Сдать отчёт')).toBeInTheDocument();
  });

  it('T41: статус — чип с текстом; ближайшее к позиции записи подсвечено', async () => {
    voiceJobsAPI.getAssignmentStatuses.mockResolvedValueOnce({ items: [{ num: '1', status: 'in_progress' }] });
    // Позиция 620с ближе к 10:11 (611с, №2), чем к 04:59 (299с, №1).
    render(<VoiceAssignmentsTab base="test" items={t41Items} currentSec={620} />);
    await screen.findByText('Провести инструктаж');
    await waitFor(() => expect(screen.getByText('В работе')).toBeInTheDocument());
    expect(screen.getByText('Новое')).toBeInTheDocument();
    const nearest = document.querySelector('[data-assign-nearest="1"]');
    expect(nearest).toBeInTheDocument();
    expect(nearest).toHaveTextContent('Сдать отчёт');
  });

  // --- Стабильные ключи поручений: статус не «переезжает» при пересборке реестра ---
  it('статус берётся по ключу поручения, а не по номеру строки', async () => {
    voiceJobsAPI.getAssignments.mockResolvedValueOnce({
      items: [
        { num: '1', key: 'bbbbbbbbbbbbbbbb', time: '01:00', task: 'Сдать отчёт', assignee: '', deadline: '' },
        { num: '2', key: 'aaaaaaaaaaaaaaaa', time: '02:00', task: 'Провести инструктаж', assignee: 'Иванов', deadline: '' },
      ],
    });
    // Статус ставили, когда «Провести инструктаж» было №1.
    voiceJobsAPI.getAssignmentStatuses.mockResolvedValueOnce({
      items: [{ num: '1', key: 'aaaaaaaaaaaaaaaa', status: 'done' }],
    });
    render(<VoiceAssignmentsTab base="test" />);
    await screen.findByText('Провести инструктаж');
    const meta2 = await screen.findByText(/^№2 · Иванов ·$/);
    await waitFor(() => expect(within(meta2).getByText('Выполнено')).toBeInTheDocument());
    expect(within(screen.getByText(/^№1 · Без ответственного ·$/)).getByText('Новое')).toBeInTheDocument();

    const menu = await openRowMenu('2');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Вернуть в работу (поручение №2)' }));
    await waitFor(() => expect(voiceJobsAPI.updateAssignmentStatus).toHaveBeenCalledWith(
      'test', { num: '2', key: 'aaaaaaaaaaaaaaaa' }, 'pending', '',
    ));
  });

  it('созданная задача сохраняется на сервере и повторно не предлагается', async () => {
    voiceJobsAPI.getAssignments.mockResolvedValueOnce({
      items: [{ num: '1', key: 'cccccccccccccccc', time: '04:59', task: 'Провести инструктаж', assignee: 'Иванов', deadline: '' }],
    });
    hubTaskSupportAPI.getAssignees.mockResolvedValueOnce({
      items: [{ id: 'user-1', username: 'ivanov', full_name: 'Иванов Иван' }],
    });
    hubTasksAPI.createTask.mockResolvedValueOnce({ items: [{ id: 'task-77' }], created: 1 });
    render(<VoiceAssignmentsTab base="test" canCreateTasks />);

    const menu = await openRowMenu('1');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Создать задачу (поручение №1)' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Исполнитель' }), { target: { value: 'Иванов' } });
    fireEvent.click(await screen.findByRole('option', { name: 'Иванов Иван' }));
    fireEvent.click(screen.getByRole('button', { name: 'Создать задачу' }));

    await waitFor(() => expect(voiceJobsAPI.updateAssignmentStatus).toHaveBeenCalledWith(
      'test', { num: '1', key: 'cccccccccccccccc' }, 'pending', '', { taskId: 'task-77' },
    ));
    expect(await screen.findByText(/Задача создана/)).toBeInTheDocument();
    const again = await openRowMenu('1');
    expect(within(again).queryByRole('menuitem', { name: 'Создать задачу (поручение №1)' })).not.toBeInTheDocument();
  });

  it('после перезагрузки задача видна по task_id из статусов', async () => {
    voiceJobsAPI.getAssignments.mockResolvedValueOnce({
      items: [{ num: '1', key: 'dddddddddddddddd', time: '04:59', task: 'Провести инструктаж', assignee: 'Иванов', deadline: '' }],
    });
    voiceJobsAPI.getAssignmentStatuses.mockResolvedValueOnce({
      items: [{ num: '1', key: 'dddddddddddddddd', status: 'pending', task_id: 'task-5' }],
    });
    render(<VoiceAssignmentsTab base="test" canCreateTasks />);
    expect(await screen.findByText(/Задача создана/)).toBeInTheDocument();
    const menu = await openRowMenu('1');
    expect(within(menu).queryByRole('menuitem', { name: 'Создать задачу (поручение №1)' })).not.toBeInTheDocument();
  });

  it('чекбокс в строке отмечает поручение выполненным, прогресс обновляется', async () => {
    voiceJobsAPI.getAssignments.mockResolvedValueOnce({
      items: [
        { num: '1', key: 'eeeeeeeeeeeeeeee', time: '01:00', task: 'Первое', assignee: 'Иванов', deadline: '' },
        { num: '2', key: 'ffffffffffffffff', time: '02:00', task: 'Второе', assignee: 'Петров', deadline: '' },
      ],
    });
    render(<VoiceAssignmentsTab base="test" />);
    await screen.findByText('Первое');
    expect(screen.getByLabelText('Выполнено 0 из 2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Выполнено: поручение №1' }));
    await waitFor(() => expect(voiceJobsAPI.updateAssignmentStatus).toHaveBeenCalledWith(
      'test', { num: '1', key: 'eeeeeeeeeeeeeeee' }, 'done', '',
    ));
    expect(await screen.findByLabelText('Выполнено 1 из 2')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Выполнено: поручение №1' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Открытые (1)' })).toBeInTheDocument();
  });

  it('прочерк вместо ответственного/срока считается пустым значением', async () => {
    voiceJobsAPI.getAssignments.mockResolvedValueOnce({
      items: [
        { num: '1', key: '1111111111111111', time: '01:00', task: 'Без исполнителя', assignee: '—', deadline: '—' },
        { num: '2', key: '2222222222222222', time: '02:00', task: 'С исполнителем', assignee: 'Иванов', deadline: '' },
      ],
    });
    render(<VoiceAssignmentsTab base="test" />);
    await screen.findByText('Без исполнителя');
    expect(screen.getByRole('button', { name: 'Без ответственного (1)' })).toBeInTheDocument();
    expect(screen.getByText(/^№1 · Без ответственного ·$/)).toBeInTheDocument();
    expect(screen.queryByText(/№1 · —/)).not.toBeInTheDocument();
  });
});
