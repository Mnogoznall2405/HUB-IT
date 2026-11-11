import { useEffect } from 'react';

export default function useMailCredentialsGateFolderClear({
  mailAccessReady,
  mailConfigLoading,
  mailRequiresPassword,
  mailRequiresRelogin,
  setFolderSummary,
  setFolderTree,
} = {}) {
  useEffect(() => {
    if (mailAccessReady || mailConfigLoading) return;
    // Keep recent cache visible while bootstrap is in flight; clear only after
    // config resolved without access and we are about to show the credentials gate.
    if (!mailRequiresPassword && !mailRequiresRelogin) return;
    setFolderSummary({});
    setFolderTree([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mailAccessReady, mailConfigLoading, mailRequiresPassword, mailRequiresRelogin]);
}
