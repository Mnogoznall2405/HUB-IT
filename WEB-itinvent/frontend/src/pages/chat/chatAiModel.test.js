import { describe, expect, it } from 'vitest';

import { buildAiSidebarRows, buildAiStatusDisplayModel, mergeAiStatusPayload } from './chatAiModel';

describe('AI run event ordering', () => {
  it('does not describe a saved result as still generating in the thread header', () => {
    const model = buildAiStatusDisplayModel({ status: 'running', stage: 'generating_answer',
      status_text: 'Формирую ответ.', result_message_id: 'saved-answer' });
    expect(model.primaryText).toBe('Ответ готов. Завершаю обработку.');
    expect(model.showSpinner).toBe(false);
  });
  it('completes only the previous stage and resets history for a new run', () => {
    let state = mergeAiStatusPayload({}, { conversation_id: 'c', run_id: 'r1', status: 'running', stage: 'checking_office', updated_at: '2026-10-20T05:00:01Z' });
    expect(state.c.completed_stages || []).toEqual([]);
    state = mergeAiStatusPayload(state, { conversation_id: 'c', run_id: 'r1', status: 'running', stage: 'generating_answer', updated_at: '2026-10-20T05:00:02Z' });
    expect(state.c.completed_stages).toEqual(['checking_office']);
    state = mergeAiStatusPayload(state, { conversation_id: 'c', run_id: 'r2', status: 'running', stage: 'analyzing_request', updated_at: '2026-10-20T05:01:00Z' });
    expect(state.c.completed_stages).toEqual([]);
    expect(mergeAiStatusPayload(state, { conversation_id: 'c', run_id: 'r1', status: 'completed', updated_at: '2026-10-20T05:00:59Z' })).toBe(state);
  });

  it('rejects stale events and never regresses a terminal run to running', () => {
    const state = { c: { run_id: 'r', status: 'completed', updated_at: '2026-10-20T05:00:03Z', result_message_id: 'answer' } };
    for (const updated_at of ['2026-10-20T05:00:01Z', '2026-10-20T05:00:04Z']) {
      expect(mergeAiStatusPayload(state, { conversation_id: 'c', run_id: 'r', status: 'running', updated_at })).toBe(state);
    }
  });
});

describe('buildAiSidebarRows assistant identity', () => {
  it('labels bot conversations with the bot title and generic conversations as personal AI', () => {
    const rows = buildAiSidebarRows({
      aiBots: [{
        id: 'documents-bot',
        title: 'Документы',
        conversation_ids: ['bot-conversation'],
      }],
      conversations: [{
        id: 'bot-conversation',
        kind: 'ai',
        title: 'Квартальный отчёт',
      }, {
        id: 'generic-conversation',
        kind: 'ai',
        title: 'Личный разговор',
      }],
      draftsByConversation: {},
      activeConversationId: '',
    });

    expect(rows).toEqual([
      expect.objectContaining({
        conversation_id: 'bot-conversation',
        title: 'Квартальный отчёт',
        assistant_title: 'Документы',
      }),
      expect.objectContaining({
        conversation_id: 'generic-conversation',
        title: 'Личный разговор',
        assistant_title: 'HUB Ассистент',
      }),
    ]);
  });

  it('AI8: resolves the bot from the conversation ai_bot_id field', () => {
    const rows = buildAiSidebarRows({
      aiBots: [{
        id: 'documents-bot',
        title: 'Документы',
        conversation_ids: [],
      }],
      conversations: [{
        id: 'bot-conversation',
        kind: 'ai',
        title: 'Беседа с документами',
        ai_bot_id: 'documents-bot',
      }],
      draftsByConversation: {},
      activeConversationId: '',
    });

    expect(rows).toEqual([
      expect.objectContaining({
        conversation_id: 'bot-conversation',
        bot_id: 'documents-bot',
        assistant_title: 'Документы',
      }),
    ]);
  });

  it('AI8: keeps a conversation row openable when its bot is missing from the bots list', () => {
    const rows = buildAiSidebarRows({
      aiBots: [],
      conversations: [{
        id: 'orphan-conversation',
        kind: 'ai',
        title: 'Старая беседа',
        ai_bot_id: 'removed-bot',
      }],
      draftsByConversation: {},
      activeConversationId: '',
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({
      conversation_id: 'orphan-conversation',
      bot_id: '',
      title: 'Старая беседа',
    }));
  });

  it('hides retired IT helper conversations while preserving other AI history', () => {
    const rows = buildAiSidebarRows({
      aiBots: [{
        id: 'it-helper-bot',
        slug: 'it-helper',
        title: 'IT-помощник',
        conversation_ids: ['mapped-it-helper'],
      }],
      conversations: [{
        id: 'mapped-it-helper',
        kind: 'ai',
        title: 'Диагностика программы',
      }, {
        id: 'legacy-it-helper',
        kind: 'ai',
        title: 'IT-помощник',
      }, {
        id: 'personal-conversation',
        kind: 'ai',
        title: 'Личный разговор',
      }],
      draftsByConversation: {},
      activeConversationId: '',
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({
      conversation_id: 'personal-conversation',
      title: 'Личный разговор',
    }));
  });
});
