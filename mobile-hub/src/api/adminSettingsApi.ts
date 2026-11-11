import apiClient from './client';

export type AdCandidate = { login: string; display_name?: string; full_name?: string; department?: string; import_status?: string };
export const getAdCandidates = async (signal?: AbortSignal) => (await apiClient.get<AdCandidate[]>('/ad-users/import-candidates', { signal })).data;
export const importAdUser = async (login: string) => (await apiClient.post('/ad-users/import-to-app', { login })).data;
export const syncAdUser = async (login: string) => (await apiClient.post('/ad-users/sync-to-app', { logins: [login] })).data;
export type AdminAiBotToolSettings = {
  multi_db_mode?: 'single' | 'multi' | string;
  allowed_databases?: string[];
  max_tool_rounds?: number;
  max_tool_calls_per_round?: number;
};
export type AdminAiBot = {
  id: string; slug: string; title: string; description: string; model: string; system_prompt: string;
  is_enabled: boolean; temperature: number; max_tokens: number; enabled_tools: string[];
  allow_file_input: boolean; allow_generated_artifacts: boolean; allow_kb_document_delivery: boolean;
  allowed_kb_scope?: string[]; tool_settings?: AdminAiBotToolSettings;
};
export const getAdminAiBots = async (signal?: AbortSignal) => (await apiClient.get<AdminAiBot[]>('/ai-bots', { signal })).data;
export const saveAdminAiBot = async (id: string | null, patch: Partial<AdminAiBot>) => id
  ? (await apiClient.patch<AdminAiBot>(`/ai-bots/${encodeURIComponent(id)}`, patch)).data
  : (await apiClient.post<AdminAiBot>('/ai-bots', patch)).data;
export const getAdminAiBotRuns = async (id: string, signal?: AbortSignal) => (await apiClient.get<{ items: Array<{ id: string; status: string; created_at?: string; error?: string }> }>(`/ai-bots/${encodeURIComponent(id)}/runs`, { signal })).data;
export type AdminAiBotAccessUser = {
  user_id: number;
  username?: string;
  full_name?: string;
  title?: string;
  allowed?: boolean;
  automatic?: boolean;
};
export const getAdminAiBotAccessUsers = async (
  botId: string,
  params: { q?: string; offset?: number; limit?: number } = {},
  signal?: AbortSignal,
) => (await apiClient.get<{ items: AdminAiBotAccessUser[]; has_more?: boolean }>(
  `/ai-bots/${encodeURIComponent(botId)}/access`,
  { params, signal },
)).data;
export const setAdminAiBotAccess = async (botId: string, userId: number, allowed: boolean) => (
  await apiClient.put(`/ai-bots/${encodeURIComponent(botId)}/access/${encodeURIComponent(userId)}`, { allowed })
).data;
export type AdminAppSettings = {
  transfer_act_reminder_controller_username: string | null;
  admin_login_allowed_ips: string[];
  available_controllers: Array<{ username: string; full_name: string }>;
  warning?: string | null;
};
export const getAdminAppSettings = async (signal?: AbortSignal) => (await apiClient.get<AdminAppSettings>('/settings/app', { signal })).data;
export const saveAdminAppSettings = async (patch: Partial<Pick<AdminAppSettings, 'transfer_act_reminder_controller_username' | 'admin_login_allowed_ips'>>) => (await apiClient.patch<AdminAppSettings>('/settings/app', patch)).data;

export type AdminEnvSettings = { items: Array<{ key: string; value: string; category?: string; description?: string; is_sensitive?: boolean; apply_target_labels?: string[] }> };
export const getAdminEnvSettings = async (signal?: AbortSignal) => (await apiClient.get<AdminEnvSettings>('/settings/env', { signal })).data;
export const saveAdminEnvSettings = async (items: Array<{ key: string; value: string }>) => (await apiClient.patch<AdminEnvSettings>('/settings/env', { items })).data;
