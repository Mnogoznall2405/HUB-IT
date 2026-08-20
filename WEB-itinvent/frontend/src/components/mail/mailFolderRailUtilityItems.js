export const buildMailFolderRailUtilityItems = ({
  canManageUsers = false,
  onItRequest,
  onOpenTemplates,
  onAfterClick,
} = {}) => {
  const items = [
    {
      id: 'it-request',
      label: 'IT-заявка',
      onClick: () => {
        onAfterClick?.();
        onItRequest();
      },
    },
  ];
  if (canManageUsers) {
    items.push({
      id: 'templates',
      label: 'Шаблоны',
      onClick: () => {
        onAfterClick?.();
        onOpenTemplates();
      },
    });
  }
  return items;
};
