export type NativeMailImageViewerGestureAction = 'previous' | 'next' | 'dismiss' | 'settle';

export function resolveNativeMailImageViewerGesture({
  dx,
  dy,
  canPrevious,
  canNext,
}: {
  dx: number;
  dy: number;
  canPrevious: boolean;
  canNext: boolean;
}): NativeMailImageViewerGestureAction {
  const horizontal = Math.abs(dx);
  const vertical = Math.abs(dy);
  if (dy >= 96 && vertical > horizontal * 1.35) return 'dismiss';
  if (dx >= 72 && horizontal > vertical * 1.35 && canPrevious) return 'previous';
  if (dx <= -72 && horizontal > vertical * 1.35 && canNext) return 'next';
  return 'settle';
}
