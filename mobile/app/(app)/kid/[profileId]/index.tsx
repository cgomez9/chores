import { useLocalSearchParams, useRouter } from 'expo-router';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../../src/lib/supabase';

type Instance = {
  id: string;
  status: 'pending' | 'submitted' | 'approved' | 'rejected';
  due_at: string;
  chore: { id: string; title: string; star_value: number; verification_mode: 'auto'|'photo'|'approval' } | null;
};

export default function KidHome() {
  const router = useRouter();
  const { profileId } = useLocalSearchParams<{ profileId: string }>();
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['kid-today', profileId],
    queryFn: async (): Promise<Instance[]> => {
      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);
      const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
      const { data, error } = await supabase
        .from('chore_instances')
        .select('id, status, due_at, chore:chores(id,title,star_value,verification_mode)')
        .or(`assignee_profile_id.eq.${profileId},assignee_profile_id.is.null`)
        .gte('due_at', startOfDay.toISOString())
        .lt('due_at', endOfDay.toISOString())
        .in('status', ['pending', 'submitted'])
        .order('due_at');
      if (error) throw error;
      return (data ?? []) as unknown as Instance[];
    },
    enabled: !!profileId,
  });

  const complete = useMutation({
    mutationFn: async (vars: { instanceId: string }) => {
      const { error } = await supabase.rpc('complete_chore', {
        instance_id: vars.instanceId,
        kid_profile_id: profileId,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kid-today', profileId] }),
  });

  function onDone(inst: Instance) {
    if (!inst.chore) return;
    if (inst.chore.verification_mode === 'photo') {
      router.push(`/(app)/kid/${profileId}/chore/${inst.id}/photo` as never);
      return;
    }
    complete.mutate({ instanceId: inst.id });
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Today's chores</Text>
        <Pressable onPress={() => router.replace('/(app)')}>
          <Text style={styles.switch}>Switch</Text>
        </Pressable>
      </View>

      {isLoading && <ActivityIndicator />}
      {error && <Text style={styles.err}>{(error as Error).message}</Text>}

      {data && data.length === 0 && (
        <Text style={styles.empty}>All done — great job! 🌟</Text>
      )}

      <ScrollView contentContainerStyle={{ gap: 12 }}>
        {(data ?? []).map((inst) => {
          const submitted = inst.status === 'submitted';
          return (
            <View key={inst.id} style={[styles.card, submitted && styles.cardWaiting]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.choreTitle}>{inst.chore?.title}</Text>
                <Text style={styles.stars}>⭐ {inst.chore?.star_value}</Text>
                {submitted && <Text style={styles.waiting}>Waiting for parent ✋</Text>}
              </View>
              {!submitted && (
                <Pressable onPress={() => onDone(inst)} style={styles.doneBtn}>
                  <Text style={styles.doneText}>Done</Text>
                </Pressable>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, paddingTop: 64, backgroundColor: '#fff' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 22, fontWeight: '700' },
  switch: { color: '#3b82f6', fontWeight: '500' },
  err: { color: '#ef4444' },
  empty: { textAlign: 'center', fontSize: 18, marginTop: 64, color: '#6b7280' },
  card: { backgroundColor: '#f9fafb', borderRadius: 12, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardWaiting: { opacity: 0.55 },
  choreTitle: { fontSize: 18, fontWeight: '600' },
  stars: { fontSize: 14, color: '#6b7280', marginTop: 2 },
  waiting: { fontSize: 12, color: '#9ca3af', marginTop: 4 },
  doneBtn: { backgroundColor: '#10b981', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 999 },
  doneText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
