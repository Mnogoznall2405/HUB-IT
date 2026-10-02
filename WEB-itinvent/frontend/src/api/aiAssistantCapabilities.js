import apiClient from './client';

// Статичная копия карты возможностей из backend/api/v1/chat/ai.py
// (_AI_ASSISTANT_CAPABILITIES). Используется, когда эндпоинт
// /chat/ai/assistant/capabilities недоступен (старый backend).
export const AI_ASSISTANT_FALLBACK_CAPABILITIES = [
  { key: 'files', group: 'files', label: 'Создание файлов, отчётов и конвертация документов', permissions: ['chat.ai.use'] },
  { key: 'kb', group: 'kb', label: 'База знаний: поиск и чтение статей и вложений', permissions: ['kb.read'] },
  { key: 'itinvent.read', group: 'itinvent', label: 'ITinvent: поиск техники, карточки, справочники, история и акты', permissions: ['database.read'] },
  { key: 'itinvent.write', group: 'itinvent', label: 'ITinvent: черновики перемещений, статусов, локаций, расходников и работ', permissions: ['database.write'] },
  { key: 'itinvent.multi_db', group: 'itinvent', label: 'ITinvent: поиск оборудования сразу по нескольким базам', permissions: [], admin_only: true },
  { key: 'computers.read', group: 'itinvent', label: 'Компьютеры: поиск по ПК, пользователю, PST и профилям; аптайм, перезагрузка, диски', permissions: ['computers.read'] },
  { key: 'self', group: 'self', label: 'Мои данные: моя техника, мой компьютер, моя учётная запись и обращение в IT', permissions: ['chat.ai.use'] },
  { key: 'office.mail', group: 'office', label: 'Почта: поиск писем и черновики писем', permissions: ['mail.access'] },
  { key: 'office.tasks.read', group: 'office', label: 'Задачи: просмотр и сводка рабочего дня', permissions: ['tasks.read'] },
  { key: 'office.tasks.write', group: 'office', label: 'Задачи: создание, комментарии и смена статуса (черновики)', permissions: ['tasks.create', 'tasks.write'], any_of: true },
  { key: 'office.announcements', group: 'office', label: 'Объявления компании', permissions: ['announcements.read'] },
  { key: 'mfu', group: 'mfu', label: 'МФУ и принтеры: список, статус SNMP/ping, счётчики страниц', permissions: ['mfu.read'] },
  { key: 'ad.read', group: 'ad', label: 'Active Directory: срок пароля, блокировка, группы, история входов', permissions: ['ad_users.read'], it_only: true },
  { key: 'ad.manage', group: 'ad', label: 'Active Directory: черновик разблокировки учётной записи', permissions: ['ad_users.manage'], it_only: true },
  { key: 'network.read', group: 'network', label: 'Сеть: ping, DNS, SSL, порты коммутаторов, розетки, обзор филиала', permissions: ['networks.read'], it_only: true },
  { key: 'network.write', group: 'network', label: 'Сеть: Wake-on-LAN (черновик)', permissions: ['networks.write'], it_only: true },
  { key: 'chat.read', group: 'chat', label: 'Чат: поиск сотрудников и бесед', permissions: ['chat.read'] },
  { key: 'chat.write', group: 'chat', label: 'Чат: черновик сообщения коллеге или в беседу', permissions: ['chat.write'] },
  { key: 'other', group: 'other', label: 'Общие ответы без обращения к данным HUB', permissions: [] },
];

export const aiAssistantCapabilities = {
  async get() {
    return (await apiClient.get('/chat/ai/assistant/capabilities')).data;
  },
};

export default aiAssistantCapabilities;
