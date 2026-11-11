import { requestDesktopDownloadedFileAction } from '../../lib/desktopBridge';
import { isNativeShellRuntime } from '../../lib/platform';

export function getDesktopOfficeOpenLabel(sourceKind) {
  switch (String(sourceKind || '').trim().toLowerCase()) {
    case 'excel':
      return 'Открыть в Excel';
    case 'word':
      return 'Открыть в Word';
    case 'presentation':
      return 'Открыть в PowerPoint';
    default:
      return 'Открыть в приложении';
  }
}

export async function openOriginalWithDesktopApplication({
  isDesktop = isNativeShellRuntime,
  requestOpen = (action) => requestDesktopDownloadedFileAction(action),
  onDownload,
} = {}) {
  if (typeof isDesktop === 'function' ? !isDesktop() : !isDesktop) {
    return { accepted: false, status: 'unavailable' };
  }
  if (typeof onDownload !== 'function') {
    return { accepted: false, status: 'unavailable' };
  }
  const result = await requestOpen('open');
  if (!result?.accepted) {
    return result || { accepted: false, status: 'unavailable' };
  }
  await onDownload();
  return result;
}
