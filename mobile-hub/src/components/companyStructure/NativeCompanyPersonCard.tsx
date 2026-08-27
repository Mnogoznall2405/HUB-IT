import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CompanyStructurePerson } from '../../api/companyStructureApi';
import {
  companyLeadershipRole,
  companyPersonInitials,
} from '../../companyStructure/nativeCompanyStructureModel';
import type { FluentTokens } from '../../theme/fluentTokens';

export const NativeCompanyPersonCard = memo(function NativeCompanyPersonCard({
  person,
  tokens,
  highlighted = false,
  onCall,
  onEmail,
}: {
  person: CompanyStructurePerson;
  tokens: FluentTokens;
  highlighted?: boolean;
  onCall: (phone: string) => void;
  onEmail: (email: string) => void;
}) {
  const role = companyLeadershipRole(person);
  return (
    <View
      testID="native-company-person-card"
      style={[
        styles.card,
        {
          backgroundColor: highlighted || role === 'head' ? tokens.selected : tokens.panelSolid,
          borderColor: highlighted || role !== 'staff' ? tokens.primary : tokens.borderSoft,
        },
      ]}
    >
      <View style={styles.heading}>
        <View style={[styles.avatar, { backgroundColor: tokens.primary }]}>
          <Text style={styles.initials}>{companyPersonInitials(person.full_name)}</Text>
        </View>
        <View style={styles.body}>
          {role !== 'staff' ? (
            <Text style={[styles.role, { color: tokens.primary }]}>{role === 'head' ? 'Начальник подразделения' : 'Заместитель начальника'}</Text>
          ) : null}
          <Text style={[styles.name, { color: tokens.textPrimary }]}>{person.full_name}</Text>
          {person.position ? <Text style={[styles.position, { color: tokens.textSecondary }]}>{person.position}</Text> : null}
          {person.department && person.department !== person.position ? <Text style={[styles.meta, { color: tokens.textTertiary }]}>{person.department}</Text> : null}
          {person.department_location ? (
            <View style={styles.location}>
              <MaterialCommunityIcons name="map-marker-outline" size={16} color={tokens.iconMuted} />
              <Text style={[styles.meta, { color: tokens.textSecondary }]}>{person.department_location}</Text>
            </View>
          ) : null}
        </View>
      </View>
      {person.work_phones.map((phone) => (
        <Pressable key={phone} onPress={() => onCall(phone)} accessibilityRole="button" accessibilityLabel={`Позвонить ${phone}`} style={styles.contact}>
          <MaterialCommunityIcons name="phone-outline" size={18} color={tokens.primary} />
          <Text style={[styles.contactText, { color: tokens.primary }]}>{phone}</Text>
        </Pressable>
      ))}
      {person.work_emails.map((email) => (
        <Pressable key={email} onPress={() => onEmail(email)} accessibilityRole="button" accessibilityLabel={`Написать письмо ${email}`} style={styles.contact}>
          <MaterialCommunityIcons name="email-outline" size={18} color={tokens.primary} />
          <Text style={[styles.contactText, { color: tokens.primary }]}>{email}</Text>
        </Pressable>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  card: { borderRadius: 15, borderWidth: 1, padding: 12, marginBottom: 9 },
  heading: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  initials: { color: '#fff', fontSize: 13, fontWeight: '900' },
  body: { flex: 1, minWidth: 0 },
  role: { marginBottom: 3, fontSize: 10, lineHeight: 14, fontWeight: '900', textTransform: 'uppercase' },
  name: { fontSize: 15, lineHeight: 20, fontWeight: '800' },
  position: { marginTop: 2, fontSize: 12, lineHeight: 17 },
  meta: { marginTop: 2, fontSize: 11, lineHeight: 16 },
  location: { marginTop: 3, flexDirection: 'row', alignItems: 'center', gap: 4 },
  contact: { minHeight: 44, marginTop: 3, paddingLeft: 55, flexDirection: 'row', alignItems: 'center', gap: 7 },
  contactText: { flex: 1, fontSize: 12, lineHeight: 17, fontWeight: '700' },
});
