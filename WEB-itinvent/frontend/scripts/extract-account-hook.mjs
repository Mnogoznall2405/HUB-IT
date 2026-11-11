import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(__dirname, '../src/pages/AccountWorkspace.jsx'), 'utf8');
const lines = src.split(/\r?\n/);
const hookBody = lines.slice(5458, 6298).join('\n')
  .replace(/^function AccountWorkspace\(\{ area = 'settings' \}\) \{/, "export function useAccountSectionData(area = 'settings') {");

const imports = `import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMediaQuery } from '@mui/material';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { authAPI, settingsAPI } from '../../../api/client';
import { passwordsAPI } from '../../../api/passwords';
import { databaseAPI } from '../../../api/database';
import {
  PERSONAL_SETTINGS_SECTIONS,
  getAvailableAdminSections,
  resolveLegacySettingsTarget,
} from '../../../components/account/accountNavigationConfig';
import {
  getVisibleNavigationItems,
  resolveMobileNavigationItems,
} from '../../../components/layout/navigationConfig';
import {
  buildDefaultTrustedDeviceLabel,
  extractWebAuthnErrorMessage,
  normalizeWebAuthnErrorName,
  registerTrustedDevice,
  resolveTrustedDeviceRegistrationMode,
} from '../../../lib/trustedDeviceEnrollment';
import { isPasskeyRegistrationAvailable } from '../../../lib/passkeyWebAuthn';
import { createNavigateToastAction } from '../../../components/feedback/toastActions';
import {
  normalizeMobileBottomNavItems,
  usePreferences,
} from '../../../contexts/PreferencesContext';
import { useNotification } from '../../../contexts/NotificationContext';
import { useAuth } from '../../../contexts/AuthContext';
import {
  DESKTOP_SCROLL_QUERY,
  SETTINGS_VERY_WIDE_QUERY,
} from '../accountConstants';
import {
  mergeTaskDelegatesIntoUsers,
  normalizePermissions,
  normalizeTaskDelegateLinks,
} from '../accountUserModel';
import { normalizeAppSettingsState } from '../admin/appSettingsModel';

`;

const out = path.join(__dirname, '../src/pages/account/hooks/useAccountSectionData.js');
fs.writeFileSync(out, imports + hookBody + '\n');
console.log('Wrote hook', (imports + hookBody).split('\n').length, 'lines');
