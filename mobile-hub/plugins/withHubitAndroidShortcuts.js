const fs = require('fs');
const path = require('path');
const {
  AndroidConfig,
  withAndroidManifest,
  withDangerousMod,
  withStringsXml,
} = require('@expo/config-plugins');

const SHORTCUTS_META_NAME = 'android.app.shortcuts';
const SHORTCUTS_RESOURCE = '@xml/shortcuts';

const SHORTCUTS = Object.freeze([
  {
    id: 'hubit_chat',
    shortLabel: 'Чат',
    shortLabelResource: 'hubit_shortcut_chat_short',
    longLabel: 'Открыть чат HUB-IT',
    longLabelResource: 'hubit_shortcut_chat_long',
    portalPath: '/chat',
  },
  {
    id: 'hubit_tasks',
    shortLabel: 'Задачи',
    shortLabelResource: 'hubit_shortcut_tasks_short',
    longLabel: 'Открыть задачи HUB-IT',
    longLabelResource: 'hubit_shortcut_tasks_long',
    portalPath: '/tasks',
  },
  {
    id: 'hubit_scan',
    shortLabel: 'Scan Center',
    shortLabelResource: 'hubit_shortcut_scan_short',
    longLabel: 'Открыть Scan Center',
    longLabelResource: 'hubit_shortcut_scan_long',
    portalPath: '/scan-center',
  },
]);

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildHubitShortcutsXml(packageName = 'ru.zsgp.hubit.mobile') {
  const activityName = `${packageName}.MainActivity`;
  const items = SHORTCUTS.map((shortcut) => `  <shortcut
    android:shortcutId="${xmlEscape(shortcut.id)}"
    android:enabled="true"
    android:icon="@mipmap/ic_launcher"
    android:shortcutShortLabel="@string/${shortcut.shortLabelResource}"
    android:shortcutLongLabel="@string/${shortcut.longLabelResource}">
    <intent
      android:action="android.intent.action.VIEW"
      android:targetPackage="${xmlEscape(packageName)}"
      android:targetClass="${xmlEscape(activityName)}"
      android:data="hubit://portal?path=${encodeURIComponent(shortcut.portalPath)}" />
  </shortcut>`).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">
${items}
</shortcuts>
`;
}

function addShortcutStringResources(stringsXml) {
  const resources = SHORTCUTS.flatMap((shortcut) => ([
    AndroidConfig.Resources.buildResourceItem({
      name: shortcut.shortLabelResource,
      value: shortcut.shortLabel,
    }),
    AndroidConfig.Resources.buildResourceItem({
      name: shortcut.longLabelResource,
      value: shortcut.longLabel,
    }),
  ]));
  return AndroidConfig.Strings.setStringItem(resources, stringsXml);
}

function addShortcutsMetadata(androidManifest) {
  const application = androidManifest.manifest.application?.[0];
  const activities = application?.activity || [];
  const mainActivity = activities.find((activity) => (
    (activity['intent-filter'] || []).some((filter) => (
      (filter.action || []).some((action) => action.$?.['android:name'] === 'android.intent.action.MAIN')
    ))
  ));
  if (!mainActivity) throw new Error('HUB-IT Android MainActivity was not found');
  const metadata = mainActivity['meta-data'] || [];
  const existing = metadata.find((item) => item.$?.['android:name'] === SHORTCUTS_META_NAME);
  if (existing) {
    existing.$['android:resource'] = SHORTCUTS_RESOURCE;
  } else {
    metadata.push({
      $: {
        'android:name': SHORTCUTS_META_NAME,
        'android:resource': SHORTCUTS_RESOURCE,
      },
    });
  }
  mainActivity['meta-data'] = metadata;
  const filters = mainActivity['intent-filter'] || [];
  const hasTextShare = filters.some((filter) => (
    (filter.action || []).some((action) => action.$?.['android:name'] === 'android.intent.action.SEND')
    && (filter.data || []).some((data) => data.$?.['android:mimeType'] === 'text/plain')
  ));
  if (!hasTextShare) {
    filters.push({
      action: [{ $: { 'android:name': 'android.intent.action.SEND' } }],
      category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
      data: [{ $: { 'android:mimeType': 'text/plain' } }],
    });
  }
  mainActivity['intent-filter'] = filters;
  return androidManifest;
}

function withHubitAndroidShortcuts(config) {
  config = withStringsXml(config, (mod) => {
    mod.modResults = addShortcutStringResources(mod.modResults);
    return mod;
  });
  config = withAndroidManifest(config, (mod) => {
    mod.modResults = addShortcutsMetadata(mod.modResults);
    return mod;
  });
  return withDangerousMod(config, ['android', async (mod) => {
    const packageName = mod.android?.package || config.android?.package || 'ru.zsgp.hubit.mobile';
    const xmlDirectory = path.join(mod.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');
    fs.mkdirSync(xmlDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(xmlDirectory, 'shortcuts.xml'),
      buildHubitShortcutsXml(packageName),
      'utf8',
    );
    return mod;
  }]);
}

module.exports = withHubitAndroidShortcuts;
module.exports.buildHubitShortcutsXml = buildHubitShortcutsXml;
module.exports.addShortcutsMetadata = addShortcutsMetadata;
module.exports.addShortcutStringResources = addShortcutStringResources;
