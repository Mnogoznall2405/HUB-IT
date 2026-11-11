import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import VoiceGlossarySection from './VoiceGlossarySection';
import { voiceGlossaryAPI } from '../../api/voiceGlossary';

vi.mock('../../api/voiceGlossary', () => ({
  voiceGlossaryAPI: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
}));

const candidates = {
  items: [
    { id: 'a1', term: 'ТГС', kind: 'abbr', expansion: '', aliases: [], status: 'candidate', occurrences: 3, core: false, evidence: 'по ТГС передан техотчёт' },
    { id: 'a2', term: 'Анкор', kind: 'org', expansion: '', aliases: ['Анкер'], status: 'candidate', occurrences: 1, core: false },
  ],
  counts: { candidate: 2, confirmed: 5, rejected: 1 },
};

beforeEach(() => {
  vi.clearAllMocks();
  voiceGlossaryAPI.list.mockResolvedValue(candidates);
  voiceGlossaryAPI.update.mockResolvedValue({});
  voiceGlossaryAPI.create.mockResolvedValue({});
  voiceGlossaryAPI.remove.mockResolvedValue({});
});

describe('VoiceGlossarySection', () => {
  it('показывает кандидатов первыми, счётчики по статусам и подсказку про расшифровку', async () => {
    render(<VoiceGlossarySection />);
    expect(await screen.findByText('ТГС')).toBeInTheDocument();
    expect(screen.getByText('Кандидаты (2)')).toBeInTheDocument();
    expect(screen.getByText('Подтверждённые (5)')).toBeInTheDocument();
    expect(screen.getByText('в 3 записях')).toBeInTheDocument();
    expect(screen.getByText('Расшифровка не указана')).toBeInTheDocument();     // у аббревиатуры без расшифровки
    expect(screen.getByText(/Ошибочно распознаётся: Анкер/)).toBeInTheDocument();
    expect(voiceGlossaryAPI.list).toHaveBeenCalledWith({ status: 'candidate', q: undefined });
  });

  it('подтверждает и отклоняет кандидата и перезагружает список', async () => {
    render(<VoiceGlossarySection />);
    await screen.findByText('ТГС');
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить ТГС' }));
    await waitFor(() => expect(voiceGlossaryAPI.update).toHaveBeenCalledWith('a1', { status: 'confirmed' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отклонить Анкор' }));
    await waitFor(() => expect(voiceGlossaryAPI.update).toHaveBeenCalledWith('a2', { status: 'rejected' }));
    await waitFor(() => expect(voiceGlossaryAPI.list.mock.calls.length).toBeGreaterThanOrEqual(3));
  });

  it('правка кандидата сохраняет расшифровку и неверные написания списком и подтверждает его', async () => {
    render(<VoiceGlossarySection />);
    await screen.findByText('ТГС');
    fireEvent.click(screen.getByRole('button', { name: 'Изменить ТГС' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Расшифровка'), { target: { value: 'теплогазоснабжение' } });
    fireEvent.change(within(dialog).getByLabelText('Неверные написания'), { target: { value: 'ТЖС, тгс ; ТГ-С' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Сохранить и подтвердить' }));
    await waitFor(() => expect(voiceGlossaryAPI.update).toHaveBeenCalledWith('a1', {
      term: 'ТГС', kind: 'abbr', expansion: 'теплогазоснабжение', aliases: ['ТЖС', 'тгс', 'ТГ-С'], core: false, status: 'confirmed',
    }));
  });

  it('новый термин создаётся подтверждённым; дубликат показывает ошибку сервера в диалоге', async () => {
    voiceGlossaryAPI.create.mockRejectedValueOnce({ response: { data: { detail: 'Такой термин уже есть' } } });
    render(<VoiceGlossarySection />);
    await screen.findByText('ТГС');
    fireEvent.click(screen.getByRole('button', { name: /Термин$/ }));
    const dialog = await screen.findByRole('dialog');
    const add = within(dialog).getByRole('button', { name: 'Добавить' });
    expect(add).toBeDisabled();                                                 // пустой термин не отправляется
    fireEvent.change(within(dialog).getByLabelText('Термин'), { target: { value: 'ГПР' } });
    fireEvent.click(add);
    expect(await within(dialog).findByText('Такой термин уже есть')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Добавить' }));
    await waitFor(() => expect(voiceGlossaryAPI.create).toHaveBeenLastCalledWith(expect.objectContaining({ term: 'ГПР', status: 'confirmed' })));
  });

  it('при ошибке загрузки не прячет её, а удаление требует подтверждения', async () => {
    voiceGlossaryAPI.list.mockRejectedValueOnce(new Error('boom'));
    render(<VoiceGlossarySection />);
    expect(await screen.findByText('Не удалось загрузить словарь')).toBeInTheDocument();

    voiceGlossaryAPI.list.mockResolvedValue(candidates);
    fireEvent.click(screen.getByText('Подтверждённые (0)'));
    await screen.findByText('ТГС');
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'Удалить ТГС' }));
    expect(voiceGlossaryAPI.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Удалить ТГС' }));
    await waitFor(() => expect(voiceGlossaryAPI.remove).toHaveBeenCalledWith('a1'));
    confirmSpy.mockRestore();
  });
});
