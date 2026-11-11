import { describe, expect, it } from 'vitest';
import { splitQuotedHistoryHtml } from './mailQuotedHistory';

describe('splitQuotedHistoryHtml', () => {
  it('splits a safe quoted tail into primary and history blocks', () => {
    const result = splitQuotedHistoryHtml('<p>Hello</p><blockquote><p>Quoted history</p></blockquote>');

    expect(result.hasQuotedHistory).toBe(true);
    expect(result.primaryHtml).toContain('Hello');
    expect(result.quotedHtml).toContain('Quoted history');
  });

  it('does not collapse the whole message when the split would leave an empty primary body', () => {
    const result = splitQuotedHistoryHtml('<blockquote><p>Only quoted content</p></blockquote>');

    expect(result.hasQuotedHistory).toBe(false);
    expect(result.primaryHtml).toContain('Only quoted content');
    expect(result.quotedHtml).toBe('');
  });

  it('does not treat plain header-like text as quoted history without a safe split point', () => {
    const result = splitQuotedHistoryHtml(
      '<div>From: support@example.com\nDate: 08.04.2026\nSubject: Status update</div><p>Main body stays visible</p>',
    );

    expect(result.hasQuotedHistory).toBe(false);
    expect(result.primaryHtml).toContain('Main body stays visible');
    expect(result.quotedHtml).toBe('');
  });
});
