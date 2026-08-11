import { describe, expect, it } from 'vitest';
import { splitDocflowDescriptionParagraphs } from './DocflowTaskSurface';

describe('splitDocflowDescriptionParagraphs', () => {
  it('keeps short text as one paragraph', () => {
    expect(splitDocflowDescriptionParagraphs('Краткое описание.')).toEqual(['Краткое описание.']);
  });

  it('splits blank-line paragraphs and soft-splits long sentence walls', () => {
    expect(splitDocflowDescriptionParagraphs('Первый абзац.\n\nВторой абзац.')).toEqual([
      'Первый абзац.',
      'Второй абзац.',
    ]);

    const wall = 'Подключаться будут только те, кто направляется в командировку. Если Вы не подключены, а командировка запланирована, просьба обратиться к сотрудникам (Хатмуллин Р.Р., Галунская Ю.А.).';
    const parts = splitDocflowDescriptionParagraphs(wall);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0]).toContain('командировку.');
    expect(parts.join(' ')).toContain('Хатмуллин Р.Р.');
  });
});
