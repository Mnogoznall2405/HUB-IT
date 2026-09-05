import { SETTINGS_PERMISSION_GROUPS } from './accountConstants';

it('marks the AD viewer baseline as always granted for custom permissions', () => {
  const flattened = SETTINGS_PERMISSION_GROUPS.flatMap((group) => group.permissions);
  const alwaysGranted = new Set(
    flattened.filter((permission) => permission.alwaysGranted).map((permission) => permission.value),
  );

  expect(alwaysGranted).toEqual(new Set([
    'address_book.read',
    'announcements.read',
    'chat.ai.use',
    'chat.read',
    'chat.write',
    'company_structure.read',
    'dashboard.read',
    'docflow.act',
    'docflow.read',
    'mail.access',
    'my_files.read',
    'my_files.share',
    'my_files.write',
    'settings.read',
    'tasks.create',
    'tasks.read',
  ]));
});
