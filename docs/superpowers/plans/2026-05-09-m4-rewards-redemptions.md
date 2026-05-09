# M4 — Rewards & Redemptions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the rewards catalog + redemption flow per `docs/superpowers/specs/2026-05-09-m4-rewards-redemptions-design.md`.

**Architecture:** Two new Postgres tables (`rewards`, `redemptions`) plus 7 `security definer` RPCs (3 reward CRUD + 4 redemption transactions). Redemptions move `pending → approved → fulfilled` (or `pending → denied`); approve writes a negative `star_ledger` row, balance is checked at both request and approve time. Mobile: new parent Rewards tab, Approvals tab grows a "Pending fulfillment" sub-section, Activity tab merges redemption rows, kid mode gets a Rewards catalog screen.

**Tech Stack:** Supabase (Postgres + Auth + RLS), pgTAP, TypeScript, Expo SDK 54 / React Native 0.81 / Expo Router 6, TanStack Query v5, Jest + jest-expo.

---

## File structure

**New SQL migrations** (`supabase/migrations/`):
- `20260509000002_rewards_table.sql`
- `20260509000003_redemptions_table.sql`
- `20260509000004_create_reward_rpc.sql`
- `20260509000005_update_reward_rpc.sql`
- `20260509000006_archive_reward_rpc.sql`
- `20260509000007_request_redemption_rpc.sql`
- `20260509000008_approve_redemption_rpc.sql`
- `20260509000009_deny_redemption_rpc.sql`
- `20260509000010_fulfill_redemption_rpc.sql`

**New pgTAP tests** (`supabase/tests/`):
- `18_rewards_rls.sql`
- `19_redemptions_rls.sql`
- `20_create_reward_rpc.sql`
- `21_update_reward_rpc.sql`
- `22_archive_reward_rpc.sql`
- `23_request_redemption_rpc.sql`
- `24_approve_redemption_rpc.sql`
- `25_deny_redemption_rpc.sql`
- `26_fulfill_redemption_rpc.sql`

**New mobile files**:
- `mobile/src/constants/rewardIcons.ts`
- `mobile/src/components/RewardIconPicker.tsx`
- `mobile/tests/RewardIconPicker.test.tsx`
- `mobile/app/(app)/parent/rewards/index.tsx`
- `mobile/app/(app)/parent/rewards/new.tsx`
- `mobile/app/(app)/parent/rewards/[id].tsx`
- `mobile/app/(app)/kid/[profileId]/rewards.tsx`

**Modified mobile files**:
- `mobile/app/(app)/parent/_layout.tsx` — add Rewards tab
- `mobile/app/(app)/parent/approvals.tsx` — SectionList + redemption rows + Pending fulfillment
- `mobile/app/(app)/parent/activity.tsx` — merge redemption rows
- `mobile/app/(app)/kid/[profileId]/index.tsx` — Rewards header link
- `mobile/src/types/database.ts` — regenerated

---

## Task 0: Branch + verify baseline

**Files:** none (git only)

- [ ] **Step 1: Create the M4 branch off main**

```bash
git switch main
git switch -c m4-rewards-redemptions
```

- [ ] **Step 2: Verify Supabase + tests still green**

```bash
npx supabase status
npx supabase test db
cd mobile && npx tsc --noEmit && npm test -- --watchAll=false && cd ..
```

Expected: pgTAP `Files=17, Tests=71+ , Result: PASS` (M3 baseline counted 71 across 16 files; M3's late `20260509000001_chore_creates_today_instance.sql` migration didn't add a test file). tsc clean; jest 17/17 pass.

---

## Task 1: rewards table

**Files:**
- Create: `supabase/migrations/20260509000002_rewards_table.sql`
- Create: `supabase/tests/18_rewards_rls.sql`

- [ ] **Step 1: Migration**

```sql
-- supabase/migrations/20260509000002_rewards_table.sql
create table public.rewards (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete cascade,
  title       text not null check (length(title) between 1 and 80),
  description text check (description is null or length(description) <= 500),
  star_cost   int  not null check (star_cost between 1 and 9999),
  icon_id     smallint not null check (icon_id between 1 and 8),
  active      boolean not null default true,
  created_by  uuid not null references public.profiles(id),
  created_at  timestamptz not null default now()
);

create index rewards_family_active_idx on public.rewards(family_id) where active;

alter table public.rewards enable row level security;

create policy rewards_select_own_family on public.rewards
  for select using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.type = 'parent' and p.family_id = rewards.family_id)
  );

create policy rewards_insert_own_family on public.rewards
  for insert with check (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.type = 'parent' and p.family_id = rewards.family_id)
  );

create policy rewards_update_own_family on public.rewards
  for update using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.type = 'parent' and p.family_id = rewards.family_id)
  ) with check (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.type = 'parent' and p.family_id = rewards.family_id)
  );
-- No DELETE policy: archive_reward soft-deletes.
```

- [ ] **Step 2: pgTAP test**

```sql
-- supabase/tests/18_rewards_rls.sql
begin;
select plan(3);

insert into auth.users(id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.com'),
  ('22222222-2222-2222-2222-222222222222', 'b@test.com');

insert into public.families(id, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Family A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Family B');

insert into public.profiles(id, family_id, type, display_name, avatar_id, user_id) values
  ('a1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'parent', 'Alice', 1, '11111111-1111-1111-1111-111111111111'),
  ('b2222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'parent', 'Bob',   1, '22222222-2222-2222-2222-222222222222');

insert into public.rewards(family_id, title, star_cost, icon_id, created_by) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Ice Cream', 50, 2, 'a1111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Cash',     200, 4, 'b2222222-2222-2222-2222-222222222222');

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select results_eq(
  $$ select title from public.rewards order by title $$,
  $$ values ('Ice Cream'::text) $$,
  'Alice sees only Family A rewards'
);

select is_empty(
  $$ select * from public.rewards where family_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' $$,
  'Alice cannot see Family B rewards'
);

prepare hack as
  update public.rewards set title = 'HACKED'
  where family_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
select lives_ok('hack', 'UPDATE against Family B does not error (RLS just affects 0 rows)');

select * from finish();
rollback;
```

- [ ] **Step 3: Run + commit**

```bash
npx supabase db reset && npx supabase test db
git add supabase/migrations/20260509000002_rewards_table.sql supabase/tests/18_rewards_rls.sql
git commit -m "feat(db): rewards table + RLS + pgTAP isolation"
```

Expected: 74 tests across 18 files (M3's 71 + 3 new).

---

## Task 2: redemptions table

**Files:**
- Create: `supabase/migrations/20260509000003_redemptions_table.sql`
- Create: `supabase/tests/19_redemptions_rls.sql`

- [ ] **Step 1: Migration**

```sql
-- supabase/migrations/20260509000003_redemptions_table.sql
create table public.redemptions (
  id                  uuid primary key default gen_random_uuid(),
  family_id           uuid not null references public.families(id) on delete cascade,
  reward_id           uuid not null references public.rewards(id) on delete cascade,
  kid_profile_id      uuid not null references public.profiles(id) on delete cascade,
  star_cost_snapshot  int  not null,
  status              text not null default 'pending'
                       check (status in ('pending','approved','denied','fulfilled')),
  requested_at        timestamptz not null default now(),
  resolved_by         uuid references public.profiles(id),
  resolved_at         timestamptz,
  parent_note         text
);

create index redemptions_family_status_idx on public.redemptions(family_id, status);
create index redemptions_kid_recent_idx on public.redemptions(kid_profile_id, requested_at desc);

alter table public.redemptions enable row level security;

create policy redemptions_select_own_family on public.redemptions
  for select using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.type = 'parent' and p.family_id = redemptions.family_id)
  );
-- No INSERT/UPDATE/DELETE policies. All writes via SD RPCs.
```

- [ ] **Step 2: pgTAP test**

```sql
-- supabase/tests/19_redemptions_rls.sql
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
insert into public.rewards(id, family_id, title, star_cost, icon_id, created_by) values
  ('aaa11111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'A-rew', 50, 2, 'a1111111-1111-1111-1111-111111111111'),
  ('bbb11111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'B-rew', 50, 2, 'b2222222-2222-2222-2222-222222222222');
insert into public.redemptions(family_id, reward_id, kid_profile_id, star_cost_snapshot) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaa11111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222', 50),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbb11111-1111-1111-1111-111111111111', 'b9999999-9999-9999-9999-999999999999', 50);

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is(
  (select count(*)::int from public.redemptions), 1,
  'Alice sees only her family''s redemption'
);

select is_empty(
  $$ select * from public.redemptions where family_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' $$,
  'Alice cannot see Family B redemptions'
);

select * from finish();
rollback;
```

- [ ] **Step 3: Run + commit**

```bash
npx supabase db reset && npx supabase test db
git add supabase/migrations/20260509000003_redemptions_table.sql supabase/tests/19_redemptions_rls.sql
git commit -m "feat(db): redemptions table + select-only RLS"
```

Expected: 76 tests across 19 files.

---

## Task 3: create_reward RPC

**Files:**
- Create: `supabase/migrations/20260509000004_create_reward_rpc.sql`
- Create: `supabase/tests/20_create_reward_rpc.sql`

- [ ] **Step 1: Migration**

```sql
-- supabase/migrations/20260509000004_create_reward_rpc.sql
create or replace function public.create_reward(
  family_id   uuid,
  title       text,
  description text,
  star_cost   int,
  icon_id     smallint
) returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  caller_profile uuid;
  new_id uuid;
begin
  select id into caller_profile
  from public.profiles
  where user_id = auth.uid() and type = 'parent' and profiles.family_id = create_reward.family_id;
  if caller_profile is null then
    raise exception 'caller is not a parent in family %', family_id;
  end if;

  insert into public.rewards(family_id, title, description, star_cost, icon_id, created_by)
  values (create_reward.family_id, create_reward.title, create_reward.description,
          create_reward.star_cost, create_reward.icon_id, caller_profile)
  returning id into new_id;

  return new_id;
end;
$$;
```

- [ ] **Step 2: pgTAP test**

```sql
-- supabase/tests/20_create_reward_rpc.sql
begin;
select plan(3);

insert into auth.users(id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.com');
insert into public.families(id, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Family A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Family B');
insert into public.profiles(id, family_id, type, display_name, avatar_id, user_id) values
  ('a1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'parent', 'Alice', 1, '11111111-1111-1111-1111-111111111111');

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select isnt(
  public.create_reward('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Ice Cream', null, 50, 2::smallint),
  null,
  'create_reward returns id on happy path'
);

prepare cross_family as select public.create_reward(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Stolen', null, 50, 2::smallint);
select throws_ok('cross_family', null, null, 'cannot create reward in another family');

prepare bad_icon as select public.create_reward(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Bad Icon', null, 50, 99::smallint);
select throws_ok('bad_icon', null, null, 'icon_id check rejects 99');

select * from finish();
rollback;
```

- [ ] **Step 3: Run + commit**

```bash
npx supabase db reset && npx supabase test db
git add supabase/migrations/20260509000004_create_reward_rpc.sql supabase/tests/20_create_reward_rpc.sql
git commit -m "feat(db): create_reward RPC with family + icon validation"
```

Expected: 79 tests across 20 files.

---

## Task 4: update_reward RPC

**Files:**
- Create: `supabase/migrations/20260509000005_update_reward_rpc.sql`
- Create: `supabase/tests/21_update_reward_rpc.sql`

- [ ] **Step 1: Migration**

```sql
-- supabase/migrations/20260509000005_update_reward_rpc.sql
create or replace function public.update_reward(
  reward_id   uuid,
  title       text default null,
  description text default null,
  star_cost   int  default null,
  icon_id     smallint default null
) returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  caller_family uuid;
  target_family uuid;
begin
  select profiles.family_id into caller_family
  from public.profiles where user_id = auth.uid() and type = 'parent';
  if caller_family is null then raise exception 'caller is not a parent'; end if;

  select r.family_id into target_family from public.rewards r where r.id = reward_id;
  if target_family is null or target_family <> caller_family then
    raise exception 'reward % not in caller family', reward_id;
  end if;

  update public.rewards set
    title       = coalesce(update_reward.title, rewards.title),
    description = coalesce(update_reward.description, rewards.description),
    star_cost   = coalesce(update_reward.star_cost, rewards.star_cost),
    icon_id     = coalesce(update_reward.icon_id, rewards.icon_id)
  where id = reward_id;
end;
$$;
```

- [ ] **Step 2: pgTAP test**

```sql
-- supabase/tests/21_update_reward_rpc.sql
begin;
select plan(4);

insert into auth.users(id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.com'),
  ('22222222-2222-2222-2222-222222222222', 'b@test.com');
insert into public.families(id, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Family A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Family B');
insert into public.profiles(id, family_id, type, display_name, avatar_id, user_id) values
  ('a1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'parent', 'Alice', 1, '11111111-1111-1111-1111-111111111111'),
  ('b2222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'parent', 'Bob',   1, '22222222-2222-2222-2222-222222222222');
insert into public.rewards(id, family_id, title, star_cost, icon_id, created_by) values
  ('aaa11111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Ice Cream', 50, 2, 'a1111111-1111-1111-1111-111111111111');

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select lives_ok(
  $$ select public.update_reward('aaa11111-1111-1111-1111-111111111111', title := 'Big Ice Cream') $$,
  'patch title'
);
select is((select title from public.rewards where id = 'aaa11111-1111-1111-1111-111111111111'), 'Big Ice Cream', 'title was updated');

select lives_ok(
  $$ select public.update_reward('aaa11111-1111-1111-1111-111111111111', star_cost := 75) $$,
  'patch star_cost'
);

set local "request.jwt.claims" to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
prepare cross_update as select public.update_reward('aaa11111-1111-1111-1111-111111111111', title := 'HACKED');
select throws_ok('cross_update', null, null, 'Bob cannot update Family A reward');

select * from finish();
rollback;
```

- [ ] **Step 3: Run + commit**

```bash
npx supabase db reset && npx supabase test db
git add supabase/migrations/20260509000005_update_reward_rpc.sql supabase/tests/21_update_reward_rpc.sql
git commit -m "feat(db): update_reward RPC with optional patch fields"
```

Expected: 83 tests across 21 files.

---

## Task 5: archive_reward RPC

**Files:**
- Create: `supabase/migrations/20260509000006_archive_reward_rpc.sql`
- Create: `supabase/tests/22_archive_reward_rpc.sql`

- [ ] **Step 1: Migration**

```sql
-- supabase/migrations/20260509000006_archive_reward_rpc.sql
create or replace function public.archive_reward(reward_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare caller_family uuid; target_family uuid;
begin
  select profiles.family_id into caller_family
  from public.profiles where user_id = auth.uid() and type = 'parent';
  if caller_family is null then raise exception 'caller is not a parent'; end if;

  select r.family_id into target_family from public.rewards r where r.id = archive_reward.reward_id;
  if target_family is null or target_family <> caller_family then
    raise exception 'reward % not in caller family', reward_id;
  end if;

  update public.rewards set active = false where id = archive_reward.reward_id;
end;
$$;
```

- [ ] **Step 2: pgTAP test**

```sql
-- supabase/tests/22_archive_reward_rpc.sql
begin;
select plan(2);

insert into auth.users(id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.com');
insert into public.families(id, name) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Family A');
insert into public.profiles(id, family_id, type, display_name, avatar_id, user_id) values
  ('a1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'parent', 'Alice', 1, '11111111-1111-1111-1111-111111111111');
insert into public.rewards(id, family_id, title, star_cost, icon_id, created_by) values
  ('aaa11111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'X', 50, 2, 'a1111111-1111-1111-1111-111111111111');

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select lives_ok(
  $$ select public.archive_reward('aaa11111-1111-1111-1111-111111111111') $$,
  'archive_reward succeeds for parent of family'
);
select is((select active from public.rewards where id = 'aaa11111-1111-1111-1111-111111111111'), false, 'active is false');

select * from finish();
rollback;
```

- [ ] **Step 3: Run + commit**

```bash
npx supabase db reset && npx supabase test db
git add supabase/migrations/20260509000006_archive_reward_rpc.sql supabase/tests/22_archive_reward_rpc.sql
git commit -m "feat(db): archive_reward RPC (soft delete)"
```

Expected: 85 tests across 22 files.

---

## Task 6: request_redemption RPC

**Files:**
- Create: `supabase/migrations/20260509000007_request_redemption_rpc.sql`
- Create: `supabase/tests/23_request_redemption_rpc.sql`

- [ ] **Step 1: Migration**

```sql
-- supabase/migrations/20260509000007_request_redemption_rpc.sql
create or replace function public.request_redemption(reward_id uuid, kid_profile_id uuid)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  caller_family uuid;
  rew           public.rewards%rowtype;
  kid_family    uuid;
  kid_type      text;
  balance       int;
  new_id        uuid;
begin
  -- caller must be a parent
  select profiles.family_id into caller_family
  from public.profiles where user_id = auth.uid() and type = 'parent';
  if caller_family is null then raise exception 'caller is not a parent'; end if;

  -- kid must be a kid in same family
  select profiles.family_id, profiles.type into kid_family, kid_type
  from public.profiles where id = kid_profile_id;
  if kid_family is null or kid_family <> caller_family or kid_type <> 'kid' then
    raise exception 'kid_profile_id % not a kid in family', kid_profile_id;
  end if;

  -- reward must exist, be active, and be in same family
  select * into rew from public.rewards where id = reward_id for update;
  if rew.id is null or rew.family_id <> caller_family or not rew.active then
    raise exception 'reward % not available', reward_id;
  end if;

  -- balance check
  select coalesce(sum(delta), 0)::int into balance
  from public.star_ledger where profile_id = kid_profile_id;
  if balance < rew.star_cost then
    raise exception 'insufficient stars (balance=%, cost=%)', balance, rew.star_cost;
  end if;

  insert into public.redemptions(family_id, reward_id, kid_profile_id, star_cost_snapshot)
  values (caller_family, reward_id, kid_profile_id, rew.star_cost)
  returning id into new_id;

  return new_id;
end;
$$;
```

- [ ] **Step 2: pgTAP test**

```sql
-- supabase/tests/23_request_redemption_rpc.sql
begin;
select plan(6);

insert into auth.users(id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.com');
insert into public.families(id, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Family A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Family B');
insert into public.profiles(id, family_id, type, display_name, avatar_id, user_id) values
  ('a1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'parent', 'Alice', 1, '11111111-1111-1111-1111-111111111111'),
  ('a2222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'kid',    'Sara',  2, null),
  ('b9999999-9999-9999-9999-999999999999', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'kid',    'Otto',  3, null);
insert into public.rewards(id, family_id, title, star_cost, icon_id, active, created_by) values
  ('aaa11111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Ice Cream', 50, 2, true,  'a1111111-1111-1111-1111-111111111111'),
  ('aaa22222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Archived',  10, 2, false, 'a1111111-1111-1111-1111-111111111111');

-- give Sara a starting balance of 60 stars
insert into public.star_ledger(family_id, profile_id, delta, reason) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a2222222-2222-2222-2222-222222222222', 60, 'manual_grant');

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- 1. Happy path returns id.
select isnt(
  public.request_redemption('aaa11111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222'),
  null,
  'request_redemption returns id on happy path'
);

-- 2. Snapshot captured at request time (50, even if reward.star_cost changes later — see Task 4).
select is(
  (select star_cost_snapshot from public.redemptions where kid_profile_id = 'a2222222-2222-2222-2222-222222222222' limit 1),
  50, 'star_cost_snapshot captured'
);

-- 3. Insufficient balance raises (Sara has 60, request needs 200 from a higher-cost reward).
insert into public.rewards(id, family_id, title, star_cost, icon_id, created_by) values
  ('aaa33333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Cash', 200, 4, 'a1111111-1111-1111-1111-111111111111');
prepare too_expensive as select public.request_redemption(
  'aaa33333-3333-3333-3333-333333333333', 'a2222222-2222-2222-2222-222222222222');
select throws_ok('too_expensive', null, null, 'insufficient balance raises');

-- 4. Archived reward raises.
prepare archived as select public.request_redemption(
  'aaa22222-2222-2222-2222-222222222222', 'a2222222-2222-2222-2222-222222222222');
select throws_ok('archived', null, null, 'archived reward raises');

-- 5. Cross-family kid raises (Otto is in Family B).
prepare cross_kid as select public.request_redemption(
  'aaa11111-1111-1111-1111-111111111111', 'b9999999-9999-9999-9999-999999999999');
select throws_ok('cross_kid', null, null, 'kid not in family raises');

-- 6. Balance computation includes negative ledger entries.
insert into public.star_ledger(family_id, profile_id, delta, reason) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a2222222-2222-2222-2222-222222222222', -50, 'redemption');
-- Sara now has 60 - 50 - 50 (first redemption) = -40 (impossible without approve, but we test the math).
-- Actually the first request didn't deduct. So she's at 60 - 50 = 10 (manual + the test row above).
-- Now request a 50-cost reward: should raise.
prepare now_too_expensive as select public.request_redemption(
  'aaa11111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222');
select throws_ok('now_too_expensive', null, null, 'balance includes prior negative deltas');

select * from finish();
rollback;
```

- [ ] **Step 3: Run + commit**

```bash
npx supabase db reset && npx supabase test db
git add supabase/migrations/20260509000007_request_redemption_rpc.sql supabase/tests/23_request_redemption_rpc.sql
git commit -m "feat(db): request_redemption RPC with snapshot + balance check"
```

Expected: 91 tests across 23 files.

---

## Task 7: approve_redemption RPC

**Files:**
- Create: `supabase/migrations/20260509000008_approve_redemption_rpc.sql`
- Create: `supabase/tests/24_approve_redemption_rpc.sql`

- [ ] **Step 1: Migration**

```sql
-- supabase/migrations/20260509000008_approve_redemption_rpc.sql
create or replace function public.approve_redemption(redemption_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  caller_profile uuid;
  caller_family  uuid;
  red            public.redemptions%rowtype;
  balance        int;
begin
  select id, profiles.family_id into caller_profile, caller_family
  from public.profiles where user_id = auth.uid() and type = 'parent';
  if caller_profile is null then raise exception 'caller is not a parent'; end if;

  select * into red from public.redemptions where id = redemption_id for update;
  if red.id is null then raise exception 'redemption % not found', redemption_id; end if;
  if red.family_id <> caller_family then raise exception 'redemption % not in caller family', redemption_id; end if;
  if red.status = 'approved' then return; end if;
  if red.status <> 'pending' then raise exception 'redemption % is not pending (status=%)', redemption_id, red.status; end if;

  -- Defense-in-depth: re-check balance against current ledger.
  select coalesce(sum(delta), 0)::int into balance
  from public.star_ledger where profile_id = red.kid_profile_id;
  if balance < red.star_cost_snapshot then
    raise exception 'insufficient stars at approve time (balance=%, cost=%)', balance, red.star_cost_snapshot;
  end if;

  update public.redemptions
    set status='approved', resolved_by=caller_profile, resolved_at=now()
    where id = redemption_id;

  insert into public.star_ledger(family_id, profile_id, delta, reason, source_id)
  values (red.family_id, red.kid_profile_id, -red.star_cost_snapshot, 'redemption', redemption_id);
end;
$$;
```

- [ ] **Step 2: pgTAP test**

```sql
-- supabase/tests/24_approve_redemption_rpc.sql
begin;
select plan(8);

insert into auth.users(id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.com');
insert into public.families(id, name) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Family A');
insert into public.profiles(id, family_id, type, display_name, avatar_id, user_id) values
  ('a1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'parent', 'Alice', 1, '11111111-1111-1111-1111-111111111111'),
  ('a2222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'kid',    'Sara',  2, null);
insert into public.rewards(id, family_id, title, star_cost, icon_id, created_by) values
  ('aaa11111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Ice Cream', 50, 2, 'a1111111-1111-1111-1111-111111111111');
-- Sara has 60 stars.
insert into public.star_ledger(family_id, profile_id, delta, reason) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a2222222-2222-2222-2222-222222222222', 60, 'manual_grant');
-- Two pending redemptions: 50 each (total 100, exceeds balance).
insert into public.redemptions(id, family_id, reward_id, kid_profile_id, star_cost_snapshot) values
  ('red11111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaa11111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222', 50),
  ('red22222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaa11111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222', 50);

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- 1-4. First approve happy path.
select lives_ok(
  $$ select public.approve_redemption('red11111-1111-1111-1111-111111111111') $$,
  'first approve succeeds'
);
select is(
  (select status from public.redemptions where id = 'red11111-1111-1111-1111-111111111111'),
  'approved', 'status approved'
);
select isnt(
  (select resolved_at from public.redemptions where id = 'red11111-1111-1111-1111-111111111111'),
  null, 'resolved_at is set'
);
select is(
  (select count(*)::int from public.star_ledger
    where source_id = 'red11111-1111-1111-1111-111111111111' and reason = 'redemption' and delta = -50),
  1, 'one negative ledger row inserted'
);

-- 5. Idempotent re-call.
select lives_ok(
  $$ select public.approve_redemption('red11111-1111-1111-1111-111111111111') $$,
  'idempotent re-call'
);
select is(
  (select count(*)::int from public.star_ledger where source_id = 'red11111-1111-1111-1111-111111111111'),
  1, 'still one ledger row'
);

-- 6. Defense-in-depth: second pending redemption now exceeds remaining balance (60 - 50 = 10 < 50).
prepare second_approve as select public.approve_redemption('red22222-2222-2222-2222-222222222222');
select throws_ok('second_approve', null, null, 'insufficient stars at approve time raises');

-- 7. Unchanged status on second.
select is(
  (select status from public.redemptions where id = 'red22222-2222-2222-2222-222222222222'),
  'pending', 'second redemption still pending'
);

select * from finish();
rollback;
```

- [ ] **Step 3: Run + commit**

```bash
npx supabase db reset && npx supabase test db
git add supabase/migrations/20260509000008_approve_redemption_rpc.sql supabase/tests/24_approve_redemption_rpc.sql
git commit -m "feat(db): approve_redemption RPC atomic with defense-in-depth balance check"
```

Expected: 99 tests across 24 files.

---

## Task 8: deny_redemption RPC

**Files:**
- Create: `supabase/migrations/20260509000009_deny_redemption_rpc.sql`
- Create: `supabase/tests/25_deny_redemption_rpc.sql`

- [ ] **Step 1: Migration**

```sql
-- supabase/migrations/20260509000009_deny_redemption_rpc.sql
create or replace function public.deny_redemption(redemption_id uuid, parent_note text default '')
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
  if red.status = 'denied' then return; end if;
  if red.status <> 'pending' then raise exception 'redemption % is not pending (status=%)', redemption_id, red.status; end if;

  update public.redemptions
    set status='denied', resolved_by=caller_profile, resolved_at=now(),
        parent_note=coalesce(parent_note, '')
    where id = redemption_id;
end;
$$;
```

- [ ] **Step 2: pgTAP test**

```sql
-- supabase/tests/25_deny_redemption_rpc.sql
begin;
select plan(5);

insert into auth.users(id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.com');
insert into public.families(id, name) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Family A');
insert into public.profiles(id, family_id, type, display_name, avatar_id, user_id) values
  ('a1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'parent', 'Alice', 1, '11111111-1111-1111-1111-111111111111'),
  ('a2222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'kid',    'Sara',  2, null);
insert into public.rewards(id, family_id, title, star_cost, icon_id, created_by) values
  ('aaa11111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Ice Cream', 50, 2, 'a1111111-1111-1111-1111-111111111111');
insert into public.redemptions(id, family_id, reward_id, kid_profile_id, star_cost_snapshot) values
  ('red11111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaa11111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222', 50),
  ('red22222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaa11111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222', 50);

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- 1-3. Deny with reason.
select lives_ok(
  $$ select public.deny_redemption('red11111-1111-1111-1111-111111111111', 'not before homework') $$,
  'deny with reason succeeds'
);
select is((select status from public.redemptions where id = 'red11111-1111-1111-1111-111111111111'), 'denied', 'status denied');
select is((select parent_note from public.redemptions where id = 'red11111-1111-1111-1111-111111111111'), 'not before homework', 'reason recorded');

-- 4-5. Deny without reason.
select lives_ok(
  $$ select public.deny_redemption('red22222-2222-2222-2222-222222222222') $$,
  'deny without reason succeeds'
);
select is((select parent_note from public.redemptions where id = 'red22222-2222-2222-2222-222222222222'), '', 'empty reason recorded');

select * from finish();
rollback;
```

- [ ] **Step 3: Run + commit**

```bash
npx supabase db reset && npx supabase test db
git add supabase/migrations/20260509000009_deny_redemption_rpc.sql supabase/tests/25_deny_redemption_rpc.sql
git commit -m "feat(db): deny_redemption RPC with optional parent note"
```

Expected: 104 tests across 25 files.

---

## Task 9: fulfill_redemption RPC

**Files:**
- Create: `supabase/migrations/20260509000010_fulfill_redemption_rpc.sql`
- Create: `supabase/tests/26_fulfill_redemption_rpc.sql`

- [ ] **Step 1: Migration**

```sql
-- supabase/migrations/20260509000010_fulfill_redemption_rpc.sql
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
end;
$$;
```

- [ ] **Step 2: pgTAP test**

```sql
-- supabase/tests/26_fulfill_redemption_rpc.sql
begin;
select plan(4);

insert into auth.users(id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.com');
insert into public.families(id, name) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Family A');
insert into public.profiles(id, family_id, type, display_name, avatar_id, user_id) values
  ('a1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'parent', 'Alice', 1, '11111111-1111-1111-1111-111111111111'),
  ('a2222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'kid',    'Sara',  2, null);
insert into public.rewards(id, family_id, title, star_cost, icon_id, created_by) values
  ('aaa11111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Ice Cream', 50, 2, 'a1111111-1111-1111-1111-111111111111');
-- One approved redemption ready to fulfill, one still pending.
insert into public.redemptions(id, family_id, reward_id, kid_profile_id, star_cost_snapshot, status, resolved_by, resolved_at) values
  ('red11111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaa11111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222', 50, 'approved', 'a1111111-1111-1111-1111-111111111111', now()),
  ('red22222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaa11111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222', 50, 'pending', null, null);

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- 1-2. Happy path.
select lives_ok(
  $$ select public.fulfill_redemption('red11111-1111-1111-1111-111111111111') $$,
  'fulfill_redemption succeeds on approved'
);
select is(
  (select status from public.redemptions where id = 'red11111-1111-1111-1111-111111111111'),
  'fulfilled', 'status fulfilled'
);

-- 3. Idempotency.
select lives_ok(
  $$ select public.fulfill_redemption('red11111-1111-1111-1111-111111111111') $$,
  'idempotent re-call'
);

-- 4. Cannot fulfill a pending redemption.
prepare fulfill_pending as select public.fulfill_redemption('red22222-2222-2222-2222-222222222222');
select throws_ok('fulfill_pending', null, null, 'fulfill on pending raises');

select * from finish();
rollback;
```

- [ ] **Step 3: Run + commit**

```bash
npx supabase db reset && npx supabase test db
git add supabase/migrations/20260509000010_fulfill_redemption_rpc.sql supabase/tests/26_fulfill_redemption_rpc.sql
git commit -m "feat(db): fulfill_redemption RPC (approved -> fulfilled bookkeeping)"
```

Expected: 108 tests across 26 files.

---

## Task 10: Regenerate database types

**Files:**
- Modify: `mobile/src/types/database.ts`

- [ ] **Step 1: Regenerate, filtering CLI noise**

```bash
npx supabase gen types typescript --local 2>/dev/null \
  | grep -v '^Connecting to' \
  | grep -v '<claude-code-hint' \
  > mobile/src/types/database.ts
```

- [ ] **Step 2: Type-check mobile**

```bash
cd mobile && npx tsc --noEmit
```

Expected: clean. The new types should include `rewards`, `redemptions`, `create_reward`, `update_reward`, `archive_reward`, `request_redemption`, `approve_redemption`, `deny_redemption`, `fulfill_redemption`.

- [ ] **Step 3: Commit**

```bash
cd .. && git add mobile/src/types/database.ts
git commit -m "chore(types): regenerate database types after M4 schema migrations"
```

---

## Task 11: rewardIcons constants + RewardIconPicker component

**Files:**
- Create: `mobile/src/constants/rewardIcons.ts`
- Create: `mobile/src/components/RewardIconPicker.tsx`
- Create: `mobile/tests/RewardIconPicker.test.tsx`

- [ ] **Step 1: Constants**

```typescript
// mobile/src/constants/rewardIcons.ts
export type RewardIconId = 1|2|3|4|5|6|7|8;

export const REWARD_ICONS: Record<RewardIconId, { emoji: string; label: string }> = {
  1: { emoji: '🎁',  label: 'Gift' },
  2: { emoji: '🍦',  label: 'Treat' },
  3: { emoji: '🎮',  label: 'Game' },
  4: { emoji: '💵',  label: 'Cash' },
  5: { emoji: '⏰',  label: 'Time' },
  6: { emoji: '🍪',  label: 'Snack' },
  7: { emoji: '🎬',  label: 'Movie' },
  8: { emoji: '🧸',  label: 'Toy' },
};

export const REWARD_ICON_IDS: RewardIconId[] = [1, 2, 3, 4, 5, 6, 7, 8];
```

- [ ] **Step 2: Failing test**

```typescript
// mobile/tests/RewardIconPicker.test.tsx
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { RewardIconPicker } from '../src/components/RewardIconPicker';

describe('RewardIconPicker', () => {
  it('renders all 8 icons', () => {
    const { getByText } = render(<RewardIconPicker value={1} onChange={() => {}} />);
    expect(getByText('🎁')).toBeTruthy();
    expect(getByText('🍦')).toBeTruthy();
    expect(getByText('🎮')).toBeTruthy();
    expect(getByText('💵')).toBeTruthy();
    expect(getByText('⏰')).toBeTruthy();
    expect(getByText('🍪')).toBeTruthy();
    expect(getByText('🎬')).toBeTruthy();
    expect(getByText('🧸')).toBeTruthy();
  });

  it('calls onChange with the icon id when tapped', () => {
    const onChange = jest.fn();
    const { getByText } = render(<RewardIconPicker value={1} onChange={onChange} />);
    fireEvent.press(getByText('🎮'));
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it('marks the selected icon', () => {
    const { getByTestId } = render(<RewardIconPicker value={4} onChange={() => {}} />);
    expect(getByTestId('reward-icon-4').props.accessibilityState).toMatchObject({ selected: true });
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

```bash
cd mobile && npm test -- RewardIconPicker
```

- [ ] **Step 4: Implement**

```typescript
// mobile/src/components/RewardIconPicker.tsx
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { REWARD_ICONS, REWARD_ICON_IDS, type RewardIconId } from '../constants/rewardIcons';

type Props = {
  value: RewardIconId;
  onChange: (id: RewardIconId) => void;
};

export function RewardIconPicker({ value, onChange }: Props) {
  return (
    <View>
      <Text style={styles.label}>Icon</Text>
      <View style={styles.row}>
        {REWARD_ICON_IDS.map((id) => {
          const sel = id === value;
          const { emoji, label } = REWARD_ICONS[id];
          return (
            <Pressable
              key={id}
              testID={`reward-icon-${id}`}
              accessibilityState={{ selected: sel }}
              onPress={() => onChange(id)}
              style={[styles.chip, sel && styles.chipSel]}
            >
              <Text style={styles.emoji}>{emoji}</Text>
              <Text style={[styles.chipLabel, sel && styles.chipLabelSel]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: '#d1d5db', alignItems: 'center', minWidth: 64 },
  chipSel: { backgroundColor: '#3b82f6', borderColor: '#3b82f6' },
  emoji: { fontSize: 24 },
  chipLabel: { fontSize: 11, color: '#374151', marginTop: 2 },
  chipLabelSel: { color: '#fff' },
});
```

- [ ] **Step 5: Run — expect 3/3 PASS**

```bash
cd mobile && npm test -- RewardIconPicker
```

- [ ] **Step 6: Commit**

```bash
cd .. && git add mobile/src/constants/rewardIcons.ts mobile/src/components/RewardIconPicker.tsx mobile/tests/RewardIconPicker.test.tsx
git commit -m "feat(mobile): RewardIconPicker component + 8-icon constants"
```

---

## Task 12: Add Rewards tab to parent layout + create list screen

**Files:**
- Modify: `mobile/app/(app)/parent/_layout.tsx`
- Create: `mobile/app/(app)/parent/rewards/index.tsx`

- [ ] **Step 1: Update parent layout**

```typescript
// mobile/app/(app)/parent/_layout.tsx
import { Tabs } from 'expo-router';

export default function ParentLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index"     options={{ title: 'Chores' }} />
      <Tabs.Screen name="rewards"   options={{ title: 'Rewards' }} />
      <Tabs.Screen name="approvals" options={{ title: 'Approvals' }} />
      <Tabs.Screen name="activity"  options={{ title: 'Activity' }} />
      <Tabs.Screen name="settings"  options={{ title: 'Settings' }} />
    </Tabs>
  );
}
```

- [ ] **Step 2: Implement rewards list**

```typescript
// mobile/app/(app)/parent/rewards/index.tsx
import { View, Text, Pressable, StyleSheet, ActivityIndicator, FlatList, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../../src/lib/supabase';
import { REWARD_ICONS, type RewardIconId } from '../../../../src/constants/rewardIcons';

type Reward = {
  id: string;
  title: string;
  star_cost: number;
  icon_id: number;
  description: string | null;
};

export default function RewardsList() {
  const router = useRouter();
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['parent-rewards'],
    queryFn: async (): Promise<Reward[]> => {
      const { data, error } = await supabase
        .from('rewards')
        .select('id, title, star_cost, icon_id, description')
        .eq('active', true)
        .order('created_at');
      if (error) throw error;
      return (data ?? []) as Reward[];
    },
  });

  const archive = useMutation({
    mutationFn: async (rewardId: string) => {
      const { error } = await supabase.rpc('archive_reward', { reward_id: rewardId });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['parent-rewards'] }),
  });

  function confirmArchive(r: Reward) {
    Alert.alert('Archive reward?', r.title, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Archive', style: 'destructive', onPress: () => archive.mutate(r.id) },
    ]);
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Rewards</Text>
        <Pressable onPress={() => router.push('/(app)/parent/rewards/new' as never)} style={styles.fab}>
          <Text style={styles.fabText}>+</Text>
        </Pressable>
      </View>

      {isLoading && <ActivityIndicator />}
      {error && <Text style={styles.err}>{(error as Error).message}</Text>}
      {data && data.length === 0 && (
        <Text style={styles.empty}>No rewards yet — tap + to add one.</Text>
      )}

      <FlatList
        data={data ?? []}
        keyExtractor={(r) => r.id}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/(app)/parent/rewards/${item.id}` as never)}
            onLongPress={() => confirmArchive(item)}
            style={styles.row}
          >
            <Text style={styles.emoji}>{REWARD_ICONS[item.icon_id as RewardIconId]?.emoji ?? '🎁'}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.rewardTitle}>{item.title}</Text>
              {item.description && <Text style={styles.desc}>{item.description}</Text>}
            </View>
            <Text style={styles.cost}>⭐ {item.star_cost}</Text>
          </Pressable>
        )}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, paddingTop: 48, backgroundColor: '#fff' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 24, fontWeight: '700' },
  fab: { backgroundColor: '#3b82f6', width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  fabText: { color: '#fff', fontSize: 26, fontWeight: '700', lineHeight: 28 },
  err: { color: '#ef4444' },
  empty: { textAlign: 'center', color: '#6b7280', marginTop: 64 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, gap: 12 },
  emoji: { fontSize: 28 },
  rewardTitle: { fontSize: 17, fontWeight: '600' },
  desc: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  cost: { fontSize: 15, fontWeight: '500' },
  sep: { height: 1, backgroundColor: '#e5e7eb' },
});
```

- [ ] **Step 3: Type-check + jest**

```bash
cd mobile && npx tsc --noEmit && npm test -- --watchAll=false
```

Expected: tsc clean. Jest 17 + 3 = 20.

- [ ] **Step 4: Commit**

```bash
cd .. && git add mobile/app/\(app\)/parent/_layout.tsx mobile/app/\(app\)/parent/rewards/index.tsx
git commit -m "feat(mobile): parent Rewards tab list + FAB + archive on long-press"
```

---

## Task 13: Create-reward form

**Files:**
- Create: `mobile/app/(app)/parent/rewards/new.tsx`

- [ ] **Step 1: Implement**

```typescript
// mobile/app/(app)/parent/rewards/new.tsx
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
```

- [ ] **Step 2: Type-check + commit**

```bash
cd mobile && npx tsc --noEmit
cd .. && git add mobile/app/\(app\)/parent/rewards/new.tsx
git commit -m "feat(mobile): create-reward form"
```

---

## Task 14: Edit-reward form

**Files:**
- Create: `mobile/app/(app)/parent/rewards/[id].tsx`

- [ ] **Step 1: Implement**

```typescript
// mobile/app/(app)/parent/rewards/[id].tsx
import { useState, useEffect } from 'react';
import { ScrollView, Text, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../../src/lib/supabase';
import { Button } from '../../../../src/components/Button';
import { TextField } from '../../../../src/components/TextField';
import { RewardIconPicker } from '../../../../src/components/RewardIconPicker';
import type { RewardIconId } from '../../../../src/constants/rewardIcons';

export default function EditReward() {
  const router = useRouter();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [cost, setCost] = useState('50');
  const [iconId, setIconId] = useState<RewardIconId>(1);

  const { data: reward, isLoading } = useQuery({
    queryKey: ['reward', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rewards')
        .select('id, title, description, star_cost, icon_id')
        .eq('id', id).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  useEffect(() => {
    if (!reward) return;
    setTitle(reward.title);
    setDescription(reward.description ?? '');
    setCost(String(reward.star_cost));
    setIconId(reward.icon_id as RewardIconId);
  }, [reward]);

  const update = useMutation({
    mutationFn: async () => {
      const sc = parseInt(cost, 10);
      if (!Number.isFinite(sc) || sc < 1 || sc > 9999) throw new Error('star cost must be 1–9999');
      const { error } = await supabase.rpc('update_reward', {
        reward_id: id,
        title: title.trim(),
        description: (description.trim() || null) as unknown as string,
        star_cost: sc,
        icon_id: iconId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['parent-rewards'] });
      qc.invalidateQueries({ queryKey: ['reward', id] });
      router.back();
    },
    onError: (e) => Alert.alert('Could not update reward', (e as Error).message),
  });

  const archive = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('archive_reward', { reward_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['parent-rewards'] });
      router.back();
    },
  });

  if (isLoading || !reward) return <ActivityIndicator style={{ marginTop: 64 }} />;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Edit reward</Text>
      <TextField label="Title" value={title} onChangeText={setTitle} />
      <TextField label="Description (optional)" value={description} onChangeText={setDescription} />
      <TextField label="Star cost" value={cost} onChangeText={setCost} keyboardType="number-pad" />
      <RewardIconPicker value={iconId} onChange={setIconId} />
      <Button label="Save changes" loading={update.isPending} onPress={() => update.mutate()} />
      <Button label="Archive" variant="secondary" onPress={() => archive.mutate()} style={{ marginTop: 8 }} />
      <Button label="Cancel" variant="secondary" onPress={() => router.back()} style={{ marginTop: 8 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, paddingTop: 64, gap: 12 },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 8 },
});
```

- [ ] **Step 2: Type-check + commit**

```bash
cd mobile && npx tsc --noEmit
cd .. && git add mobile/app/\(app\)/parent/rewards/\[id\].tsx
git commit -m "feat(mobile): edit-reward form with archive"
```

---

## Task 15: Approvals tab — SectionList with redemptions + Pending fulfillment

**Files:**
- Modify: `mobile/app/(app)/parent/approvals.tsx`

- [ ] **Step 1: Replace the file**

```typescript
// mobile/app/(app)/parent/approvals.tsx
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
    onError: (e) => alert((e as Error).message),
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
    { title: 'Decisions needed', data: decisions },
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
        sections={sections as { title: string; data: DecisionRow[] }[]}
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
          const a = item.kid ? AVATARS[item.kid.avatar_id as AvatarId] : null;
          const icon = item.reward ? REWARD_ICONS[item.reward.icon_id as RewardIconId]?.emoji : '🎁';
          return (
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.line}>
                  {a?.emoji ?? '👤'} {item.kid?.display_name} · {icon} {item.reward?.title}
                </Text>
                <Text style={styles.sub}>approved {timeAgo(item.resolved_at ?? new Date().toISOString())}</Text>
              </View>
              <Pressable onPress={() => fulfillRedemption.mutate(item.id)} style={[styles.btn, styles.btnApprove]}>
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
```

- [ ] **Step 2: Type-check + commit**

```bash
cd mobile && npx tsc --noEmit && npm test -- --watchAll=false
cd .. && git add mobile/app/\(app\)/parent/approvals.tsx
git commit -m "feat(mobile): Approvals tab grows redemption rows + Pending fulfillment section"
```

Expected: tsc clean; jest 20/20.

---

## Task 16: Activity tab — merge redemption rows

**Files:**
- Modify: `mobile/app/(app)/parent/activity.tsx`

- [ ] **Step 1: Replace the file**

```typescript
// mobile/app/(app)/parent/activity.tsx
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
```

- [ ] **Step 2: Type-check + commit**

```bash
cd mobile && npx tsc --noEmit
cd .. && git add mobile/app/\(app\)/parent/activity.tsx
git commit -m "feat(mobile): Activity tab merges chore + redemption rows"
```

---

## Task 17: Kid home Rewards link + kid Rewards screen

**Files:**
- Modify: `mobile/app/(app)/kid/[profileId]/index.tsx` — add "Rewards" header link
- Create: `mobile/app/(app)/kid/[profileId]/rewards.tsx`

- [ ] **Step 1: Update kid home to add Rewards link in the header**

The change is small — replace the header row only. Existing file body stays. Replace this block:

```typescript
      <View style={styles.header}>
        <Text style={styles.title}>Today's chores</Text>
        <Pressable onPress={() => router.replace('/(app)')}>
          <Text style={styles.switch}>Switch</Text>
        </Pressable>
      </View>
```

with:

```typescript
      <View style={styles.header}>
        <Text style={styles.title}>Today's chores</Text>
        <View style={{ flexDirection: 'row', gap: 16 }}>
          <Pressable onPress={() => router.push(`/(app)/kid/${profileId}/rewards` as never)}>
            <Text style={styles.switch}>Rewards</Text>
          </Pressable>
          <Pressable onPress={() => router.replace('/(app)')}>
            <Text style={styles.switch}>Switch</Text>
          </Pressable>
        </View>
      </View>
```

- [ ] **Step 2: Create the kid Rewards screen**

```typescript
// mobile/app/(app)/kid/[profileId]/rewards.tsx
import { View, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../../src/lib/supabase';
import { REWARD_ICONS, type RewardIconId } from '../../../../src/constants/rewardIcons';

type Reward = {
  id: string;
  title: string;
  description: string | null;
  star_cost: number;
  icon_id: number;
};

type OpenRedemption = {
  reward_id: string;
  status: 'pending' | 'approved';
};

export default function KidRewards() {
  const router = useRouter();
  const qc = useQueryClient();
  const { profileId } = useLocalSearchParams<{ profileId: string }>();

  const [rewards, openRed, balanceQ] = useQueries({
    queries: [
      {
        queryKey: ['kid-rewards', profileId],
        queryFn: async (): Promise<Reward[]> => {
          const { data, error } = await supabase
            .from('rewards')
            .select('id, title, description, star_cost, icon_id')
            .eq('active', true)
            .order('created_at');
          if (error) throw error;
          return (data ?? []) as Reward[];
        },
        enabled: !!profileId,
      },
      {
        queryKey: ['kid-open-redemptions', profileId],
        queryFn: async (): Promise<OpenRedemption[]> => {
          const { data, error } = await supabase
            .from('redemptions')
            .select('reward_id, status')
            .eq('kid_profile_id', profileId)
            .in('status', ['pending', 'approved']);
          if (error) throw error;
          return (data ?? []) as OpenRedemption[];
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
          return (data ?? []).reduce((sum, r) => sum + (r as { delta: number }).delta, 0);
        },
        enabled: !!profileId,
      },
    ],
  });

  const balance = balanceQ.data ?? 0;
  const openByReward = new Map<string, OpenRedemption['status']>();
  (openRed.data ?? []).forEach((r) => openByReward.set(r.reward_id, r.status));

  const requestMut = useMutation({
    mutationFn: async (vars: { rewardId: string }) => {
      const { error } = await supabase.rpc('request_redemption', {
        reward_id: vars.rewardId,
        kid_profile_id: profileId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kid-rewards', profileId] });
      qc.invalidateQueries({ queryKey: ['kid-open-redemptions', profileId] });
    },
    onError: (e) => Alert.alert('Could not request', (e as Error).message),
  });

  function onRequest(r: Reward) {
    Alert.alert(
      `Spend ⭐${r.star_cost} on ${r.title}?`,
      null,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Spend', onPress: () => requestMut.mutate({ rewardId: r.id }) },
      ],
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Rewards</Text>
        <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
          <View style={styles.pill}><Text style={styles.pillText}>⭐ {balance}</Text></View>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.switch}>Back</Text>
          </Pressable>
        </View>
      </View>

      {(rewards.isLoading || openRed.isLoading) && <ActivityIndicator />}
      {rewards.error && <Text style={styles.err}>{(rewards.error as Error).message}</Text>}
      {rewards.data && rewards.data.length === 0 && (
        <Text style={styles.empty}>No rewards yet.</Text>
      )}

      <ScrollView contentContainerStyle={{ gap: 12 }}>
        {(rewards.data ?? []).map((r) => {
          const openStatus = openByReward.get(r.id);
          const affordable = balance >= r.star_cost;
          const emoji = REWARD_ICONS[r.icon_id as RewardIconId]?.emoji ?? '🎁';

          let label: string | null = null;
          let buttonNode: React.ReactNode = null;
          let cardStyle = [styles.card];

          if (openStatus === 'pending') {
            label = '✋ Requested';
            cardStyle = [styles.card, styles.cardWaiting];
          } else if (openStatus === 'approved') {
            label = '🎁 Coming soon';
            cardStyle = [styles.card, styles.cardWaiting];
          } else if (!affordable) {
            label = `🔒 Need ${r.star_cost - balance} more ⭐`;
            cardStyle = [styles.card, styles.cardLocked];
          } else {
            buttonNode = (
              <Pressable onPress={() => onRequest(r)} style={styles.requestBtn}>
                <Text style={styles.requestText}>Request</Text>
              </Pressable>
            );
          }

          return (
            <View key={r.id} style={cardStyle}>
              <Text style={styles.emoji}>{emoji}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.rewardTitle}>{r.title}</Text>
                <Text style={styles.cost}>⭐ {r.star_cost}</Text>
                {label && <Text style={styles.statusLabel}>{label}</Text>}
              </View>
              {buttonNode}
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
  empty: { textAlign: 'center', color: '#6b7280', marginTop: 64 },
  card: { backgroundColor: '#f9fafb', borderRadius: 12, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardWaiting: { opacity: 0.55 },
  cardLocked: { backgroundColor: '#f3f4f6', opacity: 0.7 },
  emoji: { fontSize: 36 },
  rewardTitle: { fontSize: 18, fontWeight: '600' },
  cost: { fontSize: 14, color: '#6b7280', marginTop: 2 },
  statusLabel: { fontSize: 12, color: '#6b7280', marginTop: 4, fontStyle: 'italic' },
  requestBtn: { backgroundColor: '#10b981', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 999 },
  requestText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
```

- [ ] **Step 3: Type-check + commit**

```bash
cd mobile && npx tsc --noEmit && npm test -- --watchAll=false
cd .. && git add mobile/app/\(app\)/kid/\[profileId\]/index.tsx mobile/app/\(app\)/kid/\[profileId\]/rewards.tsx
git commit -m "feat(mobile): kid rewards catalog screen + Rewards header link on home"
```

Expected: tsc clean; jest 20/20.

---

## Task 18: Manual M4 acceptance + tag

**Files:** none (manual run + git tag + memory)

- [ ] **Step 1: Reset DB and start mobile dev server**

```bash
npx supabase db reset
cd mobile && npx expo start --android --clear
```

- [ ] **Step 2: Run the M4 acceptance script**

In the emulator:
1. Sign up fresh (`m4test@example.com` / `test1234`).
2. Onboarding → 5 seed chores auto-appear.
3. Add 1 kid, no PIN.
4. Switch to kid → tap Done on three chores (any verification modes).
5. Switch to parent → Approvals tab → approve all three chores → kid balance = 30⭐, streak `🔥 1`.
6. Parent → Rewards tab → `+` → create three rewards:
   - Ice Cream — 20⭐ — 🍦 (icon 2)
   - Screen Time — 30⭐ — 🎮 (icon 3)
   - $5 Cash — 200⭐ — 💵 (icon 4)
7. Switch → kid → tap "Rewards" header link → catalog shows: Ice Cream tappable; Screen Time tappable (exact match); $5 Cash locked with "🔒 Need 170 more ⭐".
8. Tap Ice Cream → confirm "Spend ⭐20 on Ice Cream?" → Spend → catalog flips Ice Cream card to "✋ Requested".
9. Switch → parent → Approvals tab → top section "Decisions needed" shows the redemption → tap Approve → kid's balance pill drops to 10⭐ on next pull → row moves to "Pending fulfillment" section.
10. Tap Fulfilled → row gone from Approvals → Activity tab shows "🎁 Sara · Ice Cream · fulfilled <time>".
11. Switch → kid → tap Screen Time → confirm → switch to parent → deny with note "not before homework".
12. Switch → kid → catalog: Screen Time card returns to Request-able state (denied = fresh).
13. Switch → parent → Activity tab → row "✗ Sara · Screen Time · denied — 'not before homework'".
14. Verify CI green; pgTAP, tsc, jest all green locally.

- [ ] **Step 3: Tag the milestone**

```bash
git tag -a m4-rewards-redemptions -m "M4: Rewards + Redemptions milestone complete"
git tag --list m4-rewards-redemptions -n5
```

- [ ] **Step 4: Merge to main + push**

```bash
git switch main
git merge m4-rewards-redemptions --ff-only
git push origin main
git push origin --tags
```

- [ ] **Step 5: Update project memory**

Add `m4_progress.md` to the memory directory (analogous to `m3_progress.md`) recording M4 status, any late acceptance fixes, deferrals carried into M5. Update `MEMORY.md` to link it.

---

## Spec coverage check (self-review)

| Spec section | Tasks |
|---|---|
| 1.1 rewards table | T1 |
| 1.1 redemptions table | T2 |
| 1.1 reward CRUD RPCs | T3, T4, T5 |
| 1.1 redemption RPCs | T6, T7, T8, T9 |
| 1.1 8-icon set | T11 |
| 1.1 parent Rewards tab | T12, T13, T14 |
| 1.1 Approvals tab updates | T15 |
| 1.1 Activity tab updates | T16 |
| 1.1 kid Rewards screen | T17 |
| 1.2 deferrals | enforced by absence of M5 features |
| 2 data model | T1, T2 |
| 3.1 reward CRUD semantics | T3, T4, T5 |
| 3.2 request_redemption | T6 |
| 3.3 approve_redemption + defense-in-depth | T7 |
| 3.4 deny_redemption | T8 |
| 3.5 fulfill_redemption | T9 |
| 3.6 RLS | T1, T2 |
| 3.7 validation paths | T3-T9 (each test file covers its raise paths) |
| 4.1 parent tabs | T12 |
| 4.2 Rewards tab list + forms | T12, T13, T14 |
| 4.3 RewardIconPicker | T11 |
| 4.4 Approvals tab updates | T15 |
| 4.5 Activity tab updates | T16 |
| 4.6 kid mode additions | T17 |
| 5.1 pgTAP coverage | T1-T9 |
| 5.2 Jest RewardIconPicker | T11 |
| 5.3 manual acceptance | T18 |
| 5.4 exit criteria + tag | T18 |

Every spec section has a task. No placeholders. Type names consistent across tasks (`create_reward`, `update_reward`, `archive_reward`, `request_redemption`, `approve_redemption`, `deny_redemption`, `fulfill_redemption`, `RewardIconPicker`, `REWARD_ICONS`, `RewardIconId`).

---

**End of M4 plan.**
