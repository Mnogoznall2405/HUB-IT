export function normalizeIpListForSettings(value) {
  const items = Array.isArray(value) ? value : [];
  const seen = new Set();
  return items.reduce((acc, item) => {
    const normalized = String(item || '').trim();
    if (!normalized || seen.has(normalized)) {
      return acc;
    }
    seen.add(normalized);
    acc.push(normalized);
    return acc;
  }, []);
}

export function normalizeAppSettingsState(data) {
  return {
    transfer_act_reminder_controller_username: String(data?.transfer_act_reminder_controller_username || '').trim().toLowerCase(),
    admin_login_allowed_ips: normalizeIpListForSettings(data?.admin_login_allowed_ips),
    available_controllers: Array.isArray(data?.available_controllers) ? data.available_controllers : [],
    resolved_controller: data?.resolved_controller || null,
    resolved_controller_source: String(data?.resolved_controller_source || 'none'),
    fallback_used: Boolean(data?.fallback_used),
    warning: String(data?.warning || ''),
  };
}
