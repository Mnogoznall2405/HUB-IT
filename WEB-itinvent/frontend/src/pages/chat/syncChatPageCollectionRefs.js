export function syncChatPageCollectionRefs({
  conversationsRef,
  conversations,
  conversationDetailsByIdRef,
  conversationDetailsById,
  conversationsLoadingRef,
  conversationsLoading,
  aiBotsLoadingRef,
  aiBotsLoading,
}) {
  conversationsRef.current = conversations;
  conversationDetailsByIdRef.current = conversationDetailsById;
  conversationsLoadingRef.current = conversationsLoading;
  aiBotsLoadingRef.current = aiBotsLoading;
}
