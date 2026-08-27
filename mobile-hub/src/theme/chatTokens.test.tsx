import { render } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';
import { FluentThemeContext, getFluentTokens } from './fluentTokens';
import { createChatTokens, useChatTokens } from './chatTokens';

function ChatThemeProbe() {
  const tokens = useChatTokens();
  return (
    <Text
      testID="chat-theme-probe"
      style={{ color: tokens.textPrimary, backgroundColor: tokens.panelBg }}
    >
      Chat
    </Text>
  );
}

describe('native Chat theme', () => {
  it('provides distinct accessible surfaces for light and dark schemes', () => {
    const light = createChatTokens('light');
    const dark = createChatTokens('dark');

    expect(light.panelBg).toBe('#ffffff');
    expect(light.textPrimary).toBe('#111b21');
    expect(dark.panelBg).toBe('#17212b');
    expect(dark.textPrimary).toBe('#f2f5f7');
    expect(dark.warningBg).not.toBe(light.warningBg);
  });

  it('updates Chat consumers when the selected application theme changes', async () => {
    const view = await render(
      <FluentThemeContext.Provider value={getFluentTokens('light')}>
        <ChatThemeProbe />
      </FluentThemeContext.Provider>,
    );

    expect(StyleSheet.flatten(view.getByTestId('chat-theme-probe').props.style)).toMatchObject({
      color: '#111b21',
      backgroundColor: '#ffffff',
    });

    await view.rerender(
      <FluentThemeContext.Provider value={getFluentTokens('dark')}>
        <ChatThemeProbe />
      </FluentThemeContext.Provider>,
    );

    expect(StyleSheet.flatten(view.getByTestId('chat-theme-probe').props.style)).toMatchObject({
      color: '#f2f5f7',
      backgroundColor: '#17212b',
    });
  });
});
