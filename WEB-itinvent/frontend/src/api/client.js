/**
 * Axios API client for backend communication.
 */

import axios from 'axios';
import { buildCacheKey, getOrFetchSWR } from '../lib/swrCache';
import { authAccountSecurityAPI } from './authAccountSecurity';
import { authPasskeyLoginAPI } from './authPasskeyLogin';
import { authPasswordLoginAPI } from './authPasswordLogin';
import { authSessionsAPI } from './authSessions';
import { authTrustedDevicesAPI } from './authTrustedDevices';
import { authUserAdminAPI } from './authUserAdmin';
import { chatDirectoryAPI } from './chatDirectory';
import { chatNotificationsAPI } from './chatNotifications';
import { chatConversationsAPI } from './chatConversations';
import { chatConversationDetailsAPI } from './chatConversationDetails';
import { chatGroupsAPI } from './chatGroups';
import { chatAiActionsAPI } from './chatAiActions';
import { chatThreadMessagesAPI } from './chatThreadMessages';
import { chatMessageSendingAPI } from './chatMessageSending';
import { chatAttachmentsAPI } from './chatAttachments';
import { chatUploadSessionsAPI } from './chatUploadSessions';
import { chatFileUploadsAPI } from './chatFileUploads';
import { equipmentComputersAPI } from './equipmentComputers';
import { equipmentConsumablesAPI } from './equipmentConsumables';
import { equipmentDirectoriesAPI } from './equipmentDirectories';
import { equipmentRecentCardsAPI } from './equipmentRecentCards';
import { equipmentRecordsAPI } from './equipmentRecords';
import { equipmentSearchAPI } from './equipmentSearch';
import { equipmentTransferActsAPI, UPLOADED_ACT_PARSE_TIMEOUT_MS } from './equipmentTransferActs';
import { hubAnnouncementsAPI } from './hubAnnouncements';
import { hubDashboardAPI } from './hubDashboard';
import { hubMarkdownAPI } from './hubMarkdown';
import { hubNotificationsAPI } from './hubNotifications';
import { hubTaskActivityAPI } from './hubTaskActivity';
import { hubTaskAnalyticsAPI } from './hubTaskAnalytics';
import { hubTaskFilesAPI } from './hubTaskFiles';
import { hubTaskSupportAPI } from './hubTaskSupport';
import { hubTasksAPI } from './hubTasks';
import { mailComposeAPI } from './mailCompose';
import { mailConfigAPI } from './mailConfig';
import { mailConversationsAPI } from './mailConversations';
import { mailFoldersAPI } from './mailFolders';
import { mailItRequestsAPI } from './mailItRequests';
import { mailMailboxesAPI } from './mailMailboxes';
import { mailMessageActionsAPI } from './mailMessageActions';
import { mailMessageDetailAPI } from './mailMessageDetail';
import { mailMessageFilesAPI } from './mailMessageFiles';
import { mailMessageListAPI } from './mailMessageList';
import { mailNotificationsAPI } from './mailNotifications';
import { mailPreferencesAPI } from './mailPreferences';
import { mailTemplatesAPI } from './mailTemplates';
import { scanAgentsAPI } from './scanAgents';
import { scanHostsAPI } from './scanHosts';
import { scanIncidentsAPI } from './scanIncidents';
import { scanOverviewAPI } from './scanOverview';
import { scanTasksAPI } from './scanTasks';
import { workspaceDiscoveryAPI } from './workspaceDiscovery';

const rawBase = String(import.meta.env.BASE_URL || '/');
const normalizedBase = rawBase === './' || rawBase === '.' ? '/' : rawBase;
const basePrefix = normalizedBase.endsWith('/') && normalizedBase.length > 1
  ? normalizedBase.slice(0, -1)
  : normalizedBase;

// Use app-relative /api by default so IIS virtual directories work too.
const derivedApiBase = basePrefix === '/' ? '/api' : `${basePrefix}/api`;
const API_BASE_URL = import.meta.env.VITE_API_URL || derivedApiBase;
export const API_V1_BASE = `${API_BASE_URL}/v1`;
const SYSTEM_GET_STALE_TIME_MS = 30_000;

const normalizeDbId = (value) => String(value ?? '').trim();

const normalizeCacheValue = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeCacheValue(item));
  }
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = normalizeCacheValue(value[key]);
        return acc;
      }, {});
  }
  return value ?? null;
};

const getSelectedDatabaseCachePart = () => {
  try {
    return normalizeDbId(window.localStorage.getItem('selected_database'));
  } catch {
    return '';
  }
};

let refreshInFlight = null;
let chatRequestDebugSeq = 0;

const CHAT_REQUEST_DEBUG_STORAGE_KEY = 'chat:request-debug';

const shouldDebugChatRequests = () => {
  try {
    if (typeof window === 'undefined') return false;
    const pathname = String(window.location?.pathname || '').trim();
    if (!pathname.startsWith('/chat')) return false;
    return window.localStorage.getItem(CHAT_REQUEST_DEBUG_STORAGE_KEY) !== '0';
  } catch {
    return false;
  }
};

const buildDebugRequestUrl = (config) => {
  const baseUrl = String(config?.baseURL || API_V1_BASE || '').trim();
  const rawUrl = String(config?.url || '').trim();
  let normalizedUrl = rawUrl;
  if (baseUrl && rawUrl.startsWith('/')) {
    normalizedUrl = `${baseUrl}${rawUrl}`;
  }
  const params = config?.params;
  if (!params || typeof params !== 'object') return normalizedUrl;
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    search.set(key, String(value));
  });
  const query = search.toString();
  return query ? `${normalizedUrl}?${query}` : normalizedUrl;
};

const pushChatRequestDebugEntry = (entry) => {
  try {
    if (typeof window === 'undefined') return;
    const nextEntry = {
      seq: ++chatRequestDebugSeq,
      ...entry,
    };
    const current = Array.isArray(window.__chatRequestLog) ? window.__chatRequestLog : [];
    window.__chatRequestLog = [...current.slice(-119), nextEntry];
    const prefix = `[chat-request #${nextEntry.seq}]`;
    if (nextEntry.phase === 'request') {
      console.log(prefix, `${String(nextEntry.method || 'GET').toUpperCase()} ${nextEntry.url}`, nextEntry);
      return;
    }
    if (nextEntry.phase === 'response') {
      console.log(prefix, `${String(nextEntry.method || 'GET').toUpperCase()} ${nextEntry.url} -> ${nextEntry.status} (${nextEntry.durationMs}ms)`, nextEntry);
      return;
    }
    console.warn(prefix, `${String(nextEntry.method || 'GET').toUpperCase()} ${nextEntry.url} -> ${nextEntry.status || 'ERR'} (${nextEntry.durationMs}ms)`, nextEntry);
  } catch {
    // Ignore request debug logging failures.
  }
};

const createClientRequestId = () => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Fallback below.
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const isScanApiRequestUrl = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return false;
  const path = raw.replace(/^https?:\/\/[^/]+/i, '');
  return (
    path === '/scan'
    || path.startsWith('/scan/')
    || path.startsWith('/scan?')
    || path === '/api/v1/scan'
    || path.startsWith('/api/v1/scan/')
    || path.startsWith('/api/v1/scan?')
  );
};

/**
 * Create axios instance with default configuration
 */
const apiClient = axios.create({
  baseURL: API_V1_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
  timeout: 30000,
});

/**
 * Request interceptor - add selected database to all requests
 */
apiClient.interceptors.request.use(
  (config) => {
    // For multipart uploads let the browser set boundary automatically.
    if (typeof FormData !== 'undefined' && config?.data instanceof FormData) {
      if (config.headers?.delete) {
        config.headers.delete('Content-Type');
        config.headers.delete('content-type');
      } else if (config.headers?.set) {
        config.headers.set('Content-Type', undefined);
        config.headers.set('content-type', undefined);
      } else if (config.headers) {
        delete config.headers['Content-Type'];
        delete config.headers['content-type'];
      }
    }

    const selectedDatabase = localStorage.getItem('selected_database');
    if (selectedDatabase) {
      config.headers['X-Database-ID'] = selectedDatabase;
    }
    if (!config.headers['X-Client-Request-ID']) {
      config.headers['X-Client-Request-ID'] = createClientRequestId();
    }
    if (shouldDebugChatRequests()) {
      config.metadata = {
        ...(config.metadata || {}),
        startedAt: Date.now(),
        debugUrl: buildDebugRequestUrl(config),
      };
      pushChatRequestDebugEntry({
        phase: 'request',
        method: String(config?.method || 'get').toUpperCase(),
        url: config.metadata.debugUrl,
      });
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

/**
 * Response interceptor - handle 401 errors
 */
apiClient.interceptors.response.use(
  (response) => {
    const metadata = response?.config?.metadata || {};
    if (shouldDebugChatRequests()) {
      pushChatRequestDebugEntry({
        phase: 'response',
        method: String(response?.config?.method || 'get').toUpperCase(),
        url: String(metadata.debugUrl || buildDebugRequestUrl(response?.config || {})),
        status: Number(response?.status || 0),
        durationMs: Math.max(0, Date.now() - Number(metadata.startedAt || Date.now())),
      });
    }
    return response;
  },
  async (error) => {
    const metadata = error?.config?.metadata || {};
    if (shouldDebugChatRequests()) {
      pushChatRequestDebugEntry({
        phase: 'error',
        method: String(error?.config?.method || 'get').toUpperCase(),
        url: String(metadata.debugUrl || buildDebugRequestUrl(error?.config || {})),
        status: Number(error?.response?.status || 0) || 'ERR',
        durationMs: Math.max(0, Date.now() - Number(metadata.startedAt || Date.now())),
        message: String(error?.message || 'request failed'),
      });
    }
    if (error.response?.status === 401) {
      const requestUrl = String(error.config?.url || '');
      const suppressAuthRequired = Boolean(error.config?.suppressAuthRequired);
      const isLoginRequest = requestUrl.includes('/auth/login');
      const isRefreshRequest = requestUrl.includes('/auth/refresh');
      const isInteractiveAuthFlowRequest =
        requestUrl.includes('/auth/verify-2fa') ||
        requestUrl.includes('/auth/enable-2fa') ||
        requestUrl.includes('/auth/trusted-devices/auth/') ||
        requestUrl.includes('/auth/passkey-login/');
      const canRetryWithRefresh = !error.config?._retry && !isLoginRequest && !isRefreshRequest && !isInteractiveAuthFlowRequest;

      if (canRetryWithRefresh) {
        try {
          if (!refreshInFlight) {
            refreshInFlight = apiClient.post('/auth/refresh', null, { suppressAuthRequired: true });
          }
          await refreshInFlight;
          error.config._retry = true;
          return apiClient.request(error.config);
        } catch {
          // Fall through to auth-required handling below.
        } finally {
          refreshInFlight = null;
        }
      }

      // Scan Center is served by a separate scan service. If the main backend
      // refresh succeeds but the retried scan request still gets 401, keep the
      // web session intact and let the page show its own scan loading error.
      if (error.config?._retry && isScanApiRequestUrl(requestUrl)) {
        return Promise.reject(error);
      }

      // Session expired or invalid - clear cached user and notify app state.
      localStorage.removeItem('user');
      if (!suppressAuthRequired && !isLoginRequest) {
        window.dispatchEvent(new CustomEvent('auth-required', { detail: { requestUrl } }));
      }
    }
    return Promise.reject(error);
  }
);

export default apiClient;
export { apiClient };

/**
 * Auth API methods
 */
export const authAPI = {
  get getLoginMode() {
    return authPasskeyLoginAPI.getLoginMode;
  },

  get login() {
    return authPasswordLoginAPI.login;
  },

  get startTwoFactorSetup() {
    return authPasswordLoginAPI.startTwoFactorSetup;
  },

  get verifyTwoFactorSetup() {
    return authPasswordLoginAPI.verifyTwoFactorSetup;
  },

  get verifyTwoFactorLogin() {
    return authPasswordLoginAPI.verifyTwoFactorLogin;
  },

  refresh: async () => {
    const response = await apiClient.post('/auth/refresh', null, { suppressAuthRequired: true });
    return response.data;
  },

  get regenerateBackupCodes() {
    return authAccountSecurityAPI.regenerateBackupCodes;
  },

  get getTrustedDevices() {
    return authTrustedDevicesAPI.getTrustedDevices;
  },

  get revokeTrustedDevice() {
    return authTrustedDevicesAPI.revokeTrustedDevice;
  },

  get getTrustedDeviceRegistrationOptions() {
    return authTrustedDevicesAPI.getTrustedDeviceRegistrationOptions;
  },

  get verifyTrustedDeviceRegistration() {
    return authTrustedDevicesAPI.verifyTrustedDeviceRegistration;
  },

  get getTrustedDeviceAuthOptions() {
    return authTrustedDevicesAPI.getTrustedDeviceAuthOptions;
  },

  get verifyTrustedDeviceAuth() {
    return authTrustedDevicesAPI.verifyTrustedDeviceAuth;
  },

  get getPasskeyLoginOptions() {
    return authPasskeyLoginAPI.getPasskeyLoginOptions;
  },

  get verifyPasskeyLogin() {
    return authPasskeyLoginAPI.verifyPasskeyLogin;
  },

  adminResetTwoFactor: async (userId) => {
    const response = await apiClient.post(`/auth/users/${encodeURIComponent(userId)}/reset-2fa`);
    return response.data;
  },

  get resetOwnTwoFactor() {
    return authAccountSecurityAPI.resetOwnTwoFactor;
  },

  get logout() {
    return authAccountSecurityAPI.logout;
  },

  get getCurrentUser() {
    return authAccountSecurityAPI.getCurrentUser;
  },

  changePassword: async (oldPassword, newPassword) => {
    const response = await apiClient.post('/auth/change-password', {
      old_password: oldPassword,
      new_password: newPassword,
    });
    return response.data;
  },

  uploadAvatar: async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await apiClient.post('/auth/me/avatar', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  deleteAvatar: async () => {
    const response = await apiClient.delete('/auth/me/avatar');
    return response.data;
  },

  get getSessions() {
    return authSessionsAPI.getSessions;
  },

  get terminateSession() {
    return authSessionsAPI.terminateSession;
  },

  get cleanupSessions() {
    return authSessionsAPI.cleanupSessions;
  },

  get purgeInactiveSessions() {
    return authSessionsAPI.purgeInactiveSessions;
  },

  get getUsers() {
    return authUserAdminAPI.getUsers;
  },

  get createUser() {
    return authUserAdminAPI.createUser;
  },

  get updateUser() {
    return authUserAdminAPI.updateUser;
  },

  get getTaskDelegates() {
    return authUserAdminAPI.getTaskDelegates;
  },

  get updateTaskDelegates() {
    return authUserAdminAPI.updateTaskDelegates;
  },

  get deleteUser() {
    return authUserAdminAPI.deleteUser;
  },

  syncAD: async () => {
    const response = await apiClient.post('/auth/sync-ad');
    return response.data;
  },
};

export const getCachedGet = async (
  cacheScope,
  url,
  {
    params = undefined,
    staleTimeMs = SYSTEM_GET_STALE_TIME_MS,
    force = false,
    suppressAuthRequired = false,
  } = {},
) => {
  const cacheKey = buildCacheKey(
    'http-get',
    cacheScope,
    url,
    getSelectedDatabaseCachePart(),
    normalizeCacheValue(params || {}),
  );
  const { data } = await getOrFetchSWR(
    cacheKey,
    async () => (
      await apiClient.get(url, {
        params,
        suppressAuthRequired,
      })
    ).data,
    {
      staleTimeMs,
      force,
    },
  );
  return data;
};

export const chatAPI = {
  get getHealth() {
    return chatDirectoryAPI.getHealth;
  },

  get getUnreadSummary() {
    return chatNotificationsAPI.getUnreadSummary;
  },

  get getPushConfig() {
    return chatNotificationsAPI.getPushConfig;
  },

  get upsertPushSubscription() {
    return chatNotificationsAPI.upsertPushSubscription;
  },

  get deletePushSubscription() {
    return chatNotificationsAPI.deletePushSubscription;
  },

  get getUsers() {
    return chatDirectoryAPI.getUsers;
  },

  get listAiBots() {
    return chatDirectoryAPI.listAiBots;
  },

  get openAiBotConversation() {
    return chatDirectoryAPI.openAiBotConversation;
  },

  get getConversations() {
    return chatConversationsAPI.getConversations;
  },

  get getConversation() {
    return chatConversationDetailsAPI.getConversation;
  },

  get getConversationAiStatus() {
    return chatAiActionsAPI.getConversationAiStatus;
  },

  get confirmAiAction() {
    return chatAiActionsAPI.confirmAiAction;
  },

  get cancelAiAction() {
    return chatAiActionsAPI.cancelAiAction;
  },

  get updateConversationSettings() {
    return chatConversationDetailsAPI.updateConversationSettings;
  },

  get createDirectConversation() {
    return chatConversationsAPI.createDirectConversation;
  },

  get createGroupConversation() {
    return chatGroupsAPI.createGroupConversation;
  },

  get addGroupMembers() {
    return chatGroupsAPI.addGroupMembers;
  },

  get removeGroupMember() {
    return chatGroupsAPI.removeGroupMember;
  },

  get updateGroupMemberRole() {
    return chatGroupsAPI.updateGroupMemberRole;
  },

  get transferGroupOwnership() {
    return chatGroupsAPI.transferGroupOwnership;
  },

  get leaveGroup() {
    return chatGroupsAPI.leaveGroup;
  },

  get updateGroupProfile() {
    return chatGroupsAPI.updateGroupProfile;
  },

  get uploadGroupAvatar() {
    return chatGroupsAPI.uploadGroupAvatar;
  },

  get deleteChatMessage() {
    return chatThreadMessagesAPI.deleteChatMessage;
  },

  get getThreadBootstrap() {
    return chatThreadMessagesAPI.getThreadBootstrap;
  },

  get getMessages() {
    return chatThreadMessagesAPI.getMessages;
  },

  get searchMessages() {
    return chatThreadMessagesAPI.searchMessages;
  },

  get getShareableTasks() {
    return chatMessageSendingAPI.getShareableTasks;
  },

  get getConversationAssetsSummary() {
    return chatAttachmentsAPI.getConversationAssetsSummary;
  },

  get getConversationAttachments() {
    return chatAttachmentsAPI.getConversationAttachments;
  },

  get createUploadSession() {
    return chatUploadSessionsAPI.createUploadSession;
  },

  get uploadFileChunk() {
    return chatUploadSessionsAPI.uploadFileChunk;
  },

  get getUploadSession() {
    return chatUploadSessionsAPI.getUploadSession;
  },

  get completeUploadSession() {
    return chatUploadSessionsAPI.completeUploadSession;
  },

  get cancelUploadSession() {
    return chatUploadSessionsAPI.cancelUploadSession;
  },

  get sendMessage() {
    return chatMessageSendingAPI.sendMessage;
  },

  get forwardMessage() {
    return chatMessageSendingAPI.forwardMessage;
  },

  get shareTask() {
    return chatMessageSendingAPI.shareTask;
  },

  get sendFiles() {
    return chatFileUploadsAPI.sendFiles;
  },

  get downloadAttachment() {
    return chatAttachmentsAPI.downloadAttachment;
  },

  get getMessageReads() {
    return chatThreadMessagesAPI.getMessageReads;
  },

  get markRead() {
    return chatThreadMessagesAPI.markRead;
  },

  get toggleReaction() {
    return chatThreadMessagesAPI.toggleReaction;
  },
};

export { settingsAPI } from './settings';

export const hubAPI = {
  get getDashboard() {
    return hubDashboardAPI.getDashboard;
  },

  get pollNotifications() {
    return hubNotificationsAPI.pollNotifications;
  },

  get getUnreadCounts() {
    return hubNotificationsAPI.getUnreadCounts;
  },

  get markNotificationRead() {
    return hubNotificationsAPI.markNotificationRead;
  },

  get markAllNotificationsRead() {
    return hubNotificationsAPI.markAllNotificationsRead;
  },

  get getAnnouncements() {
    return hubAnnouncementsAPI.getAnnouncements;
  },

  get getAnnouncement() {
    return hubAnnouncementsAPI.getAnnouncement;
  },

  get createAnnouncement() {
    return hubAnnouncementsAPI.createAnnouncement;
  },

  get updateAnnouncement() {
    return hubAnnouncementsAPI.updateAnnouncement;
  },

  get deleteAnnouncement() {
    return hubAnnouncementsAPI.deleteAnnouncement;
  },

  get markAnnouncementRead() {
    return hubAnnouncementsAPI.markAnnouncementRead;
  },

  get acknowledgeAnnouncement() {
    return hubAnnouncementsAPI.acknowledgeAnnouncement;
  },

  get getAnnouncementReads() {
    return hubAnnouncementsAPI.getAnnouncementReads;
  },

  get downloadAnnouncementAttachment() {
    return hubAnnouncementsAPI.downloadAnnouncementAttachment;
  },

  get getAssignees() {
    return hubTaskSupportAPI.getAssignees;
  },

  get getControllers() {
    return hubTaskSupportAPI.getControllers;
  },

  get getTaskProjects() {
    return hubTaskSupportAPI.getTaskProjects;
  },

  get createTaskProject() {
    return hubTaskSupportAPI.createTaskProject;
  },

  get updateTaskProject() {
    return hubTaskSupportAPI.updateTaskProject;
  },

  get getTaskObjects() {
    return hubTaskSupportAPI.getTaskObjects;
  },

  get createTaskObject() {
    return hubTaskSupportAPI.createTaskObject;
  },

  get updateTaskObject() {
    return hubTaskSupportAPI.updateTaskObject;
  },

  get getAnnouncementRecipients() {
    return hubAnnouncementsAPI.getAnnouncementRecipients;
  },

  get transformMarkdown() {
    return hubMarkdownAPI.transformMarkdown;
  },

  get getTasks() {
    return hubTasksAPI.getTasks;
  },

  get getTaskAnalytics() {
    return hubTaskAnalyticsAPI.getTaskAnalytics;
  },

  get exportTaskAnalyticsExcel() {
    return hubTaskAnalyticsAPI.exportTaskAnalyticsExcel;
  },

  get getTask() {
    return hubTasksAPI.getTask;
  },

  get createTask() {
    return hubTasksAPI.createTask;
  },

  get updateTask() {
    return hubTasksAPI.updateTask;
  },

  get deleteTask() {
    return hubTasksAPI.deleteTask;
  },

  get startTask() {
    return hubTasksAPI.startTask;
  },

  get submitTask() {
    return hubTasksAPI.submitTask;
  },

  get uploadTaskAttachment() {
    return hubTaskFilesAPI.uploadTaskAttachment;
  },

  get reviewTask() {
    return hubTasksAPI.reviewTask;
  },

  get downloadTaskAttachment() {
    return hubTaskFilesAPI.downloadTaskAttachment;
  },

  get downloadTaskReport() {
    return hubTaskFilesAPI.downloadTaskReport;
  },

  get getTaskComments() {
    return hubTaskActivityAPI.getTaskComments;
  },

  get addTaskComment() {
    return hubTaskActivityAPI.addTaskComment;
  },

  get markTaskCommentsSeen() {
    return hubTaskActivityAPI.markTaskCommentsSeen;
  },

  get getTaskStatusLog() {
    return hubTaskActivityAPI.getTaskStatusLog;
  },

};

export {
  authAccountSecurityAPI,
  authPasskeyLoginAPI,
  authPasswordLoginAPI,
  authSessionsAPI,
  authTrustedDevicesAPI,
  authUserAdminAPI,
  chatDirectoryAPI,
  chatNotificationsAPI,
  chatConversationsAPI,
  chatConversationDetailsAPI,
  chatGroupsAPI,
  chatAiActionsAPI,
  chatThreadMessagesAPI,
  chatMessageSendingAPI,
  chatAttachmentsAPI,
  chatUploadSessionsAPI,
  chatFileUploadsAPI,
  equipmentComputersAPI,
  equipmentConsumablesAPI,
  equipmentDirectoriesAPI,
  equipmentRecentCardsAPI,
  equipmentRecordsAPI,
  equipmentSearchAPI,
  equipmentTransferActsAPI,
  hubAnnouncementsAPI,
  hubDashboardAPI,
  hubMarkdownAPI,
  hubNotificationsAPI,
  hubTaskActivityAPI,
  hubTaskAnalyticsAPI,
  hubTaskFilesAPI,
  hubTaskSupportAPI,
  hubTasksAPI,
  mailComposeAPI,
  mailConfigAPI,
  mailConversationsAPI,
  mailFoldersAPI,
  mailItRequestsAPI,
  mailMailboxesAPI,
  mailMessageActionsAPI,
  mailMessageDetailAPI,
  mailMessageFilesAPI,
  mailMessageListAPI,
  mailNotificationsAPI,
  mailPreferencesAPI,
  mailTemplatesAPI,
  scanAgentsAPI,
  scanHostsAPI,
  scanIncidentsAPI,
  scanOverviewAPI,
  scanTasksAPI,
  workspaceDiscoveryAPI,
  UPLOADED_ACT_PARSE_TIMEOUT_MS,
};

export const mailAPI = {
  get getBootstrap() {
    return mailMessageListAPI.getBootstrap;
  },

  get getMessages() {
    return mailMessageListAPI.getMessages;
  },

  get getInbox() {
    return mailMessageListAPI.getInbox;
  },

  get getFolderSummary() {
    return mailFoldersAPI.getFolderSummary;
  },

  get getFolderTree() {
    return mailFoldersAPI.getFolderTree;
  },

  get createFolder() {
    return mailFoldersAPI.createFolder;
  },

  get renameFolder() {
    return mailFoldersAPI.renameFolder;
  },

  get deleteFolder() {
    return mailFoldersAPI.deleteFolder;
  },

  get setFolderFavorite() {
    return mailFoldersAPI.setFolderFavorite;
  },

  get searchContacts() {
    return mailComposeAPI.searchContacts;
  },

  get getMessage() {
    return mailMessageDetailAPI.getMessage;
  },

  get markAsRead() {
    return mailMessageActionsAPI.markAsRead;
  },

  get markAsUnread() {
    return mailMessageActionsAPI.markAsUnread;
  },

  get moveMessage() {
    return mailMessageActionsAPI.moveMessage;
  },

  get deleteMessage() {
    return mailMessageActionsAPI.deleteMessage;
  },

  get restoreMessage() {
    return mailMessageActionsAPI.restoreMessage;
  },

  get bulkMessageAction() {
    return mailMessageActionsAPI.bulkMessageAction;
  },

  get markAllRead() {
    return mailMessageActionsAPI.markAllRead;
  },

  get setImportance() {
    return mailMessageActionsAPI.setImportance;
  },

  get saveDraftMultipart() {
    return mailComposeAPI.saveDraftMultipart;
  },

  get deleteDraft() {
    return mailComposeAPI.deleteDraft;
  },

  get getConversations() {
    return mailConversationsAPI.getConversations;
  },

  get getConversation() {
    return mailConversationsAPI.getConversation;
  },

  get markConversationAsRead() {
    return mailConversationsAPI.markConversationAsRead;
  },

  get markConversationAsUnread() {
    return mailConversationsAPI.markConversationAsUnread;
  },

  get getUnreadCount() {
    return mailNotificationsAPI.getUnreadCount;
  },

  get getNotificationFeed() {
    return mailNotificationsAPI.getNotificationFeed;
  },

  get getPreferences() {
    return mailPreferencesAPI.getPreferences;
  },

  get updatePreferences() {
    return mailPreferencesAPI.updatePreferences;
  },

  get sendMessage() {
    return mailComposeAPI.sendMessage;
  },

  get sendMessageMultipart() {
    return mailComposeAPI.sendMessageMultipart;
  },

  get downloadAttachment() {
    return mailMessageFilesAPI.downloadAttachment;
  },

  get getAttachmentPreview() {
    return mailMessageFilesAPI.getAttachmentPreview;
  },

  get downloadAttachmentPreviewPdf() {
    return mailMessageFilesAPI.downloadAttachmentPreviewPdf;
  },

  get getMessageHeaders() {
    return mailMessageFilesAPI.getMessageHeaders;
  },

  get downloadMessageSource() {
    return mailMessageFilesAPI.downloadMessageSource;
  },

  get sendItRequest() {
    return mailItRequestsAPI.sendItRequest;
  },

  get sendItRequestMultipart() {
    return mailItRequestsAPI.sendItRequestMultipart;
  },

  get getTemplates() {
    return mailTemplatesAPI.getTemplates;
  },

  get createTemplate() {
    return mailTemplatesAPI.createTemplate;
  },

  get updateTemplate() {
    return mailTemplatesAPI.updateTemplate;
  },

  get deleteTemplate() {
    return mailTemplatesAPI.deleteTemplate;
  },

  get getMyConfig() {
    return mailConfigAPI.getMyConfig;
  },

  get updateMyConfig() {
    return mailConfigAPI.updateMyConfig;
  },

  get saveMyCredentials() {
    return mailConfigAPI.saveMyCredentials;
  },

  get updateUserConfig() {
    return mailConfigAPI.updateUserConfig;
  },

  get testConnection() {
    return mailConfigAPI.testConnection;
  },

  get listMailboxes() {
    return mailMailboxesAPI.listMailboxes;
  },

  get createMailbox() {
    return mailMailboxesAPI.createMailbox;
  },

  get updateMailbox() {
    return mailMailboxesAPI.updateMailbox;
  },

  get deleteMailbox() {
    return mailMailboxesAPI.deleteMailbox;
  },
};

export { networksAPI } from './networks';

/**
 * Equipment API methods
 */
export const equipmentAPI = {
  get getAgentComputers() {
    return equipmentComputersAPI.getAgentComputers;
  },

  get searchAgentComputers() {
    return equipmentComputersAPI.searchAgentComputers;
  },

  get getAgentComputerChanges() {
    return equipmentComputersAPI.getAgentComputerChanges;
  },

  get searchBySerial() {
    return equipmentSearchAPI.searchBySerial;
  },

  get searchUniversal() {
    return equipmentSearchAPI.searchUniversal;
  },

  get searchByEmployee() {
    return equipmentSearchAPI.searchByEmployee;
  },

  get getEmployeeEquipment() {
    return equipmentSearchAPI.getEmployeeEquipment;
  },

  get getByInvNo() {
    return equipmentRecordsAPI.getByInvNo;
  },

  get getEquipmentActs() {
    return equipmentTransferActsAPI.getEquipmentActs;
  },

  get getEquipmentHistory() {
    return equipmentRecordsAPI.getEquipmentHistory;
  },

  get downloadEquipmentActFile() {
    return equipmentTransferActsAPI.downloadEquipmentActFile;
  },

  get parseUploadedAct() {
    return equipmentTransferActsAPI.parseUploadedAct;
  },

  get getUploadedActDraft() {
    return equipmentTransferActsAPI.getUploadedActDraft;
  },

  get getTransferReminder() {
    return equipmentTransferActsAPI.getTransferReminder;
  },

  get commitUploadedActDraft() {
    return equipmentTransferActsAPI.commitUploadedActDraft;
  },

  get sendUploadedActEmail() {
    return equipmentTransferActsAPI.sendUploadedActEmail;
  },

  get getAllEquipment() {
    return equipmentRecordsAPI.getAllEquipment;
  },

  get getAllEquipmentGrouped() {
    return equipmentRecordsAPI.getAllEquipmentGrouped;
  },

  get getAllConsumablesGrouped() {
    return equipmentConsumablesAPI.getAllConsumablesGrouped;
  },

  get getByInvNos() {
    return equipmentRecordsAPI.getByInvNos;
  },

  get getRecentCards() {
    return equipmentRecentCardsAPI.getRecentCards;
  },

  get touchRecentCard() {
    return equipmentRecentCardsAPI.touchRecentCard;
  },

  get removeRecentCard() {
    return equipmentRecentCardsAPI.removeRecentCard;
  },

  get clearRecentCards() {
    return equipmentRecentCardsAPI.clearRecentCards;
  },

  get identifyWorkspace() {
    return workspaceDiscoveryAPI.identifyWorkspace;
  },

  get getBranches() {
    return equipmentDirectoriesAPI.getBranches;
  },

  get getBranchesList() {
    return equipmentDirectoriesAPI.getBranchesList;
  },

  get getLocations() {
    return equipmentDirectoriesAPI.getLocations;
  },

  get getTypes() {
    return equipmentDirectoriesAPI.getTypes;
  },

  get getModels() {
    return equipmentDirectoriesAPI.getModels;
  },

  get getStatuses() {
    return equipmentDirectoriesAPI.getStatuses;
  },

  get searchOwners() {
    return equipmentDirectoriesAPI.searchOwners;
  },

  get getOwnerDepartments() {
    return equipmentDirectoriesAPI.getOwnerDepartments;
  },

  get updateByInvNo() {
    return equipmentRecordsAPI.updateByInvNo;
  },

  get deleteByInvNo() {
    return equipmentRecordsAPI.deleteByInvNo;
  },

  get createEquipment() {
    return equipmentRecordsAPI.createEquipment;
  },

  get createConsumable() {
    return equipmentConsumablesAPI.createConsumable;
  },

  get lookupConsumables() {
    return equipmentConsumablesAPI.lookupConsumables;
  },

  get consumeConsumable() {
    return equipmentConsumablesAPI.consumeConsumable;
  },

  get updateConsumableQty() {
    return equipmentConsumablesAPI.updateConsumableQty;
  },

  get transfer() {
    return equipmentTransferActsAPI.transfer;
  },

  get transferLocation() {
    return equipmentTransferActsAPI.transferLocation;
  },

  get createTransferActOnly() {
    return equipmentTransferActsAPI.createTransferActOnly;
  },

  get getTransferActJob() {
    return equipmentTransferActsAPI.getTransferActJob;
  },

  get sendTransferActsEmail() {
    return equipmentTransferActsAPI.sendTransferActsEmail;
  },

  get downloadTransferAct() {
    return equipmentTransferActsAPI.downloadTransferAct;
  },
};

export { mfuAPI } from './mfu';

export const scanAPI = {
  get getDashboard() {
    return scanOverviewAPI.getDashboard;
  },

  get getBranches() {
    return scanOverviewAPI.getBranches;
  },

  get getHostsTable() {
    return scanOverviewAPI.getHostsTable;
  },

  get getHosts() {
    return scanHostsAPI.getHosts;
  },

  get getIncidents() {
    return scanIncidentsAPI.getIncidents;
  },

  get getIncidentInboxGroups() {
    return scanIncidentsAPI.getIncidentInboxGroups;
  },

  get getHostScanRuns() {
    return scanIncidentsAPI.getHostScanRuns;
  },

  get getTaskObservations() {
    return scanIncidentsAPI.getTaskObservations;
  },

  get exportScanTaskIncidents() {
    return scanIncidentsAPI.exportScanTaskIncidents;
  },

  get getPatterns() {
    return scanTasksAPI.getPatterns;
  },

  get ackIncident() {
    return scanIncidentsAPI.ackIncident;
  },

  get ackIncidentsBatch() {
    return scanIncidentsAPI.ackIncidentsBatch;
  },

  get getAgents() {
    return scanAgentsAPI.getAgents;
  },

  get getAgentsTable() {
    return scanAgentsAPI.getAgentsTable;
  },

  get getAgentsActivity() {
    return scanAgentsAPI.getAgentsActivity;
  },

  get getTasks() {
    return scanTasksAPI.getTasks;
  },

  get createTask() {
    return scanTasksAPI.createTask;
  },
};

export { adUsersAPI } from './adUsers';
export { ticketsAPI } from './tickets';
