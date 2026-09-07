export const ROLE_OPTIONS = [
  { value: 'admin', label: 'Админ' },
  { value: 'operator', label: 'Оператор' },
  { value: 'viewer', label: 'Просмотр' },
] as const;

export type PermissionItem = {
  value: string;
  label: string;
  alwaysGranted?: boolean;
};

export type PermissionGroup = {
  group: string;
  permissions: PermissionItem[];
};

const BASE_USER_PERMISSIONS = new Set([
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
]);

export const SETTINGS_PERMISSION_GROUPS: PermissionGroup[] = [
  {
    group: 'Корпоративный чат',
    permissions: [
      { value: 'chat.read', label: 'Чат: просмотр' },
      { value: 'chat.write', label: 'Чат: отправка сообщений' },
    ],
  },
  {
    group: 'Общие',
    permissions: [
      { value: 'dashboard.read', label: 'Dashboard: просмотр' },
      { value: 'announcements.read', label: 'Лента: просмотр' },
      { value: 'announcements.write', label: 'Лента: создание своих публикаций' },
      { value: 'announcements.moderate', label: 'Лента: модерация и аналитика' },
      { value: 'statistics.read', label: 'Статистика: просмотр' },
    ],
  },
  {
    group: 'Инвентарь',
    permissions: [
      { value: 'database.read', label: 'База: просмотр' },
      { value: 'database.write', label: 'База: изменения' },
      { value: 'database.delete', label: 'База: удаление расходников' },
      { value: 'mfu.read', label: 'МФУ: просмотр' },
      { value: 'computers.read', label: 'Компьютеры: просмотр' },
      { value: 'computers.read_all', label: 'Компьютеры: просмотр всех БД' },
      { value: 'computers.manage', label: 'Компьютеры: скрытие и возврат' },
    ],
  },
  {
    group: 'Задачи',
    permissions: [
      { value: 'tasks.read', label: 'Задачи: просмотр' },
      { value: 'tasks.create', label: 'Задачи: создание' },
      { value: 'tasks.write', label: 'Задачи: создание/редактирование' },
      { value: 'tasks.review', label: 'Задачи: проверка' },
      { value: 'tasks.manage_all', label: 'Задачи: управление всеми отделами' },
    ],
  },
  {
    group: 'Инструменты сети',
    permissions: [
      { value: 'networks.read', label: 'Сети: просмотр' },
      { value: 'networks.write', label: 'Сети: изменения' },
      { value: 'scan.read', label: 'Scan Center и DLP: просмотр' },
      { value: 'scan.ack', label: 'Scan Center и DLP: ACK инцидентов' },
      { value: 'scan.tasks', label: 'Scan Center и DLP: задачи агентам' },
      { value: 'vcs.read', label: 'Терминалы ВКС: просмотр' },
      { value: 'vcs.manage', label: 'Терминалы ВКС: управление' },
    ],
  },
  {
    group: 'Интеграции',
    permissions: [
      { value: 'mail.access', label: 'Почта: доступ к Exchange' },
      { value: 'mail.quotas.read', label: 'Почта: отчёт по квотам ящиков' },
    ],
  },
  {
    group: 'Адресная книга',
    permissions: [
      { value: 'address_book.read', label: 'Адресная книга: просмотр — доступно всем', alwaysGranted: true },
      { value: 'address_book.age.read', label: 'Адресная книга: просмотр возраста' },
      { value: 'address_book.hire_date.read', label: 'Адресная книга: просмотр даты приёма на работу' },
      { value: 'address_book.personal_phone.read', label: 'Адресная книга: просмотр личных телефонов' },
      { value: 'address_book.personal_email.read', label: 'Адресная книга: просмотр личной почты' },
    ],
  },
  {
    group: 'Структура компании',
    permissions: [
      { value: 'company_structure.read', label: 'Структура компании: просмотр — доступно всем', alwaysGranted: true },
      { value: 'company_structure.write', label: 'Структура компании: редактирование' },
    ],
  },
  {
    group: 'Склад 1С',
    permissions: [
      { value: 'warehouse_1c.read', label: 'Склад 1С: просмотр' },
      { value: 'warehouse_1c.reconcile.write', label: 'Склад 1С: подтверждать PART_NO в HUB' },
    ],
  },
  {
    group: 'Документооборот 1С',
    permissions: [
      { value: 'docflow.read', label: 'Документооборот 1С: просмотр' },
      { value: 'docflow.act', label: 'Документооборот 1С: выполнять задания' },
      { value: 'docflow.create', label: 'Документооборот 1С: создавать документы' },
      { value: 'docflow.admin', label: 'Документооборот 1С: диагностика интеграции' },
    ],
  },
  {
    group: 'Билеты',
    permissions: [
      { value: 'tickets.read', label: 'Билеты: просмотр' },
      { value: 'tickets.write', label: 'Билеты: создание и изменения' },
      { value: 'tickets.personal_data.read', label: 'Билеты: персональные данные' },
    ],
  },
  {
    group: 'База знаний',
    permissions: [
      { value: 'kb.read', label: 'База знаний: просмотр' },
      { value: 'kb.write', label: 'База знаний: редактирование' },
      { value: 'kb.publish', label: 'База знаний: публикация' },
      { value: 'kb.manage_all', label: 'База знаний: управление всеми отделами' },
    ],
  },
  {
    group: 'Настройки',
    permissions: [
      { value: 'settings.read', label: 'Настройки: просмотр' },
      { value: 'departments.manage', label: 'Отделы: назначение начальников' },
      { value: 'settings.users.manage', label: 'Пользователи: управление' },
      { value: 'settings.sessions.manage', label: 'Сессии: управление' },
    ],
  },
  {
    group: 'Мои файлы',
    permissions: [
      { value: 'my_files.read', label: 'Мои файлы: просмотр' },
      { value: 'my_files.write', label: 'Мои файлы: загрузка и удаление' },
      { value: 'my_files.share', label: 'Мои файлы: публичные ссылки' },
      { value: 'my_files.audit.read', label: 'Мои файлы: журнал аудита' },
    ],
  },
  {
    group: 'Пароли',
    permissions: [
      { value: 'passwords.read', label: 'Пароли: просмотр' },
      { value: 'passwords.write', label: 'Пароли: создание и редактирование' },
    ],
  },
  {
    group: 'AD / Доступ к папкам',
    permissions: [
      { value: 'groups_access.read', label: 'Матрица доступа AD Groups: просмотр' },
    ],
  },
  {
    group: 'AI',
    permissions: [
      { value: 'chat.ai.use', label: 'Chat: AI access' },
      { value: 'chat.ai.sandbox', label: 'Chat: OpenCode sandbox access' },
      { value: 'settings.ai.manage', label: 'Settings: AI bots manage' },
    ],
  },
].map((group) => ({
  ...group,
  permissions: group.permissions.map((permission) => (
    BASE_USER_PERMISSIONS.has(permission.value)
      ? { ...permission, alwaysGranted: true }
      : permission
  )),
}));

export const SESSION_STATUS_META: Record<string, { label: string }> = {
  active: { label: 'Активна' },
  expired_idle: { label: 'Истекла по idle' },
  expired_absolute: { label: 'Истекла по времени' },
  terminated: { label: 'Завершена' },
};

export const APP_LOCK_TIMEOUT_LABELS: Record<number, string> = {
  0: 'Сразу после сворачивания',
  30: 'Через 30 секунд',
  60: 'Через 1 минуту',
  300: 'Через 5 минут',
  900: 'Через 15 минут',
};

export const NOTIFICATION_CHANNEL_LABELS: Array<[string, string]> = [
  ['mail', 'Почта'],
  ['tasks', 'Задачи'],
  ['docflow', '1С ДО'],
  ['task_email', 'Email по задачам'],
  ['announcements', 'Лента компании'],
];

export const CHAT_NOTIFICATION_CHANNEL_LABELS: Array<[string, string]> = [
  ['chat_direct', 'Личные сообщения'],
  ['chat_group', 'Групповые беседы'],
  ['chat_task', 'Диалоги задач'],
];

export const ANDROID_PUSH_CHANNELS: Array<[string, string]> = [
  ['hubit_chat', 'Чат'],
  ['hubit_tasks', 'Задачи'],
  ['hubit_mail', 'Почта'],
  ['hubit_system', 'Системные'],
];
