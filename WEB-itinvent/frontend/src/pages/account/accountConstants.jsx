import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import PaletteOutlinedIcon from '@mui/icons-material/PaletteOutlined';
import GroupOutlinedIcon from '@mui/icons-material/GroupOutlined';
import SecurityOutlinedIcon from '@mui/icons-material/SecurityOutlined';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import SettingsApplicationsOutlinedIcon from '@mui/icons-material/SettingsApplicationsOutlined';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';

const SETTINGS_TABS = [
  { value: 'profile', label: 'Профиль', icon: <PersonOutlineIcon fontSize="small" /> },
  { value: 'security', label: 'Безопасность', icon: <ShieldOutlinedIcon fontSize="small" /> },
  { value: 'appearance', label: 'Внешний вид', icon: <PaletteOutlinedIcon fontSize="small" /> },
  { value: 'departments', label: 'Отделы', icon: <GroupOutlinedIcon fontSize="small" /> },
  { value: 'users', label: 'Пользователи', icon: <GroupOutlinedIcon fontSize="small" />, permission: 'settings.users.manage' },
  { value: 'sessions', label: 'Сессии', icon: <SecurityOutlinedIcon fontSize="small" />, permission: 'settings.sessions.manage' },
  { value: 'env', label: 'Переменные', icon: <SettingsApplicationsOutlinedIcon fontSize="small" />, adminOnly: true },
];

const SETTINGS_AI_TAB = {
  value: 'ai-bots',
  label: 'AI Bots',
  icon: <SmartToyOutlinedIcon fontSize="small" />,
  permission: 'settings.ai.manage',
};

const SETTINGS_TABS_WITH_AI = [
  ...SETTINGS_TABS.slice(0, 5),
  SETTINGS_AI_TAB,
  ...SETTINGS_TABS.slice(5),
];

export function resolveAvailableSettingsTabs({ hasPermission, isAdmin }) {
  const safeHasPermission = typeof hasPermission === 'function' ? hasPermission : () => false;
  return SETTINGS_TABS_WITH_AI.filter((item) => {
    if (item.adminOnly) return Boolean(isAdmin);
    if (isAdmin) return true;
    if (!item.permission) return true;
    return safeHasPermission(item.permission);
  });
}

export const SETTINGS_VERY_WIDE_QUERY = '(min-width:1920px)';
export const ENV_HELP_WIDE_QUERY = '(min-width:1536px)';
export const DESKTOP_SCROLL_QUERY = '(min-width:900px)';
export const USER_ROWS_PER_PAGE_OPTIONS = [10, 25, 50];
export const DEFAULT_USER_ROWS_PER_PAGE = 25;
export const CHAT_FOREGROUND_ONLY_REASON_LABELS = {
  server_not_configured: 'Фоновые push недоступны: сервер chat push пока не настроен.',
  yandex_limited: 'Яндекс.Браузер поддерживает chat-уведомления только из открытой вкладки.',
  requires_installed_pwa: 'На iPhone фоновые chat-уведомления работают только из установленной PWA.',
  permission_denied: 'Браузер ещё не дал разрешение на системные уведомления для сайта.',
  not_secure_context: 'Фоновые push требуют HTTPS и безопасный контекст браузера.',
  push_unsupported: 'Этот браузер не поддерживает background web push для chat.',
};
export const CHAT_FOREGROUND_DIAGNOSTIC_LABELS = {
  active_visible_conversation: 'Активный чат уже открыт, поэтому отдельное системное уведомление не показывается.',
  notifications_disabled: 'Chat-уведомления сейчас отключены локальным переключателем в этом браузере.',
  permission_not_granted: 'Системные уведомления браузера ещё не разрешены для этого сайта.',
  chat_socket_unavailable: 'Сейчас нет стабильного websocket-соединения для мгновенных chat-событий во вкладке.',
};

export const roleOptions = [
  { value: 'admin', label: 'Админ', color: 'error' },
  { value: 'operator', label: 'Оператор', color: 'primary' },
  { value: 'viewer', label: 'Просмотр', color: 'default' },
];

const permissionGroups = [
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
      { value: 'announcements.write', label: 'Объявления: публикация' },
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
      { value: 'scan.read', label: 'Scan Center: просмотр' },
      { value: 'scan.ack', label: 'Scan Center: ACK инцидентов' },
      { value: 'scan.tasks', label: 'Scan Center: задачи агентам' },
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
      { value: 'address_book.read', label: 'Адресная книга: просмотр' },
    ],
  },
  {
    group: 'Склад 1С',
    permissions: [
      { value: 'warehouse_1c.read', label: 'Склад 1С: просмотр' },
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
];

const MY_FILES_PERMISSION_GROUP = {
  group: 'Мои файлы',
  permissions: [
    { value: 'my_files.read', label: 'Мои файлы: просмотр' },
    { value: 'my_files.write', label: 'Мои файлы: загрузка и удаление' },
    { value: 'my_files.share', label: 'Мои файлы: публичные ссылки' },
    { value: 'my_files.audit.read', label: 'Мои файлы: журнал аудита' },
  ],
};

const PASSWORDS_PERMISSION_GROUP = {
  group: 'Пароли',
  permissions: [
    { value: 'passwords.read', label: 'Пароли: просмотр' },
    { value: 'passwords.write', label: 'Пароли: создание и редактирование' },
  ],
};

const GROUPS_ACCESS_PERMISSION_GROUP = {
  group: 'AD / Доступ к папкам',
  permissions: [
    { value: 'groups_access.read', label: 'Матрица доступа AD Groups: просмотр' },
  ],
};

const AI_PERMISSION_GROUP = {
  group: 'AI',
  permissions: [
    { value: 'chat.ai.use', label: 'Chat: AI access' },
    { value: 'settings.ai.manage', label: 'Settings: AI bots manage' },
  ],
};

export const SETTINGS_PERMISSION_GROUPS = [
  ...permissionGroups,
  MY_FILES_PERMISSION_GROUP,
  PASSWORDS_PERMISSION_GROUP,
  GROUPS_ACCESS_PERMISSION_GROUP,
  AI_PERMISSION_GROUP,
];

export const sessionStatusMeta = {
  active: { label: 'Активна', color: 'success' },
  expired_idle: { label: 'Истекла по idle', color: 'warning' },
  expired_absolute: { label: 'Истекла по времени', color: 'warning' },
  terminated: { label: 'Завершена', color: 'default' },
};

export const staticRunbook = {
  pm2: [
    'powershell -ExecutionPolicy Bypass -File C:\\Project\\Image_scan\\scripts\\pm2\\start-all.ps1',
    'powershell -ExecutionPolicy Bypass -File C:\\Project\\Image_scan\\scripts\\pm2\\restart-all.ps1',
    'powershell -ExecutionPolicy Bypass -File C:\\Project\\Image_scan\\scripts\\pm2\\stop-all.ps1',
    'powershell -ExecutionPolicy Bypass -File C:\\Project\\Image_scan\\scripts\\pm2\\health-check.ps1',
  ],
  frontend: [
    'cd C:\\Project\\Image_scan\\WEB-itinvent\\frontend',
    'npm run build',
  ],
};

export const AI_ITINVENT_DEFAULT_TOOLS = [
  'itinvent.database.current',
  'itinvent.equipment.search',
  'itinvent.equipment.search_universal',
  'itinvent.equipment.get_card',
  'itinvent.equipment.list_by_branch',
  'itinvent.employee.search',
  'itinvent.employee.list_equipment',
  'itinvent.consumables.search',
  'itinvent.directory.branches',
  'itinvent.directory.locations',
  'itinvent.directory.equipment_types',
  'itinvent.directory.statuses',
  'itinvent.analytics.summary',
];

export const AI_ITINVENT_MULTI_DB_TOOL_ID = 'itinvent.equipment.search_multi_db';
export const AI_FILES_CREATE_TOOL_ID = 'ai.files.create';
export const AI_FILES_REPORT_TOOL_ID = 'ai.files.report';
export const AI_AD_PASSWORD_STATUS_TOOL_ID = 'ad.user.password_status';

export const AI_ITINVENT_TOOL_OPTIONS = [
  { id: 'itinvent.database.current', label: 'Текущая база' },
  { id: 'itinvent.equipment.search', label: 'Поиск оборудования' },
  { id: 'itinvent.equipment.search_universal', label: 'Универсальный поиск оборудования' },
  { id: 'itinvent.equipment.get_card', label: 'Карточка устройства' },
  { id: 'itinvent.equipment.list_by_branch', label: 'Оборудование филиала' },
  { id: 'itinvent.employee.search', label: 'Поиск сотрудника' },
  { id: 'itinvent.employee.list_equipment', label: 'Оборудование сотрудника' },
  { id: 'itinvent.consumables.search', label: 'Расходники и комплектующие' },
  { id: 'itinvent.directory.branches', label: 'Справочник филиалов' },
  { id: 'itinvent.directory.locations', label: 'Справочник локаций' },
  { id: 'itinvent.directory.equipment_types', label: 'Справочник типов оборудования' },
  { id: 'itinvent.directory.statuses', label: 'Справочник статусов' },
  { id: 'itinvent.analytics.summary', label: 'Аналитика инвентаря' },
  { id: 'itinvent.entity.resolve', label: 'Разрешение сущностей' },
  { id: 'itinvent.action.transfer_draft', label: 'Черновик передачи' },
  { id: 'itinvent.action.consumable_consume_draft', label: 'Черновик списания расходника' },
  { id: 'itinvent.action.consumable_qty_draft', label: 'Черновик остатка расходника' },
  { id: 'itinvent.equipment.history', label: 'История изменений оборудования' },
  { id: 'itinvent.equipment.acts', label: 'Акты по оборудованию' },
  { id: 'itinvent.equipment.models_search', label: 'Поиск по моделям' },
  { id: 'itinvent.directory.vendors', label: 'Справочник вендоров' },
  { id: 'itinvent.directory.departments', label: 'Справочник отделов' },
  { id: 'itinvent.action.status_change_draft', label: 'Черновик смены статуса' },
  { id: 'itinvent.action.location_change_draft', label: 'Черновик смены локации' },
  { id: 'itinvent.user.by_name', label: 'Поиск пользователя по имени' },
  { id: 'itinvent.user.full_context', label: 'Полный IT-контекст пользователя' },
  { id: AI_ITINVENT_MULTI_DB_TOOL_ID, label: 'Мульти-БД поиск (admin)' },
];

export const AI_FILE_TOOL_OPTIONS = [
  { id: AI_FILES_CREATE_TOOL_ID, label: 'Создание файлов' },
  { id: AI_FILES_REPORT_TOOL_ID, label: 'Красивые отчёты' },
];

export const AI_OFFICE_TOOL_OPTIONS = [
  { id: 'office.mail.search', label: 'Поиск писем' },
  { id: 'office.mail.get_message', label: 'Открыть письмо' },
  { id: 'office.mail.contacts.resolve', label: 'Поиск почтовых контактов' },
  { id: 'office.tasks.search', label: 'Поиск задач' },
  { id: 'office.tasks.get', label: 'Открыть карточку задачи' },
  { id: 'office.workday.summary', label: 'Сводка рабочего дня' },
  { id: 'office.tasks.projects', label: 'Проекты задач' },
  { id: 'office.announcements.list', label: 'Список объявлений' },
  { id: 'office.announcements.get', label: 'Открыть объявление' },
];

export const AI_OFFICE_ACTION_TOOL_OPTIONS = [
  { id: 'office.action.mail_send_draft', label: 'Черновик нового письма' },
  { id: 'office.action.mail_reply_draft', label: 'Черновик ответа на письмо' },
  { id: 'office.action.task_create_draft', label: 'Черновик новой задачи' },
  { id: 'office.action.task_comment_draft', label: 'Черновик комментария к задаче' },
  { id: 'office.action.task_status_draft', label: 'Черновик смены статуса задачи' },
];

export const AI_MFU_TOOL_OPTIONS = [
  { id: 'mfu.devices.list', label: 'Список МФУ / принтеров' },
  { id: 'mfu.device.status', label: 'Статус МФУ (SNMP/ping)' },
  { id: 'mfu.pages.monthly', label: 'Страницы по месяцам' },
];

export const AI_NETWORK_TOOL_OPTIONS = [
  { id: 'network.socket.search', label: 'Поиск розеток' },
  { id: 'network.branch.overview', label: 'Обзор филиала (сети)' },
  { id: 'network.ports.search', label: 'Поиск портов коммутатора' },
  { id: 'network.host.ping', label: 'Ping хоста' },
  { id: 'network.dns.lookup', label: 'DNS-запрос' },
  { id: 'network.ssl.check', label: 'Проверка SSL-сертификата' },
  { id: 'network.action.wol_draft', label: 'Wake-on-LAN' },
  { id: 'network.host.info', label: 'Информация о хосте (WMI)' },
];

export const AI_AD_TOOL_OPTIONS = [
  { id: AI_AD_PASSWORD_STATUS_TOOL_ID, label: 'Срок смены пароля AD' },
  { id: 'ad.users.expiring_soon', label: 'Список истекающих паролей AD' },
  { id: 'ad.mailbox.password_status', label: 'Пароль почтового ящика AD' },
  { id: 'ad.mailboxes.expiring_soon', label: 'Истекающие пароли ящиков AD' },
  { id: 'ad.user.lockout_status', label: 'Статус блокировки AD' },
  { id: 'ad.action.unlock_draft', label: 'Разблокировка учётной записи AD' },
  { id: 'ad.user.groups', label: 'Группы пользователя AD' },
  { id: 'ad.user.logon_history', label: 'История входов AD' },
];

export const AI_ITINVENT_TOOL_IDS = new Set(AI_ITINVENT_TOOL_OPTIONS.map((item) => item.id));
export const AI_FILE_TOOL_IDS = new Set(AI_FILE_TOOL_OPTIONS.map((item) => item.id));
export const AI_OFFICE_TOOL_IDS = new Set([...AI_OFFICE_TOOL_OPTIONS, ...AI_OFFICE_ACTION_TOOL_OPTIONS].map((item) => item.id));
export const AI_MFU_TOOL_IDS = new Set(AI_MFU_TOOL_OPTIONS.map((item) => item.id));
export const AI_NETWORK_TOOL_IDS = new Set(AI_NETWORK_TOOL_OPTIONS.map((item) => item.id));
export const AI_AD_TOOL_IDS = new Set(AI_AD_TOOL_OPTIONS.map((item) => item.id));
