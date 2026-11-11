const { withAndroidManifest } = require('@expo/config-plugins');

const OPEN_HUBIT_ACTION = 'OPEN_HUBIT';

function hasOpenHubitIntentFilter(activity) {
  return (activity?.['intent-filter'] || []).some((filter) => (
    (filter.action || []).some((action) => action?.$?.['android:name'] === OPEN_HUBIT_ACTION)
  ));
}

function findLauncherActivity(application) {
  return (application.activity || []).find((activity) => (
    (activity['intent-filter'] || []).some((filter) => (
      (filter.action || []).some((action) => action?.$?.['android:name'] === 'android.intent.action.MAIN')
    ))
  ));
}

function addOpenHubitIntentFilter(androidManifest) {
  const application = androidManifest.manifest.application?.[0];
  if (!application) return androidManifest;
  const launcher = findLauncherActivity(application);
  if (!launcher || hasOpenHubitIntentFilter(launcher)) return androidManifest;
  launcher['intent-filter'] = launcher['intent-filter'] || [];
  launcher['intent-filter'].push({
    action: [{ $: { 'android:name': OPEN_HUBIT_ACTION } }],
    category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
  });
  return androidManifest;
}

function hardenHubitAndroidManifest(androidManifest) {
  const application = androidManifest.manifest.application?.[0];
  if (!application) throw new Error('HUB-IT Android application manifest was not found');
  application.$ = application.$ || {};
  application.$['android:allowBackup'] = 'false';
  application.$['android:usesCleartextTraffic'] = 'false';
  return addOpenHubitIntentFilter(androidManifest);
}

function withHubitAndroidSecurity(config) {
  return withAndroidManifest(config, (mod) => {
    mod.modResults = hardenHubitAndroidManifest(mod.modResults);
    return mod;
  });
}

module.exports = withHubitAndroidSecurity;
module.exports.hardenHubitAndroidManifest = hardenHubitAndroidManifest;
