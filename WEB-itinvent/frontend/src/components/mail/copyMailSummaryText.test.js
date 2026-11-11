import { describe, expect, it, vi } from 'vitest';

import { copyMailSummaryText } from './copyMailSummaryText';

describe('copyMailSummaryText', () => {
  it('copies the summary and reports success', async () => {
    const clipboard = { writeText: vi.fn(async () => undefined) };
    const onSuccess = vi.fn();
    const onError = vi.fn();

    await expect(copyMailSummaryText('  Краткий пересказ  ', {
      clipboard,
      onSuccess,
      onError,
    })).resolves.toBe(true);

    expect(clipboard.writeText).toHaveBeenCalledWith('  Краткий пересказ  ');
    expect(onSuccess).toHaveBeenCalledWith('Пересказ скопирован.');
    expect(onError).not.toHaveBeenCalled();
  });

  it('copies an empty string when the summary is missing', async () => {
    const clipboard = { writeText: vi.fn(async () => undefined) };

    await expect(copyMailSummaryText(null, { clipboard })).resolves.toBe(true);
    expect(clipboard.writeText).toHaveBeenCalledWith('');
  });

  it('reports a copy failure without throwing', async () => {
    const clipboard = { writeText: vi.fn(async () => {
      throw new Error('denied');
    }) };
    const onSuccess = vi.fn();
    const onError = vi.fn();

    await expect(copyMailSummaryText('text', {
      clipboard,
      onSuccess,
      onError,
    })).resolves.toBe(false);

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith('Не удалось скопировать пересказ.');
  });
});
