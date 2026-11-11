const fs = require('fs');
const path = require('path');
const {
  assertGradleVersionMatches,
  assertReleaseNotesMatch,
  parseMobileVersionMetadata,
  verifyMobileVersionSync,
} = require('./mobile-version.cjs');

describe('mobile version metadata', () => {
  it('keeps package.json, generated Android project and current release notes synchronized', () => {
    const mobileRoot = path.resolve(__dirname, '..');
    const expected = verifyMobileVersionSync(mobileRoot);
    const packageJson = JSON.parse(fs.readFileSync(path.join(mobileRoot, 'package.json'), 'utf8'));

    expect(expected).toEqual({ version: packageJson.version, versionCode: packageJson.hubit.androidVersionCode });
  });

  it('rejects a stale Android project before an APK build', () => {
    expect(() => assertGradleVersionMatches(
      'versionCode 26\nversionName "1.1.24"',
      { version: '1.1.25', versionCode: 27 },
    )).toThrow('Run Expo prebuild without -SkipPrebuild');
  });

  it('rejects invalid source and release-note metadata', () => {
    expect(() => parseMobileVersionMetadata({ version: 'latest', hubit: { androidVersionCode: 0 } })).toThrow();
    expect(() => assertReleaseNotesMatch(
      { version: '1.1.25', version_code: 26 },
      { version: '1.1.25', versionCode: 27 },
    )).toThrow('does not match package.json');
  });
});
