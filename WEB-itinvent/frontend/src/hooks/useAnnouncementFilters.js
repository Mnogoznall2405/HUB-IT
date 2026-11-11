import { useMemo } from 'react';

export function useAnnouncementFilters(announcementItems, filters, user) {
  const { q, priority, unreadOnly, ackOnly, pinnedOnly, hasAttachments, myTargetedOnly } = filters;

  const filteredAnnouncements = useMemo(() => {
    const query = String(q || '').trim().toLowerCase();
    return announcementItems.filter((item) => {
      const haystack = [
        item?.title,
        item?.preview,
        item?.recipients_summary,
        item?.author_full_name,
      ].join(' ').toLowerCase();

      if (query && !haystack.includes(query)) return false;
      if (priority && String(item?.priority || '').toLowerCase() !== priority) return false;
      if (unreadOnly && !item?.is_unread) return false;
      if (ackOnly && !item?.is_ack_pending) return false;
      if (pinnedOnly && !item?.is_pinned_active) return false;
      if (hasAttachments && Number(item?.attachments_count || 0) <= 0) return false;
      if (myTargetedOnly && !(item?.audience_scope !== 'all' && (item?.is_targeted_to_viewer || Number(item?.author_user_id) === Number(user?.id)))) return false;
      return true;
    });
  }, [announcementItems, ackOnly, hasAttachments, myTargetedOnly, pinnedOnly, priority, q, unreadOnly, user?.id]);

  const announcementSections = useMemo(() => ([
    {
      key: 'ack',
      title: 'Требуют подтверждения',
      empty: 'Нет заметок, которые нужно подтвердить.',
      items: filteredAnnouncements.filter((item) => item?.is_ack_pending),
    },
    {
      key: 'new',
      title: 'Новые и обновленные',
      empty: 'Нет новых или обновлённых заметок.',
      items: filteredAnnouncements.filter((item) => item?.is_unread),
    },
    {
      key: 'pinned',
      title: 'Закреплённые',
      empty: 'Нет закреплённых заметок.',
      items: filteredAnnouncements.filter((item) => item?.is_pinned_active),
    },
    {
      key: 'all',
      title: 'Все заметки',
      empty: 'По текущим фильтрам заметки не найдены.',
      items: filteredAnnouncements,
    },
  ]), [filteredAnnouncements]);

  const visibleAnnouncementSections = useMemo(() => (
    announcementSections.filter((section) => section.key === 'all' || section.items.length > 0)
  ), [announcementSections]);

  return {
    filteredAnnouncements,
    announcementSections,
    visibleAnnouncementSections,
  };
}
