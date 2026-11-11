import type { ReactElement } from 'react';
import { render } from '@testing-library/react-native';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import type { ChatConversationSummary, ChatMember } from '../../api/types';
import { AiConversationActionsSheet } from './AiConversationActionsSheet';
import { ChatRenameSheet } from './ChatGroupEditSheets';
import { ChatParticipantProfileSheet } from './ChatParticipantProfileSheet';

jest.mock('../../accessibility/useReducedMotion', () => ({
  useReducedMotion: () => false,
}));

const insets = { top: 64, bottom: 50, left: 30, right: 30 };

const wrap = (node: ReactElement) => (
  <SafeAreaInsetsContext.Provider value={insets}>{node}</SafeAreaInsetsContext.Provider>
);

const flatStyle = (props: { style?: StyleProp<ViewStyle> }) => (
  StyleSheet.flatten(props.style) as Record<string, number>
);

describe('AUD-8 inset-aware centered sheets', () => {
  it('keeps the AI conversation actions card inside the safe area', async () => {
    const conversation = { id: 'c1', title: 'AI-чат' } as ChatConversationSummary;
    const view = await render(wrap(
      <AiConversationActionsSheet
        conversation={conversation}
        onClose={jest.fn()}
        onRename={jest.fn()}
        onResetContext={jest.fn()}
        onDelete={jest.fn()}
      />,
    ));

    const style = flatStyle(view.getByTestId('ai-actions-backdrop').props);
    expect(style.paddingTop).toBeGreaterThanOrEqual(insets.top);
    expect(style.paddingBottom).toBeGreaterThanOrEqual(insets.bottom);
    expect(style.paddingLeft).toBeGreaterThanOrEqual(insets.left);
    expect(style.paddingRight).toBeGreaterThanOrEqual(insets.right);
  });

  it('keeps the participant profile card inside the safe area', async () => {
    const member: ChatMember = {
      user: { id: 1, username: 'user1', full_name: 'User One' },
      member_role: 'member',
    };
    const view = await render(wrap(
      <ChatParticipantProfileSheet
        visible
        member={member}
        onClose={jest.fn()}
      />,
    ));

    const style = flatStyle(view.getByTestId('participant-profile-backdrop').props);
    expect(style.paddingTop).toBeGreaterThanOrEqual(insets.top);
    expect(style.paddingBottom).toBeGreaterThanOrEqual(insets.bottom);
  });

  it('keeps the rename prompt inside the safe area', async () => {
    const view = await render(wrap(
      <ChatRenameSheet
        visible
        initialTitle="Группа"
        onClose={jest.fn()}
        onSave={jest.fn()}
      />,
    ));

    const style = flatStyle(view.getByTestId('chat-keyboard-avoiding').props);
    expect(style.paddingTop).toBeGreaterThanOrEqual(insets.top);
    expect(style.paddingBottom).toBeGreaterThanOrEqual(insets.bottom);
    expect(style.paddingLeft).toBeGreaterThanOrEqual(insets.left);
    expect(style.paddingRight).toBeGreaterThanOrEqual(insets.right);
  });
});
