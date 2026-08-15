import { Suspense, lazy } from 'react';

import {
  loadChatContextPanelModule,
  loadTaskWorkspacePanelModule,
} from './useChatPanelsController';
import { GENERAL_AI_OPENING_ID } from '../../components/chat/chatAiSidebarModel';

const LazyChatContextPanel = lazy(loadChatContextPanelModule);
const LazyTaskWorkspacePanel = lazy(loadTaskWorkspacePanelModule);
const LazyAiConversationContextPanel = lazy(() => import('../../components/chat/AiConversationContextPanel'));

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
  activeAiBot,
  activeAiStatus,
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
  handleCreateAiBotConversation,
  handleCreateAiConversation,
  openingAiBotId,
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
          currentUser={user}
        />
      </Suspense>
    );
  }

  if (showContextPanel) {
    if (String(activeConversation?.kind || '').trim() === 'ai') {
      return (
        <Suspense fallback={null}>
          <LazyAiConversationContextPanel
            activeConversation={activeConversation}
            agent={activeAiBot}
            messages={messages}
            realtimeRevision={activeAiStatus?.updated_at || activeAiStatus?.status || ''}
            onClose={onCloseContextPanel}
            onOpenSearch={openSearchDialog}
            onOpenFilePicker={openFilePicker}
            onCreateNewConversation={() => (
              activeAiBot?.id
                ? handleCreateAiBotConversation?.(activeAiBot)
                : handleCreateAiConversation?.()
            )}
            newConversationCreating={String(openingAiBotId || '').trim() === (
              activeAiBot?.id ? String(activeAiBot.id).trim() : GENERAL_AI_OPENING_ID
            )}
            onUpdateConversationSettings={updateConversationSettings}
            settingsUpdating={settingsUpdating}
            onOpenAttachmentPreview={openMediaViewer}
          />
        </Suspense>
      );
    }
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
