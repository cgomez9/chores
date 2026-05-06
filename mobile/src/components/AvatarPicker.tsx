import { Pressable, Text, View, StyleSheet } from 'react-native';
import { AVATAR_IDS, AVATARS, AvatarId } from '../constants/avatars';

type Props = { value: AvatarId; onChange: (id: AvatarId) => void };

export function AvatarPicker({ value, onChange }: Props) {
  return (
    <View style={styles.row}>
      {AVATAR_IDS.map((id) => {
        const a = AVATARS[id];
        const selected = id === value;
        return (
          <Pressable
            key={id}
            onPress={() => onChange(id)}
            style={[styles.tile, { backgroundColor: a.bg }, selected && styles.selected]}
          >
            <Text style={styles.emoji}>{a.emoji}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginVertical: 16 },
  tile: { width: 64, height: 64, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  selected: { borderColor: '#111' },
  emoji: { fontSize: 32 },
});
