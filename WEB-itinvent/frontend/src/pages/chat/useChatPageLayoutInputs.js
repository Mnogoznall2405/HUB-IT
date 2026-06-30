import useChatSidebarSection from './useChatSidebarSection';
import useChatThreadSection from './useChatThreadSection';
import useChatPageDialogsLayerProps from './useChatPageDialogsLayerProps';

export default function useChatPageLayoutInputs(ctx) {
  const sidebarPane = useChatSidebarSection(ctx);
  const { threadPane, desktopRightPanelContent } = useChatThreadSection(ctx);
  const chatPageDialogsLayerProps = useChatPageDialogsLayerProps(ctx);

  return {
    sidebarPane,
    threadPane,
    desktopRightPanelContent,
    chatPageDialogsLayerProps,
  };
}
