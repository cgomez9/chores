import { View, Text, Pressable, StyleSheet, Switch, TextInput } from 'react-native';
import type { Recurrence } from '../lib/recurrence';

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function RecurrencePicker({ value, onChange }: { value: Recurrence; onChange: (r: Recurrence) => void }) {
  const isRecurring = value.type !== 'once';

  return (
    <View>
      <Text style={styles.label}>Recurrence</Text>

      <View style={styles.row}>
        <Text style={{ flex: 1 }}>Repeats</Text>
        <Switch value={isRecurring} onValueChange={(on) =>
          onChange(on ? { type: 'daily' } : { type: 'once', due: new Date().toISOString().slice(0, 10) })
        } />
      </View>

      {!isRecurring && value.type === 'once' && (
        <View>
          <Text style={styles.sub}>Due date (YYYY-MM-DD)</Text>
          <TextInput
            value={value.due}
            onChangeText={(t) => onChange({ type: 'once', due: t })}
            style={styles.input}
            placeholder="2026-05-09"
          />
        </View>
      )}

      {isRecurring && (
        <View>
          <View style={styles.segRow}>
            {(['daily', 'weekly'] as const).map((t) => {
              const sel = value.type === t;
              return (
                <Pressable
                  key={t}
                  onPress={() =>
                    onChange(t === 'daily' ? { type: 'daily' } : { type: 'weekly', days: [new Date().getDay()] })
                  }
                  style={[styles.seg, sel && styles.segSel]}
                >
                  <Text style={[styles.segText, sel && styles.segTextSel]}>
                    {t === 'daily' ? 'Daily' : 'Weekly'}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {value.type === 'weekly' && (
            <View style={styles.daysRow}>
              {DAY_LABELS.map((lbl, i) => {
                const sel = value.days.includes(i);
                return (
                  <Pressable
                    key={i}
                    onPress={() =>
                      onChange({
                        type: 'weekly',
                        days: sel ? value.days.filter((d) => d !== i) : [...value.days, i].sort(),
                      })
                    }
                    style={[styles.dayChip, sel && styles.dayChipSel]}
                  >
                    <Text style={[styles.dayText, sel && styles.dayTextSel]}>{lbl}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  sub: { fontSize: 12, color: '#6b7280', marginTop: 8 },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, padding: 10, marginTop: 4 },
  segRow: { flexDirection: 'row', gap: 8, marginVertical: 8 },
  seg: { flex: 1, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#d1d5db', alignItems: 'center' },
  segSel: { backgroundColor: '#3b82f6', borderColor: '#3b82f6' },
  segText: { fontWeight: '600' },
  segTextSel: { color: '#fff' },
  daysRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  dayChip: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: '#d1d5db', alignItems: 'center', justifyContent: 'center' },
  dayChipSel: { backgroundColor: '#3b82f6', borderColor: '#3b82f6' },
  dayText: { fontWeight: '600' },
  dayTextSel: { color: '#fff' },
});
