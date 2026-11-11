async page => {
  const user = {
    id: 'marketing-demo-viewer',
    username: 'marketing_demo_viewer',
    full_name: 'Антон Лебедев',
    position: 'Координатор проектов',
    department: 'Проектный офис',
    role: 'viewer',
    use_custom_permissions: false,
    permissions: [
      'dashboard.read',
      'tasks.read',
      'tasks.create',
      'chat.read',
      'chat.write',
      'mail.access',
      'docflow.read',
      'address_book.read',
      'company_structure.read',
      'my_files.read',
      'settings.read',
    ],
  };

  const json = (route, body) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });

  await page.context().route('**/api/v1/**', (route) => json(route, {}));
  await page.context().route('**/api/v1/auth/me*', (route) => json(route, user));
  await page.context().route('**/api/v1/settings/me*', (route) => json(route, {
    theme_mode: 'dark',
    font_family: 'Segoe UI',
    font_scale: 1,
    dashboard_sections: ['attention', 'tasks', 'absences', 'communication', 'news'],
  }));
  await page.context().route('**/api/v1/hub/dashboard*', (route) => json(route, {
    announcements: { items: [], total: 0 },
    my_tasks: { items: [], total: 0 },
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
  }));
  await page.context().route('**/api/v1/mail/unread-count*', (route) => json(route, {
    unread_count: 3,
    state: 'fresh',
  }));
  await page.context().route('**/api/v1/chat/unread*', (route) => json(route, { count: 1 }));
  await page.context().route('**/api/v1/notifications/**', (route) => json(route, { items: [], total: 0 }));

  await page.goto('http://127.0.0.1:4174/login');
  await page.evaluate((payload) => {
    localStorage.setItem('user', JSON.stringify(payload));
    localStorage.setItem('web_preferences_cache', JSON.stringify({
      theme_mode: 'dark',
      font_family: 'Segoe UI',
      font_scale: 1,
      dashboard_sections: ['attention', 'tasks', 'absences', 'communication', 'news'],
    }));
  }, user);
  return user.username;
}
