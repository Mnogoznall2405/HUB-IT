import { createHash } from 'node:crypto';

const DEFAULT_MANIFEST_URL = 'https://hubit.zsgp.ru/desktop-updates/mobile/preview/latest.json';
const EXPECTED_ORIGIN = 'https://hubit.zsgp.ru';
const EXPECTED_PACKAGE = 'ru.zsgp.hubit.mobile';
const MAX_APK_SIZE = 250 * 1024 * 1024;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validateManifestUrl(value) {
  const url = new URL(String(value || DEFAULT_MANIFEST_URL));
  assert(url.origin === EXPECTED_ORIGIN, `Unexpected manifest origin: ${url.origin}`);
  assert(
    url.pathname === '/desktop-updates/mobile/preview/latest.json',
    `Unexpected manifest path: ${url.pathname}`,
  );
  return url;
}

async function main() {
  const manifestUrl = validateManifestUrl(process.argv[2]);
  manifestUrl.searchParams.set('verify', Date.now().toString());
  const manifestResponse = await fetch(manifestUrl, { cache: 'no-store' });
  assert(manifestResponse.ok, `Manifest HTTP ${manifestResponse.status}`);

  const manifest = await manifestResponse.json();
  const schemaVersion = Number(manifest?.schema_version || 0);
  const version = String(manifest?.version || '').trim();
  const relativePath = String(manifest?.relative_path || '').trim();
  const expectedPath = `mobile/preview/${version}/HUB-IT-Mobile-Preview-${version}.apk`;
  const expectedSize = Number(manifest?.size_bytes || 0);
  const expectedHash = String(manifest?.sha256 || '').trim().toLowerCase();

  assert(/^\d+\.\d+\.\d+$/.test(version), `Invalid version: ${version}`);
  assert(schemaVersion === 1 || schemaVersion === 2, `Unsupported schema: ${schemaVersion}`);
  assert(manifest?.package_name === EXPECTED_PACKAGE, 'Unexpected Android package');
  assert(relativePath === expectedPath, `Unexpected APK path: ${relativePath}`);
  assert(Number.isSafeInteger(expectedSize) && expectedSize > 0, 'Invalid APK size');
  assert(expectedSize <= MAX_APK_SIZE, 'APK exceeds the preview size limit');
  assert(/^[0-9a-f]{64}$/.test(expectedHash), 'Invalid manifest SHA-256');
  if (schemaVersion === 2) {
    assert(Number.isSafeInteger(manifest?.version_code) && manifest.version_code > 0, 'Invalid version_code');
    assert(
      Number.isSafeInteger(manifest?.min_supported_version_code)
        && manifest.min_supported_version_code > 0
        && manifest.min_supported_version_code <= manifest.version_code,
      'Invalid min_supported_version_code',
    );
    assert(
      Array.isArray(manifest?.changelog)
        && manifest.changelog.length >= 1
        && manifest.changelog.length <= 8
        && manifest.changelog.every((item) => typeof item === 'string' && item.trim().length >= 1 && item.trim().length <= 240),
      'Invalid changelog',
    );
    assert(/^[0-9a-f]{64}$/i.test(String(manifest?.signer_sha256 || '')), 'Invalid signer_sha256');
  }

  const apkUrl = new URL(`/desktop-updates/${relativePath}`, EXPECTED_ORIGIN);
  const apkResponse = await fetch(apkUrl, { cache: 'no-store' });
  assert(apkResponse.ok, `APK HTTP ${apkResponse.status}`);
  assert(apkResponse.body, 'APK response has no body');

  const hash = createHash('sha256');
  let actualSize = 0;
  for await (const chunk of apkResponse.body) {
    actualSize += chunk.length;
    hash.update(chunk);
  }
  const actualHash = hash.digest('hex');

  assert(actualSize === expectedSize, `APK size mismatch: ${actualSize} != ${expectedSize}`);
  assert(actualHash === expectedHash, 'APK SHA-256 mismatch');

  console.log(JSON.stringify({
    manifest_status: manifestResponse.status,
    manifest_content_type: manifestResponse.headers.get('content-type'),
    manifest_cache_control: manifestResponse.headers.get('cache-control'),
    version,
    schema_version: schemaVersion,
    version_code: manifest.version_code ?? null,
    min_supported_version_code: manifest.min_supported_version_code ?? null,
    signer_sha256: manifest.signer_sha256 ?? null,
    package_name: manifest.package_name,
    apk_status: apkResponse.status,
    apk_content_type: apkResponse.headers.get('content-type'),
    size_bytes: actualSize,
    sha256: actualHash,
    verified: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
