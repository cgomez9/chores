import { useState, useEffect } from 'react';
import { ScrollView, Text, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../../src/lib/supabase';
import { Button } from '../../../../src/components/Button';
import { TextField } from '../../../../src/components/TextField';
import { RewardIconPicker } from '../../../../src/components/RewardIconPicker';
import type { RewardIconId } from '../../../../src/constants/rewardIcons';

export default function NewReward() {
  const router = useRouter();
  const qc = useQueryClient();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [cost, setCost] = useState('50');
  const [iconId, setIconId] = useState<RewardIconId>(1);
  const [familyId, setFamilyId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('profiles').select('family_id').eq('type', 'parent').limit(1).maybeSingle();
      if (data) setFamilyId((data as { family_id: string }).family_id);
    })();
  }, []);

  const create = useMutation({
    mutationFn: async () => {
      if (!familyId) throw new Error('no family loaded');
      const sc = parseInt(cost, 10);
      if (!Number.isFinite(sc) || sc < 1 || sc > 9999) throw new Error('star cost must be 1–9999');
      const { error } = await supabase.rpc('create_reward', {
        family_id: familyId,
        title: title.trim(),
        description: (description.trim() || null) as unknown as string,
        star_cost: sc,
        icon_id: iconId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['parent-rewards'] });
      router.back();
    },
    onError: (e) => Alert.alert('Could not create reward', (e as Error).message),
  });

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>New reward</Text>
      <TextField label="Title" value={title} onChangeText={setTitle} placeholder="Ice Cream" />
      <TextField label="Description (optional)" value={description} onChangeText={setDescription} />
      <TextField label="Star cost" value={cost} onChangeText={setCost} keyboardType="number-pad" />
      <RewardIconPicker value={iconId} onChange={setIconId} />
      <Button label="Save" loading={create.isPending} onPress={() => create.mutate()} />
      <Button label="Cancel" variant="secondary" onPress={() => router.back()} style={{ marginTop: 8 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, paddingTop: 64, gap: 12 },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 8 },
});
