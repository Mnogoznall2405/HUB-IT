import { useCallback } from 'react';

export default function useMailComposeGatedSelection({
  composeOpen,
  requestCloseComposeThen,
  selectMailListItem,
  selectAdjacentMessageRaw,
} = {}) {
  const handleSelectMailListItem = useCallback((value, item) => {
    if (composeOpen) {
      requestCloseComposeThen(() => {
        void selectMailListItem(value, item);
      });
      return;
    }
    void selectMailListItem(value, item);
  }, [composeOpen, requestCloseComposeThen, selectMailListItem]);

  const selectAdjacentMessage = useCallback((delta) => {
    if (composeOpen) {
      requestCloseComposeThen(() => {
        selectAdjacentMessageRaw(delta);
      });
      return;
    }
    selectAdjacentMessageRaw(delta);
  }, [composeOpen, requestCloseComposeThen, selectAdjacentMessageRaw]);

  return {
    handleSelectMailListItem,
    selectAdjacentMessage,
  };
}
