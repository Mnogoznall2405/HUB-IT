import { describe, expect, it } from 'vitest';
import { vcsAPI } from './vcs';

describe('vcs protocol installer', () => {
  it('never writes launch tokens, endpoints, temp paths or network exception text to its log', () => {
    const installerSource = String(vcsAPI.downloadVncRegFile);

    expect(installerSource).not.toContain('FETCHING LAUNCH FILE:');
    expect(installerSource).not.toContain('LAUNCHING TOKEN FILE:');
    expect(installerSource).not.toContain('LAUNCH TOKEN FAILED:');
    expect(installerSource).not.toContain('LAUNCHING RAW:');
    expect(installerSource).not.toContain('CLEANUP OK:');
    expect(installerSource).not.toContain('CLEANUP SKIPPED:');
    expect(installerSource).not.toContain('$_.Exception.Message');
  });
});
