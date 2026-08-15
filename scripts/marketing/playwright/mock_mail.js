async page => {
  const mailbox = {
    id: 'demo-mailbox',
    label: 'anton.lebedev@example.com',
    mailbox_email: 'anton.lebedev@example.com',
    mailbox_login: 'anton.lebedev',
    effective_mailbox_login: 'anton.lebedev',
    is_primary: true,
    is_active: true,
    is_selected: true,
    mail_requires_password: false,
    mail_requires_relogin: false,
    mail_is_configured: true,
    unread_count: 3,
  };
  const messages = [
    {
      id: 'demo-mail-1',
      subject: 'Материалы к еженедельной встрече',
      sender: 'marina.orlova@example.com',
      sender_email: 'marina.orlova@example.com',
      sender_display: 'Марина Орлова',
      received_at: '2026-08-12T10:42:00Z',
      is_read: false,
      preview: 'Антон, отправляю обновлённую сводку и вопросы к повестке.',
      body_html: '<p>Антон, отправляю обновлённую сводку и вопросы к повестке.</p>',
      attachments: [],
    },
    {
      id: 'demo-mail-2',
      subject: 'Доступ к общей папке проверен',
      sender: 'kirill.volkov@example.com',
      sender_email: 'kirill.volkov@example.com',
      sender_display: 'Кирилл Волков',
      received_at: '2026-08-12T09:18:00Z',
      is_read: false,
      preview: 'Материалы открываются у всех участников проектной команды.',
      body_html: '<p>Материалы открываются у всех участников проектной команды.</p>',
      attachments: [],
    },
    {
      id: 'demo-mail-3',
      subject: 'Вопросы по поставкам',
      sender: 'elena.sokolova@example.com',
      sender_email: 'elena.sokolova@example.com',
      sender_display: 'Елена Соколова',
      received_at: '2026-08-11T15:06:00Z',
      is_read: false,
      preview: 'Добавила три вопроса для обсуждения на встрече.',
      body_html: '<p>Добавила три вопроса для обсуждения на встрече.</p>',
      attachments: [],
    },
    {
      id: 'demo-mail-4',
      subject: 'Итоги рабочей встречи',
      sender: 'project.office@example.com',
      sender_email: 'project.office@example.com',
      sender_display: 'Проектный офис',
      received_at: '2026-08-11T11:30:00Z',
      is_read: true,
      preview: 'Краткие итоги и список следующих шагов.',
      body_html: '<p>Краткие итоги и список следующих шагов.</p>',
      attachments: [],
    },
  ];
  const payload = {
    selected_mailbox: mailbox,
    mailboxes: [mailbox],
    mailboxInfo: mailbox,
    preferences: {
      preferences: {
        reading_pane: 'right',
        density: 'comfortable',
        mark_read_on_select: false,
        show_preview_snippets: true,
        show_favorites_first: true,
        folder_pane_width: 220,
        message_list_width: 360,
        bottom_list_percent: 42,
      },
    },
    unread_count: 3,
    folder_summary: {
      inbox: { total: 4, unread: 3 },
      sent: { total: 2, unread: 0 },
    },
    folder_tree: {
      items: [
        { id: 'inbox', label: 'Входящие', well_known_key: 'inbox' },
        { id: 'sent', label: 'Отправленные', well_known_key: 'sent' },
        { id: 'drafts', label: 'Черновики', well_known_key: 'drafts' },
      ],
      favorites: ['inbox'],
    },
    messages: {
      items: messages,
      folder: 'inbox',
      limit: 20,
      offset: 0,
      total: messages.length,
      has_more: false,
      next_offset: null,
      search_limited: false,
      searched_window: messages.length,
    },
    state: 'ok',
    source: 'exchange',
    as_of: '2026-08-12T10:45:00Z',
    last_error: '',
  };

  await page.context().route('**/api/v1/mail/bootstrap*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
  });
  await page.context().route('**/api/v1/mail/messages*', async (route) => {
    const detailMatch = route.request().url().match(/\/messages\/([^/?]+)(?:\?|$)/);
    const detail = detailMatch
      ? messages.find((item) => item.id === decodeURIComponent(detailMatch[1]))
      : null;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(detail || payload.messages),
    });
  });
  await page.context().route('**/api/v1/mail/config/me*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mailbox) });
  });
  await page.context().route('**/api/v1/mail/unread-count*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ unread_count: 3, state: 'fresh' }),
    });
  });
  return messages.length;
}
