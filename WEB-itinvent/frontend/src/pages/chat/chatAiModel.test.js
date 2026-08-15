import { describe, expect, it } from 'vitest';

import { buildAiSidebarRows } from './chatAiModel';

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
        assistant_title: 'Личный AI',
      }),
    ]);
  });
});
