import { useCallback, useMemo, useState } from 'react';
import { DEFAULT_DASHBOARD_MOBILE_SECTIONS, normalizeDashboardMobileSections } from '../contexts/PreferencesContext';

const DASHBOARD_MOBILE_TASK_SECTIONS = ['review', 'overdue', 'comments', 'other'];
const DASHBOARD_MOBILE_VIEW_OPTIONS = [
  { key: 'overview', label: '\u041c\u043e\u0439 \u0434\u0435\u043d\u044c' },
  { key: 'announcements', label: '\u0417\u0430\u043c\u0435\u0442\u043a\u0438' },
  { key: 'tasks', label: '\u0417\u0430\u0434\u0430\u0447\u0438' },
];
const DASHBOARD_MOBILE_ANNOUNCEMENT_SEGMENTS = [
  { key: 'all', label: '\u0412\u0441\u0435' },
  { key: 'ack', label: '\u041f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044c' },
  { key: 'new', label: '\u041d\u043e\u0432\u044b\u0435' },
  { key: 'pinned', label: '\u0417\u0430\u043a\u0440\u0435\u043f\u043b\u0435\u043d\u043d\u044b\u0435' },
];
const DASHBOARD_MOBILE_OVERVIEW_ANNOUNCEMENT_SEGMENTS = [
  { key: 'ack', label: '\u041f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044c' },
  { key: 'new', label: '\u041d\u043e\u0432\u044b\u0435' },
  { key: 'pinned', label: '\u0417\u0430\u043a\u0440\u0435\u043f\u043b\u0435\u043d\u043d\u044b\u0435' },
];
const DASHBOARD_MOBILE_TASK_SEGMENTS = [
  { key: 'review', label: '\u041a \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0435' },
  { key: 'overdue', label: '\u041f\u0440\u043e\u0441\u0440\u043e\u0447\u0435\u043d\u043d\u044b\u0435' },
  { key: 'comments', label: '\u041a\u043e\u043c\u043c\u0435\u043d\u0442\u0430\u0440\u0438\u0438' },
  { key: 'other', label: '\u0412\u0441\u0435 \u043e\u0442\u043a\u0440\u044b\u0442\u044b\u0435' },
];
const DASHBOARD_MOBILE_OVERVIEW_SECTION_META = {
  urgent: {
    title: '\u0421\u0435\u0439\u0447\u0430\u0441 \u0432\u0430\u0436\u043d\u043e',
    description: '\u041f\u0440\u043e\u0441\u0440\u043e\u0447\u0435\u043d\u043d\u044b\u0435, \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0430 \u0438 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0438\u044f.',
  },
  announcements: {
    title: '\u0417\u0430\u043c\u0435\u0442\u043a\u0438',
    description: '\u041a\u043e\u0440\u043e\u0442\u043a\u0438\u0439 \u043e\u0431\u0437\u043e\u0440 \u043d\u043e\u0432\u043e\u0441\u0442\u0435\u0439 \u0438 \u043e\u0431\u044f\u0437\u0430\u0442\u0435\u043b\u044c\u043d\u044b\u0445 \u0437\u0430\u043c\u0435\u0442\u043e\u043a.',
  },
  tasks: {
    title: '\u0417\u0430\u0434\u0430\u0447\u0438',
    description: '\u0411\u044b\u0441\u0442\u0440\u044b\u0439 triage \u043f\u043e \u0440\u0430\u0431\u043e\u0447\u0435\u0439 \u043e\u0447\u0435\u0440\u0435\u0434\u0438.',
  },
};

const buildDashboardMobileSectionDraft = (sections) => {
  const visible = normalizeDashboardMobileSections(sections);
  const hidden = DEFAULT_DASHBOARD_MOBILE_SECTIONS.filter((key) => !visible.includes(key));
  return {
    order: [...visible, ...hidden],
    hidden,
  };
};

const moveArrayItem = (items, fromIndex, toIndex) => {
  const next = Array.isArray(items) ? [...items] : [];
  if (fromIndex < 0 || fromIndex >= next.length || toIndex < 0 || toIndex >= next.length) {
    return next;
  }
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
};

export function useMobileSections(preferences) {
  const [mobileSectionsDraft, setMobileSectionsDraft] = useState(() => [...DEFAULT_DASHBOARD_MOBILE_SECTIONS]);
  const [mobileHiddenSectionsDraft, setMobileHiddenSectionsDraft] = useState([]);
  const [mobileOverviewAnnouncementSection, setMobileOverviewAnnouncementSection] = useState('ack');
  const [mobileAnnouncementSection, setMobileAnnouncementSection] = useState('all');
  const [mobileTaskSection, setMobileTaskSection] = useState('review');

  const initializeFromPreferences = useCallback(() => {
    const draft = buildDashboardMobileSectionDraft(preferences?.dashboard_mobile_sections);
    setMobileSectionsDraft(draft.order);
    setMobileHiddenSectionsDraft(draft.hidden);
  }, [preferences?.dashboard_mobile_sections]);

  const toggleSectionVisibility = useCallback((sectionKey) => {
    setMobileSectionsDraft((prev) => {
      const isCurrentlyVisible = prev.includes(sectionKey);
      if (isCurrentlyVisible) {
        return prev.filter((key) => key !== sectionKey);
      } else {
        return [...prev, sectionKey];
      }
    });

    setMobileHiddenSectionsDraft((prev) => {
      const isCurrentlyHidden = prev.includes(sectionKey);
      if (isCurrentlyHidden) {
        return prev.filter((key) => key !== sectionKey);
      } else {
        return [...prev, sectionKey];
      }
    });
  }, []);

  const reorderSections = useCallback((fromIndex, toIndex) => {
    setMobileSectionsDraft((prev) => moveArrayItem(prev, fromIndex, toIndex));
  }, []);

  const getVisibleSections = useMemo(() => {
    return mobileSectionsDraft.filter((key) => !mobileHiddenSectionsDraft.includes(key));
  }, [mobileSectionsDraft, mobileHiddenSectionsDraft]);

  return {
    constants: {
      DASHBOARD_MOBILE_TASK_SECTIONS,
      DASHBOARD_MOBILE_VIEW_OPTIONS,
      DASHBOARD_MOBILE_ANNOUNCEMENT_SEGMENTS,
      DASHBOARD_MOBILE_OVERVIEW_ANNOUNCEMENT_SEGMENTS,
      DASHBOARD_MOBILE_TASK_SEGMENTS,
      DASHBOARD_MOBILE_OVERVIEW_SECTION_META,
    },
    state: {
      mobileSectionsDraft,
      mobileHiddenSectionsDraft,
      mobileOverviewAnnouncementSection,
      mobileAnnouncementSection,
      mobileTaskSection,
    },
    setters: {
      setMobileSectionsDraft,
      setMobileHiddenSectionsDraft,
      setMobileOverviewAnnouncementSection,
      setMobileAnnouncementSection,
      setMobileTaskSection,
    },
    actions: {
      initializeFromPreferences,
      toggleSectionVisibility,
      reorderSections,
      getVisibleSections,
    },
  };
}
