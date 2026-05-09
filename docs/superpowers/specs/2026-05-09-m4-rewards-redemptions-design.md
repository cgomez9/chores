# M4 — Rewards & Redemptions — Design Spec

**Date:** 2026-05-09
**Status:** Approved (pending user review of this written doc)
**Predecessor:** `docs/superpowers/specs/2026-05-08-m3-approvals-ledger-design.md`, `docs/superpowers/specs/2026-05-05-shores-design.md`
**Successor milestone:** M5 — Realtime, Push, Co-parent Invite, Gamification Polish (TBD scope)

---

## 1. Scope and milestone boundary

### 1.1 In scope

- **`rewards` table** — parent-defined catalog of redeemable items (title, ⭐ cost, icon_id, active flag, family-scoped).
- **`redemptions` table** — per-request transaction log moving through `pending → approved → fulfilled` (or `pending → denied`).
- **Three reward CRUD RPCs**: `create_reward`, `update_reward`, `archive_reward` — same pattern as M2 chore CRUD.
- **Four redemption transaction RPCs**, all `security definer`, all atomic:
  - `request_redemption(reward_id, kid_profile_id)` — kid-side; validates current balance, inserts pending row with `star_cost_snapshot`.
  - `approve_redemption(redemption_id)` — parent-side; re-validates balance, deducts via negative `star_ledger` row, sets `status='approved'`.
  - `deny_redemption(redemption_id, parent_note text default '')` — parent-side; sets `status='denied'`, no ledger change.
  - `fulfill_redemption(redemption_id)` — parent-side; sets `status='fulfilled'`, no ledger (already deducted at approve).
- **8-icon reward set** at `mobile/src/constants/rewardIcons.ts` (🎁 🍦 🎮 💵 ⏰ 🍪 🎬 🧸).
- **New parent Rewards tab** — list + FAB + edit form, parallel to Chores tab.
- **Updated parent Approvals tab** — top section "Decisions needed" mixes pending chore submissions and pending redemption requests; new bottom section "Pending fulfillment" lists approved-but-not-fulfilled redemptions with a Fulfilled button.
- **Updated parent Activity tab** — adds fulfilled and denied redemption rows alongside the existing approved/rejected chore rows; queries the two tables in parallel and merges client-side.
- **New kid Rewards screen** — `kid/[profileId]/rewards.tsx`. Reached via a "Rewards" header link on kid home (kid mode stays a Stack — no kid tab bar in M4). Catalog of cards with per-reward state (affordable/pending/approved/locked).

### 1.2 Out of scope (deferred)

- **M5**: Supabase Realtime (instant approval/denial feedback to kid), push notifications (Expo Push + APNs/FCM), co-parent invite (deferred since M1), achievements catalog, leaderboard, family co-op goals, juicy feedback (confetti / sounds / haptics).
- **Cloud-prep slot before M8 ship**: real Supabase cloud project, email verification, Sentry, account-deletion (App Store requirement), and the four M2 dev-infra carry-overs (cron idempotency, RPC type quirks, gen-types stdout pollution, FK alias verification) plus the three M1 known issues (pin_hash typing, parent-mutation RLS hole, create_family race).
- **Free-form redemption requests** ("I want a unicorn") — explicitly out per overall spec §1.3.

### 1.3 Exit criteria

A solo parent + solo kid can:
1. Parent creates three rewards spanning the affordability range (Ice Cream 20⭐, Screen Time 30⭐, $5 Cash 200⭐).
2. Kid earns 30⭐ from M3 chore approvals.
3. Kid opens Rewards screen — Ice Cream and Screen Time are tappable; $5 Cash is locked with "Need 170 more ⭐".
4. Kid requests Ice Cream — confirmation alert, card flips to "✋ Requested".
5. Parent Approves in the Approvals tab → kid balance drops to 10⭐ → row moves to "Pending fulfillment".
6. Parent gives kid the ice cream IRL, taps Fulfilled → row moves to Activity as "🎁 Sara · Ice Cream · fulfilled <time>".
7. Kid requests Screen Time — parent Denies with note "not before homework" → Activity shows the denial with note → kid Rewards card returns to "Request" state (denied = fresh; can re-request).

After acceptance, tag `m4-rewards-redemptions`.

---

## 2. Data model

### 2.1 New tables

```text
rewards
  id          uuid pk default gen_random_uuid()
  family_id   uuid not null fk → families on delete cascade
  title       text not null check (length(title) between 1 and 80)
  description text check (description is null or length(description) <= 500)
  star_cost   int  not null check (star_cost between 1 and 9999)
  icon_id     smallint not null check (icon_id between 1 and 8)
  active      boolean not null default true
  created_by  uuid not null fk → profiles
  created_at  timestamptz not null default now()

  index (family_id) where active

redemptions
  id                  uuid pk default gen_random_uuid()
  family_id           uuid not null fk → families on delete cascade
  reward_id           uuid not null fk → rewards on delete cascade
  kid_profile_id      uuid not null fk → profiles on delete cascade
  star_cost_snapshot  int  not null
  status              text not null default 'pending'
                       check (status in ('pending','approved','denied','fulfilled'))
  requested_at        timestamptz not null default now()
  resolved_by         uuid fk → profiles
  resolved_at         timestamptz
  parent_note         text

  index (family_id, status)
  index (kid_profile_id, requested_at desc)
```

### 2.2 No changes to existing tables

`star_ledger` already accepts `reason='redemption'` (M3 added the check constraint with that value). `approve_redemption` inserts negative-delta ledger rows under that reason with `source_id = redemption.id`.

### 2.3 Schema design choices

- **`icon_id smallint`** parallels M1's `avatar_id` pattern — small surface, fast comparisons, easy to extend by adding constants and bumping the check upper bound.
- **`star_cost_snapshot`** is the cost the kid saw and agreed to. If a parent edits the reward's `star_cost` later, in-flight pending redemptions still settle at the original price.
- **`resolved_by` / `resolved_at`** capture the **approve/deny decision moment**. They are set by `approve_redemption` and `deny_redemption`, **not** by `fulfill_redemption` — fulfillment is a downstream physical event with no decision attached to it.
- **No `fulfilled_at` column.** `status='fulfilled'` plus the activity feed's row order is sufficient for v1. Additive migration if needed later.
- **Soft delete** via `active=false` on rewards. Existing pending redemptions for an archived reward continue to settle normally.
- **`parent_note`** is the denial reason field. Reused as an optional approval note if we ever want one (we don't in M4).

### 2.4 8-icon reward set (`mobile/src/constants/rewardIcons.ts`)

```typescript
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
```

### 2.5 Migration order

1. `rewards` table + RLS
2. `redemptions` table + RLS
3. `create_reward` RPC
4. `update_reward` RPC
5. `archive_reward` RPC
6. `request_redemption` RPC
7. `approve_redemption` RPC
8. `deny_redemption` RPC
9. `fulfill_redemption` RPC

---

## 3. Server-side logic

### 3.1 Reward CRUD (`security definer`, parent-only)

- `create_reward(family_id, title, description, star_cost, icon_id) → uuid` — caller must be a parent in `family_id`; insert and return new id. The icon_id check on the column already enforces 1..8.
- `update_reward(reward_id, title?, description?, star_cost?, icon_id?) → void` — partial patch via COALESCE; family-scoped.
- `archive_reward(reward_id) → void` — sets `active=false`. In-flight pending redemptions are unaffected.

### 3.2 `request_redemption(reward_id uuid, kid_profile_id uuid) → uuid`

```text
1. Resolve caller's parent family. Raise if caller is not a parent.
2. Verify kid_profile_id is type='kid' and in caller's family. Raise otherwise.
3. SELECT reward FOR UPDATE — must exist, be active, and be in caller's family.
4. balance := COALESCE(SUM(delta), 0) FROM star_ledger WHERE profile_id = kid_profile_id.
5. If balance < reward.star_cost → raise 'insufficient stars'.
6. INSERT INTO redemptions(family_id, reward_id, kid_profile_id, star_cost_snapshot)
   VALUES (caller_family, reward_id, kid_profile_id, reward.star_cost)
   RETURNING id.
7. Return new redemption id.
```

The balance check at request time prevents the obvious "kid can't afford this" UX failure. The check is non-locking against the ledger (just a SUM) — a concurrent approve that drops the balance won't block the request from being inserted, but the approve-time recheck (§3.3) catches it.

### 3.3 `approve_redemption(redemption_id uuid) → void`

```text
1. Resolve caller's parent family.
2. SELECT redemption FOR UPDATE.
3. Idempotent: status='approved' → return.
4. status must be 'pending' otherwise raise.
5. balance := COALESCE(SUM(delta), 0) FROM star_ledger WHERE profile_id = kid_profile_id.
6. If balance < star_cost_snapshot → raise 'insufficient stars at approve time'.
7. UPDATE redemptions SET status='approved', resolved_by=caller_profile, resolved_at=now()
   WHERE id = redemption_id.
8. INSERT INTO star_ledger(family_id, profile_id, delta, reason, source_id)
   VALUES (family_id, kid_profile_id, -star_cost_snapshot, 'redemption', redemption_id).
```

The defense-in-depth balance recheck (step 5–6) handles the case where two pending redemptions exceed the balance: first approve succeeds, second raises. The `FOR UPDATE` lock on the redemption row is paired with the SUM read — concurrent approvals on different redemptions for the same kid serialize cleanly because each takes the row-level lock first, then reads the ledger.

### 3.4 `deny_redemption(redemption_id uuid, parent_note text default '') → void`

```text
1. Resolve caller's parent family.
2. SELECT redemption FOR UPDATE.
3. Idempotent: status='denied' → return.
4. status must be 'pending' otherwise raise.
5. UPDATE redemptions SET status='denied', resolved_by=caller_profile,
                          resolved_at=now(), parent_note=COALESCE(parent_note, '')
   WHERE id = redemption_id.
```

No ledger change. Parent_note empty means "denied with no explanation" — UI suppresses the dash-and-quote in display.

### 3.5 `fulfill_redemption(redemption_id uuid) → void`

```text
1. Resolve caller's parent family.
2. SELECT redemption FOR UPDATE.
3. Idempotent: status='fulfilled' → return.
4. status must be 'approved' (raise on 'pending', 'denied', or anything else).
5. UPDATE redemptions SET status='fulfilled' WHERE id = redemption_id.
```

No ledger change (deducted at approve), no `resolved_*` change (decision was already made). `status='fulfilled'` is the bookkeeping marker.

### 3.6 RLS

```sql
-- rewards
alter table public.rewards enable row level security;
create policy rewards_select_own_family on public.rewards
  for select using (exists (select 1 from public.profiles p
    where p.user_id = auth.uid() and p.type = 'parent' and p.family_id = rewards.family_id));
create policy rewards_insert_own_family on public.rewards
  for insert with check (exists (select 1 from public.profiles p
    where p.user_id = auth.uid() and p.type = 'parent' and p.family_id = rewards.family_id));
create policy rewards_update_own_family on public.rewards
  for update using (exists (select 1 from public.profiles p
    where p.user_id = auth.uid() and p.type = 'parent' and p.family_id = rewards.family_id))
    with check (exists (select 1 from public.profiles p
    where p.user_id = auth.uid() and p.type = 'parent' and p.family_id = rewards.family_id));
-- No DELETE policy: archive_reward soft-deletes.

-- redemptions
alter table public.redemptions enable row level security;
create policy redemptions_select_own_family on public.redemptions
  for select using (exists (select 1 from public.profiles p
    where p.user_id = auth.uid() and p.type = 'parent' and p.family_id = redemptions.family_id));
-- No INSERT/UPDATE/DELETE policies. All writes via SD RPCs.
```

Same pattern as M3's `star_ledger` and `streaks`.

### 3.7 Validation paths that raise

| RPC | Condition | Error message |
|---|---|---|
| all | caller has no parent profile | `caller is not a parent` |
| reward CRUD | reward not in caller's family | `reward % not in caller family` |
| redemption | redemption not in caller's family | `redemption % not in caller family` |
| `request_redemption` | kid_profile_id not a kid in family | `kid_profile_id % not a kid in family` |
| `request_redemption` | reward inactive or wrong family | `reward % not available` |
| `request_redemption` | balance < cost | `insufficient stars` |
| `approve_redemption` | not pending | `redemption % is not pending` |
| `approve_redemption` | balance < cost (re-check) | `insufficient stars at approve time` |
| `deny_redemption` | not pending | `redemption % is not pending` |
| `fulfill_redemption` | not approved | `redemption % is not approved` |

Idempotent re-calls on the matching terminal status (already approved / denied / fulfilled) silently no-op.

### 3.8 Why RPC not Edge Function

Same reasoning as M3: all four redemption operations are pure DB. M5's push hooks will fire from Postgres triggers calling a `send_push` Edge Function — the redemption RPCs themselves stay in PL/pgSQL.

---

## 4. Mobile UI

### 4.1 Parent mode tabs

Goes from 4 to 5 tabs: `Chores | Rewards | Approvals | Activity | Settings`. Layout:

```typescript
<Tabs screenOptions={{ headerShown: false }}>
  <Tabs.Screen name="index"     options={{ title: 'Chores' }} />
  <Tabs.Screen name="rewards"   options={{ title: 'Rewards' }} />
  <Tabs.Screen name="approvals" options={{ title: 'Approvals' }} />
  <Tabs.Screen name="activity"  options={{ title: 'Activity' }} />
  <Tabs.Screen name="settings"  options={{ title: 'Settings' }} />
</Tabs>
```

5 tabs is at the practical max for mobile. Refactor into a `Manage` parent (chores + rewards under one entry) is M5 polish if the row gets too dense.

### 4.2 Parent Rewards tab — `parent/rewards/index.tsx`

Mirrors the Chores tab. Folder structure:

```
parent/rewards/
  index.tsx       → list with FAB; tap row → edit form
  new.tsx         → create form
  [id].tsx        → edit form
```

- **List rows:** icon emoji + title + ⭐ cost. Ordered by `created_at`.
- **Create / edit form:** Title, Description (optional), Star cost (numeric input, validated 1..9999), Icon picker (`<RewardIconPicker>` — row of 8 emoji chips, single-select). Save → `create_reward` / `update_reward`. Edit form adds an Archive button.
- **Long-press to archive** — confirm Alert, `archive_reward` RPC, optimistic invalidation of `['parent-rewards']`.
- **Empty state:** "No rewards yet — tap + to add one."

### 4.3 New `RewardIconPicker` component

`mobile/src/components/RewardIconPicker.tsx` — props `{ value: RewardIconId; onChange: (id: RewardIconId) => void }`. Renders the 8 icons as a wrapping row of chips, each `<Pressable>` showing emoji + label. Selected chip has a solid background. Mirrors `AvatarPicker` from M1.

### 4.4 Parent Approvals tab — `parent/approvals.tsx` (modified)

Restructure as a `<SectionList>` with two sections:

**Section 1 — "Decisions needed":** pending chore submissions *and* pending redemptions, sorted ascending by `completed_at`/`requested_at` (oldest first). Two parallel queries via `useQueries`, merged client-side.
- **Chore row:** existing M3 layout, Approve/Reject buttons unchanged.
- **Redemption row:** kid emoji + name · 🎁 reward title · ⭐ cost · "submitted <time>". Approve / Deny buttons. Approve hits `approve_redemption`; Deny opens the existing `RejectModal` component (the modal's signature `onConfirm(reason: string)` is generic enough — same component used for both `reject_chore` and `deny_redemption`).

**Section 2 — "Pending fulfillment":** `redemptions WHERE status='approved'`, sorted descending by `resolved_at` (newest at top).
- **Row:** kid emoji + name · 🎁 reward title · "approved <time> ago". Single button: **Fulfilled**. Tap → `fulfill_redemption` RPC.

**Cache invalidations (mutations):**
- Chore approve/reject: M3 invalidations (no change).
- Redemption approve / deny: `['approvals']`, `['activity']`, `['balance', kidId]`, `['kid-rewards', kidId]`.
- Redemption fulfill: `['approvals']` (bottom section), `['activity']`. Balance is unaffected.

### 4.5 Parent Activity tab — `parent/activity.tsx` (modified)

Now surfaces four kinds of rows: approved/rejected chores (existing M3) plus fulfilled/denied redemptions (new). Two parallel queries via `useQueries`:

```typescript
const chores = useQuery({ queryKey: ['activity-chores'], queryFn: ..., });
const redemptions = useQuery({ queryKey: ['activity-redemptions'], queryFn: ..., });
const merged = useMemo(() => {
  if (!chores.data || !redemptions.data) return undefined;
  return [...chores.data, ...redemptions.data]
    .sort((a, b) => new Date(b.eventAt).getTime() - new Date(a.eventAt).getTime())
    .slice(0, 100);
}, [chores.data, redemptions.data]);
```

Each row exposes a synthetic `eventAt` = `approved_at` (chore) or `resolved_at` (redemption). Each query caps at 50 rows server-side; merge caps at 100 client-side.

Row formats:
- Approved chore (auto): `✓ <kid> · <chore> · <time>`
- Approved chore (photo, submitted): `📸 <kid> · <chore> · <time>` + tap-to-view-photo
- Rejected chore: `✗ <kid> · <chore> · <time> — "<reason>"`
- Fulfilled redemption: `🎁 <kid> · <reward> · fulfilled <time>`
- Denied redemption: `✗ <kid> · <reward> · denied <time> — "<parent_note>"` (note omitted when empty)

### 4.6 Kid mode additions

Kid mode stays a Stack. Kid home gets a "Rewards" header link alongside Switch.

**New screen** `mobile/app/(app)/kid/[profileId]/rewards.tsx`:
- **Header:** title "Rewards", balance pill `⭐ <n>`, Back link → `router.back()`.
- **Body:** list of cards, one per active reward in family. Each card: icon emoji + title + ⭐ cost.
- **Per-reward state** (computed from two queries: `rewards` active in family + `redemptions` for this kid where `status IN ('pending','approved')`):

| State | Card style | Action |
|---|---|---|
| Affordable + no open redemption | bright | Request button |
| Pending request from this kid for this reward | dimmed | "✋ Requested" label, no button |
| Approved request for this reward (not yet fulfilled) | dimmed | "🎁 Coming soon" label, no button |
| Unaffordable | greyed | "🔒 Need <gap> more ⭐", no button |

**Request flow:** tap Request → native `Alert.alert("Spend X⭐ on <title>?", null, [Cancel, { text: 'Spend', onPress: () => mutate() }])` → `request_redemption` RPC → on success, invalidate `['kid-rewards', profileId]` and `['balance', profileId]` → card flips to "✋ Requested" on next render.

Denied / fulfilled redemptions are treated as fresh — the card returns to its affordable state and the kid can request again. There is no rate-limit or cooldown in M4.

### 4.7 Files touched

| File | Status |
|---|---|
| `mobile/src/constants/rewardIcons.ts` | New |
| `mobile/src/components/RewardIconPicker.tsx` | New |
| `mobile/tests/RewardIconPicker.test.tsx` | New |
| `mobile/app/(app)/parent/_layout.tsx` | Modified |
| `mobile/app/(app)/parent/rewards/index.tsx` | New |
| `mobile/app/(app)/parent/rewards/new.tsx` | New |
| `mobile/app/(app)/parent/rewards/[id].tsx` | New |
| `mobile/app/(app)/parent/approvals.tsx` | Modified |
| `mobile/app/(app)/parent/activity.tsx` | Modified |
| `mobile/app/(app)/kid/[profileId]/index.tsx` | Modified (header link) |
| `mobile/app/(app)/kid/[profileId]/rewards.tsx` | New |
| `mobile/src/types/database.ts` | Regenerated |

---

## 5. Testing strategy

### 5.1 pgTAP

- **Reward CRUD** (3 test files mirroring M2):
  - `create_reward` — happy path, cross-family, invalid icon_id (column check fires), title length boundaries.
  - `update_reward` — patch title, patch star_cost, cross-family.
  - `archive_reward` — flips active to false; in-flight pending redemption still settles correctly.
- **Redemption transactions** (4 test files):
  - `request_redemption` — happy path returns id; insufficient balance raises; archived reward raises; kid not in family raises; cross-family raises; balance computation accounts for prior negative ledger rows; `star_cost_snapshot` is captured (edit reward.star_cost after request, snapshot unchanged).
  - `approve_redemption` — happy path: status flip, `resolved_*` set, ledger row with negative delta and `reason='redemption'`. Idempotency on already-approved (no extra ledger row). **Defense-in-depth:** seed two pending redemptions whose total exceeds balance; first approve succeeds, second raises `'insufficient stars at approve time'`.
  - `deny_redemption` — happy path; idempotency; `parent_note` recorded; empty default works; cross-family.
  - `fulfill_redemption` — happy path: `'approved' → 'fulfilled'`. Idempotency. Raises when status='pending'.
- **RLS isolation** — User A from Family 1 cannot SELECT Family 2's `rewards` or `redemptions`.

Approximate net-new test count: ~25 across 9 new test files (one per RPC + 2 RLS files for the two new tables).

### 5.2 Jest

- `RewardIconPicker` — 3 tests: renders all 8 icons, selecting calls onChange with correct id, shows selected state.

Total Jest grows from M3's 17 to ~20.

### 5.3 Manual M4 acceptance

1. Fresh sign-up + onboarding (5 seed chores auto-appear thanks to M3's `ensure_today_instance`).
2. Add 1 kid (no PIN).
3. Kid completes three chores; parent approves all → kid balance 30⭐, streak `🔥 1`.
4. Parent → Rewards tab → create three: Ice Cream (20⭐, 🍦), Screen Time (30⭐, 🎮), $5 Cash (200⭐, 💵).
5. Switch → kid → Rewards header link → catalog: Ice Cream + Screen Time tappable; $5 Cash locked with "Need 170 more ⭐".
6. Tap Ice Cream → confirm → catalog flips Ice Cream card to "✋ Requested".
7. Switch → parent → Approvals tab top section shows the redemption alongside any pending chore submissions → tap Approve → kid balance drops to 10⭐ (next pull) → row moves to "Pending fulfillment".
8. Tap Fulfilled → row gone from Approvals → Activity feed shows "🎁 Sara · Ice Cream · fulfilled <time>".
9. Kid taps Screen Time → request → parent denies with note "not before homework" → kid catalog re-shows Screen Time as Request-able (denied = fresh) → Activity shows "✗ Sara · Screen Time · denied — 'not before homework'".
10. CI green; pgTAP, Jest, tsc all green locally.

### 5.4 M4 exit criteria

- All migrations apply cleanly to a fresh DB and to a DB at the `m3-approvals-ledger` tag (forward-compatible).
- pgTAP green (M3's 71 + ~25 new = ~96 tests).
- Jest 17 + 3 = ~20 green; `tsc --noEmit` clean.
- Manual flow above passes on Android emulator.
- Tag `m4-rewards-redemptions` after acceptance.

---

## 6. Open questions / known deferrals

- **Realtime + push** (M5) — without them, kid only sees redemption status changes on next foreground / pull-to-refresh. Acceptable for v1.
- **Co-parent invite** (M5 first task) — has been deferred since M1; will land before M8 ship.
- **Achievements catalog** (M5) — `star_ledger` carries enough information to retroactively unlock badges based on cumulative spending or earning. No M4 schema changes needed.
- **Reward sort order** — alphabetical, by cost, by recency? M4 ships `created_at` ordering. UX research after beta might justify a "popular first" or "cheapest first" reorder.
- **Reward purchase limits** — no per-reward inventory or per-kid daily caps in M4. A kid with infinite stars could request the same reward repeatedly. Reasonable for v1; revisit with real beta families.
- **Manual stars adjust UI** — `star_ledger` accepts `manual_grant` / `manual_revoke` reasons but no UI in M4. Polish if beta families ask for it.
- **Star ledger compaction** — `star_ledger` grows unboundedly. With redemptions added, the rate roughly doubles. Not a v1 concern; revisit when balance computation crosses 50ms.
- **The four M2 dev-infra carry-overs + three M1 known issues** — bundled into the cloud-prep slot before M8 ship.

---

**End of M4 spec.**
