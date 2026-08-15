async page => {
  const items = [
    {
      full_name: 'Марина Орлова',
      department: 'Финансовая служба',
      department_location: 'Екатеринбург',
      position: 'Ведущий специалист',
      age: 34,
      work_phones: [{ kind: 'Рабочий телефон', value: '+7 (000) 100-20-30', normalized: '70001002030' }],
      personal_phones: [{ kind: 'Мобильный телефон', value: '+7 (000) 300-40-50', normalized: '70003004050' }],
      work_emails: [{ kind: 'Корпоративный E-mail', value: 'marina.orlova@example.com', normalized: 'marina.orlova@example.com' }],
      personal_emails: [],
    },
    {
      full_name: 'Кирилл Волков',
      department: 'IT-поддержка',
      department_location: 'Екатеринбург',
      position: 'Инженер поддержки',
      age: 29,
      work_phones: [{ kind: 'Рабочий телефон', value: '+7 (000) 110-21-31', normalized: '70001102131' }],
      personal_phones: [],
      work_emails: [{ kind: 'Корпоративный E-mail', value: 'kirill.volkov@example.com', normalized: 'kirill.volkov@example.com' }],
      personal_emails: [],
    },
    {
      full_name: 'Елена Соколова',
      department: 'Отдел снабжения',
      department_location: 'Тюмень',
      position: 'Специалист по снабжению',
      age: 31,
      work_phones: [{ kind: 'Рабочий телефон', value: '+7 (000) 120-22-32', normalized: '70001202232' }],
      personal_phones: [],
      work_emails: [{ kind: 'Корпоративный E-mail', value: 'elena.sokolova@example.com', normalized: 'elena.sokolova@example.com' }],
      personal_emails: [],
    },
    {
      full_name: 'Антон Лебедев',
      department: 'Проектный офис',
      department_location: 'Екатеринбург',
      position: 'Координатор проектов',
      age: 36,
      work_phones: [{ kind: 'Рабочий телефон', value: '+7 (000) 130-23-33', normalized: '70001302333' }],
      personal_phones: [],
      work_emails: [{ kind: 'Корпоративный E-mail', value: 'anton.lebedev@example.com', normalized: 'anton.lebedev@example.com' }],
      personal_emails: [],
    },
  ];
  const updatedAt = '2026-08-12T10:45:00Z';

  await page.context().route('**/api/v1/address-book/search*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items, total: items.length, limit: 50, updated_at: updatedAt, last_error: '' }),
    });
  });
  await page.context().route('**/api/v1/address-book/status*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ count: items.length, updated_at: updatedAt, last_error: '', sync_in_progress: false }),
    });
  });
  return items.length;
}
