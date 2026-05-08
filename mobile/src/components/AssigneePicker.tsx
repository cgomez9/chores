import { View, Text, Pressable, StyleSheet } from 'react-native';
import { AVATARS, AvatarId } from '../constants/avatars';

export type Assignee = { id: string; display_name: string; avatar_id: number };

export function AssigneePicker({
  kids, value, onChange,
}: { kids: Assignee[]; value: string | null; onChange: (id: string | null) => void }) {
  return (
    <View>
      <Text style={styles.label}>Assignee</Text>
      <View style={styles.row}>
        <Pressable onPress={() => onChange(null)} style={[styles.chip, value === null && styles.chipSel]}>
          <Text style={[styles.chipText, value === null && styles.chipTextSel]}>Anyone</Text>
        </Pressable>
        {kids.map((k) => {
          const a = AVATARS[k.avatar_id as AvatarId];
          const sel = value === k.id;
          return (
            <Pressable key={k.id} onPress={() => onChange(k.id)} style={[styles.chip, sel && styles.chipSel]}>
              <Text style={styles.emoji}>{a.emoji}</Text>
              <Text style={[styles.chipText, sel && styles.chipTextSel]}>{k.display_name}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: '#d1d5db', flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipSel: { backgroundColor: '#3b82f6', borderColor: '#3b82f6' },
  chipText: { color: '#111827', fontWeight: '500' },
  chipTextSel: { color: '#fff' },
  emoji: { fontSize: 16 },
});
