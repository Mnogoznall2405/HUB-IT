// Tool catalogue mirrors WEB-itinvent frontend/src/pages/account/accountConstants.jsx.
// Ids are part of the backend contract — keep them in sync with the web client.

export type AiBotToolOption = { id: string; label: string };

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
  'itinvent.action.cartridge_replacement_draft',
  'itinvent.action.battery_replacement_draft',
  'itinvent.action.component_replacement_draft',
  'itinvent.action.pc_cleaning_draft',
];

export const AI_ITINVENT_MULTI_DB_TOOL_ID = 'itinvent.equipment.search_multi_db';

export const AI_BOT_TOOL_GROUPS: Array<{ key: string; title: string; options: AiBotToolOption[] }> = [
  {
    key: 'itinvent',
    title: 'Инструменты ITinvent',
    options: [
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
      { id: 'itinvent.action.cartridge_replacement_draft', label: 'Черновик замены картриджа' },
      { id: 'itinvent.action.battery_replacement_draft', label: 'Черновик замены батареи' },
      { id: 'itinvent.action.component_replacement_draft', label: 'Черновик замены комплектующей' },
      { id: 'itinvent.action.pc_cleaning_draft', label: 'Черновик чистки ПК' },
      { id: 'itinvent.user.by_name', label: 'Поиск пользователя по имени' },
      { id: 'itinvent.user.full_context', label: 'Полный IT-контекст пользователя' },
      { id: 'itinvent.computers.search', label: 'Поиск компьютеров (ПК, пользователь, PST, профили)' },
      { id: 'itinvent.computers.get', label: 'Карточка компьютера: аптайм, перезагрузка, диски, PST' },
      { id: AI_ITINVENT_MULTI_DB_TOOL_ID, label: 'Мульти-БД поиск (admin)' },
    ],
  },
  {
    key: 'files',
    title: 'Файлы и отчёты',
    options: [
      { id: 'ai.files.create', label: 'Создание файлов' },
      { id: 'ai.files.report', label: 'Красивые отчёты' },
      { id: 'ai.files.convert_document', label: 'Конвертер документов (фото/PDF)' },
    ],
  },
  {
    key: 'office',
    title: 'Почта и задачи',
    options: [
      { id: 'office.mail.search', label: 'Поиск писем' },
      { id: 'office.mail.get_message', label: 'Открыть письмо' },
      { id: 'office.mail.contacts.resolve', label: 'Поиск почтовых контактов' },
      { id: 'office.tasks.search', label: 'Поиск задач' },
      { id: 'office.tasks.get', label: 'Открыть карточку задачи' },
      { id: 'office.workday.summary', label: 'Сводка рабочего дня' },
      { id: 'office.tasks.projects', label: 'Проекты задач' },
      { id: 'office.announcements.list', label: 'Список объявлений' },
      { id: 'office.announcements.get', label: 'Открыть объявление' },
      { id: 'office.action.mail_send_draft', label: 'Черновик нового письма' },
      { id: 'office.action.mail_reply_draft', label: 'Черновик ответа на письмо' },
      { id: 'office.action.task_create_draft', label: 'Черновик новой задачи' },
      { id: 'office.action.task_comment_draft', label: 'Черновик комментария к задаче' },
      { id: 'office.action.task_status_draft', label: 'Черновик смены статуса задачи' },
    ],
  },
  {
    key: 'mfu',
    title: 'МФУ',
    options: [
      { id: 'mfu.devices.list', label: 'Список МФУ / принтеров' },
      { id: 'mfu.device.status', label: 'Статус МФУ (SNMP/ping)' },
      { id: 'mfu.pages.monthly', label: 'Страницы по месяцам' },
    ],
  },
  {
    key: 'network',
    title: 'Сети',
    options: [
      { id: 'network.socket.search', label: 'Поиск розеток' },
      { id: 'network.branch.overview', label: 'Обзор филиала (сети)' },
      { id: 'network.ports.search', label: 'Поиск портов коммутатора' },
      { id: 'network.host.ping', label: 'Ping хоста' },
      { id: 'network.dns.lookup', label: 'DNS-запрос' },
      { id: 'network.ssl.check', label: 'Проверка SSL-сертификата' },
      { id: 'network.action.wol_draft', label: 'Wake-on-LAN' },
      { id: 'network.host.info', label: 'Информация о хосте (WMI)' },
    ],
  },
  {
    key: 'ad',
    title: 'Active Directory',
    options: [
      { id: 'ad.user.password_status', label: 'Срок смены пароля AD' },
      { id: 'ad.users.expiring_soon', label: 'Список истекающих паролей AD' },
      { id: 'ad.mailbox.password_status', label: 'Пароль почтового ящика AD' },
      { id: 'ad.mailboxes.expiring_soon', label: 'Истекающие пароли ящиков AD' },
      { id: 'ad.user.lockout_status', label: 'Статус блокировки AD' },
      { id: 'ad.action.unlock_draft', label: 'Разблокировка учётной записи AD' },
      { id: 'ad.user.groups', label: 'Группы пользователя AD' },
      { id: 'ad.user.logon_history', label: 'История входов AD' },
    ],
  },
  {
    key: 'kb',
    title: 'База знаний',
    options: [
      { id: 'kb.articles.search', label: 'Поиск статей базы знаний' },
      { id: 'kb.articles.get', label: 'Открыть статью базы знаний' },
      { id: 'kb.attachments.get_text', label: 'Читать текст вложения статьи' },
      { id: 'kb.attachments.send', label: 'Отправить файл из базы знаний' },
      { id: 'kb.categories.list', label: 'Список категорий базы знаний' },
    ],
  },
  {
    key: 'self',
    title: 'Мои данные и обращения в IT',
    options: [
      { id: 'me.equipment', label: 'Моя техника' },
      { id: 'me.computer.health', label: 'Состояние моего компьютера' },
      { id: 'me.account.status', label: 'Моя учётная запись: пароль и блокировка' },
      { id: 'helpdesk.request_draft', label: 'Обращение в IT (черновик с подтверждением)' },
    ],
  },
  {
    key: 'chat',
    title: 'Чат Hub',
    options: [
      { id: 'chat.users.search', label: 'Поиск пользователей Hub' },
      { id: 'chat.conversations.search', label: 'Поиск диалогов Hub' },
      { id: 'chat.action.message_send_draft', label: 'Черновик сообщения в чат' },
    ],
  },
];

export function aiBotEnabledTools(value: { enabled_tools?: unknown }): string[] {
  return Array.isArray(value?.enabled_tools)
    ? value.enabled_tools.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

export function toggleAiBotTool(current: string[], toolId: string, enabled: boolean): string[] {
  const set = new Set(current);
  if (enabled) set.add(toolId);
  else set.delete(toolId);
  return Array.from(set);
}

export function aiBotToolsEnabledInGroup(current: string[], options: AiBotToolOption[]): number {
  const set = new Set(current);
  return options.filter((option) => set.has(option.id)).length;
}
