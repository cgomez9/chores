import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, FlatList, ActivityIndicator, Modal, Image } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../src/lib/supabase';
import { AVATARS, AvatarId } from '../../../src/constants/avatars';
import { RejectModal } from '../../../src/components/RejectModal';

type Row = {
  id: string;
  completed_at: string;
  photo_url: string | null;
  family_id: string;
  completed_by: string | null;
  kid: { id: string; display_name: string; avatar_id: number } | null;
  chore: { title: string; star_value: number; verification_mode: 'auto'|'photo'|'approval' } | null;
};

export default function Approvals() {
  const qc = useQueryClient();
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Row | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['approvals'],
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from('chore_instances')
        .select('id,completed_at,photo_url,family_id,completed_by,kid:profiles!chore_instances_completed_by_fkey(id,display_name,avatar_id),chore:chores(title,star_value,verification_mode)')
        .eq('status', 'submitted')
        .order('completed_at', { ascending: true })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const approve = useMutation({
    mutationFn: async (instanceId: string) => {
      const { error } = await supabase.rpc('approve_chore', { instance_id: instanceId });
      if (error) throw error;
    },
    onSuccess: (_d, instanceId) => {
      const row = data?.find((r) => r.id === instanceId);
      qc.invalidateQueries({ queryKey: ['approvals'] });
      qc.invalidateQueries({ queryKey: ['activity'] });
      if (row?.completed_by) {
        qc.invalidateQueries({ queryKey: ['kid-today', row.completed_by] });
        qc.invalidateQueries({ queryKey: ['balance', row.completed_by] });
        qc.invalidateQueries({ queryKey: ['streak', row.completed_by] });
      }
    },
  });

  const reject = useMutation({
    mutationFn: async (vars: { instanceId: string; reason: string }) => {
      const { error } = await supabase.rpc('reject_chore', {
        instance_id: vars.instanceId,
        reason: vars.reason,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      const row = data?.find((r) => r.id === vars.instanceId);
      qc.invalidateQueries({ queryKey: ['approvals'] });
      qc.invalidateQueries({ queryKey: ['activity'] });
      if (row?.completed_by) qc.invalidateQueries({ queryKey: ['kid-today', row.completed_by] });
    },
  });

  async function openPhoto(row: Row) {
    if (!row.photo_url) return;
    const path = `family/${row.family_id}/chore-proofs/${row.id}.jpg`;
    const { data } = await supabase.storage.from('chore-proofs').createSignedUrl(path, 60);
    setPhotoUrl(data?.signedUrl ?? null);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Approvals</Text>

      {isLoading && <ActivityIndicator />}
      {error && <Text style={styles.err}>{(error as Error).message}</Text>}
      {data && data.length === 0 && (
        <Text style={styles.empty}>No pending approvals — nice work 🌟</Text>
      )}

      <FlatList
        data={data ?? []}
        keyExtractor={(r) => r.id}
        renderItem={({ item }) => {
          const a = item.kid ? AVATARS[item.kid.avatar_id as AvatarId] : null;
          return (
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.line}>
                  {a?.emoji ?? '👤'} {item.kid?.display_name} · {item.chore?.title} · ⭐ {item.chore?.star_value}
                </Text>
                <Text style={styles.sub}>
                  submitted {timeAgo(item.completed_at)}
                  {item.chore?.verification_mode === 'photo' && (
                    <Text onPress={() => openPhoto(item)} style={styles.viewPhoto}>  ·  view photo</Text>
                  )}
                </Text>
              </View>
              <Pressable
                onPress={() => approve.mutate(item.id)}
                disabled={approve.isPending}
                style={[styles.btn, styles.btnApprove, approve.isPending && { opacity: 0.5 }]}
              >
                <Text style={styles.btnTextLight}>Approve</Text>
              </Pressable>
              <Pressable
                onPress={() => setRejectTarget(item)}
                style={[styles.btn, styles.btnReject]}
              >
                <Text style={styles.btnTextDark}>Reject</Text>
              </Pressable>
            </View>
          );
        }}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
      />

      <Modal visible={!!photoUrl} transparent animationType="fade" onRequestClose={() => setPhotoUrl(null)}>
        <Pressable style={styles.photoBg} onPress={() => setPhotoUrl(null)}>
          {photoUrl && <Image source={{ uri: photoUrl }} style={styles.photoImg} resizeMode="contain" />}
        </Pressable>
      </Modal>

      <RejectModal
        visible={!!rejectTarget}
        onCancel={() => setRejectTarget(null)}
        onConfirm={(reason) => {
          if (rejectTarget) reject.mutate({ instanceId: rejectTarget.id, reason });
          setRejectTarget(null);
        }}
      />
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
  return `${Math.floor(h / 24)}d ago`;
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, paddingTop: 48, backgroundColor: '#fff' },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 12 },
  err: { color: '#ef4444' },
  empty: { color: '#6b7280', textAlign: 'center', marginTop: 64 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 8 },
  line: { fontSize: 15 },
  sub: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  viewPhoto: { color: '#3b82f6' },
  sep: { height: 1, backgroundColor: '#e5e7eb' },
  btn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
  btnApprove: { backgroundColor: '#10b981' },
  btnReject: { backgroundColor: '#f3f4f6' },
  btnTextLight: { color: '#fff', fontWeight: '600', fontSize: 13 },
  btnTextDark: { color: '#374151', fontWeight: '500', fontSize: 13 },
  photoBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center' },
  photoImg: { width: '100%', height: '80%' },
});
