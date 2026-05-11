import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '../../src/components/Button';
import { TextField } from '../../src/components/TextField';
import { AvatarPicker } from '../../src/components/AvatarPicker';
import type { AvatarId } from '../../src/constants/avatars';
import { supabase } from '../../src/lib/supabase';
import { refetchFamily } from '../../src/hooks/useFamily';

export default function JoinFamilyScreen() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState<AvatarId>(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    setError(null);
    if (!/^[0-9]{6}$/.test(code.trim())) return setError('Code must be 6 digits');
    if (name.trim().length === 0) return setError('Your name is required');
    setLoading(true);
    const { error } = await supabase.rpc('accept_invite', {
      code: code.trim(),
      display_name: name.trim(),
      avatar_id: avatar,
    });
    setLoading(false);
    if (error) { setError(error.message); return; }
    refetchFamily();
    // Layout will redirect to /(app) when has-family resolves.
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Join a family</Text>
      <Text style={styles.sub}>Enter the 6-digit code shared by an existing parent.</Text>
      <TextField label="Invite code" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} placeholder="123456" />
      <TextField label="Your name (parent)" value={name} onChangeText={setName} placeholder="Sam" />
      <Text style={styles.label}>Pick your avatar</Text>
      <AvatarPicker value={avatar} onChange={setAvatar} />
      {error && <Text style={styles.error}>{error}</Text>}
      <Button label="Join family" onPress={onSubmit} loading={loading} />
      <Button label="Cancel" variant="secondary" onPress={() => router.back()} style={{ marginTop: 8 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, paddingTop: 64, gap: 4 },
  title: { fontSize: 26, fontWeight: '700', textAlign: 'center' },
  sub: { fontSize: 13, color: '#6b7280', textAlign: 'center', marginTop: 4, marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '500', color: '#374151' },
  error: { color: '#ef4444', marginBottom: 12, textAlign: 'center' },
});
