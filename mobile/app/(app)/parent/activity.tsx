import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, FlatList, ActivityIndicator, Modal, Image } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../src/lib/supabase';
import { AVATARS, AvatarId } from '../../../src/constants/avatars';

type Row = {
  id: string;
  status: 'submitted' | 'approved';
  completed_at: string;
  photo_url: string | null;
  family_id: string;
  kid: { display_name: string; avatar_id: number } | null;
  chore: { title: string; verification_mode: 'auto'|'photo'|'approval' } | null;
};

export default function Activity() {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['activity'],
    queryFn: async (): Promise<Row[]> => {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('chore_instances')
        .select('id,status,completed_at,photo_url,family_id,kid:profiles!chore_instances_completed_by_fkey(display_name,avatar_id),chore:chores(title,verification_mode)')
        .in('status', ['submitted', 'approved'])
        .gte('completed_at', since)
        .order('completed_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  async function openPhoto(r: Row) {
    if (!r.photo_url) return;
    const path = `family/${r.family_id}/chore-proofs/${r.id}.jpg`;
    const { data } = await supabase.storage.from('chore-proofs').createSignedUrl(path, 60);
    setSignedUrl(data?.signedUrl ?? null);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Activity</Text>
      {isLoading && <ActivityIndicator />}
      {error && <Text style={styles.err}>{(error as Error).message}</Text>}
      {data && data.length === 0 && <Text style={styles.empty}>No activity yet.</Text>}
      <FlatList
        data={data ?? []}
        keyExtractor={(r) => r.id}
        renderItem={({ item }) => {
          const avatar = item.kid ? AVATARS[item.kid.avatar_id as AvatarId].emoji : '👤';
          const icon = item.status === 'approved' ? '✓' : item.chore?.verification_mode === 'photo' ? '📸' : '✋';
          return (
            <Pressable
              style={styles.row}
              onPress={() => item.chore?.verification_mode === 'photo' && openPhoto(item)}
            >
              <Text style={styles.line}>
                {icon} {avatar} {item.kid?.display_name} · {item.chore?.title} · {timeAgo(item.completed_at)}
              </Text>
              {item.chore?.verification_mode === 'photo' && item.status === 'submitted' && (
                <Text style={styles.hint}>tap to view photo</Text>
              )}
            </Pressable>
          );
        }}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
      />
      <Text style={styles.footer}>Approvals coming next milestone.</Text>

      <Modal visible={!!signedUrl} transparent animationType="fade" onRequestClose={() => setSignedUrl(null)}>
        <Pressable style={styles.modalBg} onPress={() => setSignedUrl(null)}>
          {signedUrl && <Image source={{ uri: signedUrl }} style={styles.modalImg} resizeMode="contain" />}
        </Pressable>
      </Modal>
    </View>
  );
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, paddingTop: 48, backgroundColor: '#fff' },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 12 },
  err: { color: '#ef4444' },
  empty: { color: '#6b7280', textAlign: 'center', marginTop: 64 },
  row: { paddingVertical: 12 },
  line: { fontSize: 15 },
  hint: { fontSize: 11, color: '#3b82f6', marginTop: 2 },
  sep: { height: 1, backgroundColor: '#e5e7eb' },
  footer: { textAlign: 'center', color: '#9ca3af', marginTop: 12, fontSize: 12 },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center' },
  modalImg: { width: '100%', height: '80%' },
});
