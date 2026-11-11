import { useEffect } from 'react';

export default function useChatBottomInstantFrameCleanup({
  bottomInstantSettleFrameRef,
}) {
  useEffect(() => () => {
    if (bottomInstantSettleFrameRef.current !== null) {
      window.cancelAnimationFrame(bottomInstantSettleFrameRef.current);
      bottomInstantSettleFrameRef.current = null;
    }
  }, [bottomInstantSettleFrameRef]);
}
