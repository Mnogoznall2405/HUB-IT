import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { DashboardSectionKey } from '../preferences/preferenceNormalizers';
import {
  DEFAULT_DASHBOARD_SECTIONS,
  normalizeDashboardLayoutSections,
} from '../preferences/preferenceNormalizers';
import { useFluentTokens, type FluentTokens } from '../theme/fluentTokens';

const OPTIONAL_SECTION_KEYS: DashboardSectionKey[] = ['tasks', 'absences', 'communication', 'news'];

export const SECTION_META: Record<DashboardSectionKey, { title: string; description: string }> = {
  attention: {
    title: 'Требует внимания',
    description: 'То, где нужна ваша реакция сейчас.',
  },
  tasks: {
    title: 'Ближайшие задачи',
    description: 'До пяти открытых задач с ближайшими сроками.',
  },
  absences: {
    title: 'Отсутствуют сегодня',
    description: 'Кто в отпуске, на больничном или в командировке.',
  },
  communication: {
    title: 'Связь',
    description: 'Непрочитанные сообщения и уведомления.',
  },
  news: {
    title: 'Последние новости',
    description: 'Новые и важные сообщения компании.',
  },
};

export function DashboardCustomizeSheet({
  open,
  sections,
  saving,
  themeMode,
  onClose,
  onSave,
}: {
  open: boolean;
  sections: DashboardSectionKey[];
  saving: boolean;
  themeMode?: string;
  onClose: () => void;
  onSave: (next: DashboardSectionKey[]) => void;
}) {
  const tokens = useFluentTokens(themeMode);
  const [draft, setDraft] = useState(() => normalizeDashboardLayoutSections(sections));

  useEffect(() => {
    if (open) setDraft(normalizeDashboardLayoutSections(sections));
  }, [open, sections]);

  const tasksVisible = draft.includes('tasks');
  const visibleSecondary = draft.filter((item) => (
    item === 'absences' || item === 'communication' || item === 'news'
  ));
  const hiddenOptional = OPTIONAL_SECTION_KEYS.filter((item) => !draft.includes(item));

  const move = (key: DashboardSectionKey, direction: number) => {
    setDraft((current) => {
      const next = [...current];
      const index = next.indexOf(key);
      const secondaryIndexes = next
        .map((item, itemIndex) => (
          item === 'absences' || item === 'communication' || item === 'news' ? itemIndex : -1
        ))
        .filter((itemIndex) => itemIndex >= 0);
      const secondaryPosition = secondaryIndexes.indexOf(index);
      const targetPosition = secondaryPosition + direction;
      if (secondaryPosition < 0 || targetPosition < 0 || targetPosition >= secondaryIndexes.length) {
        return current;
      }
      const target = secondaryIndexes[targetPosition];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return next;
    });
  };

  const toggle = (key: DashboardSectionKey) => {
    setDraft((current) => {
      if (current.includes(key)) return current.filter((item) => item !== key);
      if (key === 'tasks') return ['attention', 'tasks', ...current.filter((item) => item !== 'attention')];
      return [...current, key];
    });
  };

  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Закрыть" />
        <View style={[styles.sheet, { backgroundColor: tokens.panelSolid }]}>
          <Text style={[styles.title, { color: tokens.textPrimary }]}>Настроить главную</Text>
          <ScrollView contentContainerStyle={styles.list}>
            <SectionCard tokens={tokens}>
              <View style={styles.rowFill}>
                <View style={styles.rowText}>
                  <Text style={[styles.itemTitle, { color: tokens.textPrimary }]}>Требует внимания</Text>
                  <Text style={[styles.itemCaption, { color: tokens.textSecondary }]}>
                    Всегда показывается первым.
                  </Text>
                </View>
                <View style={[styles.chip, { backgroundColor: tokens.accentSoft }]}>
                  <Text style={[styles.chipText, { color: tokens.primary }]}>Всегда</Text>
                </View>
              </View>
            </SectionCard>

            {tasksVisible ? (
              <SectionCard tokens={tokens}>
                <View style={styles.rowFill}>
                  <View style={styles.rowText}>
                    <Text style={[styles.itemTitle, { color: tokens.textPrimary }]}>{SECTION_META.tasks.title}</Text>
                    <Text style={[styles.itemCaption, { color: tokens.textSecondary }]}>
                      Основная рабочая область, всегда располагается первой.
                    </Text>
                  </View>
                  <IconAction
                    tokens={tokens}
                    name="eye-off-outline"
                    label={`Скрыть ${SECTION_META.tasks.title}`}
                    onPress={() => toggle('tasks')}
                  />
                </View>
              </SectionCard>
            ) : null}

            {visibleSecondary.map((key, index) => (
              <SectionCard key={key} tokens={tokens}>
                <View style={styles.rowFill}>
                  <View style={styles.rowText}>
                    <Text style={[styles.itemTitle, { color: tokens.textPrimary }]}>{SECTION_META[key].title}</Text>
                    <Text style={[styles.itemCaption, { color: tokens.textSecondary }]}>
                      {SECTION_META[key].description}
                    </Text>
                  </View>
                  <IconAction
                    tokens={tokens}
                    name="chevron-up"
                    label={`Поднять ${SECTION_META[key].title}`}
                    disabled={index === 0}
                    onPress={() => move(key, -1)}
                  />
                  <IconAction
                    tokens={tokens}
                    name="chevron-down"
                    label={`Опустить ${SECTION_META[key].title}`}
                    disabled={index === visibleSecondary.length - 1}
                    onPress={() => move(key, 1)}
                  />
                  <IconAction
                    tokens={tokens}
                    name="eye-off-outline"
                    label={`Скрыть ${SECTION_META[key].title}`}
                    onPress={() => toggle(key)}
                  />
                </View>
              </SectionCard>
            ))}

            {hiddenOptional.length ? (
              <View>
                <Text style={[styles.hiddenLabel, { color: tokens.textSecondary }]}>Скрытые блоки</Text>
                <View style={styles.hiddenRow}>
                  {hiddenOptional.map((key) => (
                    <Pressable
                      key={key}
                      onPress={() => toggle(key)}
                      style={[styles.restoreButton, { borderColor: tokens.actionBorder }]}
                    >
                      <MaterialCommunityIcons name="eye-outline" size={16} color={tokens.primary} />
                      <Text style={[styles.restoreText, { color: tokens.textPrimary }]}>
                        {SECTION_META[key].title}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}
          </ScrollView>
          <View style={styles.actions}>
            <Pressable onPress={() => setDraft([...DEFAULT_DASHBOARD_SECTIONS])} accessibilityRole="button">
              <Text style={[styles.actionText, { color: tokens.primary }]}>По умолчанию</Text>
            </Pressable>
            <View style={styles.actionsRight}>
              <Pressable onPress={onClose} accessibilityRole="button">
                <Text style={[styles.actionText, { color: tokens.textSecondary }]}>Отмена</Text>
              </Pressable>
              <Pressable
                onPress={() => onSave(normalizeDashboardLayoutSections(draft))}
                disabled={saving}
                testID="dashboard-customize-save"
                style={[styles.saveButton, { backgroundColor: tokens.primary, opacity: saving ? 0.7 : 1 }]}
              >
                <Text style={styles.saveText}>{saving ? 'Сохраняю…' : 'Сохранить'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function SectionCard({
  tokens,
  children,
}: {
  tokens: FluentTokens;
  children: ReactNode;
}) {
  return (
    <View style={[styles.card, { borderColor: tokens.borderSoft }]}>
      {children}
    </View>
  );
}

function IconAction({
  tokens,
  name,
  label,
  disabled,
  onPress,
}: {
  tokens: FluentTokens;
  name: ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
      style={[styles.iconButton, { opacity: disabled ? 0.35 : 1 }]}
    >
      <MaterialCommunityIcons name={name} size={20} color={tokens.iconMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
  },
  sheet: {
    maxHeight: '88%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  list: {
    paddingHorizontal: 16,
    gap: 8,
    paddingBottom: 12,
  },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  rowFill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rowText: { flex: 1, minWidth: 0 },
  itemTitle: { fontWeight: '800', fontSize: 15 },
  itemCaption: { marginTop: 2, fontSize: 12, lineHeight: 16 },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  chipText: { fontSize: 11, fontWeight: '800' },
  iconButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hiddenLabel: {
    fontSize: 12,
    marginBottom: 6,
    marginTop: 4,
  },
  hiddenRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  restoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  restoreText: { fontSize: 12, fontWeight: '700' },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  actionsRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  actionText: { fontWeight: '700', fontSize: 14 },
  saveButton: {
    minHeight: 40,
    borderRadius: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveText: { color: '#fff', fontWeight: '800' },
});
