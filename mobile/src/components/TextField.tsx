import { TextInput, View, Text, StyleSheet, TextInputProps } from 'react-native';

type Props = TextInputProps & { label: string; error?: string };

export function TextField({ label, error, style, ...rest }: Props) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...rest}
        style={[styles.input, error && styles.inputError, style]}
        placeholderTextColor="#9ca3af"
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 14, fontWeight: '500', marginBottom: 4, color: '#374151' },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, padding: 12, fontSize: 16, color: '#111' },
  inputError: { borderColor: '#ef4444' },
  error: { color: '#ef4444', fontSize: 13, marginTop: 2 },
});
