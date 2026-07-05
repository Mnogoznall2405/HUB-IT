import ChatFolderDialogs from '../../components/chat/ChatFolderDialogs';

export default function ChatPageFolderDialogsSection({
  open = false,
  createMode = false,
  folders = [],
  conversations = [],
  conversationIdsByFolder = {},
  saving = false,
  onClose,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onReorderFolder,
  onRemoveConversationFromFolder,
}) {
  return (
    <ChatFolderDialogs
      open={open}
      createMode={createMode}
      folders={folders}
      conversations={conversations}
      conversationIdsByFolder={conversationIdsByFolder}
      saving={saving}
      onClose={onClose}
      onCreateFolder={onCreateFolder}
      onRenameFolder={onRenameFolder}
      onDeleteFolder={onDeleteFolder}
      onReorderFolder={onReorderFolder}
      onRemoveConversationFromFolder={onRemoveConversationFromFolder}
    />
  );
}
