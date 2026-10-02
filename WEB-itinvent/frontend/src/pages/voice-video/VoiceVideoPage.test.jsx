import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import VoiceVideoPage from './VoiceVideoPage';
import { voiceJobsAPI } from '../../api/voiceJobs';
import { voiceVoicesAPI } from '../../api/voiceVoices';

const authState = vi.hoisted(() => ({
  permissions: new Set(['voice.read', 'voice.upload', 'voice.manage', 'tasks.create', 'tasks.write']),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    hasPermission: (p) => authState.permissions.has(p),
    user: { username: 'tester' },
  }),
}));

vi.mock('../../components/layout/MainLayout', () => ({
  default: ({ children }) => <div>{children}</div>,
}));

vi.mock('../../components/layout/MobileShellPageHeader', () => ({
  default: () => null,
}));

vi.mock('../../components/layout/PageShell', () => ({
  default: ({ children }) => <div>{children}</div>,
}));

vi.mock('../../api/voiceJobs', () => ({
  voiceJobsAPI: {
    listJobs: vi.fn(),
    listMeetings: vi.fn(),
    getOptions: vi.fn(),
    getOverview: vi.fn(),
    getMeeting: vi.fn(),
    getTranscript: vi.fn().mockResolvedValue({ segments: [], total: 0 }),
    getTopics: vi.fn().mockResolvedValue({ items: [] }),
    getAssignments: vi.fn().mockResolvedValue({ items: [] }),
    getAssignmentStatuses: vi.fn().mockResolvedValue({ items: [] }),
    resolveShareLink: vi.fn(),
    createShareLink: vi.fn(),
    revokeShareLink: vi.fn(),
    exportReportsZip: vi.fn(),
    uploadJob: vi.fn(),
    cancelJob: vi.fn(),
    retryJob: vi.fn(),
    deleteJob: vi.fn(),
    deleteMeeting: vi.fn(),
    mediaUrl: vi.fn((base) => `/api/v1/voice/meetings/${base}/media`),
    speakerSampleUrl: vi.fn((base, sp) => `/api/v1/voice/meetings/${base}/speakers/${sp}/sample`),
    reportUrl: vi.fn((base, name) => `/api/v1/voice/meetings/${base}/reports/${name}`),
    clipUrl: vi.fn((base, name) => `/api/v1/voice/meetings/${base}/clips/${name}`),
  },
}));

vi.mock('../../api/voiceVoices', () => ({
  voiceVoicesAPI: {
    list: vi.fn().mockResolvedValue({ items: [] }),
    sampleUrl: vi.fn((name, file) => `/api/v1/voice/voices/${name}/sample`),
  },
}));

vi.mock('../../api/hubTaskSupport', () => ({
  hubTaskSupportAPI: { getAssignees: vi.fn().mockResolvedValue({ items: [] }) },
}));

vi.mock('../../api/hubTasks', () => ({
  hubTasksAPI: { createTask: vi.fn().mockResolvedValue({}) },
}));

const IDLE_POLL_MS = 30000;

const deferred = () => {
  const holder = {};
  holder.promise = new Promise((resolve, reject) => {
    holder.resolve = resolve;
    holder.reject = reject;
  });
  return holder;
};

const err500 = (detail) => Object.assign(new Error('Server Error'), {
  response: { data: { detail } },
});

const canceledError = () => Object.assign(new Error('canceled'), {
  code: 'ERR_CANCELED',
  name: 'CanceledError',
});

// Промис отвечает data, если его не отменили (как axios: reject с ERR_CANCELED при abort).
const abortableResolved = (data, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(canceledError());
    return;
  }
  signal?.addEventListener('abort', () => reject(canceledError()), { once: true });
  Promise.resolve().then(() => {
    if (!signal?.aborted) resolve(data);
  });
});

// Оборачивает отложенный промис в отмену по AbortSignal.
const raceAbort = (promise, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(canceledError());
    return;
  }
  signal?.addEventListener('abort', () => reject(canceledError()), { once: true });
  promise.then(resolve, reject);
});

afterEach(() => {
  // URL-state tests and opened cards must not leak the `meeting` query across tests.
  window.history.replaceState({}, '', '/voice');
});

// jsdom не реализует HTMLMediaElement.pause/play (звонит в useSingleAudio при закрытии карточки).
window.HTMLMediaElement.prototype.pause = () => {};
window.HTMLMediaElement.prototype.play = () => Promise.resolve();

describe('VoiceVideoPage: polling', () => {
  let hiddenValue;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    hiddenValue = false;
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => hiddenValue,
    });
    voiceJobsAPI.listJobs.mockResolvedValue({ items: [], queue: { queued: 0, processing: 0 } });
    voiceJobsAPI.listMeetings.mockResolvedValue({ items: [], total: 0 });
    voiceJobsAPI.getOptions.mockResolvedValue({});
    voiceJobsAPI.getOverview.mockResolvedValue({ voicevideo_root_exists: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    hiddenValue = false;
    // Убрать собственный getter document.hidden, чтобы pause-on-hidden не утекал в другие тесты.
    delete document.hidden;
  });

  const fireVisibility = async (times = 1) => {
    await act(async () => {
      for (let i = 0; i < times; i += 1) {
        document.dispatchEvent(new Event('visibilitychange'));
      }
    });
  };

  it('N событий visibilitychange не увеличивают число тиков за интервал', async () => {
    render(<VoiceVideoPage />);
    await act(async () => {}); // стартовые запросы
    const startup = voiceJobsAPI.listJobs.mock.calls.length;

    // Базовый ритм: один интервал простоя → ровно один тик.
    await act(async () => {
      vi.advanceTimersByTime(IDLE_POLL_MS);
    });
    expect(voiceJobsAPI.listJobs.mock.calls.length).toBe(startup + 1);

    // Возврат на вкладку: 5 событий visibilitychange подряд.
    await fireVisibility(5);

    // Дальше каждый интервал даёт ровно один тик — цепочки не накапливаются.
    let prev = voiceJobsAPI.listJobs.mock.calls.length;
    for (let interval = 0; interval < 3; interval += 1) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        vi.advanceTimersByTime(IDLE_POLL_MS);
      });
      expect(voiceJobsAPI.listJobs.mock.calls.length - prev).toBe(1);
      prev = voiceJobsAPI.listJobs.mock.calls.length;
    }
  });

  it('при document.hidden запросов нет', async () => {
    render(<VoiceVideoPage />);
    await act(async () => {}); // стартовые запросы
    hiddenValue = true;
    await fireVisibility(1);
    const beforeJobs = voiceJobsAPI.listJobs.mock.calls.length;
    const beforeMeetings = voiceJobsAPI.listMeetings.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(IDLE_POLL_MS * 3);
    });
    expect(voiceJobsAPI.listJobs.mock.calls.length).toBe(beforeJobs);
    expect(voiceJobsAPI.listMeetings.mock.calls.length).toBe(beforeMeetings);
  });
});

describe('VoiceVideoPage: ошибки мутаций и права действий', () => {
  const ownActiveJob = {
    id: 'job-1', status: 'processing', kind: 'process', created_by: 'tester',
    original_filename: 'zapis1.mp3', created_at: '2026-09-29T10:00:00Z',
  };
  const ownFailedJob = {
    id: 'job-2', status: 'failed', kind: 'process', created_by: 'tester',
    original_filename: 'zapis2.mp3', created_at: '2026-09-29T09:00:00Z', error: 'упала',
  };
  const meeting = {
    base_filename: 'jbbbb2222222222_Soveshhanie', modified_at: '2026-09-29T10:00:00Z',
    segments_count: 3, reports: [], unresolved_count: 0, tags: [], project: '',
  };
  const err403 = (detail) => Object.assign(new Error('Forbidden'), {
    response: { data: { detail } },
  });

  let confirmSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    authState.permissions = new Set(['voice.read', 'voice.upload', 'voice.manage', 'tasks.create', 'tasks.write']);
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    voiceJobsAPI.listJobs.mockResolvedValue({
      items: [ownActiveJob, ownFailedJob], queue: { queued: 0, processing: 1 },
    });
    voiceJobsAPI.listMeetings.mockResolvedValue({ items: [meeting], total: 1 });
    voiceJobsAPI.getOptions.mockResolvedValue({});
    voiceJobsAPI.getOverview.mockResolvedValue({ voicevideo_root_exists: true });
  });

  afterEach(() => {
    confirmSpy.mockRestore();
  });

  it('403 при отмене задачи: сообщение из detail, кнопка снова активна', async () => {
    let rejectCancel;
    voiceJobsAPI.cancelJob.mockImplementation(() => new Promise((resolve, reject) => {
      rejectCancel = reject;
    }));
    render(<VoiceVideoPage />);
    await act(async () => {});
    fireEvent.click(screen.getByText('Задачи'));
    fireEvent.click(screen.getByRole('button', { name: 'Действия с задачей zapis1.mp3' }));
    const item = screen.getByRole('menuitem', { name: 'Отменить задачу' });
    fireEvent.click(item);
    // Пункт живёт в меню «⋮»: во время запроса меню закрыто, после ошибки
    // пункт снова доступен (сообщение берётся из detail).
    await waitFor(() => {
      expect(screen.queryByRole('menuitem', { name: 'Отменить задачу' })).not.toBeInTheDocument();
    });
    await act(async () => {
      rejectCancel(err403('Недостаточно прав: отмена задач недоступна'));
    });
    await screen.findByText('Недостаточно прав: отмена задач недоступна');
    fireEvent.click(screen.getByRole('button', { name: 'Действия с задачей zapis1.mp3' }));
    expect(screen.getByRole('menuitem', { name: 'Отменить задачу' })).toBeEnabled();
  });

  it('403 при повторе и удалении задачи: сообщение из detail', async () => {
    voiceJobsAPI.retryJob.mockRejectedValue(err403('Повтор запрещён'));
    voiceJobsAPI.deleteJob.mockRejectedValue(err403('Удаление запрещено'));
    render(<VoiceVideoPage />);
    await act(async () => {});
    fireEvent.click(screen.getByText('Задачи'));
    // Список обновляется после каждой мутации, поэтому кнопку «⋮» ищем заново.
    // Повтор и удаление доступны у упавшей задачи zapis2.mp3.
    const menu = () => screen.getByRole('button', { name: 'Действия с задачей zapis2.mp3' });
    fireEvent.click(menu());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Повторить задачу' }));
    await screen.findByText('Повтор запрещён');
    // Пока меню не размонтировано, MUI помечает остальную страницу как aria-hidden —
    // ждём закрытия, иначе кнопка «⋮» не находится по роли.
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: 'Повторить задачу' })).not.toBeInTheDocument());
    fireEvent.click(menu());
    expect(screen.getByRole('menuitem', { name: 'Повторить задачу' })).toBeEnabled();
    // Закрываем меню Esc: пока оно открыто, MUI помечает остальную страницу как aria-hidden.
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Повторить задачу' }), { key: 'Escape' });

    fireEvent.click(menu());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить задачу' }));
    await screen.findByText('Удаление запрещено');
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: 'Удалить задачу' })).not.toBeInTheDocument());
    fireEvent.click(menu());
    expect(screen.getByRole('menuitem', { name: 'Удалить задачу' })).toBeEnabled();
  });

  it('403 при удалении протокола: сообщение из detail, кнопка снова активна', async () => {
    let rejectDelete;
    voiceJobsAPI.deleteMeeting.mockImplementation(() => new Promise((resolve, reject) => {
      rejectDelete = reject;
    }));
    render(<VoiceVideoPage />);
    await act(async () => {});
    const menuButton = screen.getByRole('button', { name: /^Действия с протоколом / });
    fireEvent.click(menuButton);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить протокол' }));
    // Пункт удаления живёт в меню «⋮»: во время запроса он недоступен, а после
    // ошибки доступен снова (сообщение из detail).
    await waitFor(() => {
      expect(screen.queryByRole('menuitem', { name: 'Удалить протокол' })).not.toBeInTheDocument();
    });
    await act(async () => {
      rejectDelete(err403('Удаление протоколов запрещено'));
    });
    await screen.findByText('Удаление протоколов запрещено');
    fireEvent.click(screen.getByRole('button', { name: /^Действия с протоколом / }));
    expect(screen.getByRole('menuitem', { name: 'Удалить протокол' })).toBeEnabled();
  });

  it('пункты отмены и повтора владельцу видны только при voice.upload', async () => {
    authState.permissions = new Set(['voice.read']);
    const first = render(<VoiceVideoPage />);
    await act(async () => {});
    fireEvent.click(screen.getByText('Задачи'));
    // T26: права прежние — пункт появляется только после открытия меню «⋮».
    fireEvent.click(screen.getByRole('button', { name: 'Действия с задачей zapis1.mp3' }));
    expect(screen.queryByRole('menuitem', { name: 'Отменить задачу' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Повторить задачу' })).not.toBeInTheDocument();
    first.unmount();

    authState.permissions = new Set(['voice.read', 'voice.upload']);
    render(<VoiceVideoPage />);
    await act(async () => {});
    fireEvent.click(screen.getByText('Задачи'));
    fireEvent.click(screen.getByRole('button', { name: 'Действия с задачей zapis1.mp3' }));
    expect(screen.getByRole('menuitem', { name: 'Отменить задачу' })).toBeInTheDocument();
  });
});

describe('VoiceVideoPage: карточка встречи (refreshMeeting)', () => {
  const meetA = {
    base_filename: 'jdddd44444444_A_meet', modified_at: '2026-09-29T10:00:00Z',
    segments_count: 3, reports: [], unresolved_count: 0, tags: [], project: '',
  };
  const meetB = {
    base_filename: 'jdddd55555555_B_meet', modified_at: '2026-09-29T11:00:00Z',
    segments_count: 5, reports: [], unresolved_count: 0, tags: [], project: '',
  };
  const detailA = {
    base_filename: meetA.base_filename, reports: [],
    speakers: { resolved: [], unresolved: [] }, media_parts: [], jobs: [], has_media: false,
  };
  const detailB = {
    base_filename: meetB.base_filename, reports: [],
    speakers: { resolved: [], unresolved: [] }, media_parts: [], jobs: [], has_media: false,
  };
  const err500 = (detail) => Object.assign(new Error('Server Error'), {
    response: { data: { detail } },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    authState.permissions = new Set(['voice.read', 'voice.upload', 'voice.manage', 'tasks.create', 'tasks.write']);
    voiceJobsAPI.listJobs.mockResolvedValue({ items: [], queue: { queued: 0, processing: 0 } });
    voiceJobsAPI.listMeetings.mockResolvedValue({ items: [meetA, meetB], total: 2 });
    voiceJobsAPI.getOptions.mockResolvedValue({});
    voiceJobsAPI.getOverview.mockResolvedValue({ voicevideo_root_exists: true });
  });

  it('ошибка загрузки карточки: сообщение и «Повторить» вместо вечного спиннера', async () => {
    voiceJobsAPI.getMeeting.mockRejectedValueOnce(err500('Сервер недоступен, попробуйте позже'));
    voiceJobsAPI.getMeeting.mockResolvedValueOnce(detailA);
    render(<VoiceVideoPage />);
    await act(async () => {});
    fireEvent.click(screen.getByText('A_meet'));
    await screen.findByText('Сервер недоступен, попробуйте позже');
    const retry = screen.getByRole('button', { name: 'Повторить' });
    fireEvent.click(retry);
    await screen.findByRole('tab', { name: 'Темы' });
    expect(voiceJobsAPI.getMeeting).toHaveBeenCalledTimes(2);
  });

  it('ответ старого запроса не перезаписывает новую карточку', async () => {
    const reqA = deferred();
    const reqB = deferred();
    voiceJobsAPI.getMeeting.mockImplementation((base) => (
      base === meetA.base_filename ? reqA.promise : reqB.promise
    ));
    render(<VoiceVideoPage />);
    await act(async () => {});
    fireEvent.click(screen.getByText('A_meet'));
    // Закрыть и открыть B, пока детали A ещё грузятся.
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('B_meet'));
    await act(async () => {
      reqB.resolve(detailB);
    });
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('B_meet')).toBeInTheDocument();
    // Поздний ответ A не должен перезаписать карточку B.
    await act(async () => {
      reqA.resolve(detailA);
    });
    expect(within(dialog).getByText('B_meet')).toBeInTheDocument();
    expect(within(dialog).queryByText('A_meet')).not.toBeInTheDocument();
  });

  it('после закрытия карточка не открывается заново из позднего ответа', async () => {
    const reqA = deferred();
    voiceJobsAPI.getMeeting.mockImplementation(() => reqA.promise);
    render(<VoiceVideoPage />);
    await act(async () => {});
    fireEvent.click(screen.getByText('A_meet'));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    await act(async () => {
      reqA.resolve(detailA);
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('VoiceVideoPage: карточка обновляется с polling при resume-задаче (V06)', () => {
  const meetR = {
    base_filename: 'jdddd66666666_R_meet', modified_at: '2026-09-29T12:00:00Z',
    segments_count: 4, reports: [], unresolved_count: 0, tags: [], project: '',
  };
  const detailProcessing = {
    base_filename: meetR.base_filename, reports: [],
    speakers: { resolved: [], unresolved: [] }, media_parts: [], has_media: false,
    jobs: [{ id: 'jr1', kind: 'resume', status: 'processing' }],
  };
  const detailDone = {
    ...detailProcessing,
    jobs: [{ id: 'jr1', kind: 'resume', status: 'done' }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    authState.permissions = new Set(['voice.read', 'voice.upload', 'voice.manage']);
    voiceJobsAPI.listJobs.mockResolvedValue({ items: [], queue: { queued: 0, processing: 0 } });
    voiceJobsAPI.listMeetings.mockResolvedValue({ items: [meetR], total: 1 });
    voiceJobsAPI.getOptions.mockResolvedValue({});
    voiceJobsAPI.getOverview.mockResolvedValue({ voicevideo_root_exists: true });
    // Детерминированный мок без mockResolvedValueOnce: в полном прогоне очереди «once»
    // соседних тестов мешают порядку ответов.
    voiceJobsAPI.getMeeting.mockReset();
    let meetingCalls = 0;
    voiceJobsAPI.getMeeting.mockImplementation(() => {
      meetingCalls += 1;
      return Promise.resolve(meetingCalls === 1 ? detailProcessing : detailDone);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('баннер «Имена обновляются» снимается после завершения resume-задачи', async () => {
    render(<VoiceVideoPage />);
    await act(async () => {});
    fireEvent.click(screen.getByText('R_meet'));
    await act(async () => {});
    expect(screen.getByText(/Имена обновляются/)).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(IDLE_POLL_MS);
    });
    await act(async () => {});
    expect(voiceJobsAPI.getMeeting).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/Имена обновляются/)).not.toBeInTheDocument();
  });
});

describe('VoiceVideoPage: состояния списков (V04)', () => {
  const meetL = {
    base_filename: 'jdddd77777777_L_meet', modified_at: '2026-09-29T13:00:00Z',
    segments_count: 2, reports: [], unresolved_count: 0, tags: [], project: '',
  };
  const err500 = (detail) => Object.assign(new Error('Server Error'), {
    response: { data: { detail } },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    authState.permissions = new Set(['voice.read', 'voice.upload', 'voice.manage']);
    voiceJobsAPI.listJobs.mockResolvedValue({ items: [], queue: { queued: 0, processing: 0 } });
    voiceJobsAPI.listMeetings.mockResolvedValue({ items: [meetL], total: 1 });
    voiceVoicesAPI.list.mockResolvedValue({ items: [] });
    voiceJobsAPI.getOptions.mockResolvedValue({});
    voiceJobsAPI.getOverview.mockResolvedValue({ voicevideo_root_exists: true });
  });

  it('ошибка протоколов: без пустого состояния и CTA, с «Повторить»', async () => {
    voiceJobsAPI.listMeetings.mockRejectedValue(err500('Сервер протоколов недоступен'));
    render(<VoiceVideoPage />);
    await screen.findByText('Сервер протоколов недоступен');
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
    expect(screen.queryByText(/Здесь появятся готовые протоколы/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Загрузить запись' })).not.toBeInTheDocument();
    // Повторный запуск показывает данные.
    voiceJobsAPI.listMeetings.mockResolvedValue({ items: [meetL], total: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await screen.findByText('L_meet');
  });

  it('ошибка задач на другой вкладке не теряется молча', async () => {
    voiceJobsAPI.listJobs.mockRejectedValue(err500('Список задач недоступен'));
    render(<VoiceVideoPage />);
    await act(async () => {});
    // Активна вкладка «Протоколы», но ошибка «Задач» видна.
    expect(screen.getByText('Список задач недоступен')).toBeInTheDocument();
  });

  it('до успешной загрузки задач в сводке нет ложного «Готово: 0»', async () => {
    voiceJobsAPI.listJobs.mockRejectedValue(err500('Список задач недоступен'));
    render(<VoiceVideoPage />);

    await screen.findByText('Список задач недоступен');
    expect(screen.getByText('Готово: —')).toBeInTheDocument();
    expect(screen.queryByText('Готово: 0')).not.toBeInTheDocument();
  });

  it('ошибка задач: без пустого состояния и CTA', async () => {
    voiceJobsAPI.listJobs.mockRejectedValue(err500('Задачи недоступны'));
    render(<VoiceVideoPage />);
    await act(async () => {});
    fireEvent.click(screen.getByText('Задачи'));
    await screen.findByText('Задачи недоступны');
    expect(screen.queryByText(/Задач пока нет/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Загрузить запись' })).not.toBeInTheDocument();
  });

  it('у «Голосов» есть loading и error, без ложного пустого состояния', async () => {
    const deferredVoices = deferred();
    voiceVoicesAPI.list.mockImplementation(() => deferredVoices.promise);
    render(<VoiceVideoPage />);
    await act(async () => {});
    fireEvent.click(screen.getByText('Голоса'));
    // Идёт загрузка — пустого состояния быть не должно.
    expect(document.querySelector('.MuiSkeleton-root')).toBeInTheDocument();
    expect(screen.queryByText(/Пока ни одного голоса/)).not.toBeInTheDocument();
    await act(async () => {
      deferredVoices.reject(err500('Голоса недоступны'));
    });
    await screen.findByText('Голоса недоступны');
    expect(screen.queryByText(/Пока ни одного голоса/)).not.toBeInTheDocument();
  });

  it('индикатор виден при перезагрузке списка по фильтру', async () => {
    const deferredReload = deferred();
    voiceJobsAPI.listMeetings.mockImplementation((params, config) => (
      params?.q
        ? raceAbort(deferredReload.promise, config?.signal)
        : Promise.resolve({ items: [meetL], total: 1 })
    ));
    render(<VoiceVideoPage />);
    await act(async () => {});
    fireEvent.change(screen.getByPlaceholderText('Поиск'), { target: { value: 'совещ' } });
    await waitFor(() => {
      expect(voiceJobsAPI.listMeetings.mock.calls.some(([params]) => params?.q === 'совещ')).toBe(true);
    });
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    await act(async () => {
      deferredReload.resolve({ items: [], total: 0 });
    });
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
  });

  it('фильтры сохраняются при ошибке перезагрузки (предохранитель)', async () => {
    const deferredReload = deferred();
    voiceJobsAPI.listMeetings.mockImplementation((params, config) => (
      params?.q
        ? raceAbort(deferredReload.promise, config?.signal)
        : Promise.resolve({ items: [meetL], total: 1 })
    ));
    render(<VoiceVideoPage />);
    await act(async () => {});
    fireEvent.change(screen.getByPlaceholderText('Поиск'), { target: { value: 'совещ' } });
    await waitFor(() => {
      expect(voiceJobsAPI.listMeetings.mock.calls.some(([params]) => params?.q === 'совещ')).toBe(true);
    });
    await act(async () => {
      deferredReload.reject(err500('Перезагрузка не удалась'));
    });
    await screen.findByText('Перезагрузка не удалась');
    expect(screen.getByPlaceholderText('Поиск')).toHaveValue('совещ');
  });
});

describe('VoiceVideoPage: замечания ревьюера (B1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    voiceJobsAPI.listJobs.mockResolvedValue({ items: [], queue: { queued: 0, processing: 0 } });
    voiceJobsAPI.listMeetings.mockResolvedValue({ items: [], total: 0 });
    voiceVoicesAPI.list.mockResolvedValue({ items: [] });
    voiceJobsAPI.getOptions.mockResolvedValue({});
    voiceJobsAPI.getOverview.mockResolvedValue({ voicevideo_root_exists: true });
  });

  it('появление voice.read после первого рендера не ломает страницу', () => {
    authState.permissions = new Set([]);
    const { rerender } = render(<VoiceVideoPage />);
    expect(screen.getByText(/Недостаточно прав/)).toBeInTheDocument();
    authState.permissions = new Set(['voice.read', 'voice.upload', 'voice.manage']);
    rerender(<VoiceVideoPage />);
    expect(screen.getByRole('tab', { name: 'Протоколы' })).toBeInTheDocument();
  });
});

describe('VoiceVideoPage: замечания ревьюера (N1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.permissions = new Set(['voice.read', 'voice.upload', 'voice.manage']);
    voiceJobsAPI.listJobs.mockResolvedValue({ items: [], queue: { queued: 0, processing: 0 } });
    voiceJobsAPI.listMeetings.mockResolvedValue({ items: [], total: 0 });
    voiceVoicesAPI.list.mockResolvedValue({ items: [] });
    voiceJobsAPI.getOptions.mockResolvedValue({});
    voiceJobsAPI.getOverview.mockResolvedValue({ voicevideo_root_exists: true });
  });

  it('частичный сбой загрузки: список задач обновляется, диалог и вкладка не меняются', async () => {
    voiceJobsAPI.uploadJob.mockImplementation((file) => (
      file.name === 'b.mp3'
        ? Promise.reject(err500('Сбой сервера'))
        : Promise.resolve({})
    ));
    render(<VoiceVideoPage />);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить' }));
    const input = document.querySelector('input[type="file"]');
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [
        new File(['x'], 'a.mp3', { type: 'audio/mpeg' }),
        new File(['x'], 'b.mp3', { type: 'audio/mpeg' }),
      ],
    });
    fireEvent.change(input);
    const callsBefore = voiceJobsAPI.listJobs.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Отправить 2 файла' }));
    await screen.findByText(/Не отправлены: b\.mp3/);
    // Список задач обновился сразу, без ожидания polling.
    await waitFor(() => {
      expect(voiceJobsAPI.listJobs.mock.calls.length).toBeGreaterThan(callsBefore);
    });
    // Диалог открыт, вкладка «Задачи» не выбрана (страница за модалкой в aria-hidden — hidden: true).
    expect(screen.getByText('Обработать запись')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Задачи', hidden: true })).toHaveAttribute('aria-selected', 'false');
  });
});

describe('VoiceVideoPage: замечания ревьюера (N2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.permissions = new Set(['voice.read', 'voice.upload', 'voice.manage']);
    voiceJobsAPI.listJobs.mockResolvedValue({ items: [], queue: { queued: 0, processing: 0 } });
    voiceJobsAPI.listMeetings.mockResolvedValue({ items: [], total: 0 });
    voiceVoicesAPI.list.mockResolvedValue({ items: [] });
    voiceJobsAPI.getOptions.mockResolvedValue({});
    voiceJobsAPI.getOverview.mockResolvedValue({ voicevideo_root_exists: true });
  });

  it('ошибка экспорта ZIP показывается без кнопки «Повторить»', async () => {
    voiceJobsAPI.exportReportsZip.mockRejectedValue(err500('Не удалось собрать архив'));
    render(<VoiceVideoPage />);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Действия со списком протоколов' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Экспорт ZIP/ }));
    await screen.findByText('Не удалось собрать архив');
    // «Повторить» здесь перезагружал бы список протоколов, а не экспорт — кнопки быть не должно.
    expect(screen.queryByRole('button', { name: 'Повторить' })).not.toBeInTheDocument();
  });
});

describe('VoiceVideoPage: счётчик ZIP-экспорта (V08)', () => {
  const openExportMenu = () => fireEvent.click(
    screen.getByRole('button', { name: 'Действия со списком протоколов' }),
  );

  beforeEach(() => {
    vi.clearAllMocks();
    authState.permissions = new Set(['voice.read', 'voice.upload', 'voice.manage']);
    voiceJobsAPI.listJobs.mockResolvedValue({ items: [], queue: { queued: 0, processing: 0 } });
    voiceJobsAPI.listMeetings.mockResolvedValue({ items: [], total: 25 });
    voiceVoicesAPI.list.mockResolvedValue({ items: [] });
    voiceJobsAPI.getOptions.mockResolvedValue({});
    voiceJobsAPI.getOverview.mockResolvedValue({ voicevideo_root_exists: true });
  });

  it('считает все встречи с выбранными датами и предупреждает о лимите 20', async () => {
    render(<VoiceVideoPage />);
    await waitFor(() => expect(voiceJobsAPI.listMeetings).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Фильтры' }));
    fireEvent.change(await screen.findByLabelText('Дата от'), { target: { value: '2026-09-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть фильтры' }));

    await waitFor(() => {
      expect(voiceJobsAPI.listMeetings.mock.calls.some(([params]) => (
        params?.limit === 1 && params.date_from === '2026-09-01'
      ))).toBe(true);
    });
    openExportMenu();
    // N16: счётчик и примечание о лимите живут в подписи пункта «Экспорт ZIP».
    expect(await screen.findByText(/Будет выгружено 20 из 25 протоколов/)).toBeInTheDocument();
    expect(screen.getByText(/Экспорт ограничен 20 протоколами/)).toBeInTheDocument();
  });

  it('не блокирует экспорт, если запрос счётчика завершился ошибкой', async () => {
    voiceJobsAPI.listMeetings.mockImplementation((params) => (
      params?.limit === 1
        ? Promise.reject(err500('Счётчик недоступен'))
        : Promise.resolve({ items: [], total: 0 })
    ));
    voiceJobsAPI.exportReportsZip.mockRejectedValue(err500('ZIP недоступен'));
    render(<VoiceVideoPage />);
    openExportMenu();

    expect(await screen.findByText(/Количество протоколов недоступно/)).toBeInTheDocument();
    const exportItem = screen.getByRole('menuitem', { name: /Экспорт ZIP/ });
    expect(exportItem).toBeEnabled();
    fireEvent.click(exportItem);
    await screen.findByText('ZIP недоступен');
    expect(voiceJobsAPI.exportReportsZip).toHaveBeenCalledOnce();
  });

  it('повторно запрашивает счётчик после успешного обновления протоколов', async () => {
    let countRequests = 0;
    voiceJobsAPI.listMeetings.mockImplementation((params) => {
      if (params?.limit === 1) {
        countRequests += 1;
        return countRequests === 1
          ? Promise.reject(err500('Счётчик недоступен'))
          : Promise.resolve({ items: [], total: 7 });
      }
      return Promise.resolve({ items: [], total: 25 });
    });
    render(<VoiceVideoPage />);
    await waitFor(() => expect(countRequests).toBe(1));

    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));

    await waitFor(() => expect(countRequests).toBe(2));
    openExportMenu();
    expect(await screen.findByText('Будет выгружено 7 из 7 протоколов')).toBeInTheDocument();
  });

  it('отменяет текущий запрос счётчика при размонтировании страницы', async () => {
    let countSignal;
    voiceJobsAPI.listMeetings.mockImplementation((params, config) => {
      if (params?.limit === 1) {
        countSignal = config.signal;
        return raceAbort(new Promise(() => {}), config.signal);
      }
      return Promise.resolve({ items: [], total: 0 });
    });

    const { unmount } = render(<VoiceVideoPage />);
    await waitFor(() => expect(countSignal).toBeDefined());
    expect(countSignal.aborted).toBe(false);

    unmount();

    expect(countSignal.aborted).toBe(true);
  });
});

describe('VoiceVideoPage: URL состояния карточки (V12)', () => {
  const meeting = {
    base_filename: 'jdddd1234567890_Deep_link_meeting',
    modified_at: '2026-09-29T10:00:00Z',
    segments_count: 3,
    reports: [],
    unresolved_count: 0,
    tags: [],
    project: '',
  };
  const detail = {
    base_filename: meeting.base_filename,
    reports: [],
    speakers: { resolved: [], unresolved: [] },
    media_parts: [],
    jobs: [],
    has_media: false,
  };
  let originalUrl;

  beforeEach(() => {
    vi.clearAllMocks();
    originalUrl = window.location.href;
    window.history.replaceState({}, '', '/voice');
    authState.permissions = new Set(['voice.read', 'voice.upload', 'voice.manage']);
    voiceJobsAPI.listJobs.mockResolvedValue({ items: [], queue: { queued: 0, processing: 0 } });
    voiceJobsAPI.listMeetings.mockResolvedValue({ items: [meeting], total: 1 });
    voiceJobsAPI.getMeeting.mockResolvedValue(detail);
    voiceVoicesAPI.list.mockResolvedValue({ items: [] });
    voiceJobsAPI.getOptions.mockResolvedValue({});
    voiceJobsAPI.getOverview.mockResolvedValue({ voicevideo_root_exists: true });
  });

  afterEach(() => {
    window.history.replaceState({}, '', originalUrl);
  });

  it('adds the meeting query on open and closes on popstate', async () => {
    render(<VoiceVideoPage />);
    await act(async () => {});

    fireEvent.click(screen.getByText(/Deep_link_meeting/));
    await screen.findByRole('dialog');
    expect(new URL(window.location.href).searchParams.get('meeting')).toBe(meeting.base_filename);

    window.history.replaceState({}, '', '/voice');
    await act(async () => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('не размонтирует диалог «Поделиться» по «Назад», оставляя ссылку доступной для отзыва (T27)', async () => {
    voiceJobsAPI.createShareLink.mockResolvedValue({ token: 'live-token', url: '/voice/public/live-token' });
    render(<VoiceVideoPage />);
    await act(async () => {});

    fireEvent.click(screen.getByText(/Deep_link_meeting/));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Действия с протоколом' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Поделиться ссылкой' }));
    fireEvent.click(screen.getByRole('button', { name: 'Создать ссылку' }));
    await screen.findByDisplayValue(/live-token/);

    // «Назад»/жест убирает запись истории, но ссылка ещё не отозвана.
    window.history.replaceState({}, '', '/voice');
    await act(async () => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    // Диалог не исчезает молча: ссылка остаётся в списке и доступна для отзыва.
    expect(await screen.findByRole('dialog', { name: 'Поделиться протоколом' })).toBeInTheDocument();
    expect(screen.getByDisplayValue(/live-token/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Отозвать публичную ссылку 1' }));
    await waitFor(() => {
      expect(voiceJobsAPI.revokeShareLink).toHaveBeenCalledWith('live-token');
    });
  });

  it('показывает предупреждение о неотозванной ссылке внутри диалога «Поделиться» (N11)', async () => {
    voiceJobsAPI.createShareLink.mockResolvedValue({ token: 'live-token' });
    render(<VoiceVideoPage />);
    await act(async () => {});

    fireEvent.click(screen.getByText(/Deep_link_meeting/));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Действия с протоколом' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Поделиться ссылкой' }));
    fireEvent.click(screen.getByRole('button', { name: 'Создать ссылку' }));
    const shareDialog = await screen.findByRole('dialog', { name: 'Поделиться протоколом' });
    await within(shareDialog).findByDisplayValue(/live-token/);

    // «Назад»/жест перехватывается: предупреждение видно ВНУТРИ диалога,
    // а не блёклым баннером на странице под модалкой.
    window.history.replaceState({}, '', '/voice');
    await act(async () => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    await screen.findByRole('dialog', { name: 'Поделиться протоколом' });
    expect(within(shareDialog).getByText(/неотозванн/i)).toBeInTheDocument();
    expect(screen.queryByText(/Открыт диалог «Поделиться»/)).not.toBeInTheDocument();

    // После отзыва ссылки предупреждение исчезает вместе с диалогом —
    // нигде на странице его не остаётся.
    fireEvent.click(within(shareDialog).getByRole('button', { name: 'Отозвать публичную ссылку 1' }));
    await within(shareDialog).findByText('Ссылка отозвана');
    await waitFor(() => {
      expect(within(shareDialog).queryByText(/неотозванн/i)).not.toBeInTheDocument();
    });
    fireEvent.click(within(shareDialog).getByRole('button', { name: 'Закрыть' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Поделиться протоколом' })).not.toBeInTheDocument();
    });
    expect(screen.queryByText(/неотозванн/i)).not.toBeInTheDocument();
  });

  it('backs out of a meeting entry it created when the card is closed', async () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {
      const url = new URL(window.location.href);
      url.searchParams.delete('meeting');
      window.history.replaceState({}, '', url.toString());
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    try {
      render(<VoiceVideoPage />);
      await act(async () => {});
      fireEvent.click(screen.getByText(/Deep_link_meeting/));
      await screen.findByRole('dialog');
      expect(window.history.state).toMatchObject({ meeting: expect.any(String) });

      fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));

      expect(back).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(new URL(window.location.href).searchParams.has('meeting')).toBe(false);
    } finally {
      back.mockRestore();
    }
  });

  it('opens the meeting from the query after a page load', async () => {
    window.history.replaceState({}, '', `/voice?meeting=${encodeURIComponent(meeting.base_filename)}`);
    render(<VoiceVideoPage />);

    await screen.findByRole('dialog');
    expect(voiceJobsAPI.getMeeting).toHaveBeenCalledWith(
      meeting.base_filename,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(new URL(window.location.href).searchParams.get('meeting')).toBe(meeting.base_filename);
  });

  it('replaces a direct meeting link without navigating away from its history entry', async () => {
    window.history.replaceState({}, '', `/voice?meeting=${encodeURIComponent(meeting.base_filename)}`);
    const back = vi.spyOn(window.history, 'back');
    try {
      render(<VoiceVideoPage />);
      await screen.findByRole('dialog');

      fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));

      expect(back).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(new URL(window.location.href).pathname).toBe('/voice');
      expect(new URL(window.location.href).searchParams.has('meeting')).toBe(false);
    } finally {
      back.mockRestore();
    }
  });

  it('shows a message for a meeting that no longer exists', async () => {
    window.history.replaceState({}, '', `/voice?meeting=${encodeURIComponent(meeting.base_filename)}`);
    voiceJobsAPI.getMeeting.mockRejectedValueOnce(Object.assign(new Error('Not found'), {
      response: { status: 404, data: { detail: 'Meeting not found' } },
    }));
    render(<VoiceVideoPage />);

    expect(await screen.findByText('Протокол не найден')).toBeInTheDocument();
  });

  it('shows an expired-share message and still removes share from the URL', async () => {
    window.history.replaceState({}, '', '/voice?share=expired-token');
    voiceJobsAPI.resolveShareLink.mockRejectedValue(err500('expired'));
    render(<VoiceVideoPage />);

    expect(await screen.findByText('Ссылка недействительна или истекла')).toBeInTheDocument();
    await waitFor(() => {
      expect(new URL(window.location.href).searchParams.has('share')).toBe(false);
    });
  });
});

describe('VoiceVideoPage: загрузчики и AbortController (V23, N4)', () => {
  const meetA = {
    base_filename: 'jdddd77777777_A_meet', modified_at: '2026-09-29T12:00:00Z',
    segments_count: 2, reports: [], unresolved_count: 0, tags: [], project: '',
  };
  const meetB = {
    base_filename: 'jdddd77777777_B_meet', modified_at: '2026-09-29T11:00:00Z',
    segments_count: 1, reports: [], unresolved_count: 0, tags: [], project: '',
  };
  const jobA = {
    id: 1, original_filename: 'A_job.mp3', kind: 'process', status: 'queued',
    created_at: '2026-09-29T12:00:00Z', created_by: 'tester', file_size: 1000,
  };
  const voiceA = { name: 'Alice', samples_count: 1, has_embedding: true, samples: [] };

  beforeEach(() => {
    vi.clearAllMocks();
    authState.permissions = new Set(['voice.read', 'voice.upload', 'voice.manage']);
    voiceJobsAPI.listJobs.mockResolvedValue({ items: [jobA], queue: { queued: 1, processing: 0 } });
    voiceJobsAPI.listMeetings.mockResolvedValue({ items: [meetA], total: 1 });
    voiceVoicesAPI.list.mockResolvedValue({ items: [voiceA] });
    voiceJobsAPI.getOptions.mockResolvedValue({});
    voiceJobsAPI.getOverview.mockResolvedValue({ voicevideo_root_exists: true });
  });

  it('два «Повторить» подряд восстанавливают обе секции (N4)', async () => {
    voiceJobsAPI.listJobs.mockRejectedValue(err500('Задачи недоступны'));
    voiceJobsAPI.listMeetings.mockRejectedValue(err500('Протоколы недоступны'));
    render(<VoiceVideoPage />);
    await act(async () => {});
    await screen.findByText('Задачи недоступны');
    await screen.findByText('Протоколы недоступны');

    const jobsHolder = deferred();
    const meetingsHolder = deferred();
    voiceJobsAPI.listJobs.mockImplementation((params, config) => raceAbort(jobsHolder.promise, config?.signal));
    voiceJobsAPI.listMeetings.mockImplementation((params, config) => raceAbort(meetingsHolder.promise, config?.signal));

    // Два клика «Повторить» подряд — у разных секций.
    const retryOf = (text) => within(
      screen.getByText(text).closest('[role="alert"]'),
    ).getByRole('button', { name: 'Повторить' });
    fireEvent.click(retryOf('Задачи недоступны'));
    fireEvent.click(retryOf('Протоколы недоступны'));

    await act(async () => {
      jobsHolder.resolve({ items: [jobA], queue: { queued: 1, processing: 0 } });
      meetingsHolder.resolve({ items: [meetA], total: 1 });
    });
    await screen.findByText('A_meet');
    expect(screen.queryByText('Задачи недоступны')).not.toBeInTheDocument();
    expect(screen.queryByText('Протоколы недоступны')).not.toBeInTheDocument();
    // Имя вкладки содержит бейдж очереди — матчим по началу имени.
    fireEvent.click(screen.getByRole('tab', { name: /^Задачи/ }));
    await screen.findByText('A_job.mp3');
    expect(screen.queryByText(/Задач пока нет/)).not.toBeInTheDocument();
  });

  it('StrictMode: холодный старт загружает jobs и voices без ложного пустого состояния (V23)', async () => {
    voiceJobsAPI.listJobs.mockImplementation((params, config) => abortableResolved({ items: [jobA], queue: { queued: 1, processing: 0 } }, config?.signal));
    voiceJobsAPI.listMeetings.mockImplementation((params, config) => abortableResolved({ items: [meetA], total: 1 }, config?.signal));
    voiceVoicesAPI.list.mockImplementation((config) => abortableResolved({ items: [voiceA] }, config?.signal));
    render(
      <React.StrictMode>
        <VoiceVideoPage />
      </React.StrictMode>,
    );
    await act(async () => {});
    await act(async () => {});
    await screen.findByText('A_meet');
    fireEvent.click(screen.getByRole('tab', { name: /^Задачи/ }));
    await screen.findByText('A_job.mp3');
    expect(screen.queryByText(/Задач пока нет/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Голоса' }));
    await screen.findByText('Alice');
    expect(screen.queryByText(/Пока ни одного голоса/)).not.toBeInTheDocument();
  });

  it('отменённый запрос не снимает индикатор нового (V23)', async () => {
    voiceJobsAPI.listMeetings.mockImplementationOnce(
      (params, config) => abortableResolved({ items: [meetA], total: 1 }, config?.signal),
    );
    render(<VoiceVideoPage />);
    await act(async () => {});
    await screen.findByText('A_meet');

    const first = deferred();
    const second = deferred();
    voiceJobsAPI.listMeetings
      .mockImplementationOnce((params, config) => raceAbort(first.promise, config?.signal))
      .mockImplementationOnce((params, config) => raceAbort(second.promise, config?.signal));

    // Два быстрых переключения фильтра: первый запрос отменяется вторым.
    const previousPageCalls = voiceJobsAPI.listMeetings.mock.calls
      .filter(([params]) => params?.limit !== 1).length;
    fireEvent.click(screen.getByRole('button', { name: 'Фильтры' }));
    const unresolvedToggle = await screen.findByText('Без имени');
    fireEvent.click(unresolvedToggle);
    fireEvent.click(unresolvedToggle);
    // Открытая панель помечает остальную страницу как aria-hidden — закрываем её,
    // чтобы индикатор загрузки снова был доступен по роли.
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть фильтры' }));
    await waitFor(() => {
      const currentPageCalls = voiceJobsAPI.listMeetings.mock.calls
        .filter(([params]) => params?.limit !== 1).length;
      expect(currentPageCalls).toBe(previousPageCalls + 2);
    });
    // Индикатор нового запроса не снят отменённым старым.
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    await act(async () => {
      second.resolve({ items: [meetA, meetB], total: 2 });
    });
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
  });
});

describe('VoiceVideoPage: мобильная шапка и вкладки (V10)', () => {
  let originalMatchMedia;

  beforeEach(() => {
    vi.clearAllMocks();
    authState.permissions = new Set(['voice.read', 'voice.upload', 'voice.manage']);
    voiceJobsAPI.listJobs.mockResolvedValue({ items: [], queue: { queued: 1, processing: 0 } });
    voiceJobsAPI.listMeetings.mockResolvedValue({ items: [], total: 0 });
    voiceVoicesAPI.list.mockResolvedValue({ items: [] });
    voiceJobsAPI.getOptions.mockResolvedValue({});
    voiceJobsAPI.getOverview.mockResolvedValue({ voicevideo_root_exists: true });
    // Мобильный вьюпорт (<sm).
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

  it('на мобильном «Обновить» — компактная иконка с aria-label', async () => {
    render(<VoiceVideoPage />);
    await act(async () => {});
    const refresh = screen.getByRole('button', { name: 'Обновить' });
    // Только иконка, без текстовой надписи.
    expect(refresh.textContent).toBe('');
  });

  it('на мобильном видны все три вкладки и бейдж очереди', async () => {
    render(<VoiceVideoPage />);
    await act(async () => {});
    expect(screen.getByRole('tab', { name: /^Протоколы/ })).toBeVisible();
    expect(screen.getByRole('tab', { name: /^Задачи/ })).toBeVisible();
    expect(screen.getByRole('tab', { name: /^Голоса/ })).toBeVisible();
    // Бейдж очереди внутри вкладки «Задачи».
    expect(screen.getByRole('tab', { name: /^Задачи/ })).toHaveTextContent('1');
  });

  it('на мобильном вкладки занимают отдельную строку на всю ширину (B6)', async () => {
    render(<VoiceVideoPage />);
    await act(async () => {});
    // Вкладки под шапкой страницы на всю ширину: variant="fullWidth" даёт каждой
    // вкладке равную долю строки (flexGrow 1, flexBasis 0).
    for (const name of ['Протоколы', 'Задачи', 'Голоса']) {
      const tab = screen.getByRole('tab', { name: new RegExp(`^${name}`) });
      const style = window.getComputedStyle(tab);
      expect(style.flexGrow).toBe('1');
      expect(style.flexBasis).toBe('0px');
    }
    // Кнопки обновления/загрузки не делят строку с вкладками: название страницы
    // перенесено в первую строку внутри страницы.
    expect(screen.getByRole('heading', { name: 'Протоколы встреч' })).toBeInTheDocument();
    const refresh = screen.getByRole('button', { name: 'Обновить' });
    const tablist = screen.getByRole('tablist');
    expect(tablist.parentElement).not.toBe(refresh.closest('.MuiBox-root'));
  });

  it('на десктопе «Обновить» остаётся текстовой кнопкой (предохранитель)', async () => {
    // Десктопный вьюпорт (>=sm).
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
    render(<VoiceVideoPage />);
    await act(async () => {});
    expect(screen.getByRole('button', { name: 'Обновить' }).textContent).toContain('Обновить');
  });
});

describe('VoiceVideoPage: кликабельные чипы сводки (T45)', () => {
  const meetA = {
    base_filename: 'jdddd77777777_A_meet', modified_at: '2026-09-29T12:00:00Z',
    segments_count: 2, reports: [], unresolved_count: 0, tags: [], project: '',
  };
  const jobDone = {
    id: 1, original_filename: 'ok.mp3', kind: 'process', status: 'done',
    created_at: '2026-09-29T12:00:00Z', created_by: 'tester', file_size: 1000,
  };
  const jobFailed = {
    id: 2, original_filename: 'bad.mp3', kind: 'process', status: 'failed',
    created_at: '2026-09-29T12:00:00Z', created_by: 'tester', file_size: 1000,
  };
  const jobQueued = {
    id: 3, original_filename: 'wait.mp3', kind: 'process', status: 'queued',
    created_at: '2026-09-29T12:00:00Z', created_by: 'tester', file_size: 1000,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    authState.permissions = new Set(['voice.read', 'voice.upload', 'voice.manage']);
    voiceJobsAPI.listJobs.mockImplementation((params, config) => abortableResolved(
      { items: [jobDone, jobFailed, jobQueued], queue: { queued: 1, processing: 0 } },
      config?.signal,
    ));
    voiceJobsAPI.listMeetings.mockImplementation((params, config) => abortableResolved({ items: [meetA], total: 1 }, config?.signal));
    voiceVoicesAPI.list.mockImplementation((config) => abortableResolved({ items: [] }, config?.signal));
    voiceJobsAPI.getOptions.mockResolvedValue({});
    voiceJobsAPI.getOverview.mockResolvedValue({ voicevideo_root_exists: true });
  });

  it('чип «Ошибок» ведёт на вкладку «Задачи» с фильтром «Ошибка»', async () => {
    render(<VoiceVideoPage />);
    await act(async () => {});
    await screen.findByText('A_meet');

    fireEvent.click(await screen.findByRole('button', { name: /Показать задачи с ошибками/ }));

    const jobsTab = screen.getByRole('tab', { name: /^Задачи/ });
    expect(jobsTab).toHaveAttribute('aria-selected', 'true');
    // Фильтр «Ошибка» применён: видна только упавшая задача.
    await screen.findByText('bad.mp3');
    expect(screen.queryByText('ok.mp3')).not.toBeInTheDocument();
    expect(screen.queryByText('wait.mp3')).not.toBeInTheDocument();
  });

  it('чип «В очереди» ведёт на вкладку «Задачи» с фильтром «В очереди»', async () => {
    render(<VoiceVideoPage />);
    await act(async () => {});
    await screen.findByText('A_meet');

    fireEvent.click(await screen.findByRole('button', { name: /Показать задачи в очереди/ }));

    expect(screen.getByRole('tab', { name: /^Задачи/ })).toHaveAttribute('aria-selected', 'true');
    await screen.findByText('wait.mp3');
    expect(screen.queryByText('bad.mp3')).not.toBeInTheDocument();
  });
});
