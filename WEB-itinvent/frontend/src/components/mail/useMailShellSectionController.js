import { useCallback, useState } from 'react';

export const MAIL_SHELL_SECTION_KEY = 'mail_shell_section';

const getDefaultStorage = () => {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    return sessionStorage;
  } catch {
    return null;
  }
};

export const readStoredMailShellSection = (storage = getDefaultStorage()) => {
  try {
    const value = String(storage?.getItem?.(MAIL_SHELL_SECTION_KEY) || '').trim();
    return value === 'quotas' ? 'quotas' : 'inbox';
  } catch {
    return 'inbox';
  }
};

export const writeStoredMailShellSection = (section, storage = getDefaultStorage()) => {
  try {
    storage?.setItem?.(MAIL_SHELL_SECTION_KEY, section === 'quotas' ? 'quotas' : 'inbox');
  } catch {
    // ignore storage errors
  }
};

export default function useMailShellSectionController({
  canQuotasRead = false,
  storage,
} = {}) {
  const [mailShellSection, setMailShellSection] = useState(() => readStoredMailShellSection(storage));

  const handleMailShellSectionChange = useCallback((section) => {
    const next = section === 'quotas' ? 'quotas' : 'inbox';
    setMailShellSection(next);
    writeStoredMailShellSection(next, storage);
  }, [storage]);

  return {
    mailShellSection,
    handleMailShellSectionChange,
    showQuotasSection: Boolean(canQuotasRead) && mailShellSection === 'quotas',
  };
}
