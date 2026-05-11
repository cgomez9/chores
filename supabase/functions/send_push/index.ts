// supabase/functions/send_push/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

type PushEvent =
  | { event: 'chore_submitted' | 'chore_approved' | 'chore_rejected';
      family_id: string; instance_id: string; kid_profile_id: string | null }
  | { event: 'redemption_requested' | 'redemption_approved' | 'redemption_denied' | 'redemption_fulfilled';
      family_id: string; redemption_id: string; reward_id: string; kid_profile_id: string }
  | { event: 'achievement_unlocked';
      family_id: string; profile_id: string; achievement_key: string };

const ACHIEVEMENTS_EDGE: Record<string, { emoji: string; title: string; description: string }> = {
  first_star:   { emoji: '⭐', title: 'First Star',      description: 'Earn your first star' },
  stars_100:    { emoji: '💯', title: 'Century',         description: 'Earn 100 stars total' },
  stars_500:    { emoji: '🏆', title: 'High Roller',     description: 'Earn 500 stars total' },
  streak_7:     { emoji: '🔥', title: 'Week Streak',     description: 'Earn stars 7 days in a row' },
  streak_30:    { emoji: '🌟', title: 'Month Streak',    description: 'Earn stars 30 days in a row' },
  first_chore:  { emoji: '✅', title: 'Getting Started', description: 'Get your first chore approved' },
  chores_25:    { emoji: '💪', title: 'Quarter Century', description: 'Get 25 chores approved' },
  first_reward: { emoji: '🎁', title: 'First Reward',    description: 'Redeem your first reward' },
};

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const payload = (await req.json()) as PushEvent;

  // 1. Resolve recipient tokens.
  const { data: parents, error: pErr } = await supabase
    .from('profiles')
    .select('push_token')
    .eq('family_id', payload.family_id)
    .eq('type', 'parent')
    .not('push_token', 'is', null);
  if (pErr) return new Response(`profile lookup failed: ${pErr.message}`, { status: 500 });
  const tokens = (parents ?? [])
    .map((p) => p.push_token as string)
    .filter((t) => t && t.length > 0);
  if (tokens.length === 0) return new Response(JSON.stringify({ sent: 0, reason: 'no tokens' }), { status: 200 });

  // 2. Build message per event.
  let title = 'Shores';
  let body = '';
  if (payload.event.startsWith('chore_')) {
    const { data: inst } = await supabase
      .from('chore_instances')
      .select('stars_awarded,kid:profiles!chore_instances_completed_by_fkey(display_name),chore:chores(title)')
      .eq('id', (payload as { instance_id: string }).instance_id)
      .single();
    const kid = (inst as any)?.kid?.display_name ?? 'A kid';
    const choreTitle = (inst as any)?.chore?.title ?? 'a chore';
    const stars = (inst as any)?.stars_awarded ?? 0;
    if (payload.event === 'chore_submitted') body = `${kid} submitted '${choreTitle}' 📸`;
    else if (payload.event === 'chore_approved') body = `+${stars}⭐! Great job on '${choreTitle}' 🎉`;
    else if (payload.event === 'chore_rejected') body = `'${choreTitle}' needs another look`;
  } else if (payload.event.startsWith('redemption_')) {
    const { data: red } = await supabase
      .from('redemptions')
      .select('star_cost_snapshot,kid:profiles!redemptions_kid_profile_id_fkey(display_name),reward:rewards(title)')
      .eq('id', (payload as { redemption_id: string }).redemption_id)
      .single();
    const kid = (red as any)?.kid?.display_name ?? 'A kid';
    const rewardTitle = (red as any)?.reward?.title ?? 'a reward';
    const cost = (red as any)?.star_cost_snapshot ?? 0;
    if (payload.event === 'redemption_requested') body = `${kid} wants ${rewardTitle} (${cost}⭐)`;
    else if (payload.event === 'redemption_approved') body = `${rewardTitle} approved! 🍦`;
    else if (payload.event === 'redemption_denied') body = `Request for ${rewardTitle} was denied`;
    else if (payload.event === 'redemption_fulfilled') body = `🎁 ${kid} got their ${rewardTitle}`;
  } else if (payload.event === 'achievement_unlocked') {
    const ach = payload as { profile_id: string; achievement_key: string };
    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', ach.profile_id)
      .single();
    const kid = (profile as any)?.display_name ?? 'A kid';
    const a = ACHIEVEMENTS_EDGE[ach.achievement_key];
    if (a) body = `${a.emoji} ${kid} earned ${a.title}: ${a.description}`;
    else body = `${kid} unlocked a new achievement`;
  }

  // 3. POST to Expo Push.
  const messages = tokens.map((to) => ({ to, sound: 'default', title, body }));
  const expoRes = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(messages),
  });
  const expoBody = await expoRes.text();
  return new Response(JSON.stringify({ sent: messages.length, expoStatus: expoRes.status, expoBody }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
