import { useMemo } from 'react';

/**
 * Merges grouped layout sections into a flat source for panes/dialogs builders.
 * Each section is independently memoized in ChatPageContent to limit re-render surface.
 */
export default function useChatPageLayoutContext({
  shell,
  sidebar,
  thread,
  rightPanel,
  dialogs,
}) {
  return useMemo(
    () => ({
      ...shell,
      ...sidebar,
      ...thread,
      ...rightPanel,
      ...dialogs,
    }),
    [shell, sidebar, thread, rightPanel, dialogs],
  );
}
