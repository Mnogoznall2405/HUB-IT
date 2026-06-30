import { Suspense, lazy } from 'react';

import {
  loadChatContextPanelModule,
  loadTaskWorkspacePanelModule,
} from './useChatPanelsController';

const LazyChatContextPanel = lazy(loadChatContextPanelModule);
const LazyTaskWorkspacePanel = lazy(loadTaskWorkspacePanelModule);

export default function ChatPageRightPanelContent({
  showTaskPanel = false,
  showContextPanel = false,
  taskPanelTaskId = '',
  closeTaskPanel,
  openTaskInTasks,
  navigate,
  handleTaskPanelUpdated,
  theme,
  ui,
  activeConversation,
  conversationMetaSubtitle,
  socketStatus,
  user,
  messages,
  onCloseContextPanel,
  openSearchDialog,
  openShareDialog,
  openFilePicker,
  updateConversationSettings,
  handleAddGroupMembers,
  handleRemoveGroupMember,
  handleUpdateGroupMemberRole,
  handleTransferGroupOwnership,
  handleLeaveGroup,
  handleUpdateGroupProfile,
  settingsUpdating,
  openMediaViewer,
  openTaskFromChat,
}) {
  if (showTaskPanel) {
    return (
      <Suspense fallback={null}>
        <LazyTaskWorkspacePanel
          taskId={taskPanelTaskId}
          onClose={closeTaskPanel}
          onOpenInTasks={openTaskInTasks}
          onNavigate={navigate}
          onTaskUpdated={handleTaskPanelUpdated}
        />
      </Suspense>
    );
  }

  if (showContextPanel) {
    return (
      <Suspense fallback={null}>
        <LazyChatContextPanel
          theme={theme}
          ui={ui}
          activeConversation={activeConversation}
          conversationHeaderSubtitle={conversationMetaSubtitle}
          socketStatus={socketStatus}
          currentUser={user}
          messages={messages}
          open={showContextPanel}
          embedded
          onClose={onCloseContextPanel}
          onOpenSearch={openSearchDialog}
          onOpenShare={openShareDialog}
          onOpenFilePicker={openFilePicker}
          onUpdateConversationSettings={updateConversationSettings}
          onAddGroupMembers={handleAddGroupMembers}
          onRemoveGroupMember={handleRemoveGroupMember}
          onUpdateGroupMemberRole={handleUpdateGroupMemberRole}
          onTransferGroupOwnership={handleTransferGroupOwnership}
          onLeaveGroup={handleLeaveGroup}
          onUpdateGroupProfile={handleUpdateGroupProfile}
          settingsUpdating={settingsUpdating}
          onOpenAttachmentPreview={openMediaViewer}
          onOpenTask={openTaskFromChat}
        />
      </Suspense>
    );
  }

  return null;
}
