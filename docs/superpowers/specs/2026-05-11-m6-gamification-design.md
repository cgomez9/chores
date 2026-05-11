# M6 — Gamification: Achievements + Juicy Feedback — Design Spec

**Date:** 2026-05-11
**Status:** Approved (pending user review of this written doc)
**Predecessor:** `docs/superpowers/specs/2026-05-11-m5-live-social-design.md`, `docs/superpowers/specs/2026-05-05-shores-design.md`
**Successor milestone:** M7 — Pre-launch polish (leaderboard, family co-op goals, streak-milestone pushes, quiet hours, push retry, account-deletion, etc.)

---

## 1. Scope and milestone boundary

### 1.1 In scope

- **`achievements` table** — append-only, one row per kid per unlocked badge.
- **Catalog of 8 badges** across 4 rule families (stars, streaks, chores, redemptions). Catalog is hardcoded in SQL (inside `check_achievements()`) and in mobile constants (`mobile/src/constants/achievements.ts`). No catalog table.
- **`check_achievements(profile_id)` SQL function** — evaluates all 8 rules, inserts newly-unlocked rows with `ON CONFLICT DO NOTHING`, returns the array of newly-inserted keys.
- **RPC integration** — `approve_chore` and `fulfill_redemption` end with `perform check_achievements(<kid>)`. `approve_redemption` is skipped (no positive-delta side effect).
- **Push trigger for unlocks** — `AFTER INSERT` trigger on `achievements` fires `pg_net.http_post` to the existing M5 `send_push` Edge Function with event `achievement_unlocked`. Same exception-wrapping pattern as the M5 push triggers.
- **`send_push` Edge Function extension** — new branch for `achievement_unlocked` event; formats message using an inlined 8-entry catalog map.
- **Kid Badges screen** at `mobile/app/(app)/kid/[profileId]/badges.tsx` — 2-column grid of all 8 badges, unlocked rendered in color (with unlock date), locked rendered greyscale (with criteria description).
- **"Badges" header link** on kid home alongside Rewards + Switch.
- **Realtime extension** — `subscribeToFamily` adds a 4th `postgres_changes` listener on `achievements` INSERT, emits an `achievement_unlocked` event onto a tiny in-app event bus.
- **Achievement banner** — top-level component listens to the event bus; on event, shows a full-screen overlay with emoji + title + description + confetti for 4 seconds (dismissable by tap). Queues multiple unlocks sequentially.
- **Juicy feedback library**:
  - `react-native-confetti-cannon` for confetti (imperative `start()`).
  - `expo-haptics` for haptic feedback (`Light` and `Heavy`).
  - `expo-audio` for SFX (or `expo-av` fallback if SDK 54 doesn't expose `expo-audio` yet).
- **Two-tier feedback**:
  - Small (tap Done): `ImpactFeedbackStyle.Light` + `click.mp3`.
  - Big (chore approval received via realtime, redemption fulfilled, achievement unlocked): `ImpactFeedbackStyle.Heavy` + `chime.mp3` + confetti burst.
- **Settings toggle** "Sounds & haptics on this device" — device-local AsyncStorage flag, default ON, controls both sound and haptic firing. No DB column; each device in a family decides independently.

### 1.2 Out of scope (deferred to M7+)

- **Leaderboard** (this-week + all-time star totals per kid). Carved off from M6 — sibling-competition UX needs design thought.
- **Family co-op goals** (parent creates "Pizza Night at 500⭐ family total" etc.). Carved off; needs more product thought at v1 family sizes.
- **Streak milestone pushes** (the 7/30/100-day notifications from spec §7.1). The streak math already exists in M3; the achievement system handles the badge side; standalone push for the milestone is M7 polish along with quiet hours.
- **Quiet hours** (9pm–7am push queueing per spec §7.2), **per-event mute settings**, **push retry queue**.
- **Account-deletion flow** (App Store requirement), **Sentry**, **email verification on**, **iOS push** (APNs cert), **Sign In with Apple + Google** (M1 Tasks 22–23), **real cloud Supabase project** — all bundle into M7.
- **Achievement system polish**: kid-visible progress meters ("3 more days to Week Streak"), per-badge rarity, badge sharing, animated reveal beyond the banner. v2+.

### 1.3 Exit criteria

A single-parent + single-kid family can:
1. Kid earns first ⭐ via a chore approval → app shows **🏅 First Star** banner with confetti + chime + haptic.
2. Continue earning until 100⭐ cumulative → **🏅 Century** unlocks.
3. Build a 7-day streak (manually backdate `streaks.last_completion_date` for testing) → next approval unlocks **🏅 Week Streak**.
4. First reward fulfillment → **🏅 First Reward** unlocks.
5. Kid taps "Badges" header link → grid shows 4 unlocked (color) + 4 locked (greyscale with criteria).
6. Parent → Settings → toggles **Sounds & haptics** off → next kid Done tap: no haptic, no sound. Visual feedback (confetti/banner) still works.
7. (Dev build only) Backgrounding the app while a kid earns their 100th star → push notification arrives: "🏅 Sara earned Century: Earn 100 stars total".

After acceptance, tag `m6-gamification`.

---

## 2. Data model

### 2.1 New table

```text
achievements
  id              uuid pk default gen_random_uuid()
  family_id       uuid not null fk → families on delete cascade   -- denormalized for RLS
  profile_id      uuid not null fk → profiles on delete cascade
  achievement_key text not null
  unlocked_at     timestamptz not null default now()

  unique (profile_id, achievement_key)
  index (profile_id, unlocked_at desc)
```

### 2.2 Schema design choices

- **`achievement_key text`** instead of an enum or FK to a catalog table. The catalog is small and rarely changes; defining it inline in SQL and mobile constants keeps the system single-source-of-truth and avoids a migration each time a badge is added. Typos aren't caught at the schema level — `check_achievements()` is the only writer and is fully covered by pgTAP.
- **`family_id` denormalized** — RLS predicate matches every other table.
- **`unique (profile_id, achievement_key)`** — idempotency. `check_achievements()` uses `ON CONFLICT DO NOTHING`.
- **No catalog table** — adding/removing badges is a code change. Removing a badge leaves orphan rows; we keep the constant entry around for display. Acceptable for v1.

### 2.3 No changes to existing tables

### 2.4 Migration order

1. `achievements` table + RLS
2. `check_achievements(profile_id)` function
3. `notify_push_achievement` trigger function + trigger on `achievements` AFTER INSERT
4. Modify `approve_chore` — append `perform check_achievements(NEW kid)` at end
5. Modify `fulfill_redemption` — append `perform check_achievements(NEW kid)` at end

---

## 3. Achievement catalog

8 badges across 4 rule families. Display strings live in `mobile/src/constants/achievements.ts`. The Edge Function (`send_push`) inlines a copy for push message formatting.

| Key | Emoji | Title | Description | Unlock when |
|---|---|---|---|---|
| `first_star`   | ⭐  | First Star      | Earn your first star            | cumulative positive ledger sum ≥ 1 |
| `stars_100`    | 💯  | Century         | Earn 100 stars total            | cumulative positive ledger sum ≥ 100 |
| `stars_500`    | 🏆  | High Roller     | Earn 500 stars total            | cumulative positive ledger sum ≥ 500 |
| `streak_7`     | 🔥  | Week Streak     | Earn stars 7 days in a row      | `greatest(current_count, longest_count)` ≥ 7 |
| `streak_30`    | 🌟  | Month Streak    | Earn stars 30 days in a row     | `greatest(current_count, longest_count)` ≥ 30 |
| `first_chore`  | ✅  | Getting Started | Get your first chore approved   | count of approved `chore_instances` ≥ 1 |
| `chores_25`    | 💪  | Quarter Century | Get 25 chores approved          | count of approved `chore_instances` ≥ 25 |
| `first_reward` | 🎁  | First Reward    | Redeem your first reward        | count of `'fulfilled'` redemptions ≥ 1 |

**Notes:**
- Star totals use `sum(delta) where delta > 0` (cumulative *earned*, not net balance). Spending doesn't revoke badges.
- Streak rules check both `current_count` and `longest_count` so a kid who hit 7 once and broke the streak keeps `streak_7` forever.

```typescript
// mobile/src/constants/achievements.ts
export type AchievementKey =
  | 'first_star' | 'stars_100' | 'stars_500'
  | 'streak_7' | 'streak_30'
  | 'first_chore' | 'chores_25'
  | 'first_reward';

export const ACHIEVEMENTS: Record<AchievementKey, { emoji: string; title: string; description: string }> = {
  first_star:   { emoji: '⭐', title: 'First Star',      description: 'Earn your first star' },
  stars_100:    { emoji: '💯', title: 'Century',         description: 'Earn 100 stars total' },
  stars_500:    { emoji: '🏆', title: 'High Roller',     description: 'Earn 500 stars total' },
  streak_7:     { emoji: '🔥', title: 'Week Streak',     description: 'Earn stars 7 days in a row' },
  streak_30:    { emoji: '🌟', title: 'Month Streak',    description: 'Earn stars 30 days in a row' },
  first_chore:  { emoji: '✅', title: 'Getting Started', description: 'Get your first chore approved' },
  chores_25:    { emoji: '💪', title: 'Quarter Century', description: 'Get 25 chores approved' },
  first_reward: { emoji: '🎁', title: 'First Reward',    description: 'Redeem your first reward' },
};

export const ACHIEVEMENT_KEYS: AchievementKey[] = [
  'first_star', 'stars_100', 'stars_500',
  'streak_7', 'streak_30',
  'first_chore', 'chores_25',
  'first_reward',
];
```

---

## 4. Server-side logic

### 4.1 `check_achievements(p_profile_id uuid) → text[]`

`security definer`. Defensive — returns empty array on bad input, never raises.

```sql
create or replace function public.check_achievements(p_profile_id uuid)
  returns text[]
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  p_family_id uuid;
  stars_earned int;
  streak_max int;
  chore_count int;
  redemption_count int;
  unlocked text[];
begin
  select profiles.family_id into p_family_id from public.profiles where id = p_profile_id;
  if p_family_id is null then return '{}'; end if;

  select coalesce(sum(delta), 0)::int into stars_earned
    from public.star_ledger where profile_id = p_profile_id and delta > 0;

  select coalesce(greatest(current_count, longest_count), 0)::int into streak_max
    from public.streaks where profile_id = p_profile_id;
  streak_max := coalesce(streak_max, 0);

  select count(*)::int into chore_count
    from public.chore_instances where completed_by = p_profile_id and status = 'approved';

  select count(*)::int into redemption_count
    from public.redemptions where kid_profile_id = p_profile_id and status = 'fulfilled';

  with candidates(k) as (
    select unnest(array[
      case when stars_earned     >= 1   then 'first_star'   end,
      case when stars_earned     >= 100 then 'stars_100'    end,
      case when stars_earned     >= 500 then 'stars_500'    end,
      case when streak_max       >= 7   then 'streak_7'     end,
      case when streak_max       >= 30  then 'streak_30'    end,
      case when chore_count      >= 1   then 'first_chore'  end,
      case when chore_count      >= 25  then 'chores_25'    end,
      case when redemption_count >= 1   then 'first_reward' end
    ])
  ),
  ins as (
    insert into public.achievements(family_id, profile_id, achievement_key)
    select p_family_id, p_profile_id, k from candidates where k is not null
    on conflict (profile_id, achievement_key) do nothing
    returning achievement_key
  )
  select coalesce(array_agg(achievement_key), '{}'::text[]) into unlocked from ins;

  return unlocked;
end;
$$;
```

### 4.2 RPC integration

- **`approve_chore`**: append `perform check_achievements(inst.completed_by);` at the very end of the body, after the ledger insert and streak upsert. The kid_profile_id is already in scope as `inst.completed_by`.
- **`fulfill_redemption`**: append `perform check_achievements(red.kid_profile_id);` at the end.

Both calls discard the return value — push notifications fire from the trigger on `achievements`, not from these RPCs.

`approve_redemption` is **not** modified. Its only side effect is a negative ledger row, which doesn't affect any catalog rule (stars_earned uses `delta > 0`).

### 4.3 Push trigger for unlocks

```sql
create or replace function public.notify_push_achievement() returns trigger
  language plpgsql security definer as $$
begin
  begin
    perform net.http_post(
      url := current_setting('app.settings.functions_base_url', true) || '/send_push',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
        'Content-Type',  'application/json'
      ),
      body := jsonb_build_object(
        'event', 'achievement_unlocked',
        'family_id', NEW.family_id,
        'profile_id', NEW.profile_id,
        'achievement_key', NEW.achievement_key
      )
    );
  exception when others then null;
  end;
  return NEW;
end;
$$;

create trigger achievements_push_trigger
  after insert on public.achievements
  for each row execute function notify_push_achievement();
```

Same exception-wrapping pattern as M5's chore + redemption triggers — `net.http_post` to a null URL would otherwise abort the calling transaction in local dev. Production failures are silently swallowed (acceptable per M5 design).

### 4.4 `send_push` Edge Function — new branch

`supabase/functions/send_push/index.ts` adds an `achievement_unlocked` branch:

```text
if (payload.event === 'achievement_unlocked') {
  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('id', payload.profile_id)
    .single();
  const kid = profile?.display_name ?? 'A kid';
  const a = ACHIEVEMENTS_EDGE[payload.achievement_key];
  body = `${a.emoji} ${kid} earned ${a.title}: ${a.description}`;
}
```

`ACHIEVEMENTS_EDGE` is an inlined constant inside the Edge Function — duplicates `mobile/src/constants/achievements.ts` (same 8 entries). Short and stable; if the catalog grows, both copies update together.

### 4.5 RLS

```sql
alter table public.achievements enable row level security;
create policy achievements_select_own_family on public.achievements
  for select using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.type = 'parent' and p.family_id = achievements.family_id)
  );
-- No INSERT/UPDATE/DELETE policies. Writes only via check_achievements (security definer).
```

Same pattern as M3's `star_ledger`, M4's `redemptions`, M5's `family_invites`.

---

## 5. Mobile UI

### 5.1 New library deps

- `react-native-confetti-cannon` — imperative confetti.
- `expo-haptics` — haptic feedback.
- `expo-audio` (or `expo-av` fallback if SDK 54 hasn't promoted `expo-audio` yet) — sound effects.

Plus two bundled audio assets:
- `mobile/assets/sounds/click.mp3` (~80ms soft click for Done tap)
- `mobile/assets/sounds/chime.mp3` (~600ms positive chime for approval / achievement)

### 5.2 Feedback module — `mobile/src/lib/feedback.ts`

```text
- isEnabled(): Promise<boolean>
  reads AsyncStorage 'feedback_enabled', returns true when undefined.
- fireSmallFeedback()
  if enabled → Haptics.impactAsync(ImpactFeedbackStyle.Light) + play click.mp3
- fireBigFeedback()
  if enabled → Haptics.impactAsync(ImpactFeedbackStyle.Heavy) + play chime.mp3 + confettiRef.start()
- fireAchievementFeedback()
  same as fireBigFeedback (separated for future per-event tuning)
```

ConfettiRef is held by a top-level `<ConfettiHost>` that exposes a module-level handle so `feedback.ts` can fire from anywhere.

### 5.3 ConfettiHost — `mobile/src/components/ConfettiHost.tsx`

Mounts once inside `app/_layout.tsx`. Renders `<ConfettiCannon ref={confettiRef} fadeOut autoStart={false} />` positioned absolutely top-center. Exposes the ref via a module-level handle (or React Context — the module-level ref is simpler).

### 5.4 AchievementBanner — `mobile/src/components/AchievementBanner.tsx`

Mounts once at the app root. Subscribes to the in-app event bus. When an `achievement_unlocked` event fires:
- Looks up emoji + title + description from `ACHIEVEMENTS[key]`.
- Shows a full-screen translucent overlay with `🏅 New Achievement!` + emoji + title + description.
- Calls `fireAchievementFeedback()` on mount.
- Auto-dismisses after 4 seconds OR on tap.
- If multiple events arrive in quick succession, queues them sequentially.

### 5.5 Event bus — `mobile/src/lib/events.ts`

Tiny module-level emitter:

```typescript
type EventName = 'achievement_unlocked';
type Payload = { key: string; profile_id: string };
const listeners = new Map<EventName, Set<(p: Payload) => void>>();

export function on(name: EventName, fn: (p: Payload) => void) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name)!.add(fn);
  return () => listeners.get(name)?.delete(fn);
}

export function emit(name: EventName, payload: Payload) {
  listeners.get(name)?.forEach((fn) => fn(payload));
}
```

### 5.6 Realtime extension — `mobile/src/lib/realtime.ts`

Add a 4th `postgres_changes` listener to `subscribeToFamily`:

```text
.on('postgres_changes', {
  event: 'INSERT', schema: 'public', table: 'achievements',
  filter: `family_id=eq.${familyId}`,
}, (payload) => {
  emit('achievement_unlocked', {
    key: payload.new.achievement_key,
    profile_id: payload.new.profile_id,
  });
})
```

Banner shows for any kid in the family — works for two-parent shared-device flows where Parent B sees Parent A's kid earning a badge.

### 5.7 Kid home updates

- **Done tap small feedback:** `onDone()` calls `fireSmallFeedback()` immediately before the photo route push / RPC call.
- **Approval-arrived big feedback:** new `postgres_changes` subscription in the kid home, scoped to `completed_by=eq.<profileId>`, fires `fireBigFeedback()` when a status transitions to `'approved'`.
- **Same pattern for fulfilled redemptions:** subscription on `redemptions` where `kid_profile_id=eq.<profileId>`, fires `fireBigFeedback()` on `'fulfilled'` transitions.
- **"Badges" header link:** new `<Pressable>` in the kid home header → `router.push('/(app)/kid/<profileId>/badges')`.

### 5.8 New screen — `mobile/app/(app)/kid/[profileId]/badges.tsx`

- Header: "Badges" + balance pill (existing pattern) + Back link.
- Query: `achievements` filtered by `profile_id = <profileId>`.
- Body: 2-column grid of 8 cards mapped from `ACHIEVEMENT_KEYS`.
- **Unlocked card:** full color, emoji big, title, "Unlocked <date>".
- **Locked card:** greyscale (opacity 0.4), emoji big, title, description (criteria), no date.

### 5.9 Settings — Sounds & haptics toggle

`parent/settings.tsx` adds one row above the "Notifications — coming soon" stub:

```text
Section label: "Feedback"
Row: "Sounds & haptics on this device" + <Switch>
  reads / writes AsyncStorage 'feedback_enabled' (default true)
```

Device-local — no DB column. Each device in a family decides independently.

### 5.10 Files touched

| File | Status |
|---|---|
| `mobile/src/constants/achievements.ts`           | New |
| `mobile/src/lib/feedback.ts`                     | New |
| `mobile/src/lib/events.ts`                       | New |
| `mobile/src/components/ConfettiHost.tsx`         | New |
| `mobile/src/components/AchievementBanner.tsx`    | New |
| `mobile/src/lib/realtime.ts`                     | Modified (achievements listener) |
| `mobile/app/_layout.tsx`                         | Modified (mount ConfettiHost + AchievementBanner) |
| `mobile/app/(app)/kid/[profileId]/index.tsx`     | Modified (Badges link + Done feedback + approval/redemption feedback subscriptions) |
| `mobile/app/(app)/kid/[profileId]/badges.tsx`    | New |
| `mobile/app/(app)/parent/settings.tsx`           | Modified (Sounds & haptics toggle) |
| `mobile/tests/feedback.test.ts`                  | New |
| `mobile/tests/events.test.ts`                    | New |
| `mobile/tests/achievements-catalog.test.ts`      | New |
| `mobile/assets/sounds/click.mp3`                 | New asset |
| `mobile/assets/sounds/chime.mp3`                 | New asset |
| `mobile/src/types/database.ts`                   | Regenerated |
| `mobile/package.json`                            | Modified (new deps) |
| `supabase/functions/send_push/index.ts`          | Modified (achievement_unlocked branch + inlined catalog) |

---

## 6. Testing strategy

### 6.1 pgTAP

- **`achievements` RLS isolation** — User A from Family 1 cannot SELECT Family 2's achievements.
- **`check_achievements`** — 12 assertions covering:
  - Each catalog rule unlocks on its threshold
  - Stars rule uses positive-only sum (negative ledger doesn't revoke)
  - Streak rule uses `greatest(current, longest)`
  - Idempotent re-call returns empty array second time
  - Unknown profile_id returns empty array (doesn't error)
  - No-activity kid returns empty array, no row inserted
- **`approve_chore` integration** — approving a kid's first chore inserts `first_star` and `first_chore` into `achievements`.
- **`fulfill_redemption` integration** — fulfilling a kid's first redemption inserts `first_reward`.

Approximate net-new test count: ~19 across 4 new test files.

### 6.2 Jest

- `feedback.test.ts` — `isEnabled` default + override behavior; `fireSmallFeedback` calls Haptics when enabled, no-ops when disabled.
- `events.test.ts` — `on` / `emit` / `off` round-trip + unsubscribe.
- `achievements-catalog.test.ts` — every `ACHIEVEMENT_KEYS` entry has a corresponding `ACHIEVEMENTS` map entry.

7 new tests. Total: 23 + 7 = ~30.

ConfettiHost + AchievementBanner are not unit-tested — refs and animation are integration-level concerns, covered by manual acceptance.

### 6.3 Manual M6 acceptance

1. Fresh sign-up → onboarding → add a kid → seed chores.
2. Trigger generator (`curl.exe -X POST http://127.0.0.1:54321/functions/v1/generate_chore_instances`).
3. Kid taps Done on a chore → feel small haptic, hear soft click.
4. Parent → Approvals → approve → on kid mode (switch via avatar lock) expect big confetti + chime + heavy haptic + **🏅 First Star** banner.
5. Continue earning until cumulative 100⭐ → **🏅 Century** banner.
6. In psql:
   ```sql
   update public.streaks set current_count = 6, last_completion_date = current_date - 1
     where profile_id = '<kid uuid>';
   ```
   Approve another chore → **🏅 Week Streak** banner.
7. Parent creates a reward → kid requests → parent approves → fulfills → **🏅 First Reward** banner.
8. Kid taps **Badges** header link → grid shows 4 unlocked (color) + 4 locked (greyscale + criteria).
9. Parent → Settings → toggles **Sounds & haptics** off → next kid Done tap: no buzz, no sound. Visual feedback (confetti / banner) still works on other devices that have it enabled.
10. (Optional, dev build only) Background app on Parent A's device → drive an achievement on Parent B's session → Parent A receives push: "🏅 Sara earned Week Streak: Earn stars 7 days in a row".

### 6.4 M6 exit criteria

- Migrations apply cleanly to fresh DB and to a DB at the `m5-live-social` tag.
- pgTAP green (M5's 129 + ~19 new = **~148 tests**).
- Jest 23 + 7 = **~30 tests**; `tsc --noEmit` clean.
- Manual flow above passes on Android emulator.
- Tag `m6-gamification` after acceptance.

---

## 7. Open questions / known deferrals

- **Achievement progress meters** ("3 more days to Week Streak"). Adds UX but also adds query cost. v2+.
- **Per-badge rarity / sharing.** v2+.
- **Catalog table** instead of hardcoded SQL+TS map. Trade-off is migration noise vs. dynamic catalog. Stay inlined for v1.
- **Confetti library choice.** `react-native-confetti-cannon` is the simplest; alternatives exist (react-native-reanimated-based confetti) for more polish. Default to confetti-cannon; revisit if it has glitches on Android emulator.
- **Audio assets** — need actual sound files committed to the repo. Plan task includes a step to source or generate two short MP3s (click + chime). Free PD sources: freesound.org. v1 quality bar: anything not actively annoying.
- **Leaderboard + family co-op goals + streak-milestone pushes** — explicitly carved off; M7's territory.
- **Existing M2/M5 dev-infra carry-overs + remaining M1 issues** — still bundled for the cloud-prep slot before M8 ship.

---

**End of M6 spec.**
