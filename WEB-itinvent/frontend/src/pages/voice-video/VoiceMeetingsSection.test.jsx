import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import VoiceMeetingsSection from './VoiceMeetingsSection';

describe('VoiceMeetingsSection: мобильные фильтры (V11)', () => {
  let originalMatchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    window.matchMedia = (query) => ({
      matches: /max-width:\s*599/.test(query),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('по умолчанию сворачивает фильтры, раскрывает их кнопкой', () => {
    render(<VoiceMeetingsSection loading />);

    expect(screen.getByPlaceholderText('Поиск')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Фильтры' })).toBeVisible();
    expect(screen.queryByPlaceholderText('Участник')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Тег')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Фильтры' }));

    expect(screen.getByPlaceholderText('Участник')).toBeVisible();
    expect(screen.getByPlaceholderText('Тег')).toBeVisible();
  });

  it('applies unfinished participant and tag drafts when closing the filter drawer', () => {
    const onParticipantChange = vi.fn();
    const onTagChange = vi.fn();
    render(
      <VoiceMeetingsSection
        loading
        onParticipantChange={onParticipantChange}
        onTagChange={onTagChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Фильтры' }));
    fireEvent.change(screen.getByPlaceholderText('Участник'), { target: { value: 'Иванов' } });
    fireEvent.change(screen.getByPlaceholderText('Тег'), { target: { value: 'охрана' } });
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть фильтры' }));

    expect(onParticipantChange).toHaveBeenCalledWith('Иванов');
    expect(onTagChange).toHaveBeenCalledWith('охрана');
  });

  it('показывает активные фильтры чипами и считает их в кнопке', () => {
    render(
      <VoiceMeetingsSection
        loading
        query="еженедельное"
        unresolvedOnly
        participant="Иван"
        tag="охрана"
        dateFrom="2026-09-01"
      />,
    );

    expect(screen.getByRole('button', { name: 'Фильтры (5)' })).toBeVisible();
    expect(screen.getByText('Поиск: еженедельное')).toBeVisible();
    expect(screen.getByText('Без имени')).toBeVisible();
    expect(screen.getByText('Участник: Иван')).toBeVisible();
    expect(screen.getByText('Тег: охрана')).toBeVisible();
    expect(screen.getByText('Дата от: 2026-09-01')).toBeVisible();
  });

  it('на десктопе оставляет base_filename в title, а не отдельной строкой', () => {
    window.matchMedia = (query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
    const base = 'j123456789012_Еженедельное совещание';

    render(
      <VoiceMeetingsSection
        meetings={[{
          base_filename: base,
          modified_at: '2026-09-29T10:00:00Z',
          segments_count: 4,
          reports: [],
          unresolved_count: 0,
        }]}
      />,
    );

    expect(screen.getByText('Еженедельное совещание')).toHaveAttribute('title', base);
    expect(screen.queryByText(base)).not.toBeInTheDocument();
  });

  it('на мобильном открывает карточку протокола через именованную кнопку', () => {
    const onOpen = vi.fn();
    render(
      <VoiceMeetingsSection
        meetings={[{
          base_filename: 'A_base',
          modified_at: '2026-09-29T10:00:00Z',
          segments_count: 4,
          reports: [],
          unresolved_count: 0,
        }]}
        onOpen={onOpen}
      />,
    );

    const openButton = screen.getByRole('button', { name: 'Открыть протокол A_base' });
    expect(openButton).toBeVisible();
    fireEvent.click(openButton);
    expect(onOpen).toHaveBeenCalledWith('A_base');
  });

  it('добавляет доступное с клавиатуры действие в строку таблицы', () => {
    window.matchMedia = (query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
    const onOpen = vi.fn();
    const base = 'j123456789012_Еженедельное совещание';
    render(
      <VoiceMeetingsSection
        meetings={[{
          base_filename: base,
          modified_at: '2026-09-29T10:00:00Z',
          segments_count: 4,
          reports: [],
          unresolved_count: 0,
        }]}
        onOpen={onOpen}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Открыть протокол Еженедельное совещание' }));
    expect(onOpen).toHaveBeenCalledWith(base);
  });

  it('announces the current sort order as a pressed toggle', () => {
    window.matchMedia = (query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
    const onOrderChange = vi.fn();
    const props = { order: 'desc', onOrderChange };
    const { rerender } = render(<VoiceMeetingsSection {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Фильтры' }));
    const newestButton = screen.getByRole('button', { name: 'Сменить сортировку по дате' });
    expect(newestButton).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(newestButton);
    expect(onOrderChange).toHaveBeenCalledWith('asc');

    rerender(<VoiceMeetingsSection order="asc" onOrderChange={onOrderChange} />);
    expect(screen.getByRole('button', { name: 'Сменить сортировку по дате' }))
      .toHaveAttribute('aria-pressed', 'true');
  });
});

describe('VoiceMeetingsSection: длинные названия протоколов (B2)', () => {
  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  let originalMatchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    window.matchMedia = (query) => ({
      matches: /max-width:\s*599/.test(query),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  });

  it('clamps a long protocol name inside the mobile card width', () => {
    const longName = 'Еженедельное совещание отдела эксплуатации '.repeat(10);
    const base = `j123456789012_${longName}`;

    render(
      <VoiceMeetingsSection
        meetings={[{
          base_filename: base,
          modified_at: '2026-09-29T10:00:00Z',
          segments_count: 4,
          reports: [],
          unresolved_count: 0,
        }]}
      />,
    );

    const button = screen.getByRole('button', {
      name: /^Открыть протокол Еженедельное совещание отдела эксплуатации/,
    });
    const style = window.getComputedStyle(button);
    expect(style.minWidth).toBe('0');
    expect(style.maxWidth).toBe('100%');
    expect(style.overflow).toBe('hidden');
    expect(style.textOverflow).toBe('ellipsis');
    expect(style.whiteSpace).toBe('nowrap');
  });

  it('clamps a long protocol name inside the desktop card', () => {
    window.matchMedia = () => ({
      matches: false,
      media: '',
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
    const longName = 'Еженедельное совещание отдела эксплуатации '.repeat(10);
    const base = `j123456789012_${longName}`;

    render(
      <VoiceMeetingsSection
        meetings={[{
          base_filename: base,
          modified_at: '2026-09-29T10:00:00Z',
          segments_count: 4,
          reports: [],
          unresolved_count: 0,
        }]}
      />,
    );

    const button = screen.getByRole('button', {
      name: /^Открыть протокол Еженедельное совещание отдела эксплуатации/,
    });
    const style = window.getComputedStyle(button);
    expect(style.maxWidth).toBe('100%');
    expect(style.overflow).toBe('hidden');
    expect(style.textOverflow).toBe('ellipsis');
    expect(style.whiteSpace).toBe('nowrap');
  });
});

describe('VoiceMeetingsSection: подписи фильтров (T18)', () => {
  let originalMatchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    window.matchMedia = () => ({
      matches: false,
      media: '',
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('puts accessible names on filter inputs and labels dates explicitly', () => {
    render(<VoiceMeetingsSection />);

    expect(screen.getByRole('textbox', { name: 'Поиск протоколов' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Фильтры' }));
    expect(screen.getByRole('textbox', { name: 'Фильтр по участнику' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Фильтр по тегу' })).toBeVisible();
    expect(screen.getByLabelText('Дата от')).toBeVisible();
    expect(screen.getByLabelText('Дата до')).toBeVisible();
  });
});

describe('VoiceMeetingsSection: компактная панель инструментов (T21)', () => {
  let originalMatchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    window.matchMedia = (query) => ({
      matches: /max-width:\s*599/.test(query),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('hides the filter counter while no filter is active and keeps it when it is', () => {
    const { rerender } = render(<VoiceMeetingsSection loading />);

    expect(screen.getByRole('button', { name: 'Фильтры' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Фильтры \(\d\)/ })).not.toBeInTheDocument();

    rerender(<VoiceMeetingsSection loading participant="Иванов" />);
    expect(screen.getByRole('button', { name: 'Фильтры (1)' })).toBeVisible();
  });

  it('keeps search, filters and sort on one wrapping toolbar row', () => {
    render(<VoiceMeetingsSection loading />);

    const toolbar = screen.getByRole('button', { name: 'Фильтры' }).closest('.MuiBox-root');
    const style = window.getComputedStyle(toolbar);

    expect(style.display).toBe('flex');
    expect(style.flexWrap).toBe('nowrap');
    expect(toolbar.querySelector('input[placeholder="Поиск"]')).toBeInTheDocument();
  });

  it('moves the ZIP export and sort order into the overflow menu with the export count', () => {
    render(<VoiceMeetingsSection loading exportCount={25} exportMaxMeetings={20} />);

    expect(screen.queryByRole('button', { name: /Экспорт ZIP/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Сменить сортировку по дате' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Действия со списком протоколов' }));

    expect(screen.getByRole('menuitem', { name: /Экспорт ZIP/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Экспорт ZIP/ })).toHaveTextContent('20 из 25');
    expect(screen.getByRole('menuitem', { name: /Сортировка по дате/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /ограничен 20 протокол/ })).toBeInTheDocument();
  });

  it('reports an unavailable export count inside the overflow menu instead of an alert', () => {
    render(<VoiceMeetingsSection loading exportCountError exportCount={null} />);

    expect(screen.queryByText(/Количество протоколов недоступно/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Действия со списком протоколов' }));

    expect(screen.getByRole('menuitem', { name: /Экспорт ZIP/ })).toHaveTextContent('Количество протоколов недоступно');
  });

  it('keeps active filter chips on a single row without wrapping', () => {
    render(<VoiceMeetingsSection loading participant="Иванов" tag="охрана" />);

    const chips = screen.getByLabelText('Активные фильтры');
    const style = window.getComputedStyle(chips);

    expect(style.display).toBe('flex');
    expect(style.flexWrap).toBe('nowrap');
    expect(chips.scrollWidth).toBeLessThanOrEqual(chips.clientWidth);
  });

  it('shows the export limit inside the export item instead of a disabled row (N16)', () => {
    render(<VoiceMeetingsSection loading exportCount={25} exportMaxMeetings={20} />);

    fireEvent.click(screen.getByRole('button', { name: 'Действия со списком протоколов' }));

    const exportItem = screen.getByRole('menuitem', { name: /Экспорт ZIP/ });
    expect(exportItem).toHaveTextContent(/ограничен 20 протокол/);
    // Отдельного выключенного пункта с примечанием больше нет.
    const disabledItems = screen.getAllByRole('menuitem')
      .filter((el) => el.classList.contains('Mui-disabled'));
    expect(disabledItems).toHaveLength(0);
  });

  it('uses a short search placeholder that fits the mobile toolbar (N16)', () => {
    render(<VoiceMeetingsSection loading />);

    expect(screen.getByPlaceholderText('Поиск')).toBeInTheDocument();
  });

  it('anchors the desktop filters popover to the toolbar button when opened from the overflow menu (N15)', async () => {
    // Десктопный вьюпорт: панель фильтров — Popover с якорем.
    window.matchMedia = (query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(<VoiceMeetingsSection loading />);

      fireEvent.click(screen.getByRole('button', { name: 'Действия со списком протоколов' }));
      fireEvent.click(screen.getByRole('menuitem', { name: /^Фильтры/ }));

      await screen.findByRole('dialog', { name: 'Фильтры' });
      const anchorWarnings = errorSpy.mock.calls
        .map((args) => args.map(String).join(' '))
        .filter((msg) => msg.includes('anchorEl'));
      expect(anchorWarnings).toEqual([]);
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe('VoiceMeetingsSection: плотные строки протоколов (T22)', () => {
  const meeting = {
    base_filename: 'j123456789012_Еженедельное совещание',
    modified_at: '2026-09-29T10:00:00Z',
    segments_count: 4,
    reports: [{ ext: 'html' }, { ext: 'docx' }],
    unresolved_count: 0,
    tags: [],
    project: '',
  };

  let originalMatchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    window.matchMedia = (query) => ({
      matches: /max-width:\s*599/.test(query),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('keeps a two-line mobile card with name, meta line and a single overflow menu', () => {
    render(<VoiceMeetingsSection meetings={[meeting]} canManage onDelete={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Открыть протокол Еженедельное совещание' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Удалить протокол' })).not.toBeInTheDocument();
    expect(screen.queryByText(/отчёты: html, docx/)).not.toBeInTheDocument();

    const actions = screen.getByRole('button', { name: 'Действия с протоколом Еженедельное совещание' });
    expect(actions).toHaveAttribute('aria-haspopup', 'menu');
  });

  it('moves the mobile delete action into the protocol overflow menu', () => {
    const onDelete = vi.fn();
    render(<VoiceMeetingsSection meetings={[meeting]} canManage onDelete={onDelete} />);

    fireEvent.click(screen.getByRole('button', { name: 'Действия с протоколом Еженедельное совещание' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить протокол' }));

    expect(onDelete).toHaveBeenCalledWith(meeting);
  });

  it('keeps tags on one line and reports the rest as a plus counter', () => {
    render(<VoiceMeetingsSection
      meetings={[{ ...meeting, tags: ['один', 'два', 'три', 'четыре'], project: 'Проект' }]}
      canManage
    />);

    expect(screen.getByText('Проект')).toBeVisible();
    expect(screen.getByText('один')).toBeVisible();
    expect(screen.queryByText('четыре')).not.toBeInTheDocument();
    // T45: на xs видно не больше двух чипов тегов, остаток — «+N».
    expect(screen.getByText('+3')).toBeVisible();
  });

  it('desktop: карточки в списке по месяцам, у каждой дата, название без служебного префикса и меню действий', () => {
    window.matchMedia = (query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
    render(
      <VoiceMeetingsSection
        meetings={[
          { ...meeting, base_filename: 'j123456789012_2026-09-25_Планерка_Магадан', speaker_names: ['Иванов И.И.', 'Петрова А.С.'] },
          { ...meeting, base_filename: '2026-08-30_Совет', speaker_names: [] },
        ]}
        canManage
        onDelete={vi.fn()}
      />,
    );

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Сентябрь 2026' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Август 2026' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    // Дата берётся из названия; название — без даты и подчёркиваний.
    expect(screen.getByText('Планерка Магадан')).toBeInTheDocument();
    expect(screen.getByText(/Иванов И\.И\., Петрова А\.С\./)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Действия с протоколом/ })).toHaveLength(2);
  });

  it('отчёты доступны из меню «⋮» карточки', () => {
    window.matchMedia = (query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
    render(<VoiceMeetingsSection meetings={[meeting]} canManage onDelete={vi.fn()} />);

    expect(screen.queryByText(/html, docx/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Действия с протоколом Еженедельное совещание' }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: /html/ })).toBeInTheDocument();
  });

  it('opens the protocol by name and by card click', () => {
    window.matchMedia = (query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
    const onOpen = vi.fn();
    render(<VoiceMeetingsSection meetings={[meeting]} onOpen={onOpen} />);

    fireEvent.click(screen.getByRole('button', { name: 'Открыть протокол Еженедельное совещание' }));
    expect(onOpen).toHaveBeenCalledWith(meeting.base_filename);

    fireEvent.click(screen.getByRole('listitem'));
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('limits desktop tag chips to three with a plus counter (N14)', () => {
    window.matchMedia = (query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
    render(<VoiceMeetingsSection
      meetings={[{ ...meeting, tags: ['один', 'два', 'три', 'четыре'], project: 'Проект' }]}
      canManage
    />);

    // Десктоп: как на мобильном — проект плюс не более трёх чипов, остаток «+N».
    expect(screen.getByText('Проект')).toBeVisible();
    expect(screen.getByText('один')).toBeVisible();
    expect(screen.getByText('два')).toBeVisible();
    expect(screen.queryByText('три')).not.toBeInTheDocument();
    expect(screen.queryByText('четыре')).not.toBeInTheDocument();
    expect(screen.getByText('+2')).toBeVisible();
  });

  it('keeps the mobile meta line compact: no seconds, status as a title chip (N14, N18)', () => {
    render(<VoiceMeetingsSection meetings={[{ ...meeting, unresolved_count: 2 }]} />);

    // Статус «нужны имена» — текстовый чип рядом с названием (T45):
    // мета-строка его не съедает усечением на 320 px.
    const chip = screen.getByText(/Нужны имена · 2/);
    expect(chip).toBeVisible();

    const meta = screen.getByText(/реплик/);
    // Время без секунд: «29.09.2026, 13:00», а не «13:00:00» — строка короче.
    expect(meta.textContent).not.toMatch(/\d{2}:\d{2}:\d{2}/);
    expect(meta.textContent).not.toContain('без имени');
  });

  it('lets mobile tag chips shrink so the plus counter stays visible (N18)', () => {
    render(<VoiceMeetingsSection
      meetings={[{ ...meeting, tags: ['графический-отдел-очень-длинный', 'второй-длинный-тег', 'третий'], project: 'Проект' }]}
    />);

    // Чипы тегов сжимаются (flex 0 1 auto + minWidth 0) — строка не режется
    // посреди чипа; «+N» с flex '0 0 auto' остаётся видимым на 320 px.
    const tagChip = screen.getByText('графический-отдел-очень-длинный').closest('.MuiChip-root');
    expect(tagChip.style.flexShrink).toBe('1');
    expect(tagChip.style.minWidth).toBe('0');
    const plus = screen.getByText('+2').closest('.MuiChip-root');
    expect(plus.style.flexShrink).toBe('0');
  });

  it('does not spend the mobile meta line on the all-resolved filler (N14)', () => {
    render(<VoiceMeetingsSection meetings={[meeting]} />);

    expect(screen.queryByText(/Все имена заданы/)).not.toBeInTheDocument();
    expect(screen.getByText(/4 реплики/)).toBeInTheDocument();
  });

  it('limits xs tag chips to two with a plus counter (T45)', () => {
    render(<VoiceMeetingsSection
      meetings={[{ ...meeting, tags: ['один', 'два', 'три', 'четыре'], project: 'Проект' }]}
      canManage
    />);

    // На xs — не больше двух чипов + «+N» (T45), без усечённых подписей.
    expect(screen.getByText('Проект')).toBeVisible();
    expect(screen.getByText('один')).toBeVisible();
    expect(screen.queryByText('два')).not.toBeInTheDocument();
    expect(screen.getByText('+3')).toBeVisible();
  });
});

describe('VoiceMeetingsSection: статус обработки в строке (T45)', () => {
  const meeting = {
    base_filename: 'j123456789012_Еженедельное совещание',
    modified_at: '2026-09-29T10:00:00Z',
    segments_count: 4,
    reports: [{ ext: 'html' }],
    unresolved_count: 0,
    tags: [],
    project: '',
  };

  let originalMatchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    // Десктопная таблица: статус — отдельный чип в строке.
    window.matchMedia = (query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('shows a text status chip per protocol row', () => {
    const m2 = { ...meeting, base_filename: 'j123456789012_Вторая', unresolved_count: 2 };
    const m3 = { ...meeting, base_filename: 'j123456789012_Третья' };
    const m4 = { ...meeting, base_filename: 'j123456789012_Четвёртая' };
    render(
      <VoiceMeetingsSection
        meetings={[meeting, m2, m3, m4]}
        jobs={[
          { id: 'j1', base_filename: meeting.base_filename, status: 'processing' },
          { id: 'j2', base_filename: m3.base_filename, status: 'failed' },
        ]}
      />,
    );

    // Статус — текстовый чип, не только цвет.
    const statuses = screen.getAllByTestId('meeting-status').map((el) => el.textContent);
    expect(statuses).toEqual(['В обработке', 'Нужны имена · 2', 'Ошибка', 'Готово']);
  });

  it('marks a queued job as «В обработке» too', () => {
    render(
      <VoiceMeetingsSection
        meetings={[meeting]}
        jobs={[{ id: 'j1', base_filename: meeting.base_filename, status: 'queued' }]}
      />,
    );
    expect(screen.getByTestId('meeting-status')).toHaveTextContent('В обработке');
  });
});


describe('VoiceMeetingsSection: плотные поля фильтров (T24)', () => {
  let originalMatchMedia;
  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    window.matchMedia = (query) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  });
  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('keeps every filter field at most 44px tall with a non-wrapping label', () => {
    render(<VoiceMeetingsSection meetings={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Фильтры' }));

    const fields = screen.getAllByRole('textbox')
      .filter((el) => el.closest('.MuiFormControl-root'));
    expect(fields.length).toBeGreaterThan(0);
    for (const field of fields) {
      const control = field.closest('.MuiFormControl-root');
      expect(control).toHaveStyle({ maxHeight: '44px' });
      const label = control.querySelector('label');
      if (label) expect(getComputedStyle(label).whiteSpace).toBe('nowrap');
    }
  });
});