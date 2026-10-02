import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import VoiceUploadDialog from './VoiceUploadDialog';
import { voiceJobsAPI } from '../../api/voiceJobs';

vi.mock('../../api/voiceJobs', () => ({
  voiceJobsAPI: { uploadJob: vi.fn() },
}));

const err500 = (detail) => Object.assign(new Error('Server Error'), {
  response: { data: { detail } },
});

const makeFile = (name) => new File(['x'], name, { type: 'audio/mpeg' });

const addFiles = (container, names) => {
  // MUI Dialog рендерится в портале (document.body), не в container.
  const input = document.querySelector('input[type="file"]');
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: names.map(makeFile),
  });
  fireEvent.change(input);
};

describe('VoiceUploadDialog: частичный сбой загрузки (V09)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('диалог открыт, отправленные убраны из списка, ошибки видны, без повторной отправки', async () => {
    const onUploaded = vi.fn();
    voiceJobsAPI.uploadJob.mockImplementation((file) => (
      file.name === 'b.mp3'
        ? Promise.reject(err500('Сбой сервера'))
        : Promise.resolve({})
    ));
    const { container } = render(
      <VoiceUploadDialog open onClose={vi.fn()} onUploaded={onUploaded} options={{}} />,
    );
    addFiles(container, ['a.mp3', 'b.mp3', 'c.mp3']);

    fireEvent.click(screen.getByRole('button', { name: 'Отправить 3 файла' }));
    await screen.findByText(/Не отправлены: b\.mp3/);

    // Частичный сбой: диалог не закрывается (onUploaded — только при полном успехе).
    expect(onUploaded).not.toHaveBeenCalled();
    expect(screen.getByText('Обработать запись')).toBeInTheDocument();
    // Успешно отправленные файлы убраны из списка — повторная отправка их не коснётся.
    expect(screen.queryByText(/a\.mp3/)).not.toBeInTheDocument();
    expect(screen.queryByText(/c\.mp3/)).not.toBeInTheDocument();
    expect(screen.getByText(/b\.mp3 ·/)).toBeInTheDocument();

    // Повтор: отправляется только неудавшийся файл.
    voiceJobsAPI.uploadJob.mockImplementation(() => Promise.resolve({}));
    fireEvent.click(screen.getByRole('button', { name: 'Отправить на обработку' }));
    await vi.waitFor(() => {
      expect(onUploaded).toHaveBeenCalledTimes(1);
    });
    expect(voiceJobsAPI.uploadJob.mock.calls.map(([f]) => f.name))
      .toEqual(['a.mp3', 'b.mp3', 'c.mp3', 'b.mp3']);
    // Полный успех: список пуст.
    expect(screen.queryByText(/b\.mp3/)).not.toBeInTheDocument();
  });

  it('при частичном сбое вызывается onPartiallyUploaded, при полном успехе — нет (N1)', async () => {
    const onUploaded = vi.fn();
    const onPartiallyUploaded = vi.fn();
    voiceJobsAPI.uploadJob.mockImplementation((file) => (
      file.name === 'b.mp3'
        ? Promise.reject(err500('Сбой сервера'))
        : Promise.resolve({})
    ));
    const { container } = render(
      <VoiceUploadDialog
        open
        onClose={vi.fn()}
        onUploaded={onUploaded}
        onPartiallyUploaded={onPartiallyUploaded}
        options={{}}
      />,
    );
    addFiles(container, ['a.mp3', 'b.mp3']);
    fireEvent.click(screen.getByRole('button', { name: 'Отправить 2 файла' }));
    await screen.findByText(/Не отправлены: b\.mp3/);
    expect(onPartiallyUploaded).toHaveBeenCalledTimes(1);
    expect(onUploaded).not.toHaveBeenCalled();
    // Повтор без ошибки: полный успех — закрытие через onUploaded, без onPartiallyUploaded.
    voiceJobsAPI.uploadJob.mockImplementation(() => Promise.resolve({}));
    fireEvent.click(screen.getByRole('button', { name: 'Отправить на обработку' }));
    await vi.waitFor(() => {
      expect(onUploaded).toHaveBeenCalledTimes(1);
    });
    expect(onPartiallyUploaded).toHaveBeenCalledTimes(1);
  });
});

describe('VoiceUploadDialog: подписи форм (T18)', () => {
  it('associates select labels with their controls', async () => {
    render(
      <VoiceUploadDialog
        open
        onClose={vi.fn()}
        options={{ languages: [{ value: 'ru', label: 'Русский' }] }}
      />,
    );

    expect(screen.getByRole('combobox', { name: 'Язык записи' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Дополнительные настройки' }));
    expect(await screen.findByRole('combobox', { name: 'Распознавание речи' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Очистка голоса' })).toBeVisible();

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Распознавание речи' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Локально (WhisperX, GPU)' }));
    expect(await screen.findByRole('combobox', { name: 'Модель распознавания' })).toBeVisible();
  });

  it('accepts today after the UTC date has rolled over but Moscow has just reached midnight', () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = 'Europe/Moscow';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-29T21:30:00.000Z'));

    try {
      render(<VoiceUploadDialog open onClose={vi.fn()} options={{}} />);
      fireEvent.change(screen.getByLabelText('Дата встречи'), {
        target: { value: '2026-09-30' },
      });

      expect(screen.queryByText('Дата встречи не может быть в будущем')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
      if (originalTimezone == null) delete process.env.TZ;
      else process.env.TZ = originalTimezone;
    }
  });

  it.each([
    { limit: 5 * 1024 ** 2, size: 6 * 1024 ** 2, expected: '5.0 МБ' },
    { limit: 2 * 1024 ** 3, size: 3 * 1024 ** 3, expected: '2.0 ГБ' },
  ])('shows the upload limit as $expected', ({ limit, size, expected }) => {
    const file = new File(['x'], 'oversized.mp3', { type: 'audio/mpeg' });
    Object.defineProperty(file, 'size', { configurable: true, value: size });
    render(
      <VoiceUploadDialog
        open
        onClose={vi.fn()}
        options={{ upload_max_bytes: limit }}
      />,
    );
    const fileInput = document.querySelector('input[type="file"]');
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] });
    fireEvent.change(fileInput);

    expect(screen.getByText(new RegExp(`больше лимита ${expected.replace('.', '\\.')}`)))
      .toBeInTheDocument();
  });
});
