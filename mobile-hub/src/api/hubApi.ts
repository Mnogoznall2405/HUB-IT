import apiClient from './client';

export type HubDashboardTask = {
  id?: string | number;
  title?: string | null;
  status?: string | null;
  due_at?: string | null;
  is_overdue?: boolean;
  has_unread_comments?: boolean;
  created_by_user_id?: number | null;
  controller_user_id?: number | null;
  [key: string]: unknown;
};

export type HubDashboardAnnouncement = {
  id?: string | number;
  title?: string | null;
  preview?: string | null;
  is_ack_pending?: boolean;
  updated_at?: string | null;
  published_at?: string | null;
  created_at?: string | null;
  [key: string]: unknown;
};

export type HubDashboardAbsence = {
  id?: string | number;
  user_id?: number;
  display_name?: string | null;
  department?: string | null;
  kind?: string | null;
  kind_label?: string | null;
  starts_on?: string | null;
  ends_on?: string | null;
  [key: string]: unknown;
};

export type HubDashboardUnreadCounts = {
  notifications_unread_total?: number;
  announcements_unread?: number;
  announcements_ack_pending?: number;
  tasks_open_total?: number;
  tasks_open?: number;
  tasks_new?: number;
  tasks_review_required?: number;
  tasks_overdue?: number;
  tasks_with_unread_comments?: number;
  chat_messages_unread_total?: number;
  mail_unread?: number;
  mail_state?: string;
  [key: string]: unknown;
};

export type HubDashboard = {
  generated_at?: string;
  announcements?: { items?: HubDashboardAnnouncement[]; total?: number };
  my_tasks?: { items?: HubDashboardTask[]; total?: number };
  unread_counts?: HubDashboardUnreadCounts;
  absences_today?: {
    on?: string;
    count?: number;
    items?: HubDashboardAbsence[];
    zup_as_of?: string | null;
  };
  summary?: {
    announcements_ack_pending?: number;
    tasks_open_total?: number;
    tasks_overdue?: number;
    tasks_review_required?: number;
    tasks_with_unread_comments?: number;
    absences_today?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

const DASHBOARD_ANNOUNCEMENTS_LIMIT = 12;
const DASHBOARD_TASKS_LIMIT = 40;

export async function getHubDashboard(options: {
  announcements_limit?: number;
  tasks_limit?: number;
} = {}): Promise<HubDashboard> {
  const { data } = await apiClient.get<HubDashboard>('/hub/dashboard', {
    params: {
      announcements_limit: options.announcements_limit ?? DASHBOARD_ANNOUNCEMENTS_LIMIT,
      tasks_limit: options.tasks_limit ?? DASHBOARD_TASKS_LIMIT,
    },
  });
  return data;
}
