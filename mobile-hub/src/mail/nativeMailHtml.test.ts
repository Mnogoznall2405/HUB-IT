import {
  getSafeNativeMailExternalUrl,
  prepareNativeMailHtml,
  shouldAllowMailDocumentNavigation,
} from './nativeMailHtml';

describe('native mail HTML isolation', () => {
  it('removes executable markup and blocks remote resources by default', () => {
    const result = prepareNativeMailHtml(`
      <script>alert(1)</script>
      <img src="https://tracker.example/pixel.png" onerror="alert(2)">
      <a href="https://evil.example" onclick="alert(3)">link</a>
      <div style="background-image:url(https://tracker.example/bg.png)">Body</div>
    `);

    expect(result.document).not.toContain('alert(1)');
    expect(result.document).not.toContain('onerror');
    expect(result.document).not.toContain('onclick');
    expect(result.document).toContain('href="https://evil.example"');
    expect(result.document).not.toContain('tracker.example');
    expect(result.document).toContain("script-src 'none'");
    expect(result.document).toContain('Внешнее изображение скрыто');
    expect(result.hasBlockedExternalImages).toBe(true);
  });

  it('keeps safe external links for native handoff and rejects executable schemes', () => {
    const result = prepareNativeMailHtml(`
      <a href="https://hubit.example/path?a=1&amp;b=2">Portal</a>
      <a href="mailto:user@example.com">Mail</a>
      <a href="tel:+73452220000">Phone</a>
      <a href="javascript:alert(1)">Unsafe</a>
      <div href="https://not-an-anchor.example">Not a link</div>
    `);

    expect(result.document).toContain('href="https://hubit.example/path?a=1&amp;b=2"');
    expect(result.document).toContain('href="mailto:user@example.com"');
    expect(result.document).toContain('href="tel:+73452220000"');
    expect(result.document).not.toContain('javascript:');
    expect(result.document).not.toContain('not-an-anchor.example');
    expect(getSafeNativeMailExternalUrl('HTTPS://hubit.example/path')).toBe('HTTPS://hubit.example/path');
    expect(getSafeNativeMailExternalUrl('file:///data/secret')).toBe('');
    expect(getSafeNativeMailExternalUrl('data:text/html,unsafe')).toBe('');
  });

  it('resolves an existing CID image only from a safe inline data URL', () => {
    const result = prepareNativeMailHtml('<p>Logo</p><img src="cid:&lt;Logo@Example&gt;">', [
      {
        id: 'attachment-1',
        name: 'logo.png',
        content_id: '<logo@example>',
        is_inline: true,
        inline_data_url: 'data:image/png;base64,iVBORw0KGgo=',
      },
    ]);

    expect(result.document).toContain('data:image/png;base64,iVBORw0KGgo=');
    expect(result.usedInlineAttachmentRefs).toEqual(new Set(['attachment-1']));
    expect(result.hasBlockedExternalImages).toBe(false);
  });

  it('accepts a safe data URL from the legacy inline_src field without allowing a remote URL', () => {
    const embedded = prepareNativeMailHtml('<img src="cid:logo">', [{
      id: 'inline-legacy',
      name: 'logo.jpg',
      content_id: 'logo',
      inline_src: 'data:image/jpeg;base64,aGVsbG8=',
    }]);
    const remote = prepareNativeMailHtml('<img src="cid:tracker">', [{
      id: 'inline-remote',
      name: 'tracker.jpg',
      content_id: 'tracker',
      inline_src: 'https://tracker.example/pixel.jpg',
    }]);

    expect(embedded.document).toContain('data:image/jpeg;base64,aGVsbG8=');
    expect(embedded.usedInlineAttachmentRefs).toEqual(new Set(['inline-legacy']));
    expect(remote.document).not.toContain('tracker.example');
    expect(remote.document).toContain('Изображение недоступно');
  });

  it('allows remote images only after explicit opt-in while navigation stays local', () => {
    const result = prepareNativeMailHtml('<img src="https://images.example/photo.jpg">', [], {
      allowExternalImages: true,
    });

    expect(result.document).toContain('https://images.example/photo.jpg');
    expect(result.document).toContain('img-src data: https: http:');
    expect(shouldAllowMailDocumentNavigation('about:blank')).toBe(true);
    expect(shouldAllowMailDocumentNavigation('https://images.example')).toBe(false);
    expect(shouldAllowMailDocumentNavigation('javascript:alert(1)')).toBe(false);
  });

  it('normalizes hard-coded black text and neutral backgrounds in dark mode', () => {
    const result = prepareNativeMailHtml(`
      <style>.sender{color:rgb(0,0,0);background:#ffffff}</style>
      <p style="color:#000000 !important;background-color:#fff">Dark-readable sender</p>
      <font color="#000">Legacy sender</font>
    `, [], { dark: true });

    expect(result.document).toContain('color:#f3f2f1 !important');
    expect(result.document).toContain('background-color:#222832');
    expect(result.document).toContain('background:#222832');
    expect(result.document).not.toContain('color="#000"');
    expect(result.document).not.toContain('color:rgb(0,0,0)');
  });

  it('normalizes common Outlook near-black and system text colors in dark mode', () => {
    const result = prepareNativeMailHtml(`
      <style>
        .outlook { color: #242424; }
        .system { color: windowtext; }
        .hsl { color: hsl(0, 0%, 12%); }
      </style>
      <p style="color:#333333">Near-black sender</p>
      <font color="#222222">Legacy near-black sender</font>
    `, [], { dark: true });

    expect(result.document).not.toMatch(/color\s*:\s*(?:#242424|#333333|windowtext|hsl\(0,\s*0%,\s*12%\))/i);
    expect(result.document).not.toContain('color="#222222"');
    expect(result.document.match(/color:#f3f2f1/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('adapts low-contrast corporate colors and light mail surfaces in dark mode', () => {
    const result = prepareNativeMailHtml(`
      <style>
        .heading { color: navy; }
        .task-card { color: #0b1b3f; background: rgb(255, 255, 255); }
        .task-link { color: #0070c0; }
      </style>
      <div class="task-card" bgcolor="#ffffff">
        <h1 class="heading">Новая задача</h1>
        <font color="#0b1b3f">Описание</font>
        <a class="task-link" href="https://hubit.example/tasks/1">Открыть задачу</a>
      </div>
    `, [], { dark: true });

    expect(result.document).not.toMatch(/color\s*:\s*(?:navy|#0b1b3f|#0070c0)/i);
    expect(result.document).not.toContain('color="#0b1b3f"');
    expect(result.document).toContain('color:#f3f2f1');
    expect(result.document).toContain('background:#222832');
    expect(result.document).toContain('bgcolor="#222832"');
    expect(result.document).toContain('a{color:#8cc8ff!important');
  });
});
