async page => {
  const items = [
    {
      id: 'demo-file-docx',
      original_file_name: 'Материалы к встрече.docx',
      download_file_name: 'Материалы к встрече.docx',
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      original_size_bytes: 36864,
      stored_size_bytes: 33792,
      saved_size_bytes: 3072,
      retention_days: 7,
      status: 'ready',
      is_shared: true,
      created_at: '2026-08-12T12:30:00Z',
      expires_at: '2026-08-19T12:30:00Z',
    },
    {
      id: 'demo-file-pdf',
      original_file_name: 'Календарь проекта.pdf',
      download_file_name: 'Календарь проекта.pdf',
      mime_type: 'application/pdf',
      original_size_bytes: 1536000,
      stored_size_bytes: 1536000,
      saved_size_bytes: 0,
      retention_days: 7,
      status: 'ready',
      is_shared: false,
      created_at: '2026-08-12T12:29:00Z',
      expires_at: '2026-08-19T12:29:00Z',
    },
    {
      id: 'demo-file-xlsx',
      original_file_name: 'Сводка по этапам.xlsx',
      download_file_name: 'Сводка по этапам.xlsx',
      mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      original_size_bytes: 524288,
      stored_size_bytes: 491520,
      saved_size_bytes: 32768,
      retention_days: 7,
      status: 'ready',
      is_shared: false,
      created_at: '2026-08-12T12:28:00Z',
      expires_at: '2026-08-19T12:28:00Z',
    },
  ];

  await page.context().route('**/api/v1/my-files/quota*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        used_bytes: 2097152,
        limit_bytes: 5368709120,
        remaining_bytes: 5366611968,
      }),
    });
  });
  await page.context().route('**/api/v1/my-files?*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items }),
    });
  });
  return items.length;
}
