import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '../../src/components/Button';
import { TextField } from '../../src/components/TextField';
import { AvatarPicker } from '../../src/components/AvatarPicker';
import type { AvatarId } from '../../src/constants/avatars';
import { supabase } from '../../src/lib/supabase';

export default function AddKidScreen() {
  const router = useRouter();
  const [kidName, setKidName] = useState('');
  const [avatar, setAvatar] = useState<AvatarId>(2);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function addKid(then: 'another' | 'finish') {
    setError(null);
    if (kidName.trim().length === 0) return setError('Kid name required');
    if (pin.length > 0 && !/^\d{4}$/.test(pin)) return setError('PIN must be exactly 4 digits, or empty');
    setLoading(true);
    // For M1 we store the PIN as plain text under "pin_hash" naming.
    // M3 will replace with bcrypt-style hashing inside an Edge Function — see plan note.
    const { error } = await supabase.rpc('create_kid_profile', {
      kid_name: kidName.trim(),
      avatar,
      pin_hash: pin || undefined,
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    if (then === 'another') {
      setKidName('');
      setPin('');
    } else {
      router.replace('/(app)');
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Add a kid</Text>
      <TextField label="Kid's name" value={kidName} onChangeText={setKidName} placeholder="Sara" />
      <Text style={styles.label}>Avatar</Text>
      <AvatarPicker value={avatar} onChange={setAvatar} />
      <TextField label="PIN (optional, 4 digits)" value={pin} onChangeText={setPin} keyboardType="number-pad" maxLength={4} />
      {error && <Text style={styles.error}>{error}</Text>}
      <Button label="Add and add another" onPress={() => addKid('another')} loading={loading} />
      <Button label="Add and finish" onPress={() => addKid('finish')} loading={loading} variant="secondary" style={{ marginTop: 8 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, paddingTop: 64 },
  title: { fontSize: 26, fontWeight: '700', marginBottom: 16, textAlign: 'center' },
  label: { fontSize: 14, fontWeight: '500', color: '#374151' },
  error: { color: '#ef4444', marginBottom: 12, textAlign: 'center' },
});
