const fs = require('fs');
const path = require('path');

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function parseMobileVersionMetadata(packageJson) {
  const version = String(packageJson?.version || '').trim();
  const versionCode = Number(packageJson?.hubit?.androidVersionCode);
  if (!VERSION_PATTERN.test(version)) {
    throw new Error('mobile-hub package.json contains an invalid version.');
  }
  if (!Number.isSafeInteger(versionCode) || versionCode <= 0) {
    throw new Error('mobile-hub package.json contains an invalid hubit.androidVersionCode.');
  }
  return { version, versionCode };
}

function readMobileVersionMetadata(mobileRoot = path.resolve(__dirname, '..')) {
  const packagePath = path.join(mobileRoot, 'package.json');
  return parseMobileVersionMetadata(JSON.parse(fs.readFileSync(packagePath, 'utf8')));
}

function assertGradleVersionMatches(gradleText, expected) {
  const nameMatch = String(gradleText || '').match(/\bversionName\s+["']([^"']+)["']/);
  const codeMatch = String(gradleText || '').match(/\bversionCode\s+(\d+)/);
  if (!nameMatch || !codeMatch) throw new Error('Android Gradle version metadata was not found.');
  if (nameMatch[1] !== expected.version || Number(codeMatch[1]) !== expected.versionCode) {
    throw new Error(
      `Android project version ${nameMatch[1]} (${codeMatch[1]}) does not match package.json ${expected.version} (${expected.versionCode}). Run Expo prebuild without -SkipPrebuild.`,
    );
  }
}

function assertReleaseNotesMatch(releaseNotes, expected) {
  if (
    String(releaseNotes?.version || '').trim() !== expected.version
    || Number(releaseNotes?.version_code) !== expected.versionCode
  ) {
    throw new Error(`release-notes/${expected.version}.json does not match package.json version metadata.`);
  }
}

function verifyMobileVersionSync(mobileRoot = path.resolve(__dirname, '..')) {
  const expected = readMobileVersionMetadata(mobileRoot);
  const gradlePath = path.join(mobileRoot, 'android', 'app', 'build.gradle');
  assertGradleVersionMatches(fs.readFileSync(gradlePath, 'utf8'), expected);
  const releaseNotesPath = path.join(mobileRoot, 'release-notes', `${expected.version}.json`);
  assertReleaseNotesMatch(JSON.parse(fs.readFileSync(releaseNotesPath, 'utf8')), expected);
  return expected;
}

if (require.main === module) {
  const mobileRoot = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '..');
  const result = verifyMobileVersionSync(mobileRoot);
  process.stdout.write(`Mobile version synchronized: ${result.version} (${result.versionCode})\n`);
}

module.exports = {
  assertGradleVersionMatches,
  assertReleaseNotesMatch,
  parseMobileVersionMetadata,
  readMobileVersionMetadata,
  verifyMobileVersionSync,
};
