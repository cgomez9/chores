# M6 — Gamification (Achievements + Juicy Feedback) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the 8-badge achievement system + juicy feedback (confetti, sounds, haptics) per `docs/superpowers/specs/2026-05-11-m6-gamification-design.md`.

**Architecture:** New `achievements` table + `check_achievements()` function called atomically inside `approve_chore` and `fulfill_redemption`; AFTER INSERT trigger on `achievements` fires push notifications via the existing M5 `send_push` Edge Function (new `achievement_unlocked` branch). Mobile uses a module-level event bus + top-level `ConfettiHost` and `AchievementBanner` components driven by realtime `postgres_changes` events. Two-tier feedback library (`react-native-confetti-cannon` + `expo-haptics` + `expo-audio`) gated by a device-local AsyncStorage toggle.

**Tech Stack:** Supabase (Postgres + Auth + RLS + Realtime + Edge Functions), pgTAP, Deno, TypeScript, Expo SDK 54 / React Native 0.81 / Expo Router 6, TanStack Query v5, `react-native-confetti-cannon`, `expo-haptics`, `expo-audio` (or `expo-av` fallback).

---

## File structure

**New SQL migrations** (`supabase/migrations/`):
- `20260511000009_achievements_table.sql`
- `20260511000010_check_achievements_function.sql`
- `20260511000011_approve_chore_calls_check.sql`
- `20260511000012_fulfill_redemption_calls_check.sql`
- `20260511000013_achievement_push_trigger.sql`

**New pgTAP tests** (`supabase/tests/`):
- `33_achievements_rls.sql`
- `34_check_achievements.sql`
- `35_approve_chore_achievement_integration.sql`
- `36_fulfill_redemption_achievement_integration.sql`

**Modified Edge Function**:
- `supabase/functions/send_push/index.ts` — adds `achievement_unlocked` branch + inlined catalog

**New mobile files**:
- `mobile/src/constants/achievements.ts`
- `mobile/src/lib/events.ts`
- `mobile/src/lib/feedback.ts`
- `mobile/src/components/ConfettiHost.tsx`
- `mobile/src/components/AchievementBanner.tsx`
- `mobile/app/(app)/kid/[profileId]/badges.tsx`
- `mobile/assets/sounds/click.mp3` (asset)
- `mobile/assets/sounds/chime.mp3` (asset)
- `mobile/tests/feedback.test.ts`
- `mobile/tests/events.test.ts`
- `mobile/tests/achievements-catalog.test.ts`

**Modified mobile files**:
- `mobile/src/lib/realtime.ts` — `achievements` INSERT listener
- `mobile/app/_layout.tsx` — mount `ConfettiHost` + `AchievementBanner`
- `mobile/app/(app)/kid/[profileId]/index.tsx` — Badges header link, Done feedback, approval feedback subscription
- `mobile/app/(app)/parent/settings.tsx` — Sounds & haptics toggle
- `mobile/src/types/database.ts` — regenerated
- `mobile/package.json` — new deps

---

## Task 0: Branch + verify baseline

**Files:** none (git only)

- [ ] **Step 1: Create the M6 branch off main**

```bash
git switch main
git switch -c m6-gamification
```

- [ ] **Step 2: Verify Supabase + tests still green**

```bash
npx supabase status
npx supabase test db
cd mobile && npx tsc --noEmit && npm test -- --watchAll=false && cd ..
```

Expected: pgTAP `Files=32, Tests=129, Result: PASS`; tsc clean; jest 23/23.

---

## Task 1: achievements table

**Files:**
- Create: `supabase/migrations/20260511000009_achievements_table.sql`
- Create: `supabase/tests/33_achievements_rls.sql`

- [ ] **Step 1: Migration**

```sql
-- supabase/migrations/20260511000009_achievements_table.sql
create table public.achievements (
  id              uuid primary key default gen_random_uuid(),
  family_id       uuid not null references public.families(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  achievement_key text not null,
  unlocked_at     timestamptz not null default now(),
  unique (profile_id, achievement_key)
);

create index achievements_profile_unlocked_idx on public.achievements(profile_id, unlocked_at desc);

alter table public.achievements enable row level security;

create policy achievements_select_own_family on public.achievements
  for select using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.type = 'parent' and p.family_id = achievements.family_id)
  );
-- No INSERT/UPDATE/DELETE policies. Writes via check_achievements (security definer).
```

- [ ] **Step 2: pgTAP test**

```sql
-- supabase/tests/33_achievements_rls.sql
begin;
select plan(2);

insert into auth.users(id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.com'),
  ('22222222-2222-2222-2222-222222222222', 'b@test.com');
insert into public.families(id, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Family A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Family B');
insert into public.profiles(id, family_id, type, display_name, avatar_id, user_id) values
  ('a1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'parent', 'Alice', 1, '11111111-1111-1111-1111-111111111111'),
  ('a2222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'kid',    'Sara',  2, null),
  ('b2222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'parent', 'Bob',   1, '22222222-2222-2222-2222-222222222222'),
  ('b9999999-9999-9999-9999-999999999999', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'kid',    'Otto',  3, null);
insert into public.achievements(family_id, profile_id, achievement_key) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a2222222-2222-2222-2222-222222222222', 'first_star'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b9999999-9999-9999-9999-999999999999', 'first_star');

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is(
  (select count(*)::int from public.achievements), 1,
  'Alice sees only Family A achievements'
);
select is_empty(
  $$ select * from public.achievements where family_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' $$,
  'Alice cannot see Family B achievements'
);

select * from finish();
rollback;
```

- [ ] **Step 3: Run + commit**

```bash
npx supabase db reset && npx supabase test db
git add supabase/migrations/20260511000009_achievements_table.sql supabase/tests/33_achievements_rls.sql
git commit -m "feat(db): achievements table + select-only RLS"
```

Expected: 131 tests across 33 files.

---

## Task 2: check_achievements function

**Files:**
- Create: `supabase/migrations/20260511000010_check_achievements_function.sql`
- Create: `supabase/tests/34_check_achievements.sql`

- [ ] **Step 1: Migration**

```sql
-- supabase/migrations/20260511000010_check_achievements_function.sql
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

- [ ] **Step 2: pgTAP test**

```sql
-- supabase/tests/34_check_achievements.sql
begin;
select plan(12);

insert into auth.users(id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.com');
insert into public.families(id, name) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Family A');
insert into public.profiles(id, family_id, type, display_name, avatar_id, user_id) values
  ('a1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'parent', 'Alice', 1, '11111111-1111-1111-1111-111111111111'),
  ('a2222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'kid',    'Sara',  2, null),
  ('a3333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'kid',    'Leo',   3, null),
  ('a4444444-4444-4444-4444-444444444444', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'kid',    'Mia',   4, null);

-- 1. Unknown profile returns empty.
select is(public.check_achievements('99999999-9999-9999-9999-999999999999'), '{}'::text[], 'unknown profile_id returns empty');

-- 2. No-activity kid returns empty.
select is(public.check_achievements('a2222222-2222-2222-2222-222222222222'), '{}'::text[], 'no-activity kid returns empty');

-- 3. 1 star → first_star
insert into public.star_ledger(family_id, profile_id, delta, reason) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a2222222-2222-2222-2222-222222222222', 1, 'chore_approved');
select is(public.check_achievements('a2222222-2222-2222-2222-222222222222'), array['first_star'], '1 star unlocks first_star');

-- 4. Idempotency: second call returns empty.
select is(public.check_achievements('a2222222-2222-2222-2222-222222222222'), '{}'::text[], 'idempotent re-call returns empty');

-- 5. 100 stars total → stars_100 (first_star already unlocked, not returned).
insert into public.star_ledger(family_id, profile_id, delta, reason) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a2222222-2222-2222-2222-222222222222', 99, 'chore_approved');
select is(public.check_achievements('a2222222-2222-2222-2222-222222222222'), array['stars_100'], '100 stars unlocks stars_100 only');

-- 6. Negative ledger doesn't revoke: spend 50, badge stays. Approve again — no new unlock.
insert into public.star_ledger(family_id, profile_id, delta, reason) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a2222222-2222-2222-2222-222222222222', -50, 'redemption');
select is(public.check_achievements('a2222222-2222-2222-2222-222222222222'), '{}'::text[], 'negative ledger does not revoke');

-- 7. 500 cumulative positive (Sara at 100 earned + add 400 more) → stars_500.
insert into public.star_ledger(family_id, profile_id, delta, reason) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a2222222-2222-2222-2222-222222222222', 400, 'chore_approved');
select is(public.check_achievements('a2222222-2222-2222-2222-222222222222'), array['stars_500'], '500 cumulative unlocks stars_500');

-- 8. Streak via longest_count (current_count reset): Leo.
insert into public.streaks(profile_id, family_id, current_count, longest_count, last_completion_date)
  values ('a3333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, 7, current_date);
insert into public.star_ledger(family_id, profile_id, delta, reason) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a3333333-3333-3333-3333-333333333333', 5, 'chore_approved');
select is(
  public.check_achievements('a3333333-3333-3333-3333-333333333333'),
  array['first_star', 'streak_7', 'first_chore'] ::text[],  -- order: array_agg from a CTE — verify with sort
  'streak_7 unlocked via longest_count'
);
-- Note: the above test is fragile if array_agg order isn't stable. Switch to a containment check if it fails:
--   select results_eq(
--     $$ select unnest(public.check_achievements('a3333333-3333-3333-3333-333333333333')) order by 1 $$,
--     $$ values ('first_chore'::text), ('first_star'::text), ('streak_7'::text) $$,
--     'streak_7 via longest_count'
--   );
-- Use whichever form is stable in your Postgres version. For now we'll assume array equality with the SQL order.

-- 9. 25 approved chore_instances → chores_25
insert into public.chores(id, family_id, title, star_value, verification_mode, recurrence, assignee_profile_id, created_by) values
  ('c1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'X', 1, 'auto', '{"type":"daily"}'::jsonb, 'a4444444-4444-4444-4444-444444444444', 'a1111111-1111-1111-1111-111111111111');
insert into public.chore_instances(chore_id, family_id, assignee_profile_id, completed_by, due_at, status)
  select 'c1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a4444444-4444-4444-4444-444444444444', 'a4444444-4444-4444-4444-444444444444',
         now() + (gs || ' minutes')::interval, 'approved'
  from generate_series(1, 25) gs;
insert into public.star_ledger(family_id, profile_id, delta, reason) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a4444444-4444-4444-4444-444444444444', 25, 'chore_approved');
select ok(
  array['chores_25']::text[] <@ public.check_achievements('a4444444-4444-4444-4444-444444444444'),
  '25 approved chore_instances unlocks chores_25'
);

-- 10. First fulfilled redemption → first_reward.
insert into public.rewards(id, family_id, title, star_cost, icon_id, created_by)
  values ('aaa11111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Ice Cream', 1, 2, 'a1111111-1111-1111-1111-111111111111');
insert into public.redemptions(family_id, reward_id, kid_profile_id, star_cost_snapshot, status)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaa11111-1111-1111-1111-111111111111', 'a4444444-4444-4444-4444-444444444444', 1, 'fulfilled');
select ok(
  array['first_reward']::text[] <@ public.check_achievements('a4444444-4444-4444-4444-444444444444'),
  'fulfilled redemption unlocks first_reward'
);

-- 11. Row inserted into achievements table.
select is(
  (select count(*)::int from public.achievements where profile_id = 'a4444444-4444-4444-4444-444444444444' and achievement_key = 'first_reward'),
  1, 'first_reward row exists in achievements'
);

-- 12. Sara has stars_100 and stars_500 (set up above) — verify rows exist in table.
select is(
  (select count(*)::int from public.achievements where profile_id = 'a2222222-2222-2222-2222-222222222222'),
  3, 'Sara has first_star + stars_100 + stars_500 in achievements'
);

select * from finish();
rollback;
```

If assertion 8 (array equality with order) is flaky, replace with the commented containment form using `<@` operator and `unnest` ordering. Both are documented in the test.

- [ ] **Step 3: Run + commit**

```bash
npx supabase db reset && npx supabase test db
git add supabase/migrations/20260511000010_check_achievements_function.sql supabase/tests/34_check_achievements.sql
git commit -m "feat(db): check_achievements function with 8-badge catalog"
```

Expected: 143 tests across 34 files.

---

## Task 3: Wire approve_chore to call check_achievements

**Files:**
- Create: `supabase/migrations/20260511000011_approve_chore_calls_check.sql`
- Create: `supabase/tests/35_approve_chore_achievement_integration.sql`

- [ ] **Step 1: Migration — replace approve_chore with the same body + check_achievements call at end**

```sql
-- supabase/migrations/20260511000011_approve_chore_calls_check.sql
create or replace function public.approve_chore(instance_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  caller_profile uuid;
  caller_family  uuid;
  inst           public.chore_instances%rowtype;
  star_value     int;
  s              public.streaks%rowtype;
begin
  select id, profiles.family_id into caller_profile, caller_family
  from public.profiles where user_id = auth.uid() and type = 'parent';
  if caller_profile is null then raise exception 'caller is not a parent'; end if;

  select * into inst from public.chore_instances where id = instance_id for update;
  if inst.id is null then raise exception 'instance % not found', instance_id; end if;
  if inst.family_id <> caller_family then raise exception 'instance % not in caller family', instance_id; end if;
  if inst.status = 'approved' then return; end if;
  if inst.status <> 'submitted' then raise exception 'instance % is not submitted (status=%)', instance_id, inst.status; end if;

  select c.star_value into star_value from public.chores c where c.id = inst.chore_id;

  update public.chore_instances
    set status='approved', approved_by=caller_profile, approved_at=now(), stars_awarded=star_value
    where id = instance_id;

  insert into public.star_ledger(family_id, profile_id, delta, reason, source_id)
  values (caller_family, inst.completed_by, star_value, 'chore_approved', instance_id);

  select * into s from public.streaks where profile_id = inst.completed_by;
  if s.profile_id is null then
    insert into public.streaks(profile_id, family_id, current_count, longest_count, last_completion_date)
    values (inst.completed_by, caller_family, 1, 1, current_date);
  elsif s.last_completion_date = current_date then
    null;
  elsif s.last_completion_date = current_date - 1 then
    update public.streaks
      set current_count = s.current_count + 1,
          longest_count = greatest(s.longest_count, s.current_count + 1),
          last_completion_date = current_date
      where profile_id = inst.completed_by;
  else
    update public.streaks
      set current_count = 1,
          last_completion_date = current_date
      where profile_id = inst.completed_by;
  end if;

  -- M6: run achievement checks after ledger + streak updates.
  perform public.check_achievements(inst.completed_by);
end;
$$;
```

- [ ] **Step 2: pgTAP integration test**

```sql
-- supabase/tests/35_approve_chore_achievement_integration.sql
begin;
select plan(3);

insert into auth.users(id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.com');
insert into public.families(id, name) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Family A');
insert into public.profiles(id, family_id, type, display_name, avatar_id, user_id) values
  ('a1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'parent', 'Alice', 1, '11111111-1111-1111-1111-111111111111'),
  ('a2222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'kid',    'Sara',  2, null);
insert into public.chores(id, family_id, title, star_value, verification_mode, recurrence, assignee_profile_id, created_by)
  values ('c1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'A', 1, 'approval', '{"type":"daily"}'::jsonb, 'a2222222-2222-2222-2222-222222222222', 'a1111111-1111-1111-1111-111111111111');
insert into public.chore_instances(id, chore_id, family_id, assignee_profile_id, due_at, status, completed_by, completed_at) values
  ('11111111-aaaa-1111-1111-111111111111', 'c1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a2222222-2222-2222-2222-222222222222', now(), 'submitted', 'a2222222-2222-2222-2222-222222222222', now());

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select lives_ok(
  $$ select public.approve_chore('11111111-aaaa-1111-1111-111111111111') $$,
  'approve_chore succeeds'
);

set local role postgres;
select is(
  (select count(*)::int from public.achievements
    where profile_id = 'a2222222-2222-2222-2222-222222222222' and achievement_key = 'first_star'),
  1, 'first_star achievement row created by approve_chore'
);
select is(
  (select count(*)::int from public.achievements
    where profile_id = 'a2222222-2222-2222-2222-222222222222' and achievement_key = 'first_chore'),
  1, 'first_chore achievement row created by approve_chore'
);

select * from finish();
rollback;
```

- [ ] **Step 3: Run + commit**

```bash
npx supabase db reset && npx supabase test db
git add supabase/migrations/20260511000011_approve_chore_calls_check.sql supabase/tests/35_approve_chore_achievement_integration.sql
git commit -m "feat(db): approve_chore calls check_achievements at end of body"
```

Expected: 146 tests across 35 files.

---

## Task 4: Wire fulfill_redemption to call check_achievements

**Files:**
- Create: `supabase/migrations/20260511000012_fulfill_redemption_calls_check.sql`
- Create: `supabase/tests/36_fulfill_redemption_achievement_integration.sql`

- [ ] **Step 1: Migration**

```sql
-- supabase/migrations/20260511000012_fulfill_redemption_calls_check.sql
create or replace function public.fulfill_redemption(redemption_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  caller_profile uuid;
  caller_family  uuid;
  red            public.redemptions%rowtype;
begin
  select id, profiles.family_id into caller_profile, caller_family
  from public.profiles where user_id = auth.uid() and type = 'parent';
  if caller_profile is null then raise exception 'caller is not a parent'; end if;

  select * into red from public.redemptions where id = redemption_id for update;
  if red.id is null then raise exception 'redemption % not found', redemption_id; end if;
  if red.family_id <> caller_family then raise exception 'redemption % not in caller family', redemption_id; end if;
  if red.status = 'fulfilled' then return; end if;
  if red.status <> 'approved' then raise exception 'redemption % is not approved (status=%)', redemption_id, red.status; end if;

  update public.redemptions set status='fulfilled' where id = redemption_id;

  -- M6: run achievement checks after fulfillment.
  perform public.check_achievements(red.kid_profile_id);
end;
$$;
```

- [ ] **Step 2: pgTAP integration test**

```sql
-- supabase/tests/36_fulfill_redemption_achievement_integration.sql
begin;
select plan(2);

insert into auth.users(id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.com');
insert into public.families(id, name) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Family A');
insert into public.profiles(id, family_id, type, display_name, avatar_id, user_id) values
  ('a1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'parent', 'Alice', 1, '11111111-1111-1111-1111-111111111111'),
  ('a2222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'kid',    'Sara',  2, null);
insert into public.rewards(id, family_id, title, star_cost, icon_id, created_by) values
  ('aaa11111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Ice Cream', 10, 2, 'a1111111-1111-1111-1111-111111111111');
insert into public.redemptions(id, family_id, reward_id, kid_profile_id, star_cost_snapshot, status, resolved_by, resolved_at) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaa11111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222', 10, 'approved', 'a1111111-1111-1111-1111-111111111111', now());

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select lives_ok(
  $$ select public.fulfill_redemption('11111111-1111-1111-1111-111111111111') $$,
  'fulfill_redemption succeeds'
);

set local role postgres;
select is(
  (select count(*)::int from public.achievements
    where profile_id = 'a2222222-2222-2222-2222-222222222222' and achievement_key = 'first_reward'),
  1, 'first_reward achievement created by fulfill_redemption'
);

select * from finish();
rollback;
```

- [ ] **Step 3: Run + commit**

```bash
npx supabase db reset && npx supabase test db
git add supabase/migrations/20260511000012_fulfill_redemption_calls_check.sql supabase/tests/36_fulfill_redemption_achievement_integration.sql
git commit -m "feat(db): fulfill_redemption calls check_achievements at end of body"
```

Expected: 148 tests across 36 files.

---

## Task 5: Achievement push trigger

**Files:**
- Create: `supabase/migrations/20260511000013_achievement_push_trigger.sql`

No new pgTAP file — trigger correctness is exercised via the manual M6 acceptance flow and the existing M5 push pipeline tests.

- [ ] **Step 1: Migration**

```sql
-- supabase/migrations/20260511000013_achievement_push_trigger.sql
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

- [ ] **Step 2: Verify existing pgTAP still passes**

```bash
npx supabase db reset && npx supabase test db
```

Expected: 148 tests still PASS — the trigger fires when achievement rows are inserted during the integration tests (Tasks 3 and 4), but the exception wrapper swallows pg_net null-URL errors so the calling transactions don't abort.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260511000013_achievement_push_trigger.sql
git commit -m "feat(db): notify_push_achievement trigger for new badge unlocks"
```

---

## Task 6: send_push Edge Function — achievement_unlocked branch

**Files:**
- Modify: `supabase/functions/send_push/index.ts`

- [ ] **Step 1: Replace the file**

The current M5 send_push function handles chore_* and redemption_* events. Add a third branch for `achievement_unlocked`. Full new file:

```typescript
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

  // 1. Recipient tokens.
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
```

- [ ] **Step 2: Smoke test**

```bash
npx supabase functions serve send_push --no-verify-jwt
# Other terminal:
SERVICE_ROLE_KEY=$(npx supabase status -o json | python -c "import sys,json; print(json.load(sys.stdin).get('SERVICE_ROLE_KEY',''))")
curl -X POST http://127.0.0.1:54321/functions/v1/send_push \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"event":"achievement_unlocked","family_id":"00000000-0000-0000-0000-000000000000","profile_id":"00000000-0000-0000-0000-000000000000","achievement_key":"first_star"}'
```

Expected: `{"sent":0,"reason":"no tokens"}` (no parent tokens in fresh DB). Confirms the function doesn't crash on the new event branch.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/send_push/index.ts
git commit -m "feat(edge): send_push handles achievement_unlocked event with catalog lookup"
```

---

## Task 7: Regenerate database types

**Files:**
- Modify: `mobile/src/types/database.ts`

- [ ] **Step 1: Regenerate, filtering CLI noise**

```bash
npx supabase gen types typescript --local 2>/dev/null \
  | grep -v '^Connecting to' \
  | grep -v '<claude-code-hint' \
  > mobile/src/types/database.ts
```

- [ ] **Step 2: Type-check**

```bash
cd mobile && npx tsc --noEmit
```

Expected: clean. New types include `achievements` table and `check_achievements` RPC.

- [ ] **Step 3: Commit**

```bash
cd .. && git add mobile/src/types/database.ts
git commit -m "chore(types): regenerate database types after M6 schema migrations"
```

---

## Task 8: Install mobile deps

**Files:**
- Modify: `mobile/package.json`

- [ ] **Step 1: Install**

```bash
cd mobile
npx expo install expo-haptics expo-audio
npm install react-native-confetti-cannon --legacy-peer-deps
```

If `expo-audio` isn't yet a supported package for SDK 54, install `expo-av` instead (`npx expo install expo-av`). The plan tasks below use the `expo-audio` API; if you fell back to `expo-av`, adapt the import and method names in Task 11 (one-line change).

- [ ] **Step 2: Type-check + jest**

```bash
cd mobile && npx tsc --noEmit && npm test -- --watchAll=false
```

Expected: tsc clean; jest 23/23.

- [ ] **Step 3: Commit**

```bash
cd .. && git add mobile/package.json mobile/package-lock.json
git commit -m "chore(mobile): add react-native-confetti-cannon, expo-haptics, expo-audio"
```

---

## Task 9: Sound assets

**Files:**
- Create: `mobile/assets/sounds/click.mp3`
- Create: `mobile/assets/sounds/chime.mp3`

These are binary assets — source from a free royalty-free site (e.g., https://freesound.org with CC0 filter) or generate with a synth.

- [ ] **Step 1: Acquire / generate two short MP3 files**

Requirements:
- `click.mp3`: ~80ms soft click. Volume normalized.
- `chime.mp3`: ~600ms positive chime (rising arpeggio). Volume normalized.

Free options:
- freesound.org (filter to CC0 license)
- Use any audio editor (Audacity, FL Studio demo) to render a 3-note arpeggio
- Or commit two ~1KB placeholder files for now and replace before tagging M6

For development: any short, family-friendly audio file works. Drop the two files into `mobile/assets/sounds/`.

- [ ] **Step 2: Verify the files exist and are <50KB each**

```bash
ls -la mobile/assets/sounds/
```

Expected: two MP3 files, each well under 100KB. If files are larger, run them through a compressor (e.g., online MP3 minifier) to keep the app bundle lean.

- [ ] **Step 3: Commit**

```bash
git add mobile/assets/sounds/click.mp3 mobile/assets/sounds/chime.mp3
git commit -m "chore(mobile): add click + chime sound assets for juicy feedback"
```

---

## Task 10: Achievements constants + catalog test

**Files:**
- Create: `mobile/src/constants/achievements.ts`
- Create: `mobile/tests/achievements-catalog.test.ts`

- [ ] **Step 1: Constants**

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

- [ ] **Step 2: Test**

```typescript
// mobile/tests/achievements-catalog.test.ts
import { ACHIEVEMENTS, ACHIEVEMENT_KEYS } from '../src/constants/achievements';

describe('achievements catalog', () => {
  it('every key in ACHIEVEMENT_KEYS has an ACHIEVEMENTS entry', () => {
    for (const key of ACHIEVEMENT_KEYS) {
      expect(ACHIEVEMENTS[key]).toBeDefined();
      expect(ACHIEVEMENTS[key].emoji).toBeTruthy();
      expect(ACHIEVEMENTS[key].title).toBeTruthy();
      expect(ACHIEVEMENTS[key].description).toBeTruthy();
    }
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
cd mobile && npx tsc --noEmit && npm test -- --watchAll=false
cd .. && git add mobile/src/constants/achievements.ts mobile/tests/achievements-catalog.test.ts
git commit -m "feat(mobile): achievements catalog constants + sanity test"
```

Expected: tsc clean; jest 23 + 1 = 24.

---

## Task 11: Event bus + test

**Files:**
- Create: `mobile/src/lib/events.ts`
- Create: `mobile/tests/events.test.ts`

- [ ] **Step 1: Test**

```typescript
// mobile/tests/events.test.ts
import { on, emit } from '../src/lib/events';

describe('event bus', () => {
  it('delivers payload to subscriber', () => {
    const handler = jest.fn();
    const unsub = on('achievement_unlocked', handler);
    emit('achievement_unlocked', { key: 'first_star', profile_id: 'p1' });
    expect(handler).toHaveBeenCalledWith({ key: 'first_star', profile_id: 'p1' });
    unsub();
  });

  it('unsubscribe removes the listener', () => {
    const handler = jest.fn();
    const unsub = on('achievement_unlocked', handler);
    unsub();
    emit('achievement_unlocked', { key: 'first_star', profile_id: 'p1' });
    expect(handler).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement**

```typescript
// mobile/src/lib/events.ts
type EventName = 'achievement_unlocked';
type Payload = { key: string; profile_id: string };

const listeners = new Map<EventName, Set<(p: Payload) => void>>();

export function on(name: EventName, fn: (p: Payload) => void): () => void {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name)!.add(fn);
  return () => { listeners.get(name)?.delete(fn); };
}

export function emit(name: EventName, payload: Payload): void {
  listeners.get(name)?.forEach((fn) => fn(payload));
}
```

- [ ] **Step 3: Run + commit**

```bash
cd mobile && npm test -- events
cd mobile && npx tsc --noEmit && npm test -- --watchAll=false
cd .. && git add mobile/src/lib/events.ts mobile/tests/events.test.ts
git commit -m "feat(mobile): tiny in-app event bus for achievement_unlocked"
```

Expected: tsc clean; jest 24 + 2 = 26.

---

## Task 12: Feedback module + tests

**Files:**
- Create: `mobile/src/lib/feedback.ts`
- Create: `mobile/tests/feedback.test.ts`

The feedback module imports from `expo-haptics` and `expo-audio`. ConfettiHost will be wired in Task 13 to expose a module-level ref. For now, the confetti fire is a no-op if the ref isn't set.

- [ ] **Step 1: Failing test**

```typescript
// mobile/tests/feedback.test.ts
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireSmallFeedback, isEnabled } from '../src/lib/feedback';

jest.mock('expo-haptics');
jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn().mockReturnValue({ play: jest.fn(), remove: jest.fn() }),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

describe('feedback', () => {
  beforeEach(() => jest.clearAllMocks());

  it('isEnabled returns true when AsyncStorage value is null (default)', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    await expect(isEnabled()).resolves.toBe(true);
  });

  it('isEnabled returns false when AsyncStorage value is "false"', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('false');
    await expect(isEnabled()).resolves.toBe(false);
  });

  it('fireSmallFeedback calls Haptics.impactAsync(Light) when enabled', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    await fireSmallFeedback();
    expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
  });

  it('fireSmallFeedback does NOT call Haptics when disabled', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('false');
    await fireSmallFeedback();
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd mobile && npm test -- feedback
```

- [ ] **Step 3: Implement**

```typescript
// mobile/src/lib/feedback.ts
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAudioPlayer } from 'expo-audio';

const STORAGE_KEY = 'feedback_enabled';

// Lazy module-level players (created on first use)
let clickPlayer: ReturnType<typeof createAudioPlayer> | null = null;
let chimePlayer: ReturnType<typeof createAudioPlayer> | null = null;

function getClickPlayer() {
  if (!clickPlayer) clickPlayer = createAudioPlayer(require('../../assets/sounds/click.mp3'));
  return clickPlayer;
}
function getChimePlayer() {
  if (!chimePlayer) chimePlayer = createAudioPlayer(require('../../assets/sounds/chime.mp3'));
  return chimePlayer;
}

export async function isEnabled(): Promise<boolean> {
  const v = await AsyncStorage.getItem(STORAGE_KEY);
  return v !== 'false'; // default true
}

export async function setEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
}

// Module-level confetti fire — set by ConfettiHost (Task 13).
let confettiFire: (() => void) | null = null;
export function setConfettiFire(fn: () => void) { confettiFire = fn; }

export async function fireSmallFeedback(): Promise<void> {
  if (!(await isEnabled())) return;
  try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
  try { getClickPlayer().play(); } catch {}
}

export async function fireBigFeedback(): Promise<void> {
  if (!(await isEnabled())) return;
  try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); } catch {}
  try { getChimePlayer().play(); } catch {}
  try { confettiFire?.(); } catch {}
}

export const fireAchievementFeedback = fireBigFeedback;
```

If `expo-audio` isn't available in your SDK 54 install and you fell back to `expo-av` in Task 8, replace the `expo-audio` import and the `createAudioPlayer` calls with the `expo-av` `Audio.Sound.createAsync` pattern. The rest of the module structure stays.

- [ ] **Step 4: Run — expect 4/4 PASS**

```bash
cd mobile && npm test -- feedback
```

- [ ] **Step 5: Full suite**

```bash
cd mobile && npx tsc --noEmit && npm test -- --watchAll=false
```

Expected: tsc clean; jest 26 + 4 = 30.

- [ ] **Step 6: Commit**

```bash
cd .. && git add mobile/src/lib/feedback.ts mobile/tests/feedback.test.ts
git commit -m "feat(mobile): feedback module with haptics, audio, and confetti dispatch"
```

---

## Task 13: ConfettiHost component

**Files:**
- Create: `mobile/src/components/ConfettiHost.tsx`

- [ ] **Step 1: Implement**

```typescript
// mobile/src/components/ConfettiHost.tsx
import { useRef, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import ConfettiCannon from 'react-native-confetti-cannon';
import { setConfettiFire } from '../lib/feedback';

export function ConfettiHost() {
  const ref = useRef<ConfettiCannon | null>(null);

  useEffect(() => {
    setConfettiFire(() => ref.current?.start());
    return () => setConfettiFire(() => {});
  }, []);

  return (
    <View style={styles.container} pointerEvents="none">
      <ConfettiCannon
        ref={(r) => { ref.current = r; }}
        count={80}
        origin={{ x: 200, y: 0 }}
        autoStart={false}
        fadeOut
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'absolute', top: 0, left: 0, right: 0, height: '100%', zIndex: 1000 },
});
```

- [ ] **Step 2: Type-check + commit**

```bash
cd mobile && npx tsc --noEmit
cd .. && git add mobile/src/components/ConfettiHost.tsx
git commit -m "feat(mobile): ConfettiHost — top-level confetti cannon driven by feedback module"
```

Expected: tsc clean.

---

## Task 14: AchievementBanner component

**Files:**
- Create: `mobile/src/components/AchievementBanner.tsx`

- [ ] **Step 1: Implement**

```typescript
// mobile/src/components/AchievementBanner.tsx
import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { on } from '../lib/events';
import { ACHIEVEMENTS, type AchievementKey } from '../constants/achievements';
import { fireAchievementFeedback } from '../lib/feedback';

type QueuedBanner = { id: number; key: AchievementKey };

const DISPLAY_MS = 4000;

export function AchievementBanner() {
  const [current, setCurrent] = useState<QueuedBanner | null>(null);
  const [queue, setQueue] = useState<QueuedBanner[]>([]);

  // Subscribe once.
  useEffect(() => {
    let counter = 0;
    const unsub = on('achievement_unlocked', (p) => {
      counter += 1;
      const entry: QueuedBanner = { id: counter, key: p.key as AchievementKey };
      setQueue((q) => [...q, entry]);
    });
    return () => unsub();
  }, []);

  // Drain the queue.
  useEffect(() => {
    if (current !== null) return;
    if (queue.length === 0) return;
    const next = queue[0];
    setQueue((q) => q.slice(1));
    setCurrent(next);
    fireAchievementFeedback();
    const t = setTimeout(() => setCurrent(null), DISPLAY_MS);
    return () => clearTimeout(t);
  }, [current, queue]);

  if (!current) return null;
  const a = ACHIEVEMENTS[current.key];
  if (!a) return null;

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <Pressable onPress={() => setCurrent(null)} style={styles.card}>
        <Text style={styles.heading}>🏅 New Achievement!</Text>
        <Text style={styles.emoji}>{a.emoji}</Text>
        <Text style={styles.title}>{a.title}</Text>
        <Text style={styles.description}>{a.description}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.45)', zIndex: 999 },
  card: { backgroundColor: '#fff', borderRadius: 20, padding: 32, alignItems: 'center', minWidth: 280, gap: 8 },
  heading: { fontSize: 14, fontWeight: '600', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1 },
  emoji: { fontSize: 64, marginVertical: 8 },
  title: { fontSize: 22, fontWeight: '700', color: '#111827' },
  description: { fontSize: 14, color: '#6b7280', textAlign: 'center' },
});
```

- [ ] **Step 2: Type-check + commit**

```bash
cd mobile && npx tsc --noEmit
cd .. && git add mobile/src/components/AchievementBanner.tsx
git commit -m "feat(mobile): AchievementBanner — full-screen overlay with queueing"
```

Expected: tsc clean.

---

## Task 15: Realtime extension — achievements INSERT listener

**Files:**
- Modify: `mobile/src/lib/realtime.ts`

- [ ] **Step 1: Add a 4th listener**

Open `mobile/src/lib/realtime.ts`. After the third `.on('postgres_changes', ...)` chain (the one for `star_ledger`), add another:

```typescript
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'achievements', filter: `family_id=eq.${familyId}` },
      (payload) => {
        const row = payload.new as { achievement_key: string; profile_id: string };
        emit('achievement_unlocked', { key: row.achievement_key, profile_id: row.profile_id });
      },
    )
```

And add the import at the top of the file:

```typescript
import { emit } from './events';
```

- [ ] **Step 2: Type-check**

```bash
cd mobile && npx tsc --noEmit
```

Expected: clean. If the `payload.new` typing complains, cast as shown.

- [ ] **Step 3: Commit**

```bash
cd .. && git add mobile/src/lib/realtime.ts
git commit -m "feat(mobile): realtime listener emits achievement_unlocked on insert"
```

---

## Task 16: Wire ConfettiHost + AchievementBanner into root layout

**Files:**
- Modify: `mobile/app/_layout.tsx`

- [ ] **Step 1: Add imports + mount the components**

The current M5 root layout returns:

```typescript
  return (
    <QueryClientProvider client={queryClient}>
      <RealtimeBridge />
      <Slot />
    </QueryClientProvider>
  );
```

Add `<ConfettiHost />` and `<AchievementBanner />` as siblings inside the provider:

```typescript
  return (
    <QueryClientProvider client={queryClient}>
      <RealtimeBridge />
      <Slot />
      <ConfettiHost />
      <AchievementBanner />
    </QueryClientProvider>
  );
```

And add imports at the top:

```typescript
import { ConfettiHost } from '../src/components/ConfettiHost';
import { AchievementBanner } from '../src/components/AchievementBanner';
```

Order matters: `<Slot />` first so confetti and banner overlay it. (Z-index is set inside each component.)

- [ ] **Step 2: Type-check + jest**

```bash
cd mobile && npx tsc --noEmit && npm test -- --watchAll=false
```

Expected: tsc clean; jest 30/30.

- [ ] **Step 3: Commit**

```bash
cd .. && git add mobile/app/_layout.tsx
git commit -m "feat(mobile): mount ConfettiHost + AchievementBanner at app root"
```

---

## Task 17: Kid home — Badges link + small/big feedback wiring

**Files:**
- Modify: `mobile/app/(app)/kid/[profileId]/index.tsx`

- [ ] **Step 1: Add the Badges link**

The current kid home header has Rewards + Switch links. Add Badges in front:

```typescript
      <View style={styles.header}>
        <Text style={styles.title}>Today's chores</Text>
        <View style={{ flexDirection: 'row', gap: 16 }}>
          <Pressable onPress={() => router.push(`/(app)/kid/${profileId}/badges` as never)}>
            <Text style={styles.switch}>Badges</Text>
          </Pressable>
          <Pressable onPress={() => router.push(`/(app)/kid/${profileId}/rewards` as never)}>
            <Text style={styles.switch}>Rewards</Text>
          </Pressable>
          <Pressable onPress={() => router.replace('/(app)')}>
            <Text style={styles.switch}>Switch</Text>
          </Pressable>
        </View>
      </View>
```

- [ ] **Step 2: Add small feedback on Done tap**

The current `onDone` function looks like:

```typescript
  function onDone(inst: Instance) {
    if (!inst.chore) return;
    if (inst.chore.verification_mode === 'photo') {
      router.push(`/(app)/kid/${profileId}/chore/${inst.id}/photo` as never);
      return;
    }
    complete.mutate({ instanceId: inst.id });
  }
```

Replace with:

```typescript
  function onDone(inst: Instance) {
    if (!inst.chore) return;
    fireSmallFeedback();
    if (inst.chore.verification_mode === 'photo') {
      router.push(`/(app)/kid/${profileId}/chore/${inst.id}/photo` as never);
      return;
    }
    complete.mutate({ instanceId: inst.id });
  }
```

Add the import: `import { fireSmallFeedback, fireBigFeedback } from '../../../../src/lib/feedback';`

- [ ] **Step 3: Add big-feedback subscription**

Inside the component body, add a `useEffect` that subscribes to chore_instance + redemption status transitions for this kid:

```typescript
  useEffect(() => {
    if (!profileId) return;
    const choreChannel = supabase
      .channel(`kid-feedback-chore-${profileId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'chore_instances',
        filter: `completed_by=eq.${profileId}`,
      }, (payload) => {
        const oldStatus = (payload.old as any)?.status;
        const newStatus = (payload.new as any)?.status;
        if (newStatus === 'approved' && oldStatus !== 'approved') fireBigFeedback();
      })
      .subscribe();
    const redChannel = supabase
      .channel(`kid-feedback-red-${profileId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'redemptions',
        filter: `kid_profile_id=eq.${profileId}`,
      }, (payload) => {
        const oldStatus = (payload.old as any)?.status;
        const newStatus = (payload.new as any)?.status;
        if (newStatus === 'fulfilled' && oldStatus !== 'fulfilled') fireBigFeedback();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(choreChannel);
      supabase.removeChannel(redChannel);
    };
  }, [profileId]);
```

Add the import for `useEffect` if not already present.

- [ ] **Step 4: Type-check + jest**

```bash
cd mobile && npx tsc --noEmit && npm test -- --watchAll=false
```

Expected: tsc clean; jest 30/30 still pass.

- [ ] **Step 5: Commit**

```bash
cd .. && git add mobile/app/\(app\)/kid/\[profileId\]/index.tsx
git commit -m "feat(mobile): kid home — Badges link + small Done feedback + big approval feedback"
```

---

## Task 18: Kid Badges screen

**Files:**
- Create: `mobile/app/(app)/kid/[profileId]/badges.tsx`

- [ ] **Step 1: Implement**

```typescript
// mobile/app/(app)/kid/[profileId]/badges.tsx
import { View, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueries } from '@tanstack/react-query';
import { supabase } from '../../../../src/lib/supabase';
import { ACHIEVEMENTS, ACHIEVEMENT_KEYS, type AchievementKey } from '../../../../src/constants/achievements';

type Unlocked = { achievement_key: string; unlocked_at: string };

export default function KidBadges() {
  const router = useRouter();
  const { profileId } = useLocalSearchParams<{ profileId: string }>();

  const [unlockedQ, balanceQ] = useQueries({
    queries: [
      {
        queryKey: ['kid-badges', profileId],
        queryFn: async (): Promise<Unlocked[]> => {
          const { data, error } = await supabase
            .from('achievements')
            .select('achievement_key, unlocked_at')
            .eq('profile_id', profileId);
          if (error) throw error;
          return (data ?? []) as Unlocked[];
        },
        enabled: !!profileId,
      },
      {
        queryKey: ['balance', profileId],
        queryFn: async (): Promise<number> => {
          const { data, error } = await supabase
            .from('star_ledger')
            .select('delta')
            .eq('profile_id', profileId);
          if (error) throw error;
          return (data ?? []).reduce((s, r) => s + (r as { delta: number }).delta, 0);
        },
        enabled: !!profileId,
      },
    ],
  });

  const balance = balanceQ.data ?? 0;
  const unlockedByKey = new Map<string, string>();
  (unlockedQ.data ?? []).forEach((u) => unlockedByKey.set(u.achievement_key, u.unlocked_at));

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Badges</Text>
        <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
          <View style={styles.pill}><Text style={styles.pillText}>⭐ {balance}</Text></View>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.switch}>Back</Text>
          </Pressable>
        </View>
      </View>

      {unlockedQ.isLoading && <ActivityIndicator />}
      {unlockedQ.error && <Text style={styles.err}>{(unlockedQ.error as Error).message}</Text>}

      <ScrollView contentContainerStyle={styles.grid}>
        {ACHIEVEMENT_KEYS.map((key: AchievementKey) => {
          const a = ACHIEVEMENTS[key];
          const unlockedAt = unlockedByKey.get(key);
          const unlocked = !!unlockedAt;
          return (
            <View key={key} style={[styles.card, !unlocked && styles.cardLocked]}>
              <Text style={[styles.emoji, !unlocked && styles.emojiLocked]}>{a.emoji}</Text>
              <Text style={[styles.cardTitle, !unlocked && styles.cardTitleLocked]}>{a.title}</Text>
              {unlocked ? (
                <Text style={styles.cardDate}>Unlocked {new Date(unlockedAt!).toLocaleDateString()}</Text>
              ) : (
                <Text style={styles.cardDesc}>{a.description}</Text>
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
  pill: { backgroundColor: '#fef3c7', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  pillText: { fontSize: 14, fontWeight: '600', color: '#92400e' },
  err: { color: '#ef4444' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 },
  card: { width: '48%', backgroundColor: '#fef3c7', borderRadius: 16, padding: 16, alignItems: 'center', gap: 4, marginBottom: 12 },
  cardLocked: { backgroundColor: '#f3f4f6', opacity: 0.55 },
  emoji: { fontSize: 48 },
  emojiLocked: { opacity: 0.5 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#92400e', textAlign: 'center' },
  cardTitleLocked: { color: '#6b7280' },
  cardDate: { fontSize: 11, color: '#6b7280' },
  cardDesc: { fontSize: 11, color: '#6b7280', textAlign: 'center', fontStyle: 'italic' },
});
```

- [ ] **Step 2: Type-check + commit**

```bash
cd mobile && npx tsc --noEmit
cd .. && git add mobile/app/\(app\)/kid/\[profileId\]/badges.tsx
git commit -m "feat(mobile): kid Badges screen — 2-column grid with locked/unlocked states"
```

Expected: tsc clean.

---

## Task 19: Settings — Sounds & haptics toggle

**Files:**
- Modify: `mobile/app/(app)/parent/settings.tsx`

- [ ] **Step 1: Add a Feedback section above the Notifications stub**

The current Settings has the family info, "Invite a co-parent" section, then stubs (Notifications + Subscription) + Switch profile + Sign out + invite modal.

Insert a new section above the Notifications stub. Need:
- Import `Switch` from react-native, `useEffect` + `useState` from react, and `isEnabled` / `setEnabled` from feedback module.
- State for the toggle, loaded from `isEnabled()` on mount.
- Persisted via `setEnabled()`.

Replace the existing component file with this updated version:

```typescript
// mobile/app/(app)/parent/settings.tsx
import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Modal, Pressable, Alert, Switch } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { supabase } from '../../../src/lib/supabase';
import { Button } from '../../../src/components/Button';
import { signOut } from '../../../src/lib/auth';
import { isEnabled, setEnabled } from '../../../src/lib/feedback';

export default function Settings() {
  const router = useRouter();
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [feedbackOn, setFeedbackOn] = useState(true);

  useEffect(() => {
    isEnabled().then(setFeedbackOn);
  }, []);

  async function onToggleFeedback(v: boolean) {
    setFeedbackOn(v);
    await setEnabled(v);
  }

  const { data, isLoading } = useQuery({
    queryKey: ['family-summary'],
    queryFn: async () => {
      const { data: fam } = await supabase.from('families').select('name').limit(1).maybeSingle();
      const { data: profs } = await supabase.from('profiles').select('id, type');
      return {
        familyName: (fam as { name: string } | null)?.name ?? 'Family',
        memberCount: profs?.length ?? 0,
      };
    },
  });

  const invite = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('create_family_invite');
      if (error) throw error;
      return data as string;
    },
    onSuccess: (c) => { setCopied(false); setCode(c); },
    onError: (e) => Alert.alert('Could not generate code', (e as Error).message),
  });

  async function onCopy() {
    if (!code) return;
    await Clipboard.setStringAsync(code);
    setCopied(true);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Settings</Text>

      {isLoading ? <ActivityIndicator /> : (
        <View style={styles.section}>
          <Text style={styles.label}>Family</Text>
          <Text style={styles.value}>{data?.familyName} · {data?.memberCount} member{data?.memberCount === 1 ? '' : 's'}</Text>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.label}>Co-parents</Text>
        <Button label="Invite a co-parent" onPress={() => invite.mutate()} loading={invite.isPending} variant="secondary" />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Feedback</Text>
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Sounds & haptics on this device</Text>
          <Switch value={feedbackOn} onValueChange={onToggleFeedback} />
        </View>
      </View>

      <View style={styles.stub}><Text style={styles.stubText}>Notifications — coming soon</Text></View>
      <View style={styles.stub}><Text style={styles.stubText}>Subscription — coming soon</Text></View>

      <Button label="Switch profile" variant="secondary" onPress={() => router.replace('/(app)')} />
      <Button label="Sign out" variant="secondary" onPress={signOut} style={{ marginTop: 8 }} />

      <Modal visible={!!code} transparent animationType="fade" onRequestClose={() => setCode(null)}>
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Co-parent invite code</Text>
            <Text style={styles.codeBig}>{code}</Text>
            <Text style={styles.modalSub}>Expires in 24 hours. Share it with your co-parent — they enter it on the join-family screen when they sign up.</Text>
            <Pressable onPress={onCopy} style={styles.copyBtn}>
              <Text style={styles.copyText}>{copied ? '✓ Copied' : 'Copy code'}</Text>
            </Pressable>
            <Pressable onPress={() => setCode(null)} style={styles.doneBtn}>
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, paddingTop: 48, backgroundColor: '#fff', gap: 12 },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 8 },
  section: { paddingVertical: 8 },
  label: { fontSize: 11, color: '#6b7280', textTransform: 'uppercase', fontWeight: '600' },
  value: { fontSize: 16, marginTop: 4 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  toggleLabel: { fontSize: 15, flex: 1 },
  stub: { padding: 12, backgroundColor: '#f3f4f6', borderRadius: 8 },
  stubText: { color: '#6b7280' },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  modalCard: { backgroundColor: '#fff', borderRadius: 16, padding: 24, width: 320, gap: 12, alignItems: 'center' },
  modalTitle: { fontSize: 17, fontWeight: '600' },
  codeBig: { fontSize: 36, fontWeight: '700', letterSpacing: 8, color: '#111827', marginVertical: 8 },
  modalSub: { fontSize: 13, color: '#6b7280', textAlign: 'center' },
  copyBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 999, backgroundColor: '#3b82f6' },
  copyText: { color: '#fff', fontWeight: '600' },
  doneBtn: { paddingVertical: 8 },
  doneText: { color: '#6b7280', fontWeight: '500' },
});
```

- [ ] **Step 2: Type-check + jest**

```bash
cd mobile && npx tsc --noEmit && npm test -- --watchAll=false
```

Expected: tsc clean; jest 30/30.

- [ ] **Step 3: Commit**

```bash
cd .. && git add mobile/app/\(app\)/parent/settings.tsx
git commit -m "feat(mobile): settings — Sounds & haptics device-local toggle"
```

---

## Task 20: Manual M6 acceptance + tag + push + memory

**Files:** none (manual + git tag + memory write)

- [ ] **Step 1: Reset DB and start everything**

```bash
# Terminal A — Supabase + Edge Function
npx supabase db reset
npx supabase functions serve send_push --no-verify-jwt

# Terminal B — Expo
cd mobile && npx expo start --android --clear
```

- [ ] **Step 2: Walk the M6 acceptance flow**

1. Sign up fresh (`m6test@example.com` / `test1234`) → onboarding → 5 seed chores auto-appear.
2. Add a kid (no PIN).
3. Trigger generator: `curl.exe -X POST http://127.0.0.1:54321/functions/v1/generate_chore_instances`.
4. Tap kid → kid home shows today's chores. Tap **Done** on one → feel a small haptic, hear a soft click.
5. Switch → parent → Approvals → tap Approve. Switch back to kid → expect **🏅 First Star** banner with confetti + chime + heavy haptic. Balance pill shows the awarded stars.
6. Continue earning until cumulative 100⭐ (approve more chores, possibly tweak `chores.star_value` in psql to speed up):
   ```sql
   update public.chores set star_value = 100 where family_id = (select id from public.families limit 1);
   ```
   Approve one chore → **🏅 Century** banner.
7. Backdate streak in psql so the next approval crosses 7 days:
   ```sql
   update public.streaks set current_count = 6, last_completion_date = current_date - 1
     where profile_id = (select id from public.profiles where type='kid' limit 1);
   ```
   Approve another chore → **🏅 Week Streak** banner.
8. Parent → Rewards → create a 1-star reward. Switch → kid → request it. Switch → parent → Approve → tap Fulfilled. Switch → kid → **🏅 First Reward** banner.
9. Tap kid home **Badges** header link → grid shows 4 unlocked (color) + 4 locked (greyscale with criteria).
10. Parent → Settings → toggle **Sounds & haptics on this device** off → next kid Done tap: no buzz, no sound. Confetti and banner still work for big events (those still need feedback module toggle — actually with toggle off, fireSmallFeedback no-ops; fireBigFeedback also no-ops because the feedback module gates both. Confetti also won't fire. Banner still APPEARS but in silence — verify this matches your understanding; if you want visual to still fire when sound is off, that's an M7 polish split).
11. (Optional, dev build only) Background app on Parent A's device → trigger an unlock on a second emulator → push notification arrives: "🏅 Sara earned Week Streak: Earn stars 7 days in a row".

- [ ] **Step 3: Tag the milestone**

```bash
git tag -a m6-gamification -m "M6: Gamification (achievements + juicy feedback) milestone complete"
git tag --list m6-gamification -n5
```

- [ ] **Step 4: Merge to main + push**

```bash
git switch main
git merge m6-gamification --ff-only
git push origin main
git push origin --tags
```

- [ ] **Step 5: Update project memory**

Write `m6_progress.md` (analogous to `m5_progress.md`) recording M6 status, any late acceptance fixes, deferrals carried into M7. Update `MEMORY.md` to link it.

---

## Spec coverage check (self-review)

| Spec section | Tasks |
|---|---|
| 1.1 achievements table + 8-badge catalog | T1, T10 |
| 1.1 check_achievements function | T2 |
| 1.1 approve_chore + fulfill_redemption integration | T3, T4 |
| 1.1 notify_push_achievement trigger | T5 |
| 1.1 send_push achievement_unlocked branch | T6 |
| 1.1 kid Badges screen + header link | T17, T18 |
| 1.1 AchievementBanner + ConfettiHost | T13, T14, T16 |
| 1.1 Realtime extension (achievements INSERT) | T15 |
| 1.1 Juicy feedback library + two-tier firing | T8, T9, T12, T17 |
| 1.1 Settings Sounds & haptics toggle | T19 |
| 2 data model | T1 |
| 3 catalog (8 badges) | T2 SQL + T10 constants |
| 4.1 check_achievements | T2 |
| 4.2 RPC integration | T3, T4 |
| 4.3 push trigger | T5 |
| 4.4 send_push extension | T6 |
| 4.5 RLS | T1 |
| 5.1 dep install | T8 |
| 5.2 feedback module | T12 |
| 5.3 ConfettiHost | T13 |
| 5.4 AchievementBanner | T14 |
| 5.5 event bus | T11 |
| 5.6 realtime extension | T15 |
| 5.7 kid home updates | T17 |
| 5.8 badges screen | T18 |
| 5.9 settings toggle | T19 |
| 6.1 pgTAP | T1, T2, T3, T4 |
| 6.2 Jest | T10, T11, T12 |
| 6.3 manual acceptance | T20 |
| 6.4 exit criteria + tag | T20 |

Every spec section reached by a task. No placeholders. Type names consistent: `check_achievements`, `notify_push_achievement`, `ACHIEVEMENT_KEYS`, `ACHIEVEMENTS`, `fireSmallFeedback`, `fireBigFeedback`, `fireAchievementFeedback`, `ConfettiHost`, `AchievementBanner`, `setConfettiFire`.

---

**End of M6 plan.**
