import { describe, expect, it } from 'vitest';
import { buildAiReplyNotificationPreview } from './aiReplyPreview';

describe('buildAiReplyNotificationPreview', () => {
  it('drops markdown, links and the memory mark, collapses whitespace', () => {
    expect(buildAiReplyNotificationPreview('# Итог\n\n- **один**\n- два [ссылка](https://a.b)\n\n_Учтена личная память: 3 факта_'))
      .toBe('Итог - один - два ссылка');
  });

  it('cuts long answers with an ellipsis and tolerates empty values', () => {
    const cut = buildAiReplyNotificationPreview('слово '.repeat(80));
    expect(cut.length).toBeLessThanOrEqual(140);
    expect(cut.endsWith('…')).toBe(true);
    expect(buildAiReplyNotificationPreview(null)).toBe('');
  });
});
