export const CREATE_MOBILE_SHEET_TITLES = {
  description: 'Описание задачи',
  assignees: 'Исполнители',
  priority: 'Приоритет',
  files: 'Файлы',
  checklist: 'Чек-лист',
  project: 'Проект',
  controller: 'Контролёр',
  observers: 'Наблюдатели',
  advanced: 'Полная форма',
};

export const getCreateMobileSheetTitle = (sheet = '') => (
  CREATE_MOBILE_SHEET_TITLES[String(sheet || '')] || ''
);

export const isCreateDescriptionMobileSheet = (sheet = '') => sheet === 'description';

export const isCreateTallMobileSheet = (sheet = '') => (
  ['description', 'assignees', 'controller', 'observers'].includes(String(sheet || ''))
);
