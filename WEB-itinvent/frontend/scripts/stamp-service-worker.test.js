import { describe, expect, it } from 'vitest';
import { applyServiceWorkerBuildId } from './stamp-service-worker.mjs';

describe('service worker release stamp', () => {
  it('replaces every shell cache declaration with one content build id', () => {
    const source = [
      "const SW_VERSION = 'old';",
      "const APP_SHELL_CACHE = 'shell-old';",
      "const APP_ASSET_CACHE = 'assets-old';",
      "const CHAT_MEDIA_CACHE = 'keep-this';",
    ].join('\n');

    expect(applyServiceWorkerBuildId(source, 'abc123')).toContain("const SW_VERSION = 'build-abc123';");
    expect(applyServiceWorkerBuildId(source, 'abc123')).toContain("const APP_SHELL_CACHE = 'hubit-app-shell-vabc123';");
    expect(applyServiceWorkerBuildId(source, 'abc123')).toContain("const APP_ASSET_CACHE = 'hubit-app-assets-vabc123';");
    expect(applyServiceWorkerBuildId(source, 'abc123')).toContain("const CHAT_MEDIA_CACHE = 'keep-this';");
  });
});
