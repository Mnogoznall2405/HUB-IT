import { useMemo } from 'react';

export function useTaskQueues(taskItems, user) {
  const isAdmin = String(user?.role || '').toLowerCase() === 'admin';

  const reviewQueue = useMemo(() => taskItems.filter((task) => {
    if (String(task?.status || '').toLowerCase() !== 'review') return false;
    return isAdmin
      || Number(task?.created_by_user_id) === Number(user?.id)
      || Number(task?.controller_user_id) === Number(user?.id);
  }), [isAdmin, taskItems, user?.id]);

  const reviewIds = useMemo(() => new Set(reviewQueue.map((item) => String(item?.id || ''))), [reviewQueue]);

  const overdueQueue = useMemo(() => taskItems.filter((task) => task?.is_overdue && !reviewIds.has(String(task?.id || ''))), [reviewIds, taskItems]);

  const overdueIds = useMemo(() => new Set(overdueQueue.map((item) => String(item?.id || ''))), [overdueQueue]);

  const commentQueue = useMemo(() => taskItems.filter((task) => task?.has_unread_comments && !reviewIds.has(String(task?.id || '')) && !overdueIds.has(String(task?.id || ''))), [overdueIds, reviewIds, taskItems]);

  const commentIds = useMemo(() => new Set(commentQueue.map((item) => String(item?.id || ''))), [commentQueue]);

  const otherQueue = useMemo(() => taskItems.filter((task) => !reviewIds.has(String(task?.id || '')) && !overdueIds.has(String(task?.id || '')) && !commentIds.has(String(task?.id || ''))), [commentIds, overdueIds, reviewIds, taskItems]);

  const taskQueues = useMemo(() => ({
    review: reviewQueue,
    overdue: overdueQueue,
    comments: commentQueue,
    other: otherQueue,
  }), [reviewQueue, overdueQueue, commentQueue, otherQueue]);

  return {
    taskQueues,
    reviewQueue,
    overdueQueue,
    commentQueue,
    otherQueue,
  };
}
