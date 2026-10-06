import { act, render } from '@testing-library/react-native';
import { BackHandler, Text } from 'react-native';
import { ScreenSheet, ScreenSheetHost } from './ScreenSheet';

describe('ScreenSheet', () => {
  it('is drawn by the root host and follows the owner props and visibility', async () => {
    const onClose = jest.fn();
    const view = await render(
      <ScreenSheetHost>
        <ScreenSheet visible onClose={onClose}><Text>Папки</Text></ScreenSheet>
      </ScreenSheetHost>,
    );
    expect(view.getByText('Папки')).toBeTruthy();

    await view.rerender(
      <ScreenSheetHost>
        <ScreenSheet visible onClose={onClose}><Text>Обновлено</Text></ScreenSheet>
      </ScreenSheetHost>,
    );
    expect(view.getByText('Обновлено')).toBeTruthy();
    expect(view.queryByText('Папки')).toBeNull();

    await view.rerender(
      <ScreenSheetHost>
        <ScreenSheet visible={false} onClose={onClose}><Text>Обновлено</Text></ScreenSheet>
      </ScreenSheetHost>,
    );
    expect(view.queryByText('Обновлено')).toBeNull();
  });

  it('renders in place when no host is mounted', async () => {
    const view = await render(<ScreenSheet visible onClose={jest.fn()}><Text>Без хоста</Text></ScreenSheet>);
    expect(view.getByText('Без хоста')).toBeTruthy();
  });

  it('closes on the Android back button instead of leaving the screen', async () => {
    let backPress: (() => boolean) | undefined;
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
      backPress = handler as () => boolean;
      return { remove: jest.fn() };
    });
    const onClose = jest.fn();
    await render(<ScreenSheet visible onClose={onClose}><Text>Папки</Text></ScreenSheet>);
    let handled = false;
    await act(async () => { handled = backPress?.() ?? false; });
    expect(handled).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    jest.restoreAllMocks();
  });

  it('removes the sheet from the host when the owner unmounts', async () => {
    const view = await render(
      <ScreenSheetHost>
        <ScreenSheet visible onClose={jest.fn()}><Text>Папки</Text></ScreenSheet>
      </ScreenSheetHost>,
    );
    expect(view.getByText('Папки')).toBeTruthy();
    await view.rerender(<ScreenSheetHost>{null}</ScreenSheetHost>);
    expect(view.queryByText('Папки')).toBeNull();
  });
});
