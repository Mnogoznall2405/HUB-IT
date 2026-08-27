import { useMemo } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  isSafeMarkdownHref,
  parseChatMarkdown,
  stripChatMarkdownPreview,
  type MarkdownInline,
} from '../../chat/chatMarkdown';
import { type ChatTokens, useChatStyles } from '../../theme/chatTokens';

function InlineNodes({
  nodes,
  isOwn,
}: {
  nodes: MarkdownInline[];
  isOwn: boolean;
}) {
  const { styles } = useChatStyles(createStyles);
  return (
    <>
      {nodes.map((node, index) => {
        if (node.type === 'text') {
          return <Text key={index}>{node.value}</Text>;
        }
        if (node.type === 'code') {
          return (
            <Text key={index} style={styles.inlineCode}>
              {node.value}
            </Text>
          );
        }
        if (node.type === 'link') {
          const href = node.href;
          return (
            <Text
              key={index}
              style={[styles.link, isOwn ? styles.linkOwn : null]}
              onPress={isSafeMarkdownHref(href) ? () => {
                void Linking.openURL(href);
              } : undefined}
              accessibilityRole={isSafeMarkdownHref(href) ? 'link' : undefined}
            >
              <InlineNodes nodes={node.children} isOwn={isOwn} />
            </Text>
          );
        }
        const style = node.type === 'bold'
          ? styles.bold
          : node.type === 'italic'
            ? styles.italic
            : styles.strike;
        return (
          <Text key={index} style={style}>
            <InlineNodes nodes={node.children} isOwn={isOwn} />
          </Text>
        );
      })}
    </>
  );
}

export function ChatMarkdownBody({
  value,
  isOwn,
  deleted = false,
}: {
  value?: string | null;
  isOwn: boolean;
  deleted?: boolean;
}) {
  const { styles } = useChatStyles(createStyles);
  const blocks = useMemo(() => parseChatMarkdown(value), [value]);
  if (!blocks.length) return null;
  const textColor = isOwn ? styles.textOwn : styles.textOther;

  return (
    <View
      testID="chat-markdown-body"
      accessibilityLabel={stripChatMarkdownPreview(value)}
    >
      {blocks.map((block, index) => {
        if (block.type === 'code') {
          return (
            <ScrollView
              key={index}
              horizontal
              style={styles.codeScroll}
              contentContainerStyle={styles.codeBlock}
            >
              <Text style={styles.codeText}>{block.value}</Text>
            </ScrollView>
          );
        }
        if (block.type === 'table') {
          return (
            <ScrollView key={index} horizontal style={styles.tableScroll}>
              <View style={styles.table}>
                <View style={styles.tableRow}>
                  {block.headers.map((cell, cellIndex) => (
                    <Text key={`h-${cellIndex}`} style={[styles.tableCell, styles.tableHead]}>{cell}</Text>
                  ))}
                </View>
                {block.rows.map((row, rowIndex) => (
                  <View key={`r-${rowIndex}`} style={styles.tableRow}>
                    {row.map((cell, cellIndex) => (
                      <Text key={`c-${rowIndex}-${cellIndex}`} style={styles.tableCell}>{cell}</Text>
                    ))}
                  </View>
                ))}
              </View>
            </ScrollView>
          );
        }
        if (block.type === 'list') {
          return (
            <View key={index} style={styles.list}>
              {block.items.map((item, itemIndex) => (
                <View key={itemIndex} style={styles.listItem}>
                  <Text style={[styles.text, textColor, deleted && styles.deleted]}>
                    {block.ordered ? `${itemIndex + 1}.` : '•'}
                  </Text>
                  <Text style={[styles.text, styles.listText, textColor, deleted && styles.deleted]}>
                    <InlineNodes nodes={item} isOwn={isOwn} />
                  </Text>
                </View>
              ))}
            </View>
          );
        }
        const headingStyle = block.type === 'heading'
          ? block.level === 1 ? styles.h1 : block.level === 2 ? styles.h2 : styles.h3
          : null;
        return (
          <Text
            key={index}
            style={[
              styles.text,
              textColor,
              headingStyle,
              block.type === 'blockquote' && styles.quote,
              deleted && styles.deleted,
            ]}
          >
            <InlineNodes nodes={block.children} isOwn={isOwn} />
          </Text>
        );
      })}
    </View>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  text: { fontSize: 16, lineHeight: 22 },
  textOwn: { color: chatTokens.bubbleOwnText },
  textOther: { color: chatTokens.bubbleOtherText },
  deleted: { fontStyle: 'italic', opacity: 0.72 },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through' },
  inlineCode: {
    fontFamily: 'monospace',
    fontSize: 14,
    backgroundColor: chatTokens.sidebarSearchBg,
    borderRadius: 4,
  },
  link: { color: chatTokens.accentText, textDecorationLine: 'underline' },
  linkOwn: { color: chatTokens.bubbleOwnText },
  h1: { fontSize: 19, lineHeight: 24, fontWeight: '700', marginBottom: 4 },
  h2: { fontSize: 18, lineHeight: 23, fontWeight: '700', marginBottom: 4 },
  h3: { fontSize: 17, lineHeight: 22, fontWeight: '700', marginBottom: 3 },
  quote: {
    paddingLeft: 8,
    borderLeftWidth: 3,
    borderLeftColor: chatTokens.composerActionBg,
    opacity: 0.92,
  },
  list: { marginVertical: 2, gap: 3 },
  listItem: { flexDirection: 'row', gap: 8 },
  listText: { flex: 1 },
  codeScroll: { marginVertical: 6, maxWidth: '100%' },
  codeBlock: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: chatTokens.sidebarSearchBg,
  },
  codeText: { fontFamily: 'monospace', fontSize: 13, color: chatTokens.textPrimary },
  tableScroll: { marginVertical: 6, maxWidth: '100%' },
  table: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: chatTokens.borderSoft,
    borderRadius: 10,
    overflow: 'hidden',
  },
  tableRow: { flexDirection: 'row' },
  tableCell: {
    minWidth: 88,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: chatTokens.borderSoft,
    color: chatTokens.textPrimary,
    fontSize: 13,
  },
  tableHead: { fontWeight: '800', backgroundColor: chatTokens.sidebarSearchBg },
});
