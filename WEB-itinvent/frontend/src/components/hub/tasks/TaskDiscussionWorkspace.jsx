import { lazy, Suspense } from 'react';
import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';

const LazyChatPageContent = lazy(() => import('../../../pages/chat/ChatPageContent').then((module) => ({
  default: module.ChatPageContent,
})));

function DiscussionLoadingState({ label = 'Открываем обсуждение…' }) {
  return (
    <Stack
      role="status"
      aria-live="polite"
      sx={{ flex: 1, minHeight: 220 }}
      alignItems="center"
      justifyContent="center"
      spacing={1.25}
    >
      <CircularProgress size={28} />
      <Typography variant="body2" color="text.secondary">{label}</Typography>
    </Stack>
  );
}

export default function TaskDiscussionWorkspace({
  taskId,
  conversationId,
  messageId = '',
  loading = false,
  error = '',
  onRetry,
  onBackToTask,
}) {
  if (error) {
    return (
      <Stack sx={{ flex: 1, minHeight: 0, p: { xs: 1.5, md: 2 } }} justifyContent="center">
        <Alert
          severity="error"
          action={(
            <Button color="inherit" size="small" onClick={onRetry} sx={{ minHeight: 40, fontWeight: 800 }}>
              Повторить
            </Button>
          )}
        >
          {error}
        </Alert>
      </Stack>
    );
  }

  if (loading || !conversationId) {
    return <DiscussionLoadingState />;
  }

  return (
    <Box
      data-testid="task-discussion-workspace"
      data-task-id={taskId}
      data-conversation-id={conversationId}
      data-message-id={messageId || undefined}
      sx={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}
    >
      <Suspense fallback={<DiscussionLoadingState label="Загружаем сообщения…" />}>
        <LazyChatPageContent
          embedded
          embeddedTaskId={taskId}
          embeddedConversationId={conversationId}
          embeddedMessageId={messageId}
          embeddedBackLabel="К задаче"
          onEmbeddedBack={onBackToTask}
        />
      </Suspense>
    </Box>
  );
}
