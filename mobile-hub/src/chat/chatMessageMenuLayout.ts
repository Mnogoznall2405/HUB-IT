export type ChatMenuAnchor = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ChatMenuPlacement = 'above' | 'below' | 'center';

export function isUsableChatMenuAnchor(anchor?: ChatMenuAnchor | null): anchor is ChatMenuAnchor {
  return Boolean(
    anchor
    && Number.isFinite(anchor.x)
    && Number.isFinite(anchor.y)
    && anchor.width > 8
    && anchor.height > 8,
  );
}

export function placeMessageActionMenu(options: {
  anchor?: ChatMenuAnchor | null;
  viewport: { width: number; height: number };
  menu: { width: number; height: number };
  align?: 'start' | 'end';
  padding?: number;
  gap?: number;
}): { top: number; left: number; placement: ChatMenuPlacement } {
  const padding = Math.max(0, Number(options.padding ?? 12));
  const gap = Math.max(0, Number(options.gap ?? 8));
  const menuWidth = Math.max(1, options.menu.width);
  const menuHeight = Math.max(1, options.menu.height);
  const maxLeft = Math.max(padding, options.viewport.width - menuWidth - padding);
  const maxTop = Math.max(padding, options.viewport.height - menuHeight - padding);
  if (!isUsableChatMenuAnchor(options.anchor)) {
    return {
      top: Math.min(maxTop, Math.max(padding, (options.viewport.height - menuHeight) / 2)),
      left: Math.min(maxLeft, Math.max(padding, (options.viewport.width - menuWidth) / 2)),
      placement: 'center',
    };
  }
  const { anchor } = options;
  const spaceAbove = anchor.y - padding;
  const spaceBelow = options.viewport.height - (anchor.y + anchor.height) - padding;
  const placement: ChatMenuPlacement = spaceAbove >= menuHeight || spaceAbove >= spaceBelow
    ? 'above'
    : 'below';
  const rawTop = placement === 'above'
    ? anchor.y - menuHeight - gap
    : anchor.y + anchor.height + gap;
  const rawLeft = options.align === 'end'
    ? anchor.x + anchor.width - menuWidth
    : anchor.x;
  return {
    top: Math.min(maxTop, Math.max(padding, rawTop)),
    left: Math.min(maxLeft, Math.max(padding, rawLeft)),
    placement,
  };
}
