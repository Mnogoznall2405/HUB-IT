const { hardenHubitAndroidManifest } = require('./withHubitAndroidSecurity');

it('prevents Android backup migration and cleartext traffic', () => {
  const manifest = {
    manifest: {
      application: [{
        $: {
          'android:allowBackup': 'true',
          'android:usesCleartextTraffic': 'true',
          'android:fullBackupContent': '@xml/secure_store_backup_rules',
        },
      }],
    },
  };

  hardenHubitAndroidManifest(manifest);
  hardenHubitAndroidManifest(manifest);

  expect(manifest.manifest.application[0].$).toMatchObject({
    'android:allowBackup': 'false',
    'android:usesCleartextTraffic': 'false',
    'android:fullBackupContent': '@xml/secure_store_backup_rules',
  });
});

it('lets already delivered FCM chat notifications open the launcher via OPEN_HUBIT', () => {
  const manifest = {
    manifest: {
      application: [{
        $: {},
        activity: [{
          $: { 'android:name': '.MainActivity' },
          'intent-filter': [{
            action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
            category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }],
          }],
        }],
      }],
    },
  };

  hardenHubitAndroidManifest(manifest);
  hardenHubitAndroidManifest(manifest);

  const filters = manifest.manifest.application[0].activity[0]['intent-filter'];
  expect(filters).toHaveLength(2);
  expect(filters[1]).toEqual({
    action: [{ $: { 'android:name': 'OPEN_HUBIT' } }],
    category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
  });
});

it('fails closed when the Android application entry is absent', () => {
  expect(() => hardenHubitAndroidManifest({ manifest: {} })).toThrow(
    'HUB-IT Android application manifest was not found',
  );
});
