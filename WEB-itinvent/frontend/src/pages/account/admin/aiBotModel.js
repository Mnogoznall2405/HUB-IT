import {
  AI_AD_TOOL_IDS,
  AI_FILE_TOOL_IDS,
  AI_ITINVENT_TOOL_IDS,
  AI_MFU_TOOL_IDS,
  AI_NETWORK_TOOL_IDS,
  AI_OFFICE_TOOL_IDS,
} from '../accountConstants';

export const getAiBotEnabledTools = (value) => (
  Array.isArray(value?.enabled_tools) ? value.enabled_tools.map((item) => String(item).trim()).filter(Boolean) : []
);

export const getAiBotItinventTools = (value) => getAiBotEnabledTools(value).filter((item) => AI_ITINVENT_TOOL_IDS.has(item));
export const getAiBotFileTools = (value) => getAiBotEnabledTools(value).filter((item) => AI_FILE_TOOL_IDS.has(item));
export const getAiBotOfficeTools = (value) => getAiBotEnabledTools(value).filter((item) => AI_OFFICE_TOOL_IDS.has(item));
export const getAiBotMfuTools = (value) => getAiBotEnabledTools(value).filter((item) => AI_MFU_TOOL_IDS.has(item));
export const getAiBotNetworkTools = (value) => getAiBotEnabledTools(value).filter((item) => AI_NETWORK_TOOL_IDS.has(item));
export const getAiBotAdTools = (value) => getAiBotEnabledTools(value).filter((item) => AI_AD_TOOL_IDS.has(item));

export const isAiBotLiveDataEnabled = (value) => getAiBotItinventTools(value).length > 0;

export const shouldWarnAiBotLiveDataDisabled = (value) => (
  Boolean(value?.is_enabled ?? true) && getAiBotEnabledTools(value).length === 0
);

export const createAiBotDraft = (value = {}) => ({
  title: String(value?.title || '').trim(),
  slug: String(value?.slug || '').trim(),
  description: String(value?.description || '').trim(),
  system_prompt: String(value?.system_prompt || '').trim(),
  model: String(value?.model || '').trim(),
  temperature: Number(value?.temperature ?? 0.2),
  max_tokens: Number(value?.max_tokens ?? 2000),
  allow_file_input: Boolean(value?.allow_file_input ?? true),
  allow_generated_artifacts: Boolean(value?.allow_generated_artifacts ?? true),
  allow_kb_document_delivery: Boolean(value?.allow_kb_document_delivery ?? false),
  is_enabled: Boolean(value?.is_enabled ?? true),
  allowed_kb_scope: Array.isArray(value?.allowed_kb_scope) ? value.allowed_kb_scope.join(', ') : '',
  enabled_tools: Array.isArray(value?.enabled_tools) ? value.enabled_tools.map((item) => String(item).trim()).filter(Boolean) : [],
  multi_db_mode: String(value?.tool_settings?.multi_db_mode || 'single').trim() || 'single',
  allowed_databases: Array.isArray(value?.tool_settings?.allowed_databases)
    ? value.tool_settings.allowed_databases.map((item) => String(item).trim()).filter(Boolean)
    : [],
  max_tool_rounds: Number(value?.tool_settings?.max_tool_rounds ?? 6),
  max_tool_calls_per_round: Number(value?.tool_settings?.max_tool_calls_per_round ?? 3),
});
