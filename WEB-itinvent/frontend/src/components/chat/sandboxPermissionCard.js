export const SANDBOX_PERMISSION_ACTION_TYPE = 'ai.sandbox.permission';

const PERMISSION_STATUS_TO_CARD_STATUS = {
  pending: 'pending',
  approved: 'confirmed',
  rejected: 'cancelled',
};

export function sandboxPermissionStatusToCardStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return PERMISSION_STATUS_TO_CARD_STATUS[normalized] || normalized || 'pending';
}

const text = (value) => String(value ?? '').trim();

const pickConversationId = (envelope, payload) => (
  text(envelope?.conversation_id || payload?.conversation_id)
);

export function buildSandboxPermissionCard({ envelope, activeConversationId } = {}) {
  const payload = envelope?.payload && typeof envelope.payload === 'object' ? envelope.payload : {};
  const change = text(envelope?.change || payload?.change);
  if (change !== 'permission') return null;
  if (pickConversationId(envelope, payload) !== text(activeConversationId)) return null;
  const actionId = text(payload?.action_id);
  const messageId = text(payload?.message_id);
  if (!actionId || !messageId) return null;
  const summary = text(payload?.summary || payload?.operation);
  return {
    id: actionId,
    action_type: SANDBOX_PERMISSION_ACTION_TYPE,
    status: sandboxPermissionStatusToCardStatus(payload?.status),
    conversation_id: pickConversationId(envelope, payload),
    message_id: messageId,
    preview: {
      title: 'Разрешить действие OpenCode',
      summary,
      tool: text(payload?.tool),
      arguments: payload?.arguments && typeof payload.arguments === 'object' ? payload.arguments : {},
    },
  };
}
