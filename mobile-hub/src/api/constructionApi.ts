import apiClient from './client';

export type ConstructionTeamMember = { role_key: string; full_name: string; position?: string; department?: string };
export type ConstructionGroup = { group_ref: string; group_name: string; active_request_count?: number | null; overdue_request_count?: number | null };
export type ConstructionObject = {
  object_ref: string; name: string; kind: 'project' | 'general' | 'unassigned';
  managed_object_id?: string | null; request_count: number; team?: ConstructionTeamMember[];
};
export type ConstructionPage<T> = {
  items: T[]; has_more: boolean; next_cursor?: string | null; snapshot_changed?: boolean;
  as_of: string; cache?: { state?: string }; scan_truncated?: boolean; truncated?: boolean;
};
export type ConstructionDetail = {
  id?: string; name?: string; object_id?: string; object_name?: string;
  group_ref?: string; group_name?: string; groups?: ConstructionGroup[];
  team?: ConstructionTeamMember[]; object_team?: ConstructionTeamMember[];
};
export type ConstructionRequest = {
  request_ref: string; request_number?: string; date?: string; required_date?: string;
  warehouse_name?: string; department_name?: string; responsible_name?: string;
  manager_names?: string[]; supplier_names?: string[]; progress_label?: string;
  stage?: { key?: string; label?: string }; current_state?: { label?: string; description?: string };
  item_groups?: ConstructionRequestItem[]; nomenclature_items?: ConstructionRequestItem[];
};
export type ConstructionRequestItem = {
  name?: string; nomenclature_name?: string; characteristic_name?: string;
  qty_requested?: number; quantity?: number; qty_ordered?: number; qty_received?: number;
  unit?: string; unit_name?: string; cancelled?: boolean;
};
export type ConstructionScope = { objectId?: string; groupRef?: string; requestRef?: string; tab?: 'work' };
const segment = (value: string) => encodeURIComponent(value);
function objectPath(scope: ConstructionScope): string {
  if (!scope.objectId) throw new Error('Не указан строительный объект');
  return `/construction/objects/${segment(scope.objectId)}`
    + (scope.groupRef ? `/directions/${segment(scope.groupRef)}` : '');
}
const config = (signal?: AbortSignal) => ({ signal, timeout: 50000 });

export async function getConstructionObjects(params: { q?: string; kind?: string; cursor?: string }, signal?: AbortSignal) {
  const { data } = await apiClient.get<ConstructionPage<ConstructionObject>>('/construction/objects', {
    ...config(signal), params: { ...params, limit: 24 },
  });
  return data;
}
export async function getConstructionDetail(scope: ConstructionScope, signal?: AbortSignal) {
  const { data } = await apiClient.get<ConstructionDetail>(objectPath(scope), config(signal));
  return data;
}
export async function getConstructionRequests(scope: ConstructionScope, params: { q?: string; view?: string; cursor?: string }, signal?: AbortSignal) {
  const { data } = await apiClient.get<ConstructionPage<ConstructionRequest>>(`${objectPath(scope)}/requests`, {
    ...config(signal), params: { ...params, limit: 25 },
  });
  return data;
}
export async function getConstructionRequest(scope: ConstructionScope, signal?: AbortSignal) {
  if (!scope.requestRef) throw new Error('Не указана заявка');
  const { data } = await apiClient.get<ConstructionRequest>(
    `${objectPath(scope)}/requests/${segment(scope.requestRef)}`, config(signal),
  );
  return data;
}

export type ConstructionWorkSummary = {
  total: number; percent: number | null; missing_weights_or_plan: number;
  completed: number; over_plan: number; overdue: number;
  calculation?: { notes: string[]; baseline_date: string; method: string } | null;
};
export type ConstructionWorkItem = {
  id: string; group_ref: string; version: number;
  plan: {
    section: string; name: string; unit: string; planned_quantity: number | string;
    initial_quantity: number | string; initial_date?: string | null;
    planned_start?: string | null; planned_end?: string | null;
    revised_start?: string | null; revised_end?: string | null;
    actual_start?: string | null; actual_end?: string | null;
    material_comment: string; production_comment: string; archived: boolean;
  };
  day: { quantity: number | string; engineers: number; installers: number; comment: string };
  total_quantity: number; remaining_quantity: number; percent: number | null; overdue: boolean;
};
export type ConstructionWorkProgress = {
  as_of: string; items: ConstructionWorkItem[]; summary: ConstructionWorkSummary;
  sections: (ConstructionWorkSummary & { group_ref: string; name: string })[];
  directions: (ConstructionWorkSummary & { group_ref: string; name: string })[];
  trend: { date: string; percent: number | null }[];
  calculation_sections: { name: string; percent: number | null }[];
};
export async function getConstructionWork(scope: ConstructionScope, params: { as_of: string; include_archived: boolean }, signal?: AbortSignal) {
  const { data } = await apiClient.get<ConstructionWorkProgress>(`${objectPath(scope)}/work-progress`, { ...config(signal), params });
  return data;
}
