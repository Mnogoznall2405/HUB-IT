import { useCallback, useMemo } from 'react';

export default function useChatMessageChromeController({
  mailActionEditor,
  setMailActionEditor,
  chatMailAttachmentOptions,
  submitMailActionEdit,
}) {
  const onCloseMailActionEditor = useCallback(
    () => setMailActionEditor(null),
    [setMailActionEditor],
  );

  return useMemo(() => ({
    mailActionEditor,
    chatMailAttachmentOptions,
    onCloseMailActionEditor,
    onSubmitMailActionEdit: submitMailActionEdit,
  }), [
    chatMailAttachmentOptions,
    mailActionEditor,
    onCloseMailActionEditor,
    submitMailActionEdit,
  ]);
}
