import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import VoiceMeetingDrawer from './VoiceMeetingDrawer';
import { voiceJobsAPI } from '../../api/voiceJobs';
import { stashMailComposePrefill } from '../../lib/mailComposePrefill';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../../api/voiceJobs', () => ({
  voiceJobsAPI: {
    getTranscript: vi.fn(),
    getTopics: vi.fn(),
    getAssignments: vi.fn(),
    getAssignmentStatuses: vi.fn(),
    assignSpeakers: vi.fn(),
    updateMeetingMeta: vi.fn(),
    createShareLink: vi.fn(),
    revokeShareLink: vi.fn(),
    mediaUrl: vi.fn((base) => `/api/v1/voice/meetings/${base}/media`),
    speakerSampleUrl: vi.fn((base, sp) => `/api/v1/voice/meetings/${base}/speakers/${sp}/sample`),
    reportUrl: vi.fn((base, name) => `/api/v1/voice/meetings/${base}/reports/${name}`),
    clipUrl: vi.fn((base, name) => `/api/v1/voice/meetings/${base}/clips/${name}`),
  },
}));

vi.mock('../../api/hubTaskSupport', () => ({
  hubTaskSupportAPI: { getAssignees: vi.fn().mockResolvedValue({ items: [] }) },
}));

vi.mock('../../api/hubTasks', () => ({
  hubTasksAPI: { createTask: vi.fn().mockResolvedValue({}) },
}));

vi.mock('../../lib/mailComposePrefill', () => ({
  stashMailComposePrefill: vi.fn(),
}));

// T47: виртуальный список — в тестах рендерим окно из 80 строк вокруг
// последней цели scrollToItem; вызовы скролла записываем в __vlistCalls.
globalThis.__vlistCalls = { scrollToItem: [], scrollTo: [] };
vi.mock('react-window', () => {
  const W = 80;
  const List = React.forwardRef((props, ref) => {
    const { height, width, itemCount, itemData, itemKey, children: Row, onItemsRendered } = props;
    const [start, setStart] = React.useState(0);
    const stop = Math.min(itemCount - 1, start + W - 1);
    React.useImperativeHandle(ref, () => ({
      scrollToItem: (i) => {
        globalThis.__vlistCalls.scrollToItem.push(i);
        setStart(Math.max(0, Math.min(i - 5, Math.max(0, itemCount - W))));
      },
      scrollTo: (o) => globalThis.__vlistCalls.scrollTo.push(o),
      resetAfterIndex: () => {},
    }));
    React.useEffect(() => {
      onItemsRendered?.({ overscanStartIndex: start, overscanStopIndex: stop, visibleStartIndex: start, visibleStopIndex: stop });
    }, [start, stop]);
    const rows = [];
    for (let i = start; i <= stop; i += 1) {
      rows.push(React.createElement(Row, { key: itemKey ? itemKey(i, itemData) : i, index: i, style: {}, data: itemData }));
    }
    return <div data-vlist style={{ height, width, overflowY: 'auto' }}>{rows}</div>;
  });
  return { VariableSizeList: List, FixedSizeList: List };
});
vi.mock('react-virtualized-auto-sizer', () => ({
  default: ({ children }) => children({ width: 800, height: 600 }),
}));

const makeMeeting = (base, extra = {}) => ({
  base_filename: base,
  reports: [],
  speakers: { resolved: [], unresolved: [] },
  media_parts: [],
  jobs: [],
  has_media: false,
  segments_count: 1,
  ...extra,
});

// Действия шапки карточки перенесены в меню «⋮» (T23).
const openMeetingMenu = () => fireEvent.click(
  screen.getByRole('button', { name: 'Действия с протоколом' }),
);
describe('VoiceMeetingDrawer: публичная ссылка (V12)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    voiceJobsAPI.getTranscript.mockResolvedValue({ segments: [], total: 0 });
    voiceJobsAPI.getTopics.mockResolvedValue({ items: [] });
    voiceJobsAPI.getAssignments.mockResolvedValue({ items: [] });
    voiceJobsAPI.getAssignmentStatuses.mockResolvedValue({ items: [] });
    voiceJobsAPI.createShareLink.mockResolvedValue({ token: 'just-created-token' });
    voiceJobsAPI.revokeShareLink.mockResolvedValue({ revoked: true });
  });

  it('allows revoking the public link just created in the dialog', async () => {
    render(
      <VoiceMeetingDrawer
        open
        meeting={makeMeeting('A_base')}
        onClose={vi.fn()}
        canManage
        voices={[]}
      />,
    );

    openMeetingMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Поделиться ссылкой' }));
    const internalUrl = `${window.location.origin}/voice?meeting=A_base`;
    expect(screen.getByDisplayValue(internalUrl)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Копировать ссылку на протокол' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Создать ссылку' }));
    const publicLink = await screen.findByDisplayValue(/public\/just-created-token/);
    expect(publicLink).not.toHaveValue(internalUrl);

    fireEvent.click(screen.getByRole('button', { name: 'Отозвать публичную ссылку 1' }));
    await waitFor(() => {
      expect(voiceJobsAPI.revokeShareLink).toHaveBeenCalledWith('just-created-token');
    });
    expect(await screen.findByText('Ссылка отозвана')).toBeInTheDocument();
  });

  it('keeps every public link created in the dialog available for revocation', async () => {
    voiceJobsAPI.createShareLink
      .mockResolvedValueOnce({ token: 'first-token' })
      .mockResolvedValueOnce({ token: 'second-token' });
    render(
      <VoiceMeetingDrawer
        open
        meeting={makeMeeting('A_base')}
        onClose={vi.fn()}
        canManage
        voices={[]}
      />,
    );

    openMeetingMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Поделиться ссылкой' }));
    fireEvent.click(screen.getByRole('button', { name: 'Создать ссылку' }));
    await screen.findByDisplayValue(/public\/first-token/);
    fireEvent.click(screen.getByRole('button', { name: 'Создать ещё одну' }));
    await screen.findByDisplayValue(/public\/second-token/);

    expect(screen.getByDisplayValue(/public\/first-token/)).toBeInTheDocument();
    expect(screen.getByDisplayValue(/public\/second-token/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Отозвать публичную ссылку 1' }));
    await waitFor(() => {
      expect(voiceJobsAPI.revokeShareLink).toHaveBeenNthCalledWith(1, 'first-token');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Отозвать публичную ссылку 2' }));
    await waitFor(() => {
      expect(voiceJobsAPI.revokeShareLink).toHaveBeenNthCalledWith(2, 'second-token');
    });
  });

  it('shows an error and keeps the link available when revocation fails', async () => {
    voiceJobsAPI.revokeShareLink.mockRejectedValue(Object.assign(new Error('Failed'), {
      response: { data: { detail: 'Не удалось отозвать ссылку' } },
    }));
    render(
      <VoiceMeetingDrawer
        open
        meeting={makeMeeting('A_base')}
        onClose={vi.fn()}
        canManage
        voices={[]}
      />,
    );

    openMeetingMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Поделиться ссылкой' }));
    fireEvent.click(screen.getByRole('button', { name: 'Создать ссылку' }));
    const publicLink = await screen.findByDisplayValue(/public\/just-created-token/);
    fireEvent.click(screen.getByRole('button', { name: 'Отозвать публичную ссылку 1' }));

    expect(await screen.findByText('Не удалось отозвать ссылку')).toBeInTheDocument();
    expect(publicLink).toBeInTheDocument();
  });

  it('shows a separate internal URL and uses it in the protocol email', async () => {
    render(
      <VoiceMeetingDrawer
        open
        meeting={makeMeeting('A_base')}
        onClose={vi.fn()}
        canManage
        voices={[]}
      />,
    );

    openMeetingMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Поделиться ссылкой' }));
    expect(screen.getByText('Для вошедших')).toBeInTheDocument();
    expect(screen.getByText('Публичная ссылка без входа')).toBeInTheDocument();
    expect(screen.getByDisplayValue(`${window.location.origin}/voice?meeting=A_base`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Копировать ссылку на протокол' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Поделиться протоколом' })).not.toBeInTheDocument();
    });

    openMeetingMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Отправить протокол письмом' }));
    await waitFor(() => expect(stashMailComposePrefill).toHaveBeenCalled());
    expect(stashMailComposePrefill.mock.calls.at(-1)[0].bodyPlain)
      .toContain(`${window.location.origin}/voice?meeting=A_base`);
  });

  it('warns before closing the dialog with an active public link', async () => {
    render(
      <VoiceMeetingDrawer
        open
        meeting={makeMeeting('A_base')}
        onClose={vi.fn()}
        canManage
        voices={[]}
      />,
    );

    openMeetingMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Поделиться ссылкой' }));
    fireEvent.click(screen.getByRole('button', { name: 'Создать ссылку' }));
    await screen.findByDisplayValue(/public\/just-created-token/);
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));

    expect(await screen.findByText(/неотозванная ссылка останется активной/i)).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Поделиться протоколом' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть без отзыва' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Поделиться протоколом' })).not.toBeInTheDocument();
    });
  });

  it('uses a readable fallback when share-link validation details are not strings', async () => {
    voiceJobsAPI.createShareLink.mockRejectedValueOnce(Object.assign(new Error('Bad request'), {
      response: { data: { detail: [{ msg: 'Invalid expiration' }] } },
    }));
    render(
      <VoiceMeetingDrawer
        open
        meeting={makeMeeting('A_base')}
        onClose={vi.fn()}
        canManage
        voices={[]}
      />,
    );

    openMeetingMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Поделиться ссылкой' }));
    fireEvent.click(screen.getByRole('button', { name: 'Создать ссылку' }));

    expect(await screen.findByText('Не удалось создать ссылку')).toBeInTheDocument();
  });

  it('сбрасывает ссылки диалога «Поделиться» при смене встречи (N17)', async () => {
    const props = { open: true, onClose: vi.fn(), canManage: true, voices: [] };
    const { rerender } = render(
      <VoiceMeetingDrawer meeting={makeMeeting('A_base')} {...props} />,
    );

    openMeetingMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Поделиться ссылкой' }));
    fireEvent.click(screen.getByRole('button', { name: 'Создать ссылку' }));
    await screen.findByDisplayValue(/public\/just-created-token/);

    // Переход Назад/Вперёд между двумя протоколами: ссылки встречи A
    // не должны протекать в карточку встречи B.
    await act(async () => {
      rerender(<VoiceMeetingDrawer meeting={makeMeeting('B_base')} {...props} />);
    });

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Поделиться протоколом' })).not.toBeInTheDocument();
    });
    expect(screen.queryByDisplayValue(/public\//)).not.toBeInTheDocument();

    openMeetingMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Поделиться ссылкой' }));
    const shareDialog = await screen.findByRole('dialog', { name: 'Поделиться протоколом' });
    expect(within(shareDialog).queryByDisplayValue(/public\//)).not.toBeInTheDocument();
    expect(within(shareDialog).queryByText(/неотозванн/i)).not.toBeInTheDocument();
  });
});

const unresolvedSpeakers = {
  resolved: [],
  unresolved: [{ speaker: 'S1', has_sample: false, first_segment_start: 0 }],
};

const segA = {
  segments: [{ speaker: 'S1', text: 'реплика из встречи А', start: 0, start_time_formatted: '00:00' }],
  total: 1,
};
const segB = {
  segments: [{ speaker: 'S2', text: 'реплика из встречи B', start: 0, start_time_formatted: '00:00' }],
  total: 1,
};

describe('VoiceMeetingDrawer: транскрипт привязан к встрече', () => {
  let resolvers;

  beforeEach(() => {
    vi.clearAllMocks();
    resolvers = new Map();
    voiceJobsAPI.getTranscript.mockImplementation((base, _params, options) => new Promise((resolve, reject) => {
      resolvers.set(base, { resolve, reject });
      options?.signal?.addEventListener('abort', () => {
        const err = new Error('canceled');
        err.name = 'CanceledError';
        err.code = 'ERR_CANCELED';
        reject(err);
      });
    }));
    voiceJobsAPI.getTopics.mockResolvedValue({ items: [] });
    voiceJobsAPI.getAssignments.mockResolvedValue({ items: [] });
    voiceJobsAPI.getAssignmentStatuses.mockResolvedValue({ items: [] });
  });

  it('не показывает реплики встречи A в карточке встречи B при смене base до ответа', async () => {
    const props = { open: true, onClose: vi.fn(), canManage: false, voices: [] };
    const { rerender } = render(<VoiceMeetingDrawer meeting={makeMeeting('A_base')} {...props} />);
    // Транскрипт грузится при открытии карточки — отдельной вкладки не нужно (T28).
    await waitFor(() => {
      expect(voiceJobsAPI.getTranscript.mock.calls.map((c) => c[0])).toContain('A_base');
    });

    // Смена встречи до ответа на транскрипт A.
    rerender(<VoiceMeetingDrawer meeting={makeMeeting('B_base')} {...props} />);

    // Поздний ответ транскрипта A приходит уже для карточки B.
    await act(async () => {
      resolvers.get('A_base')?.resolve(segA);
    });

    await waitFor(() => {
      expect(voiceJobsAPI.getTranscript.mock.calls.map((c) => c[0])).toContain('B_base');
    });
    await act(async () => {
      resolvers.get('B_base')?.resolve(segB);
    });
    await screen.findByText(/реплика из встречи B/);
    expect(screen.queryByText(/реплика из встречи А/)).not.toBeInTheDocument();
  });
});

describe('VoiceMeetingDrawer: сброс состояния и обратная связь (V06)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    voiceJobsAPI.getAssignments.mockResolvedValue({ items: [] });
    voiceJobsAPI.getAssignmentStatuses.mockResolvedValue({ items: [] });
    voiceJobsAPI.assignSpeakers.mockResolvedValue({});
  });

  it('сообщение об успехе переживает обновление meeting, мета-поля синхронизируются', async () => {
    const props = { open: true, onClose: vi.fn(), canManage: true, voices: [], onAssigned: vi.fn() };
    const { rerender } = render(<VoiceMeetingDrawer
      meeting={makeMeeting('A_base', { speakers: unresolvedSpeakers, web_meta: { tags: [], project: '' } })}
      {...props}
    />);
    fireEvent.click(screen.getByRole('tab', { name: /Участники/ }));
    fireEvent.change(screen.getByPlaceholderText('Выберите из списка или впишите имя'), {
      target: { value: 'Иван Иванов' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Сохранить имена/ }));
    await screen.findByText(/переименование поставлен/);

    // Обновление meeting той же встречи (новая ссылка на web_meta) не должно стирать сообщение.
    rerender(<VoiceMeetingDrawer
      meeting={makeMeeting('A_base', {
        speakers: unresolvedSpeakers,
        web_meta: { tags: ['тег1'], project: 'Проект-1' },
      })}
      {...props}
    />);
    expect(screen.getByText(/переименование поставлен/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Проект' })).not.toBeInTheDocument();
    openMeetingMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Теги и проект' }));
    expect(await screen.findByRole('textbox', { name: 'Проект' })).toHaveValue('Проект-1');
  });

  it('severity Alert не определяется по слову «очередь» в тексте', async () => {
    voiceJobsAPI.assignSpeakers.mockRejectedValue(Object.assign(new Error('Bad Gateway'), {
      response: { data: { detail: 'Задача в очередь не попала' } },
    }));
    const props = { open: true, onClose: vi.fn(), canManage: true, voices: [], onAssigned: vi.fn() };
    render(<VoiceMeetingDrawer
      meeting={makeMeeting('A_base', { speakers: unresolvedSpeakers })}
      {...props}
    />);
    fireEvent.click(screen.getByRole('tab', { name: /Участники/ }));
    fireEvent.change(screen.getByPlaceholderText('Выберите из списка или впишите имя'), {
      target: { value: 'Иван Иванов' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Сохранить имена/ }));
    await screen.findByText('Задача в очередь не попала');
    const alert = screen.getByText('Задача в очередь не попала').closest('.MuiAlert-root');
    expect(alert).toHaveClass('MuiAlert-standardError');
  });
});

describe('VoiceMeetingDrawer: ошибка подготовки письма (T19)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    voiceJobsAPI.getAssignments.mockRejectedValue(new Error('network unavailable'));
  });

  it('shows the assignment load error and does not create an email draft', async () => {
    render(
      <VoiceMeetingDrawer
        open
        meeting={makeMeeting('A_base', { reports: [{ name: 'report.html', ext: 'html' }] })}
        onClose={vi.fn()}
        canManage={false}
        voices={[]}
      />,
    );

    openMeetingMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Отправить протокол письмом' }));

    expect(await screen.findByText(/Не удалось загрузить поручения/)).toBeInTheDocument();
    expect(stashMailComposePrefill).not.toHaveBeenCalled();
  });

  it('marks metadata save failures as errors without inspecting the message text', async () => {
    voiceJobsAPI.updateMeetingMeta.mockRejectedValueOnce(new Error('server unavailable'));
    render(
      <VoiceMeetingDrawer
        open
        meeting={makeMeeting('A_base', {
          reports: [{ name: 'report.html', ext: 'html' }],
        })}
        onClose={vi.fn()}
        canManage
        voices={[]}
      />,
    );

    openMeetingMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Теги и проект' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Сохранить' }));

    const errorText = await screen.findByText('Не удалось сохранить');
    const error = errorText.closest('.MuiAlert-root');
    expect(error).toHaveTextContent('Не удалось сохранить');
    expect(error).toHaveClass('MuiAlert-standardError');
  });
});

describe('VoiceMeetingDrawer: доступность (T15)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    voiceJobsAPI.getTranscript.mockResolvedValue({ segments: [], total: 0 });
    voiceJobsAPI.getTopics.mockResolvedValue({ items: [] });
    voiceJobsAPI.getAssignments.mockResolvedValue({ items: [] });
    voiceJobsAPI.getAssignmentStatuses.mockResolvedValue({ items: [] });
  });

  it('exposes the meeting drawer with an accessible title', () => {
    render(
      <VoiceMeetingDrawer
        open
        meeting={makeMeeting('A_base')}
        onClose={vi.fn()}
        canManage={false}
        voices={[]}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: /A_base/ });
    expect(dialog).toBeInTheDocument();
    expect(document.getElementById(dialog.getAttribute('aria-labelledby'))).toBeInTheDocument();
  });

  it('orders participant section headings below the meeting title', () => {
    render(
      <VoiceMeetingDrawer
        open
        meeting={makeMeeting('A_base', {
          speakers: {
            resolved: [{ name: 'Иван', first_segment_start: 0 }],
            unresolved: [{ speaker: 'S1', has_sample: false, first_segment_start: 10 }],
          },
        })}
        onClose={vi.fn()}
        canManage={false}
        voices={[]}
      />,
    );

    expect(screen.getByRole('heading', { name: 'A_base', level: 2 })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Участники/ }));
    expect(screen.getByRole('heading', { name: 'Опознанные участники', level: 3 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Неопознанные участники/, level: 3 })).toBeInTheDocument();
  });

  it('exposes playable transcript timecodes as named buttons', async () => {
    voiceJobsAPI.getTranscript.mockResolvedValue({
      segments: [{ speaker: 'S1', text: 'Проверка', start: 12, start_time_formatted: '00:12' }],
      total: 1,
    });
    render(
      <VoiceMeetingDrawer
        open
        meeting={makeMeeting('A_base', { has_media: true })}
        onClose={vi.fn()}
        canManage={false}
        voices={[]}
      />,
    );

    // Транскрипт на десктопе всегда виден в левой колонке — вкладка не нужна.
    expect(await screen.findByRole('button', { name: 'Перейти к 00:12' })).toBeInTheDocument();
  });

  it('names playback buttons with the participant they play', () => {
    render(
      <VoiceMeetingDrawer
        open
        meeting={makeMeeting('A_base', {
          has_media: true,
          speakers: {
            resolved: [{ name: 'Иван', first_segment_start: 0 }],
            unresolved: [{ speaker: 'S1', has_sample: true, first_segment_start: 10 }],
          },
        })}
        onClose={vi.fn()}
        canManage={false}
        voices={[]}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: /Участники/ }));
    expect(screen.getByRole('button', { name: 'Прослушать участника Иван с первой реплики' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Прослушать фрагмент участника S1' })).toBeInTheDocument();
  });

  it('keeps the complete unbroken meeting name available when the drawer title is truncated', () => {
    const name = 'В'.repeat(140);
    render(
      <VoiceMeetingDrawer
        open
        meeting={makeMeeting(name)}
        onClose={vi.fn()}
        canManage={false}
        voices={[]}
      />,
    );

    const title = screen.getByRole('heading', { name, level: 2 });
    expect(title).toHaveAttribute('title', name);
  });

  it('keeps entered participant names when switching between drawer tabs', () => {
    render(
      <VoiceMeetingDrawer
        open
        meeting={makeMeeting('A_base', { speakers: unresolvedSpeakers })}
        onClose={vi.fn()}
        canManage
        voices={[]}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: /Участники/ }));
    const field = screen.getByPlaceholderText('Выберите из списка или впишите имя');
    fireEvent.change(field, { target: { value: 'Иван Иванов' } });
    fireEvent.click(screen.getByRole('tab', { name: /Файлы/ }));
    fireEvent.click(screen.getByRole('tab', { name: /Участники/ }));

    expect(screen.getByPlaceholderText('Выберите из списка или впишите имя')).toHaveValue('Иван Иванов');
  });
});

describe('VoiceMeetingDrawer: плотные поля (T24)', () => {
  const renderWithSpeakers = (props) => {
    const result = render(
      <VoiceMeetingDrawer
        open
        meeting={makeMeeting('A_base', {
          speakers: {
            resolved: [{ name: 'Иван', first_segment_start: 0 }],
            unresolved: [{ speaker: 'S1', has_sample: false, first_segment_start: 10 }],
          },
        })}
        onClose={vi.fn()}
        canManage
        voices={[]}
        {...props}
      />,
    );
    // Панель «Участники» на десктопе — правая вкладка панели (T28).
    fireEvent.click(screen.getByRole('tab', { name: /Участники/ }));
    return result;
  };

  it('keeps the rename and unidentified-speaker fields at most 44px tall', () => {
    renderWithSpeakers();

    const rename = screen.getByPlaceholderText('Новое имя (пусто — оставить)').closest('.MuiFormControl-root');
    const who = screen.getByPlaceholderText('Выберите из списка или впишите имя').closest('.MuiFormControl-root');

    for (const field of [rename, who]) {
      expect(field).toHaveStyle({ maxHeight: '44px' });
      expect(field.querySelector('label')).toBeInTheDocument();
    }
  });

  it('keeps participant names and their field in one row from sm upwards', () => {
    renderWithSpeakers();

    const rename = screen.getByPlaceholderText('Новое имя (пусто — оставить)').closest('.MuiFormControl-root');
    const nameChip = screen.getByText('Иван');
    const row = rename.closest('.MuiStack-root');
    const rowDirection = window.getComputedStyle(row).flexDirection;

    expect(window.getComputedStyle(row).display).toBe('flex');
    expect(rowDirection).not.toBe('column');
    expect(row.contains(nameChip)).toBe(true);
  });

  it('does not move the unresolved-speaker name into a separate column on mobile', () => {
    renderWithSpeakers();

    const who = screen.getByPlaceholderText('Выберите из списка или впишите имя').closest('.MuiFormControl-root');
    const row = who.closest('.MuiStack-root');
    const rowDirection = window.getComputedStyle(row).flexDirection;

    expect(window.getComputedStyle(row).display).toBe('flex');
    expect(rowDirection).not.toBe('column');
  });
});

describe('VoiceMeetingDrawer: мобильная компоновка (T16)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    voiceJobsAPI.getTranscript.mockResolvedValue({ segments: [], total: 0 });
    voiceJobsAPI.getTopics.mockResolvedValue({ items: [] });
    voiceJobsAPI.getAssignments.mockResolvedValue({ items: [] });
    voiceJobsAPI.getAssignmentStatuses.mockResolvedValue({ items: [] });
  });

  it('uses the full viewport height for the mobile meeting card', () => {
    const originalMatchMedia = window.matchMedia;
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

    render(
      <VoiceMeetingDrawer
        open
        meeting={makeMeeting('A_base')}
        onClose={vi.fn()}
        canManage={false}
        voices={[]}
      />,
    );
    window.matchMedia = originalMatchMedia;

    const dialog = screen.getByRole('dialog', { name: /A_base/ });
    const paper = dialog.closest('.MuiDialog-paper') || dialog.querySelector('.MuiDialog-paper');
    expect(window.getComputedStyle(paper).maxHeight).toBe('100%');
  });

  it('collapses the tag and project editor until the manager opens it', async () => {
    voiceJobsAPI.updateMeetingMeta.mockResolvedValue({});

    render(
      <VoiceMeetingDrawer
        open
        meeting={makeMeeting('A_base', {
          reports: [{ name: 'report.html', ext: 'html' }],
          web_meta: { tags: [], project: 'Проект' },
        })}
        onClose={vi.fn()}
        canManage
        voices={[]}
      />,
    );

    // Редактор открывается из меню «⋮» и по умолчанию свёрнут (T23).
    expect(screen.queryByRole('combobox', { name: 'Теги' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Проект' })).not.toBeInTheDocument();

    openMeetingMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Теги и проект' }));
    expect(screen.getByRole('combobox', { name: 'Теги' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Проект' })).toBeVisible();

    fireEvent.change(screen.getByRole('textbox', { name: 'Проект' }), {
      target: { value: 'Новый проект' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => {
      expect(voiceJobsAPI.updateMeetingMeta).toHaveBeenCalledWith('A_base', {
        tags: [],
        project: 'Новый проект',
      });
    });
    expect(await screen.findByText('Сохранено')).toBeInTheDocument();
  });

  it('distinguishes unidentified speakers from the total participant chip', () => {
    render(
      <VoiceMeetingDrawer
        open
        meeting={makeMeeting('A_base', {
          reports: [{ name: 'report.html', ext: 'html' }],
          speakers: {
            resolved: [{ name: 'Иван' }, { name: 'Ольга' }],
            unresolved: [{ speaker: 'speaker_3' }],
          },
        })}
        onClose={vi.fn()}
        canManage={false}
        voices={[]}
      />,
    );

    expect(screen.getByRole('tab', { name: 'Участники (1)' })).toBeInTheDocument();
    expect(screen.getByText(/1 реплика · 3 участника · 1 отчёт/)).toBeInTheDocument();
  });
});

describe('VoiceMeetingDrawer: компактная шапка (T23)', () => {
  const renderDrawer = (props) => render(
    <VoiceMeetingDrawer
      open
      meeting={makeMeeting('j123456789abc_Еженедельное совещание', {
        segments_count: 320,
        speakers: { resolved: [{ name: 'Иван' }], unresolved: [] },
        reports: [
          { name: 'protocol.html', kind: 'protocol', ext: 'html', size: 1024 },
          { name: 'report.docx', kind: 'report', ext: 'docx', size: 2048 },
          { name: 'transcript.txt', kind: 'transcript', ext: 'txt', size: 512 },
        ],
        web_meta: { tags: ['тег1'], project: 'Проект-1' },
      })}
      onClose={vi.fn()}
      canManage
      voices={[]}
      {...props}
    />,
  );

  it('renders one meta line with correct Russian plurals', () => {
    renderDrawer();

    expect(screen.getByText('320 реплик · 1 участник · 3 отчёта · Запись удалена')).toBeInTheDocument();
    expect(screen.queryByText('1 участников')).not.toBeInTheDocument();
    expect(screen.queryByText('3 отчётов')).not.toBeInTheDocument();
  });

  it('pluralises two participants and a single report correctly', () => {
    render(
      <VoiceMeetingDrawer
        open
        meeting={makeMeeting('A_base', {
          segments_count: 2,
          speakers: { resolved: [{ name: 'Иван' }, { name: 'Ольга' }], unresolved: [] },
          reports: [{ name: 'a.html', kind: 'report', ext: 'html', size: 1 }],
        })}
        onClose={vi.fn()}
        canManage
        voices={[]}
      />,
    );
    expect(screen.getByText('2 реплики · 2 участника · 1 отчёт · Запись удалена')).toBeInTheDocument();
  });

  it('moves mail, share and tag editor into the overflow menu', () => {
    renderDrawer();

    expect(screen.queryByRole('button', { name: 'Отправить протокол письмом' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Поделиться ссылкой на протокол' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Редактор тегов и проекта' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Закрыть' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Действия с протоколом' }));

    expect(screen.getByRole('menuitem', { name: 'Отправить протокол письмом' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Поделиться ссылкой' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Теги и проект' })).toBeInTheDocument();
  });

  it('keeps the technical base filename out of the header', () => {
    renderDrawer();

    expect(screen.queryByText('j123456789abc_Еженедельное совещание')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Еженедельное совещание', level: 2 }))
      .toHaveAttribute('title', 'Еженедельное совещание');
  });

  it('opens the tag editor from the overflow menu', async () => {
    voiceJobsAPI.updateMeetingMeta.mockResolvedValue({});
    renderDrawer();

    fireEvent.click(screen.getByRole('button', { name: 'Действия с протоколом' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Теги и проект' }));

    expect(await screen.findByRole('textbox', { name: 'Проект' })).toHaveValue('Проект-1');
  });

  it('sends the protocol mail from the overflow menu', async () => {
    renderDrawer();

    fireEvent.click(screen.getByRole('button', { name: 'Действия с протоколом' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Отправить протокол письмом' }));

    await waitFor(() => expect(stashMailComposePrefill).toHaveBeenCalled());
  });

  it('opens the share dialog from the overflow menu', () => {
    renderDrawer();

    fireEvent.click(screen.getByRole('button', { name: 'Действия с протоколом' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Поделиться ссылкой' }));

    expect(screen.getByRole('dialog', { name: 'Поделиться протоколом' })).toBeInTheDocument();
  });
});

describe('VoiceMeetingDrawer: плотные строки отчётов (T25)', () => {
  const reports = [
    { name: 'A_base_protocol.html', kind: 'protocol', ext: 'html', size: 1024 },
    { name: 'A_base_report.docx', kind: 'report', ext: 'docx', size: 2048 },
    { name: 'A_base_transcript.txt', kind: 'transcript', ext: 'txt', size: 512 },
  ];
  const renderReports = (props) => render(
    <ThemeProvider theme={theme}>
      <VoiceMeetingDrawer
        open
        meeting={makeMeeting('A_base', { reports })}
        onClose={vi.fn()}
        canManage
        voices={[]}
        {...props}
      />
    </ThemeProvider>,
  );
  const openReportsTab = () => fireEvent.click(
    screen.getByRole('tab', { name: 'Файлы (3)' }),
  );
  const reportMenu = (name) => fireEvent.click(screen.getByRole('button', { name }));

  it('keeps one visible row per report with a visible view action', () => {
    renderReports();
    openReportsTab();

    // Просмотр остаётся видимым действием, а не спрятан в меню.
    expect(screen.getByRole('button', { name: 'Просмотр protocol.html' })).toBeVisible();
    // У отчёта без просмотра «Скачать» остаётся на виду (это ссылка с download).
    expect(screen.getByRole('link', { name: 'Скачать report.docx' })).toBeVisible();
  });

  it('moves open-in-new-tab and download into the per-report overflow menu', () => {
    renderReports();
    openReportsTab();

    expect(screen.queryByRole('button', { name: /^Открыть в новой вкладке/ })).not.toBeInTheDocument();

    reportMenu('Действия с файлом protocol.html');
    expect(screen.getByRole('menuitem', { name: 'Открыть в новой вкладке' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Скачать' })).toBeInTheDocument();
  });

  it('keeps the report overflow menu discoverable', () => {
    renderReports();
    openReportsTab();

    const menus = screen.getAllByRole('button', { name: /^Действия с файлом / });
    expect(menus).toHaveLength(1);
    for (const menu of menus) {
      expect(menu).toHaveAttribute('aria-haspopup', 'menu');
    }
  });

  it('gives the view action a 44px mobile target and keeps group labels inside rows (N12)', () => {
    renderReports();
    openReportsTab();

    // «Просмотр» на xs — полноценный тач-таргет 44px, как у соседней «⋮»
    // (jsdom вычисляет базовое правило темы без media-запросов).
    expect(screen.getByRole('button', { name: 'Просмотр protocol.html' }))
      .toHaveStyle({ minHeight: '44px' });

    // Подписи групп не занимают отдельные строки-заголовки — группа
    // указана внутри строки отчёта (тип · размер). Три отчёта трёх групп
    // не должны давать блок выше ~160px.
    expect(screen.queryByText('Протокол')).not.toBeInTheDocument();
    expect(screen.queryByText('Отчёт')).not.toBeInTheDocument();
    // «Текст разговора» встречается только внутри строки файла (тип · размер) —
    // заголовка группы нет (T28: вкладки теперь «Темы/Поручения/Участники/Файлы»).
    expect(screen.getByText(/Протокол · 1 КБ/)).toBeInTheDocument();
    expect(screen.getByText(/Отчёт · 2 КБ/)).toBeInTheDocument();
    expect(screen.getByText(/Текст разговора · 1 КБ/)).toBeInTheDocument();
  });
});

describe('timecodeToSec (T30)', () => {
  it('парсит MM:SS, H:MM:SS и таймкоды внутри подписей', async () => {
    const { timecodeToSec } = await import('./VoiceMeetingDrawer');
    expect(timecodeToSec('01:00')).toBe(60);
    expect(timecodeToSec('1:02:03')).toBe(3723);
    expect(timecodeToSec('17:10–17:40')).toBe(1030);
    expect(timecodeToSec('00:00')).toBe(0);
    expect(timecodeToSec('')).toBeNull();
    expect(timecodeToSec('нет времени')).toBeNull();
  });
});

describe('VoiceMeetingDrawer: фаза 4 — единая карточка (T28–T33)', () => {
  const segList = {
    segments: [
      { speaker: 'S1', text: 'первая реплика', start: 0, start_time_formatted: '00:00' },
      { speaker: 'S2', text: 'вторая реплика', start: 60, start_time_formatted: '01:00' },
      { speaker: 'S1', text: 'третья реплика', start: 120, start_time_formatted: '02:00' },
    ],
    total: 3,
  };
  const renderMediaDrawer = (extra = {}) => render(
    <ThemeProvider theme={theme}>
      <VoiceMeetingDrawer
        open
        meeting={makeMeeting('A_base', { has_media: true, ...extra })}
        onClose={vi.fn()}
        canManage={false}
        voices={[]}
      />
    </ThemeProvider>,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.pause = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    voiceJobsAPI.getTranscript.mockResolvedValue(segList);
    voiceJobsAPI.getTopics.mockResolvedValue({
      items: [
        { title: 'Тема первая', start: 0, end: 90 },
        { title: 'Вторая тема', start: 90, end: 180 },
      ],
    });
    voiceJobsAPI.getAssignments.mockResolvedValue({
      items: [
        { num: 1, time: '01:00', task: 'Сделать отчёт', assignee: 'Иван', deadline: '01.10.2026', clip: 'clip1.mp4' },
      ],
    });
    voiceJobsAPI.getAssignmentStatuses.mockResolvedValue({ items: [] });
  });

  it('T28: грузит транскрипт/темы/поручения при открытии; текст и темы видны без переключения вкладок', async () => {
    renderMediaDrawer();

    await waitFor(() => expect(voiceJobsAPI.getTranscript).toHaveBeenCalledWith('A_base', expect.anything(), expect.anything()));
    expect(voiceJobsAPI.getTopics).toHaveBeenCalledWith('A_base', expect.anything());
    expect(voiceJobsAPI.getAssignments).toHaveBeenCalledWith('A_base', expect.anything());

    // Две колонки на ≥md: слева всегда транскрипт, справа по умолчанию — темы.
    expect(await screen.findByText('первая реплика')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Перейти к теме «Вторая тема»/ })).toBeInTheDocument();

    // Поручения — за вкладкой правой панели.
    fireEvent.click(screen.getByRole('tab', { name: /Поручения/ }));
    expect(await screen.findByText('Сделать отчёт')).toBeInTheDocument();
  });

  it('T28: вкладки правой панели переключают разделы, левая колонка остаётся на месте', async () => {
    renderMediaDrawer();
    await screen.findByText('первая реплика');

    fireEvent.click(screen.getByRole('tab', { name: /Файлы/ }));
    expect(await screen.findByText('Отчётов нет')).toBeInTheDocument();
    // Транскрипт не скрывается — две колонки, а не вкладки целиком.
    expect(screen.getByText('первая реплика')).toBeInTheDocument();
  });

  it('T29: клик по теме перематывает плеер на её начало', async () => {
    renderMediaDrawer();
    const topic = await screen.findByRole('button', { name: 'Перейти к теме «Вторая тема», 1:30' });
    const video = document.querySelector('video');
    expect(video).toBeInTheDocument();

    fireEvent.click(topic);
    expect(video.currentTime).toBe(90);
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it('T29: кнопки «Предыдущая/следующая тема» переходят по границам тем', async () => {
    renderMediaDrawer();
    await screen.findByRole('button', { name: 'Перейти к теме «Тема первая», 0:00' });
    const video = document.querySelector('video');

    act(() => {
      video.currentTime = 45;
      fireEvent(video, new Event('seeked'));
    });

    fireEvent.click(screen.getByRole('button', { name: 'Следующая тема' }));
    expect(video.currentTime).toBe(90);
    fireEvent.click(screen.getByRole('button', { name: 'Предыдущая тема' }));
    expect(video.currentTime).toBe(0);
  });

  it('T30: клик по таймкоду поручения перематывает основной плеер, клип остаётся отдельной кнопкой', async () => {
    renderMediaDrawer();
    fireEvent.click(screen.getByRole('tab', { name: /Поручения/ }));
    const chip = await screen.findByRole('button', { name: 'Перейти к 01:00 (поручение №1)' });
    const video = document.querySelector('video');

    fireEvent.click(chip);
    expect(video.currentTime).toBe(60);
    // Отдельный clip-диалог не открылся — переход идёт через основной плеер.
    expect(screen.queryByText('Фрагмент поручения №1')).not.toBeInTheDocument();
    // Доступ к фрагменту — в меню «⋮» строки поручения (P4-1).
    fireEvent.click(screen.getByRole('button', { name: 'Действия с поручением №1' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Открыть фрагмент (поручение №1)' })).toBeInTheDocument();
  });

  it('T32: проигрываемая реплика подсвечивается по позиции плеера', async () => {
    renderMediaDrawer();
    await screen.findByText('вторая реплика');
    const video = document.querySelector('video');

    act(() => {
      video.currentTime = 65;
      fireEvent(video, new Event('seeked'));
    });

    const row = document.querySelector('[data-seg-start="60"]');
    expect(row).toHaveAttribute('data-seg-active', '1');
    expect(document.querySelector('[data-seg-start="0"]')).not.toHaveAttribute('data-seg-active');
  });

  it('T32: ручная прокрутка выключает follow-режим и показывает кнопку возврата', async () => {
    renderMediaDrawer();
    await screen.findByText('первая реплика');
    const video = document.querySelector('video');

    act(() => {
      video.currentTime = 65;
      fireEvent(video, new Event('seeked'));
    });
    // Прокрутка внутри колонки транскрипта снимает follow.
    fireEvent.wheel(screen.getByText('вторая реплика'));

    const follow = await screen.findByRole('button', { name: 'К текущему месту' });
    fireEvent.click(follow);
    expect(screen.queryByRole('button', { name: 'К текущему месту' })).not.toBeInTheDocument();
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('T31: шаги перемотки ±5/±15 и компактный режим плеера', async () => {
    renderMediaDrawer();
    await screen.findByText('первая реплика');
    const video = document.querySelector('video');

    fireEvent.click(screen.getByRole('button', { name: 'Вперёд на 15 секунд' }));
    expect(video.currentTime).toBe(15);
    fireEvent.click(screen.getByRole('button', { name: 'Вперёд на 5 секунд' }));
    expect(video.currentTime).toBe(20);
    fireEvent.click(screen.getByRole('button', { name: 'Назад на 5 секунд' }));
    expect(video.currentTime).toBe(15);
    fireEvent.click(screen.getByRole('button', { name: 'Назад на 15 секунд' }));
    expect(video.currentTime).toBe(0);

    // Компактный режим: видео сворачивается в панель, элемент остаётся смонтированным.
    fireEvent.click(screen.getByRole('button', { name: 'Свернуть видео' }));
    expect(video).not.toBeVisible();
    expect(screen.getByRole('button', { name: 'Играть' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Показать видео' }));
    expect(video).toBeVisible();
  });

  it('T31: скорость воспроизведения применяется к элементу плеера', async () => {
    renderMediaDrawer();
    await screen.findByText('первая реплика');
    const video = document.querySelector('video');

    const rateField = screen.getByLabelText('Скорость воспроизведения');
    fireEvent.mouseDown(rateField);
    const option = await screen.findByRole('option', { name: '×1.5' });
    fireEvent.click(option);

    expect(video.playbackRate).toBe(1.5);
  });

  it('T30: шкала времени содержит отрезки тем и точки поручений', async () => {
    renderMediaDrawer();
    await screen.findByText('первая реплика');
    const video = document.querySelector('video');
    // Шкала появляется после метаданных — в jsdom имитируем durationchange.
    act(() => {
      Object.defineProperty(video, 'duration', { value: 180, configurable: true });
      fireEvent(video, new Event('loadedmetadata'));
    });

    const slider = await screen.findByRole('slider', { name: 'Шкала записи' });
    expect(within(slider).getByTitle(/Поручение №1 · 01:00/)).toBeInTheDocument();
    expect(within(slider).getByTitle(/Тема первая/)).toBeInTheDocument();
  });

  it('T33: у реплики рядом с таймкодом поручения показывается маркер', async () => {
    renderMediaDrawer();
    await screen.findByText('вторая реплика');

    const marker = await screen.findByRole('button', { name: 'У реплики поручение №1' });
    fireEvent.click(marker);
    // Маркер открывает панель поручений.
    expect(await screen.findByText('Сделать отчёт')).toBeInTheDocument();
  });

  it('T33: переход к скрытой фильтром реплике сбрасывает фильтр с уведомлением', async () => {
    renderMediaDrawer();
    await screen.findByText('первая реплика');
    // Фильтр «S2» прячет реплики S1 (0:00 и 2:00).
    fireEvent.mouseDown(screen.getByLabelText('Участник'));
    fireEvent.click(await screen.findByRole('option', { name: 'S2' }));

    // Тема «Вторая тема» (1:30) целится в реплику S1 — за фильтром: фильтр сбрасывается.
    fireEvent.click(screen.getByRole('button', { name: 'Перейти к теме «Вторая тема», 1:30' }));
    expect(await screen.findByText('Фильтр сброшен, чтобы показать место в записи')).toBeInTheDocument();
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('T32: обновления позиции плеера идут ~4 раза в секунду (timeupdate)', async () => {
    renderMediaDrawer();
    await screen.findByText('вторая реплика');
    const video = document.querySelector('video');
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(1000);
    try {
      act(() => { video.currentTime = 10; fireEvent(video, new Event('timeupdate')); });
      expect(document.querySelector('[data-seg-start="0"]')).toHaveAttribute('data-seg-active', '1');

      // +100 мс < 250 — обновление пропускается, активная реплика не меняется.
      nowSpy.mockReturnValue(1100);
      act(() => { video.currentTime = 65; fireEvent(video, new Event('timeupdate')); });
      expect(document.querySelector('[data-seg-start="0"]')).toHaveAttribute('data-seg-active', '1');

      // +300 мс ≥ 250 — обновление проходит.
      nowSpy.mockReturnValue(1300);
      act(() => { video.currentTime = 65; fireEvent(video, new Event('timeupdate')); });
      expect(document.querySelector('[data-seg-start="60"]')).toHaveAttribute('data-seg-active', '1');
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('T32: Пробел и стрелки управляют плеером вне полей ввода', async () => {
    renderMediaDrawer();
    await screen.findByText('первая реплика');
    const video = document.querySelector('video');
    const textTarget = screen.getByText('первая реплика'); // <p> — не контрол

    fireEvent.keyDown(textTarget, { key: ' ' });
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled();

    fireEvent.keyDown(textTarget, { key: 'ArrowRight' });
    expect(video.currentTime).toBe(5);
    fireEvent.keyDown(textTarget, { key: 'ArrowRight', shiftKey: true });
    expect(video.currentTime).toBe(20);
    fireEvent.keyDown(textTarget, { key: 'ArrowLeft', shiftKey: true });
    expect(video.currentTime).toBe(5);

    // Внутри полей ввода стрелки не перехватываются.
    fireEvent.keyDown(screen.getByPlaceholderText('Поиск по тексту…'), { key: 'ArrowRight' });
    expect(video.currentTime).toBe(5);
  });

  it('T31: аудиодорожка показывается компактной полосой без видео-блока', async () => {
    renderMediaDrawer();
    await screen.findByText('первая реплика');
    const video = document.querySelector('video');
    act(() => {
      Object.defineProperty(video, 'videoHeight', { value: 0, configurable: true });
      fireEvent(video, new Event('loadedmetadata'));
    });

    expect(video).not.toBeVisible();
    // Панель управления при этом остаётся.
    expect(screen.getByRole('button', { name: 'Играть' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Свернуть видео' })).not.toBeInTheDocument();
  });

  it('T34: без записи — вместо плеера строка состояния, переходы прокручивают текст', async () => {
    render(
      <ThemeProvider theme={theme}>
        <VoiceMeetingDrawer
          open
          meeting={makeMeeting('A_base', { has_media: false, media_parts: [] })}
          onClose={vi.fn()}
          canManage={false}
          voices={[]}
        />
      </ThemeProvider>,
    );

    expect(await screen.findByText('Запись удалена, доступен текст')).toBeInTheDocument();
    expect(document.querySelector('video')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Играть' })).not.toBeInTheDocument();

    // Шкала есть по длительности транскрипта; тема прокручивает текст без плеера.
    expect(await screen.findByRole('slider', { name: 'Шкала записи' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Перейти к теме «Вторая тема», 1:30' }));
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('T30: объединённая запись — переход в другую часть подставляет её источник и локальное время', async () => {
    voiceJobsAPI.getTopics.mockResolvedValue({
      items: [{ title: 'Третья тема', start: 150, end: 200 }],
    });
    render(
      <ThemeProvider theme={theme}>
        <VoiceMeetingDrawer
          open
          meeting={makeMeeting('A_base', {
            has_media: false,
            media_parts: [
              { base: 'P1_base', has_media: true, offset: 0 },
              { base: 'P2_base', has_media: true, offset: 120 },
            ],
          })}
          onClose={vi.fn()}
          canManage={false}
          voices={[]}
        />
      </ThemeProvider>,
    );

    const video = document.querySelector('video');
    expect(video.src).toContain('P1_base');

    fireEvent.click(await screen.findByRole('button', { name: 'Перейти к теме «Третья тема», 2:30' }));
    // Подставилась вторая часть; после loadedmetadata — локальное время 150−120=30.
    expect(video.src).toContain('P2_base');
    act(() => { fireEvent(video, new Event('loadedmetadata')); });
    expect(video.currentTime).toBe(30);
  });

  it('T28: на <md контент за вкладками «Текст/Темы/Поручения/Ещё», плеер закреплён сверху', async () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = (query) => ({
      matches: query.includes('max-width'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
    try {
      renderMediaDrawer();
      expect(screen.getByRole('tab', { name: 'Текст' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Темы' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /Поручения/ })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Ещё' })).toBeInTheDocument();
      // Плеер закреплён над вкладками, транскрипт — вкладка по умолчанию.
      expect(document.querySelector('video')).toBeInTheDocument();
      expect(await screen.findByText('первая реплика')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('tab', { name: 'Темы' }));
      expect(await screen.findByRole('button', { name: /Перейти к теме «Вторая тема»/ })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('tab', { name: 'Ещё' }));
      expect(await screen.findByText('Все участники опознаны.')).toBeInTheDocument();
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it('P4-2: все четыре вкладки правой панели рендерятся без прокрутки (fullWidth)', async () => {
    renderMediaDrawer();
    await screen.findByText('первая реплика');
    const tabs = screen.getByRole('tablist', { name: 'Панель протокола' });
    expect(within(tabs).getByRole('tab', { name: 'Темы' })).toBeInTheDocument();
    expect(within(tabs).getByRole('tab', { name: /Поручения/ })).toBeInTheDocument();
    expect(within(tabs).getByRole('tab', { name: /Участники/ })).toBeInTheDocument();
    expect(within(tabs).getByRole('tab', { name: /Файлы/ })).toBeInTheDocument();
    // fullWidth-раскладка: скролл-стрелок быть не должно.
    expect(within(tabs).queryAllByRole('button').length).toBe(0);
    expect(within(tabs).getAllByRole('tab')).toHaveLength(4);
  });

  it('P4-2: тулбар транскрипта — поиск и участник в одной строке, без длинной подсказки', async () => {
    renderMediaDrawer();
    const search = await screen.findByPlaceholderText('Поиск по тексту…');
    const speaker = screen.getByLabelText('Участник');
    // Одна строка: общий flex-контейнер, участник — компактный select рядом.
    const row = search.closest('.MuiStack-root');
    expect(row).toBe(speaker.closest('.MuiStack-root'));
    expect(row.dataset.toolbar).toBe('transcript-filters');
    // Длинная подсказка убрана — остаётся только счётчик и «Следить за записью».
    expect(screen.queryByText(/нажмите на время/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Следить за записью' })).toBeInTheDocument();
  });

  // P4-4 (Ревью 9): на 320×800 строка кнопок плеера и тулбар транскрипта
  // переполнялись — диалог скроллился по горизонтали (scrollWidth 354/318).
  const withNarrowViewport = async (fn) => {
    const originalMatchMedia = window.matchMedia;
    // <360px: все max-width-запросы (down('sm') 899.95 и down(360) 359.95) совпадают.
    window.matchMedia = (query) => ({
      matches: query.includes('max-width'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
    try {
      await fn();
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  };

  it('P4-4: на <360px ±5 и селектор скорости уходят в «⋮», ±15 и переход по темам остаются', async () => {
    await withNarrowViewport(async () => {
      renderMediaDrawer();
      await screen.findByPlaceholderText('Поиск по тексту…');

      // Шаги ±5 скрыты, ±15 и переход по темам — на месте.
      expect(screen.queryByRole('button', { name: 'Назад на 5 секунд' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Вперёд на 5 секунд' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Назад на 15 секунд' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Вперёд на 15 секунд' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Предыдущая тема' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Следующая тема' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Играть' })).toBeInTheDocument();

      // Селектора скорости нет — он в ⋮-меню плеера и остаётся работоспособным.
      expect(screen.queryByRole('combobox', { name: 'Скорость воспроизведения' })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Ещё действия плеера' }));
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Скорость ×1.5' }));
      expect(document.querySelector('video').playbackRate).toBe(1.5);
    });
  });

  it('P4-4: на <360px тулбар — поиск ≥120px, «Участник» и «Следить» — иконки', async () => {
    await withNarrowViewport(async () => {
      renderMediaDrawer();
      const search = await screen.findByPlaceholderText('Поиск по тексту…');
      const toolbar = search.closest('[data-toolbar="transcript-filters"]');
      expect(toolbar).not.toBeNull();
      // Поиск не уже 120px — ограничение задано стилем.
      const field = toolbar.querySelector('.MuiTextField-root');
      expect(getComputedStyle(field).minWidth).toBe('120px');

      // Селекта «Участник» нет — вместо него иконка-фильтр с меню.
      expect(within(toolbar).queryByLabelText('Участник')).not.toBeInTheDocument();
      fireEvent.click(within(toolbar).getByRole('button', { name: 'Фильтр по участнику' }));
      fireEvent.click(await screen.findByRole('menuitem', { name: 'S2' }));
      await waitFor(() => expect(screen.queryByText('первая реплика')).not.toBeInTheDocument());
      expect(screen.getByText('вторая реплика')).toBeInTheDocument();

      // «Следить за записью» — иконка с доступным именем и состоянием.
      const follow = within(toolbar).getByRole('button', { name: /Следить за записью/ });
      expect(follow).toHaveAttribute('aria-pressed', 'true');
      fireEvent.click(follow);
      await waitFor(() => expect(follow).toHaveAttribute('aria-pressed', 'false'));
    });
  });

  it('T36: шапка — название без подложки, мета с длительностью, без «Источник доступен»', async () => {
    renderMediaDrawer({
      speakers: { resolved: [{ name: 'Иван Петров' }], unresolved: [{ speaker: 'S2', has_sample: false }] },
      segments_count: 364,
    });
    const title = screen.getByRole('dialog', { name: /A_base/ }).querySelector('.MuiDialogTitle-root');
    // Подложка названия убрана (Ревью 10: фон выглядел как поле ввода).
    expect(title).toHaveStyle({ background: 'transparent' });

    const video = document.querySelector('video');
    Object.defineProperty(video, 'duration', { value: 2700, configurable: true });
    Object.defineProperty(video, 'videoHeight', { value: 0, configurable: true });
    fireEvent(video, new Event('loadedmetadata'));

    await screen.findByPlaceholderText('Поиск по тексту…');
    // Мета: длительность · реплики (из загруженного текста, не шапочное число) ·
    // участники · отчёты; без «Источник доступен» — только предупреждения.
    const meta = document.querySelector('[data-meta="meeting"]').textContent;
    expect(meta).toMatch(/45:00/);
    expect(meta).toMatch(/3 реплики/);
    expect(meta).toMatch(/2 участника/);
    expect(meta).not.toMatch(/Источник доступен/);
  });

  it('T36: мета — «Запись удалится DD.MM» при сроке ≤7 дней, «Запись удалена» без медиа', async () => {
    const soon = new Date(Date.now() + 3 * 86400 * 1000).toISOString();
    renderMediaDrawer({ source_expires_at: soon });
    await screen.findByPlaceholderText('Поиск по тексту…');
    expect(document.querySelector('[data-meta="meeting"]').textContent).toMatch(/Запись удалится/);

    cleanup();
    const later = new Date(Date.now() + 30 * 86400 * 1000).toISOString();
    renderMediaDrawer({ source_expires_at: later });
    await screen.findByPlaceholderText('Поиск по тексту…');
    expect(document.querySelector('[data-meta="meeting"]').textContent).not.toMatch(/Источник|Запись удалится/);

    cleanup();
    renderMediaDrawer({ has_media: false });
    await screen.findByPlaceholderText('Поиск по тексту…');
    expect(document.querySelector('[data-meta="meeting"]').textContent).toMatch(/Запись удалена/);
  });

  it('T40: вкладки без сокращений — полные подписи с бейджами на ≥360', async () => {
    renderMediaDrawer();
    await screen.findByText('первая реплика');
    const tabs = screen.getByRole('tablist', { name: 'Панель протокола' });
    expect(within(tabs).getByRole('tab', { name: /Поручения/ })).toBeInTheDocument();
    expect(within(tabs).getByRole('tab', { name: /Участники/ })).toBeInTheDocument();
    // Нет сокращённых подписей в DOM-тексте.
    expect(within(tabs).queryByText(/Поруч\./)).not.toBeInTheDocument();
    expect(within(tabs).queryByText(/Участн\./)).not.toBeInTheDocument();
    // Число — бейджем при полной подписи.
    expect(within(tabs).getByText('1')).toBeInTheDocument();
  });

  it('T40: на 390px вкладки с полными подписями; на <360 — иконка + aria-label', async () => {
    const withViewport = async (narrow, fn) => {
      const original = window.matchMedia;
      window.matchMedia = (query) => ({
        matches: query.includes('max-width') && (narrow || !query.includes('359.95')),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      });
      try { await fn(); } finally { window.matchMedia = original; }
    };

    // 390–899: полные подписи.
    await withViewport(false, async () => {
      renderMediaDrawer();
      await screen.findByText('первая реплика');
      const tabs = screen.getByRole('tablist', { name: 'Навигация по карточке протокола' });
      expect(within(tabs).getByRole('tab', { name: /Поручения/ })).toBeInTheDocument();
      expect(within(tabs).queryByText(/Поруч\./)).not.toBeInTheDocument();
    });
    cleanup();

    // <360: иконка без текста подписи, полное имя в aria-label.
    await withViewport(true, async () => {
      renderMediaDrawer();
      await screen.findByText('первая реплика');
      const tabs = screen.getByRole('tablist', { name: 'Навигация по карточке протокола' });
      const assignTab = within(tabs).getByRole('tab', { name: 'Поручения' });
      expect(assignTab).toBeInTheDocument();
      expect(within(tabs).queryByText('Поручения')).not.toBeInTheDocument();
      expect(within(assignTab).getByText('1')).toBeInTheDocument(); // бейдж
    });
  });

  it('T37: «Сейчас играет» под шкалой — тема по позиции, клик открывает темы', async () => {
    renderMediaDrawer();
    await screen.findByPlaceholderText('Поиск по тексту…');
    const video = document.querySelector('video');
    act(() => {
      Object.defineProperty(video, 'duration', { value: 180, configurable: true });
      fireEvent(video, new Event('loadedmetadata'));
    });
    // Позиция 10с → тема 1 из 2; клик по строке открывает вкладку «Темы».
    act(() => { video.currentTime = 10; fireEvent(video, new Event('seeked')); });
    const now = await screen.findByRole('button', { name: /Сейчас играет: тема 1 из 2 — Тема первая/ });
    fireEvent.click(now);
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Темы' })).toHaveAttribute('aria-selected', 'true'));
    // Переход через границу → тема 2.
    act(() => { video.currentTime = 120; fireEvent(video, new Event('seeked')); });
    expect(screen.getByRole('button', { name: /Сейчас играет: тема 2 из 2 — Вторая тема/ })).toBeInTheDocument();
  });

  it('T37: отрезки тем и точки поручений на шкале доступны с клавиатуры', async () => {
    renderMediaDrawer();
    await screen.findByText('первая реплика');
    const video = document.querySelector('video');
    act(() => {
      Object.defineProperty(video, 'duration', { value: 180, configurable: true });
      fireEvent(video, new Event('loadedmetadata'));
    });
    const slider = await screen.findByRole('slider', { name: 'Шкала записи' });
    // Точка поручения — фокусируемая кнопка с понятным именем (T37).
    const dot = within(slider).getByRole('button', { name: /Поручение №1 · 01:00 · Сделать отчёт/ });
    fireEvent.keyDown(dot, { key: 'Enter' });
    expect(video.currentTime).toBe(60);
    // Отрезок темы — тоже фокусируемый, Enter → переход к теме.
    const seg = within(slider).getByRole('button', { name: /Тема «Вторая тема»/ });
    fireEvent.keyDown(seg, { key: 'Enter' });
    expect(video.currentTime).toBe(90);
  });

  it('T38: имя спикера — отдельной строкой, реплики подряд группируются под одним именем', async () => {
    voiceJobsAPI.getTranscript.mockResolvedValue({
      segments: [
        { speaker: 'S1', text: 'первая реплика', start: 0, start_time_formatted: '00:00' },
        { speaker: 'S1', text: 'вторая реплика того же спикера', start: 30, start_time_formatted: '00:30' },
        { speaker: 'S2', text: 'третья реплика другого', start: 60, start_time_formatted: '01:00' },
      ],
      total: 3,
    });
    renderMediaDrawer();
    await screen.findByPlaceholderText('Поиск по тексту…');
    // S1 идёт дважды подряд → одна строка имени на две реплики; S2 — своя.
    expect(screen.getAllByTestId('seg-speaker')).toHaveLength(2);
    const names = screen.getAllByTestId('seg-speaker').map((el) => el.textContent);
    expect(names[0]).toContain('S1');
    expect(names[1]).toContain('S2');
    // У имени есть цветовая метка (стабильный цвет на участника).
    // Точка — соседний элемент имени в строке спикера.
    const mark = screen.getAllByTestId('seg-speaker')[0].parentElement.querySelector('[data-speaker-dot]');
    expect(mark).toBeInTheDocument();
  });

  it('T38: неопознанный SPEAKER_01 → «Участник N (без имени)» с кнопкой «Назвать»', async () => {
    voiceJobsAPI.getTranscript.mockResolvedValue({
      segments: [
        { speaker: 'SPEAKER_01', text: 'реплика без имени', start: 0, start_time_formatted: '00:00' },
      ],
      total: 1,
    });
    renderMediaDrawer({ speakers: { resolved: [], unresolved: [{ speaker: 'SPEAKER_01', has_sample: false }] } });
    await screen.findByPlaceholderText('Поиск по тексту…');
    expect(screen.getByText(/Участник 2 \(без имени\)/)).toBeInTheDocument();
    expect(screen.queryByText(/SPEAKER_01/)).not.toBeInTheDocument();
    // T51: «Назвать» открывает ввод имени на месте (не уводит на вкладку).
    fireEvent.click(screen.getByRole('button', { name: /Назвать.*Участник 2/ }));
    expect(await screen.findByLabelText('Кто это?')).toBeInTheDocument();
  });

  it('T39: поиск подсвечивает совпадения, не пряча реплики; Enter — к следующему', async () => {
    renderMediaDrawer();
    const search = await screen.findByPlaceholderText('Поиск по тексту…');
    fireEvent.change(search, { target: { value: 'вторая' } });
    // Все реплики остаются на месте (дефолт — подсветка, не фильтр).
    await waitFor(() => expect(document.querySelectorAll('mark').length).toBe(1));
    expect(screen.getByText('первая реплика')).toBeInTheDocument();
    expect(screen.getByText('третья реплика')).toBeInTheDocument();
    expect(screen.getByText(/Реплика 1 из 1 с совпадениями/)).toBeInTheDocument();
    // Enter → следующее совпадение (scrollIntoView на цель).
    fireEvent.keyDown(search, { key: 'Enter' });
    await waitFor(() => expect(document.querySelector('[data-search-current]')).toBeInTheDocument());
    // Режим «Только совпадения» прячет остальные.
    fireEvent.click(screen.getByRole('button', { name: /Только совпадения/ }));
    await waitFor(() => expect(screen.queryByText('первая реплика')).not.toBeInTheDocument());
    expect(screen.getByText(/вторая/)).toBeInTheDocument();
  });

  it('T42: скелетоны вместо спиннера при загрузке текста, тем и поручений', async () => {
    let release;
    voiceJobsAPI.getTranscript.mockReturnValueOnce(new Promise((r) => { release = r; }));
    renderMediaDrawer();
    // Пока текст грузится — скелетоны строк (не только CircularProgress).
    await waitFor(() => expect(document.querySelectorAll('[data-skeleton]')).not.toHaveLength(0));
    release(segList);
    await screen.findByPlaceholderText('Поиск по тексту…');
  });

  it('T42: ошибка текста — сообщение и «Повторить» в своём блоке', async () => {
    voiceJobsAPI.getTranscript.mockRejectedValueOnce(new Error('boom'));
    renderMediaDrawer();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Не удалось загрузить текст разговора');
    // Повтор загружает только текст — темы и поручения не трогаем.
    const topicsCalls = voiceJobsAPI.getTopics.mock.calls.length;
    fireEvent.click(within(alert).getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(voiceJobsAPI.getTranscript.mock.calls.length).toBe(2));
    expect(voiceJobsAPI.getTopics.mock.calls.length).toBe(topicsCalls);
    await screen.findByText('первая реплика');
  });

  it('T42: ошибка тем — сообщение и «Повторить»; пусто — понятный текст', async () => {
    voiceJobsAPI.getTopics.mockRejectedValueOnce(new Error('boom'));
    renderMediaDrawer();
    await screen.findByPlaceholderText('Поиск по тексту…');
    fireEvent.click(screen.getByRole('tab', { name: 'Темы' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Не удалось загрузить темы');
    fireEvent.click(within(alert).getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(voiceJobsAPI.getTopics.mock.calls.length).toBe(2));
    // После успешного повтора темы видны.
    await screen.findByRole('button', { name: 'Перейти к теме «Тема первая», 0:00' });
  });

  it('T39: Shift+Enter — к предыдущему совпадению; рендер ограничен лимитом', async () => {
    // jsdom рендерит медленно — берём 1500 реплик: лимит видимой области (200)
    // проверяется так же, как на 5000 (механика от объёма не зависит).
    const segs = Array.from({ length: 1500 }, (_, i) => ({
      speaker: i % 2 ? 'S1' : 'S2',
      text: i % 100 === 50 ? `цель номер ${i}` : `реплика ${i}`,
      start: i * 5,
      start_time_formatted: '00:00',
    }));
    voiceJobsAPI.getTranscript.mockResolvedValueOnce({ segments: segs, total: segs.length });
    renderMediaDrawer();
    const search = await screen.findByPlaceholderText('Поиск по тексту…');
    fireEvent.change(search, { target: { value: 'цель' } });
    // 15 совпадений; строк в DOM — не больше лимита видимой области,
    // поиск не раздувает рендер на большом тексте.
    await waitFor(() => expect(document.querySelectorAll('mark').length).toBeGreaterThan(0));
    expect(document.querySelectorAll('[data-seg-start]').length).toBeLessThanOrEqual(250);
    await waitFor(() => expect(screen.getByText(/Реплика 1 из 15 с совпадениями/)).toBeInTheDocument());
    // Enter → вперёд, Shift+Enter → назад (с зацикливанием на последнее).
    fireEvent.keyDown(search, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText(/Реплика 2 из 15 с совпадениями/)).toBeInTheDocument());
    fireEvent.keyDown(search, { key: 'Enter', shiftKey: true });
    await waitFor(() => expect(screen.getByText(/Реплика 1 из 15 с совпадениями/)).toBeInTheDocument());
    fireEvent.keyDown(search, { key: 'Enter', shiftKey: true });
    await waitFor(() => expect(screen.getByText(/Реплика 15 из 15 с совпадениями/)).toBeInTheDocument());
  });

  it('T43: в видимом тексте карточки нет технических строк', async () => {
    voiceJobsAPI.getTranscript.mockResolvedValue({
      segments: [
        { speaker: 'SPEAKER_01', text: 'реплика без имени', start: 0, start_time_formatted: '00:00' },
        { speaker: 'S1', text: 'обычная реплика', start: 5, start_time_formatted: '00:05' },
      ],
      total: 2,
    });
    renderMediaDrawer({
      speakers: { resolved: [{ name: 'Иван' }], unresolved: [{ speaker: 'SPEAKER_01', has_sample: false }] },
    });
    await screen.findByPlaceholderText('Поиск по тексту…');
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).not.toMatch(/SPEAKER_\d+/);
    expect(dialog.textContent).not.toMatch(/base_filename/);
    expect(dialog.textContent).not.toMatch(/\(фильтр\)/);
    expect(dialog.textContent).not.toMatch(/Источник доступен/);
  });

  it('T42: пустые темы и пустой текст — понятные состояния', async () => {
    voiceJobsAPI.getTopics.mockResolvedValueOnce({ items: [] });
    voiceJobsAPI.getTranscript.mockResolvedValueOnce({ segments: [], total: 0 });
    renderMediaDrawer();
    await screen.findByText(/Текст разговора пуст/);
    fireEvent.click(screen.getByRole('tab', { name: 'Темы' }));
    expect(await screen.findByText(/Темы не выделены для этой записи/)).toBeInTheDocument();
  });

  it('P4-4: на 390–899px раскладка прежняя — select «Участник» и чип «Следить»', async () => {
    const originalMatchMedia = window.matchMedia;
    // 390px: down('sm') совпадает, down(360) — нет.
    window.matchMedia = (query) => ({
      matches: query.includes('max-width') && !query.includes('359.95'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
    try {
      renderMediaDrawer();
      await screen.findByPlaceholderText('Поиск по тексту…');
      expect(screen.getByLabelText('Участник')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Следить/ })).toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: 'Скорость воспроизведения' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Назад на 5 секунд' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Ещё действия плеера' })).not.toBeInTheDocument();
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });
});
describe('VoiceMeetingDrawer: доработка T38 (P5-1…P5-3) + P5-4/5, формат времени', () => {
  const segs3 = {
    segments: [
      { speaker: 'Иван', text: 'первая длинная реплика с несколькими строками текста для проверки вертикального выравнивания времени', start: 0, start_time_formatted: '0:00:00' },
      { speaker: 'Мария', text: 'вторая реплика', start: 7, start_time_formatted: '0:00:07' },
      { speaker: 'Пётр', text: 'третья реплика', start: 14, start_time_formatted: '0:00:14' },
      { speaker: 'Иван', text: 'четвёртая реплика того же спикера', start: 21, start_time_formatted: '0:00:21' },
    ],
    total: 4,
  };
  const renderP5 = (extra = {}) => render(
    <ThemeProvider theme={theme}>
      <VoiceMeetingDrawer
        open
        meeting={makeMeeting('A_base', { has_media: true, ...extra })}
        onClose={vi.fn()}
        canManage={false}
        voices={[]}
      />
    </ThemeProvider>,
  );
  const mockMobile = () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = (query) => ({
      matches: query.includes('max-width'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
    return () => { window.matchMedia = originalMatchMedia; };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.pause = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    voiceJobsAPI.getTranscript.mockResolvedValue(segs3);
    voiceJobsAPI.getTopics.mockResolvedValue({ items: [{ title: 'Тема 1', start: 0, end: 60 }] });
    voiceJobsAPI.getAssignments.mockResolvedValue({ items: [] });
    voiceJobsAPI.getAssignmentStatuses.mockResolvedValue({ items: [] });
  });

  it('P5-1: время — по верхней строке (alignItems/alignSelf: flex-start)', async () => {
    renderP5();
    await screen.findByText(/первая длинная реплика/);
    const row = document.querySelector('[data-seg-start="0"]');
    expect(getComputedStyle(row).alignItems).toBe('flex-start');
    const timeBtn = within(row).getByRole('button', { name: /Перейти к/ });
    expect(getComputedStyle(timeBtn).alignSelf).toBe('flex-start');
  });

  it('P5-2: три участника — три разных цвета по порядку появления', async () => {
    renderP5();
    await screen.findByText(/первая длинная реплика/);
    // Иван повторяется после Петра → меток 4 (по одной на смену спикера),
    // уникальных цветов — 3; цвет Ивана стабилен между метками.
    const labels = document.querySelectorAll('[data-testid="seg-speaker"]');
    expect(labels.length).toBe(4);
    const colors = [...labels].map((el) => getComputedStyle(el).color);
    expect(new Set(colors).size).toBe(3);
    expect(colors[3]).toBe(colors[0]);
    // Первый участник — первый цвет палитры (порядок, не хеш).
    const hex2rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
    expect(colors[0]).toBe(hex2rgb(theme.palette.primary.main));
    expect(colors[1]).toBe(hex2rgb(theme.palette.warning.main));
  });

  it('P5-3: на <sm имя и время — одной строкой; «Сейчас играет» — в строке плеера', async () => {
    const restore = mockMobile();
    try {
      renderP5();
      await screen.findByText(/первая длинная реплика/);
      const seg = document.querySelector('[data-seg-start="0"]');
      const head = seg.querySelector('[data-seg-head]');
      expect(head).toBeTruthy();
      expect(head.querySelector('[data-testid="seg-speaker"]')).toBeTruthy();
      expect(within(head).getByRole('button', { name: /Перейти к/ })).toBeTruthy();
      // «Сейчас играет» живёт в строке плеера, а не отдельной строкой ниже.
      const np = screen.getByRole('button', { name: /Сейчас играет/ });
      expect(np.closest('[data-player-row]')).toBeTruthy();
    } finally {
      restore();
    }
  });

  it('P5-3: на ≥sm разметка прежняя — имя строкой над репликой, время в колонке', async () => {
    renderP5();
    await screen.findByText(/первая длинная реплика/);
    const seg = document.querySelector('[data-seg-start="0"]');
    expect(seg.querySelector('[data-seg-head]')).toBeNull();
  });

  it('P5-5: счётчик — «Реплика N из M с совпадениями»; подсветка — цвет темы, не #ff0', async () => {
    renderP5();
    const input = await screen.findByPlaceholderText('Поиск по тексту…');
    fireEvent.change(input, { target: { value: 'реплика' } });
    expect(await screen.findByText('Реплика 1 из 4 с совпадениями')).toBeInTheDocument();
    const mark = document.querySelector('mark');
    expect(mark).toBeTruthy();
    expect(getComputedStyle(mark).backgroundColor).not.toBe('rgb(255, 255, 0)');
  });

  it('время короче часа — MM:SS без ведущего «0:»', async () => {
    renderP5();
    expect(await screen.findByText('0:07')).toBeInTheDocument();
    expect(screen.queryByText('0:00:07')).not.toBeInTheDocument();
  });
});

describe('VoiceMeetingDrawer: фаза 6 — производительность и доводка (T46–T53)', () => {
  const manySegs = (n) => Array.from({ length: n }, (_, i) => ({
    speaker: ['S1', 'S2'][i % 2],
    text: `реплика ${i}`,
    start: i * 2,
    start_time_formatted: '00:00',
  }));
  const renderP6 = (extra = {}) => render(
    <ThemeProvider theme={theme}>
      <VoiceMeetingDrawer
        open
        meeting={makeMeeting('A_base', { has_media: true, ...extra })}
        onClose={vi.fn()}
        canManage
        voices={[{ name: 'Иван Петров' }]}
      />
    </ThemeProvider>,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.__vlistCalls = { scrollToItem: [], scrollTo: [] };
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.pause = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    voiceJobsAPI.getTranscript.mockResolvedValue({ segments: manySegs(10), total: 10 });
    voiceJobsAPI.getTopics.mockResolvedValue({ items: [{ title: 'Тема 1', start: 0, end: 60 }] });
    voiceJobsAPI.getAssignments.mockResolvedValue({ items: [] });
    voiceJobsAPI.getAssignmentStatuses.mockResolvedValue({ items: [] });
  });

  it('T47: виртуализация — в DOM ограниченное окно строк, «Показать ещё» нет', async () => {
    voiceJobsAPI.getTranscript.mockResolvedValue({ segments: manySegs(1500), total: 1500 });
    renderP6();
    await screen.findByText('реплика 0');
    const rows = document.querySelectorAll('[data-seg-start]').length;
    expect(rows).toBeLessThanOrEqual(120);
    expect(screen.queryByText(/Показать ещё/)).not.toBeInTheDocument();
  });

  it('T47/T49: переход по теме к дальней реплике — scrollToItem, цель в DOM', async () => {
    voiceJobsAPI.getTranscript.mockResolvedValue({ segments: manySegs(1500), total: 1500 });
    voiceJobsAPI.getTopics.mockResolvedValue({ items: [{ title: 'Поздняя тема', start: 2000, end: 2500 }] });
    renderP6();
    await screen.findByText('реплика 0');
    fireEvent.click(screen.getByRole('button', { name: /Перейти к теме «Поздняя тема»/ }));
    await waitFor(() => expect(globalThis.__vlistCalls.scrollToItem.length).toBeGreaterThan(0));
    // Цель (реплика с start≈2000 → индекс 1000) оказывается в окне и в DOM.
    await screen.findByText('реплика 1000');
    expect(document.querySelector('[data-seg-start="2000"]')).toBeTruthy();
  });

  it('T46: смена активной реплики перерисовывает ≤2 строк', async () => {
    renderP6();
    await screen.findByText('реплика 0');
    const video = document.querySelector('video');
    const list = document.querySelector('[data-vlist]');
    const mutations = [];
    const obs = new MutationObserver((ms) => mutations.push(...ms));
    obs.observe(list, { attributes: true, childList: true, subtree: true });
    act(() => { video.currentTime = 5; fireEvent(video, new Event('seeked')); });
    // Активность переехала с реплики 0 на реплику 2 (start=4): атрибут
    // поменялся максимум у двух строк, новых DOM-узлов нет.
    const attr = mutations.filter((m) => m.attributeName === 'data-seg-active');
    expect(attr.length).toBeLessThanOrEqual(2);
    expect(mutations.filter((m) => m.type === 'childList').length).toBe(0);
    obs.disconnect();
  });

  it('T49: слежение — строка в видимой зоне → прокрутка не вызывается', async () => {
    renderP6();
    await screen.findByText('реплика 0');
    const video = document.querySelector('video');
    act(() => { fireEvent(video, new Event('play')); });
    globalThis.__vlistCalls.scrollToItem.length = 0;
    window.HTMLElement.prototype.scrollIntoView.mockClear();
    // Активная реплика остаётся в видимом окне (все jsdom-rect = 0 → в зоне):
    // ни scrollToItem, ни scrollIntoView не вызываются.
    act(() => { video.currentTime = 3; fireEvent(video, new Event('seeked')); });
    expect(globalThis.__vlistCalls.scrollToItem.length).toBe(0);
    expect(window.HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it('T49: слежение — дальняя активная реплика догоняется мгновенным переходом', async () => {
    voiceJobsAPI.getTranscript.mockResolvedValue({ segments: manySegs(1500), total: 1500 });
    renderP6();
    await screen.findByText('реплика 0');
    const video = document.querySelector('video');
    act(() => { fireEvent(video, new Event('play')); });
    act(() => { video.currentTime = 2000; fireEvent(video, new Event('seeked')); });
    await waitFor(() => expect(globalThis.__vlistCalls.scrollToItem.length).toBeGreaterThan(0));
  });

  it('T48: ввод обновляет поле сразу, подсветка — после deferred-значения', async () => {
    voiceJobsAPI.getTranscript.mockResolvedValue({ segments: manySegs(300), total: 300 });
    renderP6();
    const input = await screen.findByPlaceholderText('Поиск по тексту…');
    fireEvent.change(input, { target: { value: 'реплика 7' } });
    // Поле контролируемое — значение видно сразу, не ждёт deferred.
    expect(input).toHaveValue('реплика 7');
    // «реплика 7» — подстрока «реплика 7» и «реплика 70..79» → 11 совпадений.
    await waitFor(() => expect(screen.getByText(/Реплика 1 из 11 с совпадениями/)).toBeInTheDocument());
    expect(document.querySelectorAll('mark').length).toBeGreaterThan(0);
  });

  it('T53: без тем строка «Сейчас играет» не показывается', async () => {
    voiceJobsAPI.getTopics.mockResolvedValue({ items: [] });
    renderP6();
    await screen.findByText('реплика 0');
    const video = document.querySelector('video');
    act(() => {
      Object.defineProperty(video, 'duration', { value: 300, configurable: true });
      fireEvent(video, new Event('loadedmetadata'));
    });
    expect(screen.queryByRole('button', { name: /Сейчас играет/ })).not.toBeInTheDocument();
  });

  it('T51: «Назвать» — только у первого появления неназванного участника', async () => {
    voiceJobsAPI.getTranscript.mockResolvedValue({
      segments: [
        { speaker: 'SPEAKER_00', text: 'первая', start: 0, start_time_formatted: '00:00' },
        { speaker: 'S1', text: 'вторая', start: 2, start_time_formatted: '00:02' },
        { speaker: 'SPEAKER_00', text: 'третья — тот же участник', start: 4, start_time_formatted: '00:04' },
        { speaker: 'SPEAKER_01', text: 'четвёртая — второй безымянный', start: 6, start_time_formatted: '00:06' },
      ],
      total: 4,
    });
    renderP6({
      speakers: {
        resolved: [{ name: 'S1' }],
        unresolved: [
          { speaker: 'SPEAKER_00', has_sample: false },
          { speaker: 'SPEAKER_01', has_sample: false },
        ],
      },
    });
    await screen.findByText('первая');
    const nameBtns = screen.getAllByRole('button', { name: /^Назвать — / });
    expect(nameBtns.length).toBe(2);
  });

  it('T51: клик по имени безымянного участника открывает ввод имени на месте', async () => {
    voiceJobsAPI.getTranscript.mockResolvedValue({
      segments: [{ speaker: 'SPEAKER_00', text: 'реплика', start: 0, start_time_formatted: '00:00' }],
      total: 1,
    });
    renderP6({ speakers: { resolved: [], unresolved: [{ speaker: 'SPEAKER_00', has_sample: false }] } });
    await screen.findByText('реплика');
    fireEvent.click(document.querySelector('[data-testid="seg-speaker"]'));
    expect(await screen.findByLabelText('Кто это?')).toBeInTheDocument();
    // Выбор имени из поповера ставит ту же задачу переименования, что вкладка.
    const input = screen.getByLabelText('Кто это?');
    fireEvent.change(input, { target: { value: 'Иван Петров' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    // Та же задача переименования, что и на вкладке: счётчик кнопки вырос.
    fireEvent.click(screen.getByRole('tab', { name: /Участники/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Сохранить имена \(1\)/ })).toBeInTheDocument());
  });

  it('T50: вкладка «Участники» — компактные строки без SPEAKER_, со статистикой', async () => {
    voiceJobsAPI.getTranscript.mockResolvedValue({
      segments: [
        { speaker: 'SPEAKER_00', text: 'а', start: 0, start_time_formatted: '00:00', end: 5 },
        { speaker: 'SPEAKER_00', text: 'б', start: 5, start_time_formatted: '00:05', end: 10 },
        { speaker: 'S1', text: 'в', start: 10, start_time_formatted: '00:10', end: 20 },
      ],
      total: 3,
    });
    renderP6({
      speakers: {
        resolved: [{ name: 'S1' }],
        unresolved: [{ speaker: 'SPEAKER_00', has_sample: false }],
      },
    });
    await screen.findByText('а');
    fireEvent.click(screen.getByRole('tab', { name: /Участники/ }));
    const rows = await screen.findAllByTestId('speaker-row');
    expect(rows.length).toBe(2);
    const panelText = rows.map((r) => r.textContent).join(' ');
    expect(panelText).not.toMatch(/SPEAKER_\d+/);
    expect(panelText).toMatch(/реплик/);
    // Одна закреплённая кнопка сохранения с количеством заполненных имён.
    expect(screen.getAllByRole('button', { name: /Сохранить имена/ }).length).toBe(1);
  });

  it('T52: у видео-записи есть «Большое видео» и «Во весь экран»', async () => {
    renderP6();
    await screen.findByText('реплика 0');
    const video = document.querySelector('video');
    act(() => {
      Object.defineProperty(video, 'videoHeight', { value: 360, configurable: true });
      Object.defineProperty(video, 'duration', { value: 300, configurable: true });
      fireEvent(video, new Event('loadedmetadata'));
    });
    const big = await screen.findByRole('button', { name: 'Большое видео' });
    expect(screen.getByRole('button', { name: 'Во весь экран' })).toBeInTheDocument();
    const before = video.style.maxHeight;
    fireEvent.click(big);
    expect(video.style.maxHeight).not.toBe(before);
  });
});

describe('VoiceMeetingDrawer: доработка по «Ревью 14» (T55, P6-2)', () => {
  const segs14 = [
    { speaker: 'S1', text: 'первая реплика', start: 0, start_time_formatted: '00:00', end: 5 },
    { speaker: 'S1', text: 'вторая реплика', start: 90, start_time_formatted: '01:30', end: 95 },
    { speaker: 'S2', text: 'третья реплика', start: 150, start_time_formatted: '02:30', end: 160 },
  ];
  const render14 = (extra = {}) => render(
    <ThemeProvider theme={theme}>
      <VoiceMeetingDrawer
        open
        meeting={makeMeeting('A_base', { has_media: true, ...extra })}
        onClose={vi.fn()}
        canManage
        voices={[]}
      />
    </ThemeProvider>,
  );
  const trackRect = {
    left: 0, top: 0, width: 900, height: 24, right: 900, bottom: 24, x: 0, y: 0, toJSON: () => ({}),
  };
  const mockTrackRect = (slider) => vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue(trackRect);
  // jsdom не знает PointerEvent: fireEvent.pointer* теряет clientX —
  // шлём MouseEvent с нужным type, React его распознаёт как pointer-*.
  const firePointer = (el, type, init = {}) => {
    act(() => {
      el.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
    });
  };
  const setDuration = (sec) => {
    const video = document.querySelector('video');
    act(() => {
      Object.defineProperty(video, 'duration', { value: sec, configurable: true });
      fireEvent(video, new Event('loadedmetadata'));
    });
    return video;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.__vlistCalls = { scrollToItem: [], scrollTo: [] };
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.pause = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    voiceJobsAPI.getTranscript.mockResolvedValue({ segments: segs14, total: 3 });
    voiceJobsAPI.getTopics.mockResolvedValue({
      items: [
        { title: 'Тема первая', start: 0, end: 90 },
        { title: 'Вторая тема', start: 90, end: 180 },
      ],
    });
    voiceJobsAPI.getAssignments.mockResolvedValue({
      items: [
        { num: 1, time: '01:00', task: 'Сделать отчёт', assignee: 'Иван', deadline: '01.10.2026', clip: 'clip1.mp4' },
      ],
    });
    voiceJobsAPI.getAssignmentStatuses.mockResolvedValue({ items: [] });
  });

  it('T55: клик поверх отрезка темы — позиция = доля × длительность, не начало темы', async () => {
    render14();
    await screen.findByText('первая реплика');
    const video = setDuration(180);
    const slider = await screen.findByRole('slider', { name: 'Шкала записи' });
    mockTrackRect(slider);
    // «Вторая тема» покрывает 50–100% шкалы: клик на 77% — не к её началу (90с), а в точку.
    const seg2 = within(slider).getByRole('button', { name: /Тема «Вторая тема»/ });
    fireEvent.click(seg2, { clientX: 693 });
    expect(video.currentTime).toBeCloseTo(138.6, 1);
    // «Тема первая» покрывает 0–50%: клик на 33% — не к 0, а в точку.
    const seg1 = within(slider).getByRole('button', { name: /Тема «Тема первая»/ });
    fireEvent.click(seg1, { clientX: 297 });
    expect(video.currentTime).toBeCloseTo(59.4, 1);
    // Отрезки не перехватывают указатель.
    expect(window.getComputedStyle(seg2).pointerEvents).toBe('none');
  });

  it('T55: перетаскивание ползунка — перемотка при отпускании, подсказка в процессе', async () => {
    render14();
    await screen.findByText('первая реплика');
    const video = setDuration(180);
    const slider = await screen.findByRole('slider', { name: 'Шкала записи' });
    mockTrackRect(slider);
    firePointer(slider, 'pointerdown', { clientX: 450 });
    firePointer(slider, 'pointermove', { clientX: 693 });
    // Пока тянем — плеер стоит, подсказка показывает целевую точку и тему.
    expect(video.currentTime).toBe(0);
    const hint = await screen.findByTestId('timeline-hint');
    expect(hint).toHaveTextContent('2:18');
    expect(hint).toHaveTextContent('Вторая тема');
    firePointer(slider, 'pointerup', { clientX: 693 });
    expect(video.currentTime).toBeCloseTo(138.6, 1);
  });

  it('T55: наведение на шкалу — подсказка «время · тема»', async () => {
    render14();
    await screen.findByText('первая реплика');
    setDuration(180);
    const slider = await screen.findByRole('slider', { name: 'Шкала записи' });
    mockTrackRect(slider);
    firePointer(slider, 'pointermove', { clientX: 600 });
    const hint = await screen.findByTestId('timeline-hint');
    expect(hint).toHaveTextContent('2:00');
    expect(hint).toHaveTextContent('Вторая тема');
    firePointer(slider, 'pointerout', { relatedTarget: document.body });
    expect(screen.queryByTestId('timeline-hint')).not.toBeInTheDocument();
  });

  it('T55: клавиатура — ←/→ ±5 с, Shift+←/→ ±15 с, Home/End', async () => {
    render14();
    await screen.findByText('первая реплика');
    const video = setDuration(180);
    const slider = await screen.findByRole('slider', { name: 'Шкала записи' });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(video.currentTime).toBe(5);
    fireEvent.keyDown(slider, { key: 'ArrowRight', shiftKey: true });
    expect(video.currentTime).toBe(15);
    fireEvent.keyDown(slider, { key: 'End' });
    expect(video.currentTime).toBe(180);
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(video.currentTime).toBe(0);
  });

  it('T55: на шкале есть заливка прогресса и бегунок', async () => {
    render14();
    await screen.findByText('первая реплика');
    setDuration(180);
    const slider = await screen.findByRole('slider', { name: 'Шкала записи' });
    expect(slider.querySelector('[data-testid="timeline-progress"]')).toBeTruthy();
    expect(slider.querySelector('[data-testid="timeline-thumb"]')).toBeTruthy();
  });

  it('P6-2: имя «Участник N (без имени)» во вкладке участников не обрезается', async () => {
    render14({
      speakers: {
        resolved: [],
        unresolved: [{ speaker: 'SPEAKER_00', has_sample: false, first_segment_start: 0, suggested_name: 'Иван' }],
      },
    });
    await screen.findByText('первая реплика');
    fireEvent.click(screen.getByRole('tab', { name: /Участники/ }));
    const row = await screen.findByTestId('speaker-row');
    const nameEl = within(row).getByText(/Участник 1 \(без имени\)/);
    // Имя переносится, а не схлопывается в многоточие.
    expect(window.getComputedStyle(nameEl).whiteSpace).not.toBe('nowrap');
    const stack = row.querySelector('.MuiStack-root');
    expect(window.getComputedStyle(stack).flexWrap).toBe('wrap');
  });
});
