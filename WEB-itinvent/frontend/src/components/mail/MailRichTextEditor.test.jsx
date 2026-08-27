import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MailRichTextEditor from './MailRichTextEditor';

describe('MailRichTextEditor', () => {
  it('inserts a real clipboard image at the selection and keeps CID html across size changes', async () => {
    const ref = React.createRef();
    const file = new File(['image'], 'pasted.png', { type: 'image/png' });
    const onChange = vi.fn();
    const onInlineImageSelected = vi.fn();
    const onPasteInlineImages = vi.fn(() => [{
      file,
      contentId: 'inline-1@hubit.local',
      previewUrl: 'blob:inline-1',
    }]);
    const { container } = render(
      <MailRichTextEditor
        ref={ref}
        value="<p>After</p>"
        onChange={onChange}
        onPasteInlineImages={onPasteInlineImages}
        onInlineImageSelected={onInlineImageSelected}
      />,
    );
    const root = container.querySelector('.ql-editor');
    const editor = ref.current.getEditor();
    vi.spyOn(editor, 'getSelection').mockReturnValue({ index: 0, length: 0 });

    fireEvent.paste(root, {
      clipboardData: {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
        getData: () => '',
      },
    });

    await waitFor(() => {
      expect(onPasteInlineImages).toHaveBeenCalledWith([file]);
      expect(ref.current.getSemanticHtml()).toContain('src="cid:inline-1@hubit.local"');
    });
    const image = root.querySelector('img');
    fireEvent.click(image);
    expect(onInlineImageSelected).toHaveBeenLastCalledWith('original');

    expect(ref.current.setSelectedInlineImageSize('small')).toBe(true);
    expect(image.style.width).toBe('320px');
    expect(ref.current.setSelectedInlineImageSize('medium')).toBe(true);
    expect(image.style.width).toBe('560px');
    expect(ref.current.setSelectedInlineImageSize('full')).toBe(true);
    expect(image.style.width).toBe('100%');
    expect(ref.current.setSelectedInlineImageSize('original')).toBe(true);
    expect(image.style.width).toBe('');
    expect(image.dataset.mailInlineSize).toBe('original');
    expect(ref.current.getSemanticHtml()).toContain('src="cid:inline-1@hubit.local"');

    editor.deleteText(0, 1, 'user');
    await waitFor(() => expect(ref.current.getSemanticHtml()).not.toContain('cid:inline-1@hubit.local'));
  });

  it('keeps pasted links and tables while dropping conflicting colors and remote images', () => {
    const ref = React.createRef();
    const { container } = render(<MailRichTextEditor ref={ref} value="" onChange={vi.fn()} />);
    const root = container.querySelector('.ql-editor');
    const editor = ref.current.getEditor();
    vi.spyOn(editor, 'getSelection').mockReturnValue({ index: 0, length: 0 });

    fireEvent.paste(root, {
      clipboardData: {
        items: [],
        getData: (type) => type === 'text/html'
          ? '<p style="color:#000;background:#fff"><a href="https://example.com">Link</a></p><table><tbody><tr><td>Cell</td></tr></tbody></table><img src="https://example.com/tracker.png">'
          : '',
      },
    });

    expect(root.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
    expect(root.querySelector('table')).toBeTruthy();
    expect(root.querySelector('td')?.textContent).toBe('Cell');
    expect(root.querySelector('img')).toBeNull();
    expect(root.innerHTML).not.toContain('color: rgb(0, 0, 0)');
    expect(root.innerHTML).not.toContain('background-color: rgb(255, 255, 255)');
  });
});
