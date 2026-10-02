import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ChatMarkdownBody } from './ChatMarkdownBody';

// BUG-LIST: inside a shrink-to-fit bubble `flex: 1` on the list item text
// sets flexBasis to 0, so the row collapses to the marker width and the
// text wraps by syllables. The item text must keep an auto basis
// (flexShrink only) and the marker must not shrink.
// getByText resolves the deepest host Text, so `.parent` of a leaf inside
// InlineNodes is the styled item Text, and `.parent` of a marker is the
// list-item row.
describe('ChatMarkdownBody list items', () => {
  it('renders an ordered list without zeroing the item text basis', async () => {
    const view = await render(
      <ChatMarkdownBody isOwn value={'1. Я устал обновляться по пять раз на дню\n2. Второй пункт'} />,
    );

    const marker = view.getByText('1.');
    const row = marker.parent!;
    expect(StyleSheet.flatten(row.props.style).flexDirection).toBe('row');
    expect(StyleSheet.flatten(marker.props.style).flexShrink).toBe(0);

    const itemText = view.getByText('Я устал обновляться по пять раз на дню').parent!;
    const itemStyle = StyleSheet.flatten(itemText.props.style);
    expect(itemStyle.flex).toBeUndefined();
    expect(itemStyle.flexBasis ?? 'auto').not.toBe(0);
    expect(itemStyle.flexShrink).toBe(1);
    expect(view.getByText('2.')).toBeTruthy();
    expect(view.getByText('Второй пункт')).toBeTruthy();
  });

  it('renders an unordered list with the same layout contract', async () => {
    const view = await render(
      <ChatMarkdownBody isOwn={false} value={'- Купить молоко\n- Позвонить в офис'} />,
    );

    const bullets = view.getAllByText('•');
    expect(bullets).toHaveLength(2);
    for (const bullet of bullets) {
      expect(StyleSheet.flatten(bullet.props.style).flexShrink).toBe(0);
      const row = bullet.parent!;
      expect(StyleSheet.flatten(row.props.style).flexDirection).toBe('row');
    }

    const itemStyle = StyleSheet.flatten(view.getByText('Купить молоко').parent!.props.style);
    expect(itemStyle.flex).toBeUndefined();
    expect(itemStyle.flexBasis ?? 'auto').not.toBe(0);
    expect(itemStyle.flexShrink).toBe(1);
  });

  it('keeps the auto basis for both a short and a long item', async () => {
    const longItem = 'Длинный пункт со множеством слов, который не помещается '
      + 'в одну строку пузыря и должен переноситься только по словам';
    const view = await render(
      <ChatMarkdownBody isOwn={false} value={`- Короткий\n- ${longItem}`} />,
    );

    for (const text of ['Короткий', longItem]) {
      const itemStyle = StyleSheet.flatten(view.getByText(text).parent!.props.style);
      expect(itemStyle.flex).toBeUndefined();
      expect(itemStyle.flexBasis ?? 'auto').not.toBe(0);
      expect(itemStyle.flexShrink).toBe(1);
    }
  });
});
