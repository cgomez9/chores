import { useState, useEffect } from 'react';
import { Modal, View, Text, TextInput, Pressable, StyleSheet } from 'react-native';

type Props = {
  visible: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
};

export function RejectModal({ visible, onCancel, onConfirm }: Props) {
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (visible) setReason('');
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.bg}>
        <View style={styles.card}>
          <Text style={styles.title}>Reject this chore?</Text>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="Why? (optional)"
            style={styles.input}
            multiline
          />
          <View style={styles.row}>
            <Pressable onPress={onCancel} style={[styles.btn, styles.btnSecondary]}>
              <Text style={styles.btnTextSecondary}>Cancel</Text>
            </Pressable>
            <Pressable onPress={() => onConfirm(reason)} style={[styles.btn, styles.btnDanger]}>
              <Text style={styles.btnText}>Reject</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, width: 320, gap: 12 },
  title: { fontSize: 17, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, padding: 10, minHeight: 60, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  btn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 },
  btnSecondary: { backgroundColor: '#f3f4f6' },
  btnDanger: { backgroundColor: '#ef4444' },
  btnText: { color: '#fff', fontWeight: '600' },
  btnTextSecondary: { color: '#374151', fontWeight: '500' },
});
