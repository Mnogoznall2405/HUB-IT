import apiClient from './client';

const scope = (objectId, groupRef) => `/construction/objects/${encodeURIComponent(objectId)}${groupRef ? `/directions/${encodeURIComponent(groupRef)}` : ''}`;

export const constructionWorkAPI = {
  planning: async (objectId, groupRef, day, signal) => (await apiClient.get(`${scope(objectId, groupRef)}/planning`, { params: { day }, signal })).data,
  saveWeek: async (objectId, groupRef, payload) => (await apiClient.put(`${scope(objectId, groupRef)}/planning`, payload)).data,
  saveSummary: async (objectId, groupRef, payload) => (await apiClient.put(`${scope(objectId, groupRef)}/daily-summary`, payload)).data,
  planningHistory: async (objectId, groupRef, period, beforeId) => (await apiClient.get(`${scope(objectId, groupRef)}/planning-history`, { params: { period, before_id: beforeId } })).data,
  read: async (objectId, groupRef, { asOf, includeArchived = false, signal } = {}) => {
    const { data } = await apiClient.get(`${scope(objectId, groupRef)}/work-progress`, { params: { as_of: asOf, include_archived: includeArchived }, signal });
    return data;
  },
  savePlan: async (objectId, groupRef, items) => {
    const { data } = await apiClient.put(`${scope(objectId, groupRef)}/work-plan`, { items });
    return data;
  },
  saveDay: async (objectId, groupRef, workDate, items) => {
    const { data } = await apiClient.put(`${scope(objectId, groupRef)}/work-days`, { work_date: workDate, items });
    return data;
  },
  history: async (objectId, groupRef, workId, beforeId) => {
    const { data } = await apiClient.get(`${scope(objectId, groupRef)}/work-items/${encodeURIComponent(workId)}/history`, { params: { before_id: beforeId } });
    return data;
  },
};
