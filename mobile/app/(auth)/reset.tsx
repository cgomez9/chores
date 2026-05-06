import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Link } from 'expo-router';
import { Button } from '../../src/components/Button';
import { TextField } from '../../src/components/TextField';
import { requestPasswordReset } from '../../src/lib/auth';

export default function ResetScreen() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    setError(null);
    setLoading(true);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (e: any) {
      setError(e.message ?? 'Could not send reset email');
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Check your email</Text>
        <Text style={styles.body}>If that email is registered, we've sent a reset link.</Text>
        <Link href="/(auth)/login" style={styles.link}>Back to login</Link>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Reset your password</Text>
      <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
      {error && <Text style={styles.error}>{error}</Text>}
      <Button label="Send reset link" onPress={onSubmit} loading={loading} />
      <Link href="/(auth)/login" style={styles.link}>Back to login</Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 24, textAlign: 'center' },
  body: { textAlign: 'center', marginBottom: 16, color: '#374151' },
  error: { color: '#ef4444', marginBottom: 12, textAlign: 'center' },
  link: { textAlign: 'center', marginTop: 16, color: '#3b82f6' },
});
