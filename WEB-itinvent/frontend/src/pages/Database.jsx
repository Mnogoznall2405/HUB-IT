import DatabasePageView from './database/DatabasePageView';
import useDatabasePageViewModel from './database/useDatabasePageViewModel';

export {
  UPLOAD_ACT_MAX_SIZE_MB,
  UPLOAD_ACT_MAX_SIZE_BYTES,
  buildUploadActInvVerification,
  buildUploadActEmailDefaults,
  buildUploadActEmailResultState,
  buildUploadActCommitPayload,
  buildUploadActDraftFormState,
  buildUploadActSelectedEmailPayload,
  buildUploadActParseErrorMessage,
  clearUploadActReminderSearch,
  createEmptyUploadActEmailSummary,
  getUploadActReminderDeepLinkAction,
  getUploadActAutoEmailEmployees,
  getUploadActEmailErrorMessage,
  isApiUnavailableForActParseError,
  isUploadActParseNetworkError,
  isUploadActProxyUnavailableError,
  isUploadActCommitDisabled,
  parseInvNosInput,
  parseUploadActReminderDeepLink,
  resolveDataModeRefreshBehavior,
  validateUploadActPdfFile,
} from './database/uploadAct';

export {
  getEquipmentRowActions,
  removeItemFromGrouped,
} from './database/equipmentModel';

// Thin composition container: the view-model hook owns all orchestration,
// DatabasePageView owns all JSX. No state lives here.
export default function Database() {
  const vm = useDatabasePageViewModel();
  return <DatabasePageView vm={vm} />;
}
