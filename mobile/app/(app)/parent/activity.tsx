import { useState, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, FlatList, ActivityIndicator, Modal, Image } from 'react-native';
import { useQueries } from '@tanstack/react-query';
import { supabase } from '../../../src/lib/supabase';
import { AVATARS, AvatarId } from '../../../src/constants/avatars';
import { REWARD_ICONS, type RewardIconId } from '../../../src/constants/rewardIcons';

type ChoreRow = {
  kind: 'chore';
  id: string;
  status: 'approved' | 'rejected';
  approved_at: string | null;
  completed_at: string | null;
  photo_url: string | null;
  family_id: string;
  rejection_reason: string | null;
  kid: { display_name: string; avatar_id: number } | null;
  chore: { title: string; verification_mode: 'auto'|'photo'|'approval' } | null;
};

type RedemptionRow = {
  kind: 'redemption';
  id: string;
  status: 'fulfilled' | 'denied';
  resolved_at: string | null;
  parent_note: string | null;
  kid: { display_name: string; avatar_id: number } | null;
  reward: { title: string; icon_id: number } | null;
};

type ActivityRow = (ChoreRow | RedemptionRow) & { eventAt: string };

export default function Activity() {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  const [chores, redemptions] = useQueries({
    queries: [
      {
        queryKey: ['activity-chores'],
        queryFn: async (): Promise<ChoreRow[]> => {
          const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
          const { data, error } = await supabase
            .from('chore_instances')
            .select('id,status,approved_at,completed_at,photo_url,family_id,rejection_reason,kid:profiles!chore_instances_completed_by_fkey(display_name,avatar_id),chore:chores(title,verification_mode)')
            .in('status', ['approved', 'rejected'])
            .gte('completed_at', since)
            .order('approved_at', { ascending: false, nullsFirst: false })
            .limit(50);
          if (error) throw error;
          return (data ?? []).map((d) => ({ ...(d as object), kind: 'chore' })) as unknown as ChoreRow[];
        },
      },
      {
        queryKey: ['activity-redemptions'],
        queryFn: async (): Promise<RedemptionRow[]> => {
          const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
          const { data, error } = await supabase
            .from('redemptions')
            .select('id,status,resolved_at,parent_note,kid:profiles!redemptions_kid_profile_id_fkey(display_name,avatar_id),reward:rewards(title,icon_id)')
            .in('status', ['fulfilled', 'denied'])
            .gte('resolved_at', since)
            .order('resolved_at', { ascending: false })
            .limit(50);
          if (error) throw error;
          return (data ?? []).map((d) => ({ ...(d as object), kind: 'redemption' })) as unknown as RedemptionRow[];
        },
      },
    ],
  });

  const merged: ActivityRow[] | undefined = useMemo(() => {
    if (!chores.data || !redemptions.data) return undefined;
    const all: ActivityRow[] = [
      ...chores.data.map((r) => ({ ...r, eventAt: r.approved_at ?? r.completed_at ?? '' })),
      ...redemptions.data.map((r) => ({ ...r, eventAt: r.resolved_at ?? '' })),
    ];
    return all
      .filter((r) => r.eventAt !== '')
      .sort((a, b) => new Date(b.eventAt).getTime() - new Date(a.eventAt).getTime())
      .slice(0, 100);
  }, [chores.data, redemptions.data]);

  async function openPhoto(r: ChoreRow) {
    if (!r.photo_url) return;
    const path = `family/${r.family_id}/chore-proofs/${r.id}.jpg`;
    const { data } = await supabase.storage.from('chore-proofs').createSignedUrl(path, 60);
    setSignedUrl(data?.signedUrl ?? null);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Activity</Text>
      {(chores.isLoading || redemptions.isLoading) && <ActivityIndicator />}
      {chores.error && <Text style={styles.err}>{(chores.error as Error).message}</Text>}
      {redemptions.error && <Text style={styles.err}>{(redemptions.error as Error).message}</Text>}
      {merged && merged.length === 0 && <Text style={styles.empty}>No activity yet.</Text>}

      <FlatList
        data={merged ?? []}
        keyExtractor={(r) => `${r.kind}-${r.id}`}
        renderItem={({ item }) => {
          const avatar = item.kid ? AVATARS[item.kid.avatar_id as AvatarId].emoji : '👤';
          if (item.kind === 'chore') {
            if (item.status === 'rejected') {
              const reason = item.rejection_reason && item.rejection_reason.length > 0
                ? ` — "${item.rejection_reason}"` : '';
              return (
                <View style={styles.row}>
                  <Text style={styles.line}>
                    ✗ {avatar} {item.kid?.display_name} · {item.chore?.title} · {timeAgo(item.eventAt)}{reason}
                  </Text>
                </View>
              );
            }
            const icon = item.chore?.verification_mode === 'photo' ? '📸' : '✓';
            return (
              <Pressable
                style={styles.row}
                onPress={() => item.chore?.verification_mode === 'photo' && openPhoto(item)}
              >
                <Text style={styles.line}>
                  {icon} {avatar} {item.kid?.display_name} · {item.chore?.title} · {timeAgo(item.eventAt)}
                </Text>
                {item.chore?.verification_mode === 'photo' && (
                  <Text style={styles.hint}>tap to view photo</Text>
                )}
              </Pressable>
            );
          }
          // redemption
          const rewardEmoji = item.reward ? REWARD_ICONS[item.reward.icon_id as RewardIconId]?.emoji : '🎁';
          if (item.status === 'fulfilled') {
            return (
              <View style={styles.row}>
                <Text style={styles.line}>
                  🎁 {avatar} {item.kid?.display_name} · {rewardEmoji} {item.reward?.title} · fulfilled {timeAgo(item.eventAt)}
                </Text>
              </View>
            );
          }
          // denied
          const note = item.parent_note && item.parent_note.length > 0 ? ` — "${item.parent_note}"` : '';
          return (
            <View style={styles.row}>
              <Text style={styles.line}>
                ✗ {avatar} {item.kid?.display_name} · {rewardEmoji} {item.reward?.title} · denied {timeAgo(item.eventAt)}{note}
              </Text>
            </View>
          );
        }}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
      />

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
  return `${Math.floor(h / 24)}d ago`;
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
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center' },
  modalImg: { width: '100%', height: '80%' },
});
