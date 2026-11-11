import { useCallback } from 'react';

import {
  clampMailPaneSize,
  getMailPaneCssValue,
  MAIL_PANE_CSS_VARIABLES,
} from './mailPaneLayout';

export default function useMailPaneResize({
  desktopMailAreaRef,
  persistMailPaneSize,
} = {}) {
  const applyMailPaneResize = useCallback((key, value, { commit = false } = {}) => {
    const normalizedValue = clampMailPaneSize(key, value);
    const cssVariable = MAIL_PANE_CSS_VARIABLES[key];
    if (cssVariable) {
      desktopMailAreaRef?.current?.style.setProperty(cssVariable, getMailPaneCssValue(key, normalizedValue));
    }
    if (commit) persistMailPaneSize(key, normalizedValue);
  }, [desktopMailAreaRef, persistMailPaneSize]);

  const handleFolderPaneResize = useCallback((value, options) => {
    applyMailPaneResize('folder_pane_width', value, options);
  }, [applyMailPaneResize]);

  const handleMessageListResize = useCallback((value, options) => {
    applyMailPaneResize('message_list_width', value, options);
  }, [applyMailPaneResize]);

  const handleBottomListResize = useCallback((value, options) => {
    applyMailPaneResize('bottom_list_percent', value, options);
  }, [applyMailPaneResize]);

  return {
    applyMailPaneResize,
    handleFolderPaneResize,
    handleMessageListResize,
    handleBottomListResize,
  };
}
