import { useCallback } from 'react';

import {
  resolveComposeMailboxId as resolveMailboxComposeMailboxId,
  resolveItemMailboxId as resolveMailboxItemMailboxId,
  withMailboxParams,
  withMailboxPayload,
} from './mailMailboxModel';

export default function useMailActiveMailboxBindings({
  activeMailboxId,
  composeFromOptions,
} = {}) {
  const withActiveMailboxParams = useCallback(
    (params = {}) => withMailboxParams(activeMailboxId, params),
    [activeMailboxId],
  );
  const withActiveMailboxPayload = useCallback(
    (payload = {}) => withMailboxPayload(activeMailboxId, payload),
    [activeMailboxId],
  );
  const resolveItemMailboxId = useCallback((item) => (
    resolveMailboxItemMailboxId({ item, activeMailboxId })
  ), [activeMailboxId]);
  const resolveComposeMailboxId = useCallback((candidate = '') => (
    resolveMailboxComposeMailboxId({ candidate, activeMailboxId, composeFromOptions })
  ), [activeMailboxId, composeFromOptions]);

  return {
    withActiveMailboxParams,
    withActiveMailboxPayload,
    resolveItemMailboxId,
    resolveComposeMailboxId,
  };
}
