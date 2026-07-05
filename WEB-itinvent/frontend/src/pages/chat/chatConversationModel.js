export const shouldDeferChatUrlSyncForRequestedConversation = ({
  applyingRequestedConversationId,
  activeConversationId,
}) => {
  const applyingId = String(applyingRequestedConversationId || '').trim();
  if (!applyingId) return false;
  return String(activeConversationId || '').trim() !== applyingId;
};

export const getTaskConversationTaskId = (conversation) => (
  String(conversation?.task_id || '').trim()
);

export const isOrphanedTaskConversation = (conversation) => (
  Boolean(getTaskConversationTaskId(conversation))
  && conversation?.task_missing === true
);

export const getConversationRemovalMode = (conversation) => (
  String(conversation?.kind || '').trim() === 'group'
  && String(conversation?.viewer_member_role || '').trim() !== 'owner'
    ? 'leave'
    : 'delete'
);

export const patchTaskConversationFromTask = (conversation, updatedTask) => {
  const updatedTaskId = String(updatedTask?.id || '').trim();
  if (!updatedTaskId || String(conversation?.task_id || '').trim() !== updatedTaskId) {
    return conversation;
  }

  const hasTaskField = (field) => Object.prototype.hasOwnProperty.call(updatedTask || {}, field);
  const updatedTitle = String(updatedTask?.title || '').trim();
  return {
    ...conversation,
    title: updatedTitle ? `Задача: ${updatedTitle}` : conversation.title,
    task_title: updatedTitle || conversation.task_title,
    task_status: String(updatedTask?.status || '').trim() || conversation.task_status,
    task_assignee_full_name: hasTaskField('assignee_full_name')
      ? (String(updatedTask?.assignee_full_name || '').trim() || null)
      : conversation.task_assignee_full_name,
    task_due_at: hasTaskField('due_at') ? (updatedTask?.due_at || null) : conversation.task_due_at,
    task_completed_at: hasTaskField('completed_at')
      ? (updatedTask?.completed_at || null)
      : conversation.task_completed_at,
  };
};
