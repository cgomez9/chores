import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, SectionList, ActivityIndicator, Modal, Image } from 'react-native';
import { useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../src/lib/supabase';
import { AVATARS, AvatarId } from '../../../src/constants/avatars';
import { REWARD_ICONS, type RewardIconId } from '../../../src/constants/rewardIcons';
import { RejectModal } from '../../../src/components/RejectModal';

type ChoreRow = {
  kind: 'chore';
  id: string;
  completed_at: string;
  photo_url: string | null;
  family_id: string;
  completed_by: string | null;
  kid: { display_name: string; avatar_id: number } | null;
  chore: { title: string; star_value: number; verification_mode: 'auto'|'photo'|'approval' } | null;
};

type RedemptionPendingRow = {
  kind: 'redemption-pending';
  id: string;
  requested_at: string;
  star_cost_snapshot: number;
  kid_profile_id: string;
  kid: { display_name: string; avatar_id: number } | null;
  reward: { title: string; icon_id: number } | null;
};

type RedemptionFulfillRow = {
  kind: 'redemption-fulfill';
  id: string;
  resolved_at: string | null;
  star_cost_snapshot: number;
  kid_profile_id: string;
  kid: { display_name: string; avatar_id: number } | null;
  reward: { title: string; icon_id: number } | null;
};

type DecisionRow = ChoreRow | RedemptionPendingRow;

export default function Approvals() {
  const qc = useQueryClient();
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [rejectChoreTarget, setRejectChoreTarget] = useState<ChoreRow | null>(null);
  const [denyTarget, setDenyTarget] = useState<RedemptionPendingRow | null>(null);

  const [chores, redPending, redApproved] = useQueries({
    queries: [
      {
        queryKey: ['approvals-chores'],
        queryFn: async (): Promise<ChoreRow[]> => {
          const { data, error } = await supabase
            .from('chore_instances')
            .select('id,completed_at,photo_url,family_id,completed_by,kid:profiles!chore_instances_completed_by_fkey(display_name,avatar_id),chore:chores(title,star_value,verification_mode)')
            .eq('status', 'submitted')
            .order('completed_at', { ascending: true })
            .limit(100);
          if (error) throw error;
          return (data ?? []).map((d) => ({ ...(d as object), kind: 'chore' })) as unknown as ChoreRow[];
        },
      },
      {
        queryKey: ['approvals-redemptions-pending'],
        queryFn: async (): Promise<RedemptionPendingRow[]> => {
          const { data, error } = await supabase
            .from('redemptions')
            .select('id,requested_at,star_cost_snapshot,kid_profile_id,kid:profiles!redemptions_kid_profile_id_fkey(display_name,avatar_id),reward:rewards(title,icon_id)')
            .eq('status', 'pending')
            .order('requested_at', { ascending: true })
            .limit(100);
          if (error) throw error;
          return (data ?? []).map((d) => ({ ...(d as object), kind: 'redemption-pending' })) as unknown as RedemptionPendingRow[];
        },
      },
      {
        queryKey: ['approvals-redemptions-approved'],
        queryFn: async (): Promise<RedemptionFulfillRow[]> => {
          const { data, error } = await supabase
            .from('redemptions')
            .select('id,resolved_at,star_cost_snapshot,kid_profile_id,kid:profiles!redemptions_kid_profile_id_fkey(display_name,avatar_id),reward:rewards(title,icon_id)')
            .eq('status', 'approved')
            .order('resolved_at', { ascending: false })
            .limit(100);
          if (error) throw error;
          return (data ?? []).map((d) => ({ ...(d as object), kind: 'redemption-fulfill' })) as unknown as RedemptionFulfillRow[];
        },
      },
    ],
  });

  const isLoading = chores.isLoading || redPending.isLoading || redApproved.isLoading;
  const errorAny = (chores.error ?? redPending.error ?? redApproved.error) as Error | undefined;

  const decisions: DecisionRow[] = [
    ...(chores.data ?? []),
    ...(redPending.data ?? []),
  ].sort((a, b) => {
    const ta = a.kind === 'chore' ? a.completed_at : a.requested_at;
    const tb = b.kind === 'chore' ? b.completed_at : b.requested_at;
    return new Date(ta).getTime() - new Date(tb).getTime();
  });

  const fulfill: RedemptionFulfillRow[] = redApproved.data ?? [];

  function invalidateAfterDecision(kidId?: string | null) {
    qc.invalidateQueries({ queryKey: ['approvals-chores'] });
    qc.invalidateQueries({ queryKey: ['approvals-redemptions-pending'] });
    qc.invalidateQueries({ queryKey: ['approvals-redemptions-approved'] });
    qc.invalidateQueries({ queryKey: ['activity'] });
    if (kidId) {
      qc.invalidateQueries({ queryKey: ['kid-today', kidId] });
      qc.invalidateQueries({ queryKey: ['balance', kidId] });
      qc.invalidateQueries({ queryKey: ['streak', kidId] });
      qc.invalidateQueries({ queryKey: ['kid-rewards', kidId] });
    }
  }

  const approveChore = useMutation({
    mutationFn: async (instanceId: string) => {
      const { error } = await supabase.rpc('approve_chore', { instance_id: instanceId });
      if (error) throw error;
    },
    onSuccess: (_d, instanceId) => {
      const row = chores.data?.find((r) => r.id === instanceId);
      invalidateAfterDecision(row?.completed_by);
    },
  });

  const rejectChore = useMutation({
    mutationFn: async (vars: { instanceId: string; reason: string }) => {
      const { error } = await supabase.rpc('reject_chore', { instance_id: vars.instanceId, reason: vars.reason });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      const row = chores.data?.find((r) => r.id === vars.instanceId);
      invalidateAfterDecision(row?.completed_by);
    },
  });

  const approveRedemption = useMutation({
    mutationFn: async (redemptionId: string) => {
      const { error } = await supabase.rpc('approve_redemption', { redemption_id: redemptionId });
      if (error) throw error;
    },
    onSuccess: (_d, redemptionId) => {
      const row = redPending.data?.find((r) => r.id === redemptionId);
      invalidateAfterDecision(row?.kid_profile_id);
    },
  });

  const denyRedemption = useMutation({
    mutationFn: async (vars: { redemptionId: string; note: string }) => {
      const { error } = await supabase.rpc('deny_redemption', { redemption_id: vars.redemptionId, parent_note: vars.note });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      const row = redPending.data?.find((r) => r.id === vars.redemptionId);
      invalidateAfterDecision(row?.kid_profile_id);
    },
  });

  const fulfillRedemption = useMutation({
    mutationFn: async (redemptionId: string) => {
      const { error } = await supabase.rpc('fulfill_redemption', { redemption_id: redemptionId });
      if (error) throw error;
    },
    onSuccess: (_d, redemptionId) => {
      const row = redApproved.data?.find((r) => r.id === redemptionId);
      invalidateAfterDecision(row?.kid_profile_id);
    },
  });

  async function openPhoto(row: ChoreRow) {
    if (!row.photo_url) return;
    const path = `family/${row.family_id}/chore-proofs/${row.id}.jpg`;
    const { data } = await supabase.storage.from('chore-proofs').createSignedUrl(path, 60);
    setPhotoUrl(data?.signedUrl ?? null);
  }

  const sections = [
    { title: 'Decisions needed', data: decisions as DecisionRow[] },
    { title: 'Pending fulfillment', data: fulfill as unknown as DecisionRow[] },
  ].filter((s) => s.data.length > 0);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Approvals</Text>

      {isLoading && <ActivityIndicator />}
      {errorAny && <Text style={styles.err}>{errorAny.message}</Text>}
      {!isLoading && sections.length === 0 && (
        <Text style={styles.empty}>No pending approvals — nice work 🌟</Text>
      )}

      <SectionList
        sections={sections}
        keyExtractor={(item) => `${item.kind}-${item.id}`}
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionHeader}>{section.title}</Text>
        )}
        renderItem={({ item }) => {
          if (item.kind === 'chore') {
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
                <Pressable onPress={() => approveChore.mutate(item.id)} style={[styles.btn, styles.btnApprove]}>
                  <Text style={styles.btnTextLight}>Approve</Text>
                </Pressable>
                <Pressable onPress={() => setRejectChoreTarget(item)} style={[styles.btn, styles.btnSecondary]}>
                  <Text style={styles.btnTextDark}>Reject</Text>
                </Pressable>
              </View>
            );
          }
          if (item.kind === 'redemption-pending') {
            const a = item.kid ? AVATARS[item.kid.avatar_id as AvatarId] : null;
            const icon = item.reward ? REWARD_ICONS[item.reward.icon_id as RewardIconId]?.emoji : '🎁';
            return (
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.line}>
                    {a?.emoji ?? '👤'} {item.kid?.display_name} · {icon} {item.reward?.title} · ⭐ {item.star_cost_snapshot}
                  </Text>
                  <Text style={styles.sub}>requested {timeAgo(item.requested_at)}</Text>
                </View>
                <Pressable onPress={() => approveRedemption.mutate(item.id)} style={[styles.btn, styles.btnApprove]}>
                  <Text style={styles.btnTextLight}>Approve</Text>
                </Pressable>
                <Pressable onPress={() => setDenyTarget(item)} style={[styles.btn, styles.btnSecondary]}>
                  <Text style={styles.btnTextDark}>Deny</Text>
                </Pressable>
              </View>
            );
          }
          // redemption-fulfill (Pending fulfillment section)
          const fulfillItem = item as unknown as RedemptionFulfillRow;
          const a = fulfillItem.kid ? AVATARS[fulfillItem.kid.avatar_id as AvatarId] : null;
          const icon = fulfillItem.reward ? REWARD_ICONS[fulfillItem.reward.icon_id as RewardIconId]?.emoji : '🎁';
          return (
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.line}>
                  {a?.emoji ?? '👤'} {fulfillItem.kid?.display_name} · {icon} {fulfillItem.reward?.title}
                </Text>
                <Text style={styles.sub}>approved {timeAgo(fulfillItem.resolved_at ?? new Date().toISOString())}</Text>
              </View>
              <Pressable onPress={() => fulfillRedemption.mutate(fulfillItem.id)} style={[styles.btn, styles.btnApprove]}>
                <Text style={styles.btnTextLight}>Fulfilled</Text>
              </Pressable>
            </View>
          );
        }}
      />

      <Modal visible={!!photoUrl} transparent animationType="fade" onRequestClose={() => setPhotoUrl(null)}>
        <Pressable style={styles.photoBg} onPress={() => setPhotoUrl(null)}>
          {photoUrl && <Image source={{ uri: photoUrl }} style={styles.photoImg} resizeMode="contain" />}
        </Pressable>
      </Modal>

      <RejectModal
        visible={!!rejectChoreTarget}
        onCancel={() => setRejectChoreTarget(null)}
        onConfirm={(reason) => {
          if (rejectChoreTarget) rejectChore.mutate({ instanceId: rejectChoreTarget.id, reason });
          setRejectChoreTarget(null);
        }}
      />

      <RejectModal
        visible={!!denyTarget}
        onCancel={() => setDenyTarget(null)}
        onConfirm={(note) => {
          if (denyTarget) denyRedemption.mutate({ redemptionId: denyTarget.id, note });
          setDenyTarget(null);
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
  sectionHeader: { fontSize: 12, fontWeight: '700', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginTop: 12, marginBottom: 4, paddingVertical: 4 },
  err: { color: '#ef4444' },
  empty: { color: '#6b7280', textAlign: 'center', marginTop: 64 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 8 },
  line: { fontSize: 15 },
  sub: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  viewPhoto: { color: '#3b82f6' },
  btn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
  btnApprove: { backgroundColor: '#10b981' },
  btnSecondary: { backgroundColor: '#f3f4f6' },
  btnTextLight: { color: '#fff', fontWeight: '600', fontSize: 13 },
  btnTextDark: { color: '#374151', fontWeight: '500', fontSize: 13 },
  photoBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center' },
  photoImg: { width: '100%', height: '80%' },
});
