const {
  addShortcutStringResources,
  addShortcutsMetadata,
  buildHubitShortcutsXml,
} = require('./withHubitAndroidShortcuts');

it('generates trusted shortcuts for Chat, Tasks and Scan Center', () => {
  const xml = buildHubitShortcutsXml();
  expect(xml).toContain('android:shortcutId="hubit_chat"');
  expect(xml).toContain('android:shortcutId="hubit_tasks"');
  expect(xml).toContain('android:shortcutId="hubit_scan"');
  expect(xml).toContain('android:shortcutShortLabel="@string/hubit_shortcut_chat_short"');
  expect(xml).toContain('android:shortcutLongLabel="@string/hubit_shortcut_scan_long"');
  expect(xml).toContain('hubit://portal?path=%2Fchat');
  expect(xml).not.toContain('android:data="http');
});

it('adds Android string resources required by shortcut labels', () => {
  const stringsXml = { resources: {} };
  addShortcutStringResources(stringsXml);
  expect(stringsXml.resources.string).toEqual(expect.arrayContaining([
    expect.objectContaining({ $: { name: 'hubit_shortcut_chat_short' }, _: 'Чат' }),
    expect.objectContaining({ $: { name: 'hubit_shortcut_tasks_long' }, _: 'Открыть задачи HUB-IT' }),
    expect.objectContaining({ $: { name: 'hubit_shortcut_scan_short' }, _: 'Scan Center' }),
  ]));
});

it('adds the shortcuts metadata to MainActivity exactly once', () => {
  const manifest = {
    manifest: {
      application: [{
        activity: [{
          $: { 'android:name': '.MainActivity' },
          'intent-filter': [{ action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }] }],
        }],
      }],
    },
  };
  addShortcutsMetadata(manifest);
  addShortcutsMetadata(manifest);
  expect(manifest.manifest.application[0].activity[0]['meta-data']).toEqual([{
    $: {
      'android:name': 'android.app.shortcuts',
      'android:resource': '@xml/shortcuts',
    },
  }]);
  const filters = manifest.manifest.application[0].activity[0]['intent-filter'];
  expect(filters.filter((filter) => (
    filter.action?.some((action) => action.$?.['android:name'] === 'android.intent.action.SEND')
  ))).toHaveLength(1);
});
