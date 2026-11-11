async page => {
  await page.context().route('**/api/v1/settings/me*', async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    await route.fulfill({
      response,
      json: {
        ...payload,
        theme_mode: 'dark',
        font_family: 'Segoe UI',
        font_scale: 1,
        dashboard_sections: ['attention', 'tasks', 'absences', 'communication', 'news'],
      },
    });
  });
  await page.context().route('**/api/v1/hub/dashboard*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        announcements: {
          items: [
            {
              id: 'demo-news-1',
              title: 'Обновили пространство проектной команды',
              preview: 'Материалы, задачи и обсуждения теперь собраны в одном месте.',
              is_ack_pending: false,
              updated_at: '2026-08-12T08:00:00Z',
            },
          ],
          total: 1,
        },
        my_tasks: {
          items: [
            {
              id: 'demo-task-1',
              title: 'Подготовить материалы к еженедельной встрече',
              status: 'open',
              due_at: '2026-08-18T12:30:00Z',
              priority: 'high',
              assignee_full_name: 'Марина Орлова',
              created_by_full_name: 'Антон Лебедев',
              is_overdue: false,
              has_unread_comments: true,
            },
          ],
          total: 1,
        },
        unread_counts: { notifications_unread_total: 3 },
        summary: {},
        absences_today: {
          count: 2,
          items: [
            {
              id: 'demo-absence-1',
              display_name: 'Ольга Романова',
              department: 'Проектный офис',
              kind: 'business_trip',
              kind_label: 'Командировка',
              starts_on: '2026-08-11',
              ends_on: '2026-08-13',
            },
            {
              id: 'demo-absence-2',
              display_name: 'Денис Фомин',
              department: 'Отдел снабжения',
              kind: 'vacation',
              kind_label: 'Отпуск',
              starts_on: '2026-08-10',
              ends_on: '2026-08-14',
            },
          ],
        },
      }),
    });
  });
  await page.context().route('**/api/v1/mail/unread-count*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ unread_count: 3, state: 'fresh' }),
    });
  });
  await page.evaluate(() => localStorage.removeItem('web_preferences_cache'));
  return true;
}
