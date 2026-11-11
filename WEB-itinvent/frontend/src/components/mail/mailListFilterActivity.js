export const isMailAdvancedFiltersActive = (filters = {}) => Boolean(
  filters?.from_filter
  || filters?.to_filter
  || filters?.subject_filter
  || filters?.body_filter
  || filters?.importance
  || (filters?.folder_scope && filters.folder_scope !== 'current')
);

export const hasActiveMailListFilters = ({
  search = '',
  unreadOnly = false,
  hasAttachmentsOnly = false,
  filterDateFrom = '',
  filterDateTo = '',
  advancedFiltersActive = false,
} = {}) => Boolean(
  search
  || unreadOnly
  || hasAttachmentsOnly
  || filterDateFrom
  || filterDateTo
  || advancedFiltersActive
);

export const getMailNoResultsHint = ({
  hasActiveFilters = false,
  viewMode = 'messages',
} = {}) => (
  hasActiveFilters
    ? 'Ничего не найдено. Измените фильтры.'
    : (viewMode === 'conversations' ? 'Нет цепочек' : 'Нет писем')
);
