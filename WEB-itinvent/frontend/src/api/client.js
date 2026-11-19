/**
 * Axios API client for backend communication.
 */


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
import { chatAiSandboxAPI } from './chatAiSandbox';
import { chatThreadMessagesAPI } from './chatThreadMessages';
import { chatMessageSendingAPI } from './chatMessageSending';
import { chatAttachmentsAPI } from './chatAttachments';
import { chatUploadSessionsAPI } from './chatUploadSessions';
import { chatFileUploadsAPI } from './chatFileUploads';
import { chatFoldersAPI } from './chatFolders';
import { chatStickersAPI } from './chatStickers';
import { equipmentComputersAPI } from './equipmentComputers';
import { equipmentConsumablesAPI } from './equipmentConsumables';
import { equipmentDirectoriesAPI } from './equipmentDirectories';
import { equipmentRecentActsAPI } from './equipmentRecentActs';
import { equipmentRecentCardsAPI } from './equipmentRecentCards';
import { equipmentRecordsAPI } from './equipmentRecords';
import { equipmentSearchAPI } from './equipmentSearch';
import { equipmentTransferActsAPI, UPLOADED_ACT_PARSE_TIMEOUT_MS } from './equipmentTransferActs';
import { hubAnnouncementsAPI } from './hubAnnouncements';
import { hubDashboardAPI } from './hubDashboard';
import { hubMarkdownAPI } from './hubMarkdown';
import { hubNotificationsAPI } from './hubNotifications';
import { hubTaskActivityAPI } from './hubTaskActivity';
import { hubTaskDiscussionAPI } from './hubTaskDiscussion';
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
import { scanReviewAPI } from './scanReview';
import { scanTasksAPI } from './scanTasks';
import { workspaceDiscoveryAPI } from './workspaceDiscovery';
import apiClient, { API_V1_BASE, getCachedGet } from './http';

export default apiClient;
export { apiClient };
export { API_V1_BASE, getCachedGet };

export { authAPI } from './auth';


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

  get getConfig() {
    return chatDirectoryAPI.getConfig;
  },

  get listAiBots() {
    return chatDirectoryAPI.listAiBots;
  },

  get openAiBotConversation() {
    return chatDirectoryAPI.openAiBotConversation;
  },

  get createAiConversation() {
    return chatDirectoryAPI.createAiConversation;
  },

  get createAiBotConversation() {
    return chatDirectoryAPI.createAiBotConversation;
  },

  get renameAiConversation() {
    return chatDirectoryAPI.renameAiConversation;
  },

  get deleteAiConversation() {
    return chatDirectoryAPI.deleteAiConversation;
  },

  get stopAiConversationRun() {
    return chatDirectoryAPI.stopAiConversationRun;
  },

  get retryAiConversationRun() {
    return chatDirectoryAPI.retryAiConversationRun;
  },

  get resetAiConversationContext() {
    return chatDirectoryAPI.resetAiConversationContext;
  },

  get getAiMemory() {
    return chatDirectoryAPI.getAiMemory;
  },

  get updateAiMemorySettings() {
    return chatDirectoryAPI.updateAiMemorySettings;
  },

  get updateAiMemoryItem() {
    return chatDirectoryAPI.updateAiMemoryItem;
  },

  get deleteAiMemoryItem() {
    return chatDirectoryAPI.deleteAiMemoryItem;
  },

  get clearAiMemory() {
    return chatDirectoryAPI.clearAiMemory;
  },

  get saveAttachmentToMyFiles() {
    return chatDirectoryAPI.saveAttachmentToMyFiles;
  },

  get getAiSandboxConversation() {
    return chatAiSandboxAPI.getConversation;
  },

  get respondAiSandboxPermission() {
    return chatAiSandboxAPI.respondPermission;
  },

  get attachAiSandboxArchive() {
    return chatAiSandboxAPI.attachArchive;
  },

  get attachAiSandboxFile() {
    return chatAiSandboxAPI.attachFile;
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

  get setPinnedMessage() {
    return chatConversationDetailsAPI.setPinnedMessage;
  },
  get getPinnedMessages() {
    return chatConversationDetailsAPI.getPinnedMessages;
  },
  get pinMessage() {
    return chatConversationDetailsAPI.pinMessage;
  },
  get unpinMessage() {
    return chatConversationDetailsAPI.unpinMessage;
  },

  get deleteConversation() {
    return chatConversationDetailsAPI.deleteConversation;
  },

  get createDirectConversation() {
    return chatConversationsAPI.createDirectConversation;
  },

  get ensureNotesConversation() {
    return chatConversationsAPI.ensureNotesConversation;
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

  get restrictGroupMember() {
    return chatGroupsAPI.restrictGroupMember;
  },

  get liftGroupMemberRestriction() {
    return chatGroupsAPI.liftGroupMemberRestriction;
  },

  get transferGroupOwnership() {
    return chatGroupsAPI.transferGroupOwnership;
  },

  get leaveGroup() {
    return chatGroupsAPI.leaveGroup;
  },

  get getGroupActivity() {
    return chatGroupsAPI.getGroupActivity;
  },

  get createGroupInvite() {
    return chatGroupsAPI.createGroupInvite;
  },

  get revokeGroupInvites() {
    return chatGroupsAPI.revokeGroupInvites;
  },

  get previewGroupInvite() {
    return chatGroupsAPI.previewGroupInvite;
  },

  get joinGroupByInvite() {
    return chatGroupsAPI.joinGroupByInvite;
  },

  get updateGroupProfile() {
    return chatGroupsAPI.updateGroupProfile;
  },

  get uploadGroupAvatar() {
    return chatGroupsAPI.uploadGroupAvatar;
  },

  get deleteGroupAvatar() {
    return chatGroupsAPI.deleteGroupAvatar;
  },

  get deleteChatMessage() {
    return chatThreadMessagesAPI.deleteChatMessage;
  },

  get editChatMessage() {
    return chatThreadMessagesAPI.editChatMessage;
  },

  get getThreadBootstrap() {
    return chatThreadMessagesAPI.getThreadBootstrap;
  },

  get hydrateThreadMessages() {
    return chatThreadMessagesAPI.hydrateThreadMessages;
  },

  get getMessages() {
    return chatThreadMessagesAPI.getMessages;
  },

  get searchMessages() {
    return chatThreadMessagesAPI.searchMessages;
  },

  get searchMessagesGlobal() {
    return chatThreadMessagesAPI.searchMessagesGlobal;
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

  get listStickerPacks() {
    return chatStickersAPI.listPacks;
  },

  get importStickerPack() {
    return chatStickersAPI.importPack;
  },

  get removeStickerPack() {
    return chatStickersAPI.removePack;
  },

  get sendSticker() {
    return chatStickersAPI.sendSticker;
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

  get votePoll() {
    return chatThreadMessagesAPI.votePoll;
  },

  get closePoll() {
    return chatThreadMessagesAPI.closePoll;
  },

  get listChatFolders() {
    return chatFoldersAPI.listFolders;
  },

  get createChatFolder() {
    return chatFoldersAPI.createFolder;
  },

  get updateChatFolder() {
    return chatFoldersAPI.updateFolder;
  },

  get deleteChatFolder() {
    return chatFoldersAPI.deleteFolder;
  },

  get getChatFolder() {
    return chatFoldersAPI.getFolder;
  },

  get setChatFolderConversations() {
    return chatFoldersAPI.setFolderConversations;
  },

  get addChatFolderConversation() {
    return chatFoldersAPI.addFolderConversation;
  },

  get removeChatFolderConversation() {
    return chatFoldersAPI.removeFolderConversation;
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

  get completeTask() {
    return hubTasksAPI.completeTask;
  },

  get reopenTask() {
    return hubTasksAPI.reopenTask;
  },

  get downloadTaskAttachment() {
    return hubTaskFilesAPI.downloadTaskAttachment;
  },

  get getTaskAttachmentPreview() {
    return hubTaskFilesAPI.getTaskAttachmentPreview;
  },

  get downloadTaskAttachmentPreviewPdf() {
    return hubTaskFilesAPI.downloadTaskAttachmentPreviewPdf;
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

  get getTaskDiscussion() {
    return hubTaskDiscussionAPI.getTaskDiscussion;
  },

  get openTaskDiscussion() {
    return hubTaskDiscussionAPI.openTaskDiscussion;
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
  chatFoldersAPI,
  chatStickersAPI,
  equipmentComputersAPI,
  equipmentConsumablesAPI,
  equipmentDirectoriesAPI,
  equipmentRecentActsAPI,
  equipmentRecentCardsAPI,
  equipmentRecordsAPI,
  equipmentSearchAPI,
  equipmentTransferActsAPI,
  hubAnnouncementsAPI,
  hubDashboardAPI,
  hubMarkdownAPI,
  hubNotificationsAPI,
  hubTaskActivityAPI,
  hubTaskDiscussionAPI,
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
  scanReviewAPI,
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

  get getComputersSummary() {
    return equipmentComputersAPI.getComputersSummary;
  },

  get getAgentComputersByInvNos() {
    return equipmentComputersAPI.getAgentComputersByInvNos;
  },

  get getAgentComputer() {
    return equipmentComputersAPI.getAgentComputer;
  },

  get hideComputer() {
    return equipmentComputersAPI.hideComputer;
  },

  get unhideComputer() {
    return equipmentComputersAPI.unhideComputer;
  },

  get deleteComputer() {
    return equipmentComputersAPI.deleteComputer;
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

  get searchActs() {
    return equipmentTransferActsAPI.searchActs;
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

  get getCurrentActs() {
    return equipmentRecordsAPI.getCurrentActs;
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

  get getRecentActs() {
    return equipmentRecentActsAPI.getRecentActs;
  },

  get touchRecentAct() {
    return equipmentRecentActsAPI.touchRecentAct;
  },

  get removeRecentAct() {
    return equipmentRecentActsAPI.removeRecentAct;
  },

  get clearRecentActs() {
    return equipmentRecentActsAPI.clearRecentActs;
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

  get getConsumableById() {
    return equipmentConsumablesAPI.getConsumableById;
  },

  get consumeConsumable() {
    return equipmentConsumablesAPI.consumeConsumable;
  },

  get updateConsumableQty() {
    return equipmentConsumablesAPI.updateConsumableQty;
  },

  get deleteConsumable() {
    return equipmentConsumablesAPI.deleteConsumable;
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

  get getReviewItems() {
    return scanReviewAPI.getReviewItems;
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

  get getTaskSystemMetrics() {
    return scanTasksAPI.getTaskSystemMetrics;
  },
};

export { adUsersAPI } from './adUsers';
export { ticketsAPI } from './tickets';
