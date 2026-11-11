import client from './client';

// Branch work schedules for DLP activity reclassification (Администрирование → «Графики работы»).
export const dlpWorkSchedulesAPI = {
  getSchedules: async () => {
    const { data } = await client.get('/inventory/dlp/work-schedules');
    return data;
  },
  saveSchedule: async (branchName, schedule) => {
    const { data } = await client.put(`/inventory/dlp/work-schedules/${encodeURIComponent(branchName)}`, schedule);
    return data;
  },
  deleteSchedule: async (branchName) => {
    const { data } = await client.delete(`/inventory/dlp/work-schedules/${encodeURIComponent(branchName)}`);
    return data;
  },
};
