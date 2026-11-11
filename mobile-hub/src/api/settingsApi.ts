import apiClient from './client';
import {
  normalizePreferencePayload,
  type UserPreferences,
} from '../preferences/preferenceNormalizers';

export type UserSettingsPatch = Partial<{
  pinned_database: string | null;
  theme_mode: string;
  font_family: string;
  font_scale: number;
  dashboard_sections: string[];
  dashboard_mobile_sections: string[];
  mobile_bottom_nav_items: string[];
}>;

export async function getMySettings(): Promise<UserPreferences> {
  const { data } = await apiClient.get<Record<string, unknown>>('/settings/me');
  return normalizePreferencePayload(data);
}

export async function updateMySettings(patch: UserSettingsPatch): Promise<UserPreferences> {
  const { data } = await apiClient.patch<Record<string, unknown>>('/settings/me', patch);
  return normalizePreferencePayload(data);
}
