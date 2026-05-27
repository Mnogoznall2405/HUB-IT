import apiClient from './client';
import type { ChatConversationSummary, ChatMessage } from './types';

export async function getConversations(): Promise<ChatConversationSummary[]> {
  const { data } = await apiClient.get<{ items?: ChatConversationSummary[] } | ChatConversationSummary[]>(
    '/chat/conversations',
  );
  if (Array.isArray(data)) return data;
  return data.items || [];
}

export async function markConversationRead(conversationId: string, lastMessageId?: string): Promise<void> {
  await apiClient.post(`/chat/conversations/${conversationId}/read`, {
    last_read_message_id: lastMessageId || undefined,
  });
}

export async function deleteMessage(conversationId: string, messageId: string): Promise<void> {
  await apiClient.delete(`/chat/conversations/${conversationId}/messages/${messageId}`);
}

export async function getMessages(conversationId: string, limit = 80): Promise<ChatMessage[]> {
  const { data } = await apiClient.get<{ items?: ChatMessage[] } | ChatMessage[]>(
    `/chat/conversations/${conversationId}/messages`,
    { params: { limit } },
  );
  const items = Array.isArray(data) ? data : data.items || [];
  return items;
}

export async function sendTextMessage(conversationId: string, bodyText: string): Promise<ChatMessage> {
  const { data } = await apiClient.post<ChatMessage>(`/chat/conversations/${conversationId}/messages`, {
    body_text: bodyText,
  });
  return data;
}

export async function createDirectConversation(peerUserId: number): Promise<ChatConversationSummary> {
  const { data } = await apiClient.post<ChatConversationSummary>('/chat/conversations/direct', {
    peer_user_id: peerUserId,
  });
  return data;
}

export async function createGroupConversation(
  title: string,
  memberUserIds: number[],
): Promise<ChatConversationSummary> {
  const { data } = await apiClient.post<ChatConversationSummary>('/chat/conversations/group', {
    title,
    member_user_ids: memberUserIds,
  });
  return data;
}

export async function getConversation(conversationId: string): Promise<ChatConversationSummary> {
  const { data } = await apiClient.get<ChatConversationSummary>(
    `/chat/conversations/${conversationId}`,
  );
  return data;
}

export async function confirmAiAction(actionId: string): Promise<void> {
  await apiClient.post(`/chat/ai/actions/${actionId}/confirm`, {});
}

export async function cancelAiAction(actionId: string): Promise<void> {
  await apiClient.post(`/chat/ai/actions/${actionId}/cancel`, {});
}

export async function searchMessages(conversationId: string, query: string): Promise<ChatMessage[]> {
  const { data } = await apiClient.get<{ items?: ChatMessage[] }>(
    `/chat/conversations/${conversationId}/messages/search`,
    { params: { q: query } },
  );
  return data.items || [];
}

export async function toggleReaction(
  conversationId: string,
  messageId: string,
  emoji: string,
): Promise<void> {
  await apiClient.post(`/chat/conversations/${conversationId}/messages/${messageId}/reactions`, { emoji });
}

export async function forwardMessage(
  targetConversationId: string,
  sourceMessageId: string,
  body?: string,
): Promise<void> {
  await apiClient.post(`/chat/conversations/${targetConversationId}/messages/forward`, {
    source_message_id: sourceMessageId,
    body: body || undefined,
    body_format: 'plain',
  });
}

export async function sendFileMessage(conversationId: string, formData: FormData): Promise<ChatMessage> {
  const { data } = await apiClient.post<ChatMessage>(
    `/chat/conversations/${conversationId}/messages/files`,
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return data;
}

export async function getChatUsers(): Promise<Array<{ id: number; username: string; full_name?: string }>> {
  const { data } = await apiClient.get<{ items?: Array<{ id: number; username: string; full_name?: string }> }>(
    '/chat/users',
  );
  return data.items || (data as unknown as Array<{ id: number; username: string; full_name?: string }>);
}

export async function getAiBots(): Promise<Array<{ id: string; name: string }>> {
  const { data } = await apiClient.get<{ items?: Array<{ id: string; name: string }> }>('/chat/ai/bots');
  return data.items || [];
}

export async function openAiBot(botId: string): Promise<ChatConversationSummary> {
  const { data } = await apiClient.post<ChatConversationSummary>(`/chat/ai/bots/${botId}/open`, {});
  return data;
}

export async function registerNativePushToken(token: string, deviceId: string): Promise<void> {
  await apiClient.put('/settings/notifications/native-push-token', {
    token,
    platform: 'android',
    device_id: deviceId,
  });
}
