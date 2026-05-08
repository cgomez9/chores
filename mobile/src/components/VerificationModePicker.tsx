import { View, Text, Pressable, StyleSheet } from 'react-native';

export type VerificationMode = 'auto' | 'photo' | 'approval';
const MODES: { value: VerificationMode; label: string; hint: string }[] = [
  { value: 'auto',     label: 'Auto',     hint: 'Tap done = done' },
  { value: 'photo',    label: 'Photo',    hint: 'Kid sends a photo' },
  { value: 'approval', label: 'Approval', hint: 'Parent confirms' },
];

export function VerificationModePicker({ value, onChange }: { value: VerificationMode; onChange: (v: VerificationMode) => void }) {
  return (
    <View>
      <Text style={styles.label}>Verification</Text>
      <View style={styles.row}>
        {MODES.map((m) => {
          const sel = m.value === value;
          return (
            <Pressable key={m.value} onPress={() => onChange(m.value)} style={[styles.btn, sel && styles.btnSel]}>
              <Text style={[styles.btnLabel, sel && styles.btnLabelSel]}>{m.label}</Text>
              <Text style={[styles.btnHint, sel && styles.btnHintSel]}>{m.hint}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6 },
  row: { flexDirection: 'row', gap: 8 },
  btn: { flex: 1, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#d1d5db', alignItems: 'center' },
  btnSel: { backgroundColor: '#3b82f6', borderColor: '#3b82f6' },
  btnLabel: { fontWeight: '600', color: '#111827' },
  btnLabelSel: { color: '#fff' },
  btnHint: { fontSize: 11, color: '#6b7280', marginTop: 2 },
  btnHintSel: { color: '#dbeafe' },
});
