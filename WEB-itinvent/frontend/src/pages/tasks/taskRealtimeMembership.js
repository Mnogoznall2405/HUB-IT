// Decides what a realtime task change means for the server-filtered task list.
//
// The list is a server-side query (status / controller / department / assignee filters, view
// scope, search, due state, unread, focus). A remote change can move a task into or out of that
// result, so patching only the row that is already on screen leaves stale membership.
//   'patch'  - row stays: merge the new fields in place
//   'remove' - row no longer matches the active filters: drop it
//   'reload' - membership or placement cannot be decided locally: refetch the page
//   'ignore' - row is not on screen and does not match: nothing to do

const idsOf = (task) => {
  const many = Array.isArray(task?.assignee_user_ids) && task.assignee_user_ids.length
    ? task.assignee_user_ids
    : [task?.assignee_user_id];
  return many.map((value) => String(value || '')).filter(Boolean).sort();
};

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export function classifyRealtimeTaskChange({ task, existingItem, filters = {} }) {
  const {
    statusFilter = '',
    controllerFilter = '',
    departmentFilter = '',
    assigneeFilter = '',
    assigneeFilteredOnServer = false,
    viewMode = 'all',
    // Filters whose result only the server can compute (due state, attachments, unread, focus, text).
    serverOnlyFilterActive = false,
  } = filters;

  if (serverOnlyFilterActive) return 'reload';

  const matches = (
    (!statusFilter || String(task?.status || '') === String(statusFilter))
    && (!controllerFilter || String(task?.controller_user_id || '') === String(controllerFilter))
    && (!departmentFilter || String(task?.department_id || '') === String(departmentFilter))
    && (!assigneeFilteredOnServer || !assigneeFilter || idsOf(task).includes(String(assigneeFilter)))
  );

  if (!existingItem) {
    if (!matches) return 'ignore';
    // Unfiltered "all" view: an unseen task only affects paging/order of a list the user is
    // already looking at, which the next navigation/snapshot refreshes; refetching on every
    // foreign task change would turn each remote edit into a page reload.
    const narrowed = Boolean(
      statusFilter || controllerFilter || departmentFilter || (assigneeFilteredOnServer && assigneeFilter),
    ) || (viewMode !== 'all' && viewMode !== 'department');
    return narrowed ? 'reload' : 'ignore';
  }

  // "My" scopes depend on the user's relation to the task (assignee / creator / controller).
  if (viewMode !== 'all' && viewMode !== 'department') {
    const relationChanged = !same(idsOf(existingItem), idsOf(task))
      || String(existingItem.created_by_user_id || '') !== String(task?.created_by_user_id || '')
      || String(existingItem.controller_user_id || '') !== String(task?.controller_user_id || '');
    if (relationChanged) return 'reload';
  }
  return matches ? 'patch' : 'remove';
}
