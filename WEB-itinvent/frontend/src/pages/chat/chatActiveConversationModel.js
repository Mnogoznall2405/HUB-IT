export function resolveActiveConversationSummary({
  activeConversationId,
  conversations,
  searchChats,
} = {}) {
  return conversations.find((item) => item.id === activeConversationId)
    || searchChats.find((item) => item.id === activeConversationId)
    || null;
}

export function mergeActiveConversation({
  activeConversationId,
  activeConversationSummary,
  conversationDetailsById,
} = {}) {
  const normalizedConversationId = String(activeConversationSummary?.id || activeConversationId || '').trim();
  const detail = normalizedConversationId ? conversationDetailsById[normalizedConversationId] : null;
  if (!activeConversationSummary) {
    return detail || null;
  }
  if (!detail) {
    return activeConversationSummary;
  }
  return {
    ...activeConversationSummary,
    ...detail,
    direct_peer: detail?.direct_peer || activeConversationSummary?.direct_peer || null,
    member_preview: Array.isArray(detail?.member_preview) && detail.member_preview.length > 0
      ? detail.member_preview
      : (Array.isArray(activeConversationSummary?.member_preview) ? activeConversationSummary.member_preview : []),
    members: Array.isArray(detail?.members) ? detail.members : undefined,
  };
}

export function buildMentionCandidates({
  activeConversation,
  currentUserId,
  searchPeople,
} = {}) {
  const byKey = new Map();
  const addPerson = (value) => {
    const person = value?.user || value;
    if (!person || typeof person !== 'object') return;
    const personId = Number(person?.id || 0);
    if (Number.isFinite(personId) && personId > 0 && personId === currentUserId) return;
    const username = String(person?.username || '').trim();
    const fullName = String(person?.full_name || person?.name || '').trim();
    if (!username && !fullName) return;
    const key = personId > 0 ? `id:${personId}` : `username:${username.toLowerCase()}`;
    if (!key || byKey.has(key)) return;
    byKey.set(key, person);
  };
  addPerson(activeConversation?.direct_peer);
  (Array.isArray(activeConversation?.members) ? activeConversation.members : []).forEach(addPerson);
  (Array.isArray(activeConversation?.member_preview) ? activeConversation.member_preview : []).forEach(addPerson);
  (Array.isArray(searchPeople) ? searchPeople : []).slice(0, 12).forEach(addPerson);
  return Array.from(byKey.values()).slice(0, 32);
}
