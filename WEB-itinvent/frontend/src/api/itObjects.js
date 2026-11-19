import apiClient from './http';


const refPath = (objectRef) => encodeURIComponent(String(objectRef || '').trim());

export const itObjectsAPI = {
  list: async ({ search = '', mine = false, hidden = false, signal } = {}) => {
    const { data } = await apiClient.get('/it-objects', { params: { q: search, mine, hidden }, signal });
    return data;
  },
  create: async ({ name, linkedRef = null }) => {
    const { data } = await apiClient.post('/it-objects', { name, linked_ref: linkedRef || null });
    return data;
  },
  // «Удалить» скрывает объект: доступы, пароли и журнал сохраняются, объект можно вернуть.
  hide: async (objectRef) => {
    const { data } = await apiClient.delete(`/it-objects/${refPath(objectRef)}`);
    return data;
  },
  restore: async (objectRef) => {
    const { data } = await apiClient.post(`/it-objects/${refPath(objectRef)}/restore`);
    return data;
  },
  get: async (objectRef, { signal } = {}) => {
    const { data } = await apiClient.get(`/it-objects/${refPath(objectRef)}`, { signal });
    return data;
  },
  computers: async (objectRef, { signal } = {}) => {
    const { data } = await apiClient.get(`/it-objects/${refPath(objectRef)}/computers`, { signal });
    return data;
  },
  computer: async (objectRef, macAddress, { signal } = {}) => {
    const { data } = await apiClient.get(`/it-objects/${refPath(objectRef)}/computers/${encodeURIComponent(macAddress)}`, { signal });
    return data;
  },
  inventory: async (objectRef, { page = 1, limit = 100, signal } = {}) => {
    const { data } = await apiClient.get(`/it-objects/${refPath(objectRef)}/inventory`, { params: { page, limit }, signal });
    return data;
  },
  monitoring: async (objectRef, { signal } = {}) => {
    const { data } = await apiClient.get(`/it-objects/${refPath(objectRef)}/monitoring`, { signal });
    return data;
  },
  // Привязка устройств мониторинга к объекту: свободные устройства, добавить, убрать.
  monitoringFreeDevices: async (objectRef, { signal } = {}) => {
    const { data } = await apiClient.get(`/it-objects/${refPath(objectRef)}/monitoring/free-devices`, { signal });
    return data;
  },
  assignMonitoringDevice: async (objectRef, targetId) => {
    const { data } = await apiClient.put(`/it-objects/${refPath(objectRef)}/monitoring/devices/${encodeURIComponent(targetId)}`);
    return data;
  },
  releaseMonitoringDevice: async (objectRef, targetId) => {
    const { data } = await apiClient.delete(`/it-objects/${refPath(objectRef)}/monitoring/devices/${encodeURIComponent(targetId)}`);
    return data;
  },
  // Карта сети объекта: drawio-документ целиком; expected_version — защита от перезаписи чужой правки.
  netmap: async (objectRef, { signal } = {}) => {
    const { data } = await apiClient.get(`/it-objects/${refPath(objectRef)}/netmap`, { signal });
    return data;
  },
  saveNetmap: async (objectRef, { fileName = '', xml, expectedVersion = null, previewPng = null }) => {
    const { data } = await apiClient.put(`/it-objects/${refPath(objectRef)}/netmap`, {
      file_name: fileName,
      xml,
      expected_version: expectedVersion,
      ...(previewPng ? { preview_png: previewPng } : {}),
    });
    return data;
  },
  deleteNetmap: async (objectRef) => {
    const { data } = await apiClient.delete(`/it-objects/${refPath(objectRef)}/netmap`);
    return data;
  },
  // PNG-миниатюра карты (blob) и её запись из редактора.
  netmapPreview: async (objectRef, { signal } = {}) => {
    const { data } = await apiClient.get(`/it-objects/${refPath(objectRef)}/netmap/preview`, {
      responseType: 'blob',
      signal,
    });
    return data;
  },
  saveNetmapPreview: async (objectRef, pngBase64) => {
    const { data } = await apiClient.put(`/it-objects/${refPath(objectRef)}/netmap/preview`, { png: pngBase64 });
    return data;
  },
  // История версий карты: список без xml + одна версия целиком для просмотра/восстановления.
  netmapVersions: async (objectRef, { signal } = {}) => {
    const { data } = await apiClient.get(`/it-objects/${refPath(objectRef)}/netmap/versions`, { signal });
    return data;
  },
  netmapVersion: async (objectRef, version, { signal } = {}) => {
    const { data } = await apiClient.get(`/it-objects/${refPath(objectRef)}/netmap/versions/${encodeURIComponent(version)}`, { signal });
    return data;
  },
  passwordsAudit: async (objectRef, { limit = 20, signal } = {}) => {
    const { data } = await apiClient.get(`/it-objects/${refPath(objectRef)}/passwords/audit`, { params: { limit }, signal });
    return data;
  },
  userOptions: async (query = '', { signal } = {}) => {
    const { data } = await apiClient.get('/it-objects/user-options', { params: { q: query }, signal });
    return data;
  },
  assignOwner: async (objectRef, userId) => {
    const { data } = await apiClient.put(`/it-objects/${refPath(objectRef)}/owner`, { user_id: userId });
    return data;
  },
  clearOwner: async (objectRef) => {
    const { data } = await apiClient.delete(`/it-objects/${refPath(objectRef)}/owner`);
    return data;
  },
  // roles: { project_lead: {employee_code, full_name, position, department, department_location} | null, ... }
  setTeam: async (objectRef, roles) => {
    const { data } = await apiClient.put(`/it-objects/${refPath(objectRef)}/team`, { roles });
    return data;
  },
  searchEmployees: async (query, { limit = 30, signal } = {}) => {
    const { data } = await apiClient.get('/it-objects/employee-candidates', { params: { q: String(query || ''), limit }, signal });
    return data;
  },
  grant: async (objectRef, { userId, section, level }) => {
    const { data } = await apiClient.put(`/it-objects/${refPath(objectRef)}/grants`, {
      user_id: userId,
      section,
      level,
    });
    return data;
  },
  // sections: { passwords: 'view' | 'manage' | null, computers: ..., inventory: ... } — всё за один запрос.
  setAccess: async (objectRef, userId, sections) => {
    const { data } = await apiClient.put(`/it-objects/${refPath(objectRef)}/access/${encodeURIComponent(userId)}`, { sections });
    return data;
  },
  revoke: async (objectRef, { userId, section }) => {
    const { data } = await apiClient.delete(`/it-objects/${refPath(objectRef)}/grants`, {
      params: { user_id: userId, section },
    });
    return data;
  },
};
