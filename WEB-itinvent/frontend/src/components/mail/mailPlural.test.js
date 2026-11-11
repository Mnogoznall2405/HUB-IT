import { describe, expect, it } from 'vitest';
import {
  formatMailFolderCountCaption,
  formatRuLetterCount,
  formatRuRecipientCount,
  formatRuThreadCount,
  pluralizeRu,
} from './mailPlural';

describe('pluralizeRu', () => {
  it('picks one/few/many forms for typical Russian counts', () => {
    expect(pluralizeRu(1, 'получатель', 'получателя', 'получателей')).toBe('получатель');
    expect(pluralizeRu(2, 'получатель', 'получателя', 'получателей')).toBe('получателя');
    expect(pluralizeRu(4, 'получатель', 'получателя', 'получателей')).toBe('получателя');
    expect(pluralizeRu(5, 'получатель', 'получателя', 'получателей')).toBe('получателей');
    expect(pluralizeRu(11, 'получатель', 'получателя', 'получателей')).toBe('получателей');
    expect(pluralizeRu(12, 'получатель', 'получателя', 'получателей')).toBe('получателей');
    expect(pluralizeRu(21, 'получатель', 'получателя', 'получателей')).toBe('получатель');
    expect(pluralizeRu(22, 'получатель', 'получателя', 'получателей')).toBe('получателя');
    expect(pluralizeRu(25, 'получатель', 'получателя', 'получателей')).toBe('получателей');
  });
});

describe('formatRuRecipientCount', () => {
  it('formats the full Russian recipient label', () => {
    expect(formatRuRecipientCount(0)).toBe('0 получателей');
    expect(formatRuRecipientCount(1)).toBe('1 получатель');
    expect(formatRuRecipientCount(2)).toBe('2 получателя');
    expect(formatRuRecipientCount(5)).toBe('5 получателей');
    expect(formatRuRecipientCount(11)).toBe('11 получателей');
    expect(formatRuRecipientCount(21)).toBe('21 получатель');
  });
});

describe('formatMailFolderCountCaption', () => {
  it('labels total messages, threads and filtered results', () => {
    expect(formatRuLetterCount(499)).toBe('499 писем');
    expect(formatRuLetterCount(1)).toBe('1 письмо');
    expect(formatRuThreadCount(5)).toBe('5 цепочек');
    expect(formatMailFolderCountCaption({ total: 499 })).toBe('499 писем');
    expect(formatMailFolderCountCaption({ total: 5, viewMode: 'conversations' })).toBe('5 цепочек');
    expect(formatMailFolderCountCaption({ total: 24, hasActiveFilters: true })).toBe('найдено 24');
  });
});
