import { Fragment, useMemo } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { FluentTokens } from '../theme/fluentTokens';

type MarkdownBlock = {
  key: string;
  kind: 'paragraph' | 'heading' | 'bullet' | 'number' | 'quote' | 'code' | 'check';
  text: string;
  level?: number;
  checked?: boolean;
};

function parseBlocks(value: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const codeLines: string[] = [];
  let inCode = false;
  String(value || '').replace(/\r\n?/g, '\n').split('\n').forEach((line, index) => {
    if (/^\s*```/.test(line)) {
      if (inCode) {
        blocks.push({ key: `code-${index}`, kind: 'code', text: codeLines.join('\n') });
        codeLines.length = 0;
      }
      inCode = !inCode;
      return;
    }
    if (inCode) {
      codeLines.push(line);
      return;
    }
    const heading = line.match(/^\s*(#{1,6})\s+(.+)$/);
    const check = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.+)$/);
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
    const number = line.match(/^\s*(\d+)[.)]\s+(.+)$/);
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (heading) blocks.push({ key: `heading-${index}`, kind: 'heading', text: heading[2], level: heading[1].length });
    else if (check) blocks.push({ key: `check-${index}`, kind: 'check', text: check[2], checked: check[1].toLowerCase() === 'x' });
    else if (bullet) blocks.push({ key: `bullet-${index}`, kind: 'bullet', text: bullet[1] });
    else if (number) blocks.push({ key: `number-${index}`, kind: 'number', text: number[2], level: Number(number[1]) });
    else if (quote) blocks.push({ key: `quote-${index}`, kind: 'quote', text: quote[1] });
    else if (line.trim()) blocks.push({ key: `paragraph-${index}`, kind: 'paragraph', text: line.trim() });
  });
  if (inCode || codeLines.length > 0) blocks.push({ key: 'code-last', kind: 'code', text: codeLines.join('\n') });
  return blocks;
}

function safeLink(value: string): string {
  const normalized = String(value || '').trim();
  return /^(https?:\/\/|mailto:)/i.test(normalized) ? normalized : '';
}

function InlineMarkdown({ text, tokens }: { text: string; tokens: FluentTokens }) {
  const parts = String(text || '').split(/(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\[[^\]]+\]\([^)]+\))/g);
  return (
    <Text>
      {parts.map((part, index) => {
        const code = part.match(/^`([^`]+)`$/);
        const bold = part.match(/^(?:\*\*|__)(.*)(?:\*\*|__)$/);
        const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (code) return <Text key={index} style={[styles.inlineCode, { backgroundColor: tokens.panelMuted }]}>{code[1]}</Text>;
        if (bold) return <Text key={index} style={styles.bold}>{bold[1]}</Text>;
        if (link) {
          const url = safeLink(link[2]);
          return url ? (
            <Text
              key={index}
              accessibilityRole="link"
              onPress={() => { void Linking.openURL(url); }}
              style={[styles.link, { color: tokens.primary }]}
            >
              {link[1]}
            </Text>
          ) : <Fragment key={index}>{link[1]}</Fragment>;
        }
        return <Fragment key={index}>{part.replace(/[*_~]/g, '')}</Fragment>;
      })}
    </Text>
  );
}

export function FeedMarkdownText({ value, tokens }: { value: string; tokens: FluentTokens }) {
  const blocks = useMemo(() => parseBlocks(value), [value]);
  return (
    <View accessibilityRole="text" style={styles.container}>
      {blocks.map((block) => {
        if (block.kind === 'code') {
          return <Text key={block.key} selectable style={[styles.code, { color: tokens.textPrimary, backgroundColor: tokens.panelMuted }]}>{block.text}</Text>;
        }
        if (block.kind === 'heading') {
          return <Text key={block.key} accessibilityRole="header" style={[styles.heading, block.level === 1 ? styles.headingOne : null, { color: tokens.textPrimary }]}><InlineMarkdown text={block.text} tokens={tokens} /></Text>;
        }
        if (block.kind === 'quote') {
          return <View key={block.key} style={[styles.quote, { borderLeftColor: tokens.primary }]}><Text style={[styles.paragraph, { color: tokens.textSecondary }]}><InlineMarkdown text={block.text} tokens={tokens} /></Text></View>;
        }
        if (block.kind === 'check') {
          return <View key={block.key} style={styles.listRow}><MaterialCommunityIcons name={block.checked ? 'checkbox-marked' : 'checkbox-blank-outline'} size={18} color={block.checked ? tokens.primary : tokens.iconMuted} /><Text style={[styles.listText, { color: tokens.textPrimary }]}><InlineMarkdown text={block.text} tokens={tokens} /></Text></View>;
        }
        if (block.kind === 'bullet' || block.kind === 'number') {
          return <View key={block.key} style={styles.listRow}><Text style={[styles.marker, { color: tokens.primary }]}>{block.kind === 'number' ? `${block.level}.` : '•'}</Text><Text style={[styles.listText, { color: tokens.textPrimary }]}><InlineMarkdown text={block.text} tokens={tokens} /></Text></View>;
        }
        return <Text key={block.key} style={[styles.paragraph, { color: tokens.textPrimary }]}><InlineMarkdown text={block.text} tokens={tokens} /></Text>;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8 },
  paragraph: { fontSize: 14, lineHeight: 21 },
  heading: { fontSize: 17, lineHeight: 22, fontWeight: '800', marginTop: 4 },
  headingOne: { fontSize: 20, lineHeight: 25 },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  marker: { width: 20, textAlign: 'right', fontWeight: '800', lineHeight: 21 },
  listText: { flex: 1, fontSize: 14, lineHeight: 21 },
  quote: { borderLeftWidth: 3, paddingLeft: 10 },
  code: { borderRadius: 10, padding: 10, fontFamily: 'monospace', fontSize: 13, lineHeight: 19 },
  inlineCode: { fontFamily: 'monospace' },
  bold: { fontWeight: '800' },
  link: { textDecorationLine: 'underline' },
});
