import { render } from '@testing-library/react-native';
import { FeedMarkdownText } from './FeedMarkdownText';
import { getFluentTokens } from '../theme/fluentTokens';

describe('FeedMarkdownText', () => {
  it('renders Markdown structure without turning unsafe URLs into links', async () => {
    const view = await render(
      <FeedMarkdownText
        tokens={getFluentTokens('light')}
        value={'# Заголовок\n- [x] Готово\n[Сайт](https://example.com)\n[Опасно](javascript:alert(1))'}
      />,
    );
    expect(view.getByRole('header')).toBeTruthy();
    expect(view.getByRole('link')).toHaveTextContent('Сайт');
    expect(view.getByText(/Опасно/)).toBeTruthy();
    expect(view.queryAllByRole('link')).toHaveLength(1);
  });
});
