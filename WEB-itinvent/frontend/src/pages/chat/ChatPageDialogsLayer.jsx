import { Suspense, lazy } from 'react';

import { loadChatDialogsModule } from './useChatDialogsController';

const LazyChatDialogs = lazy(loadChatDialogsModule);

export default function ChatPageDialogsLayer({ open = false, ...dialogProps }) {
  if (!open) return null;

  return (
    <Suspense fallback={null}>
      <LazyChatDialogs {...dialogProps} />
    </Suspense>
  );
}
