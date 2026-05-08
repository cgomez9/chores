# M3 — Approvals & Ledger — Design Spec

**Date:** 2026-05-08
**Status:** Approved (pending user review of this written doc)
**Predecessor:** `docs/superpowers/specs/2026-05-08-m2-chore-loop-design.md` (M2 spec), `docs/superpowers/specs/2026-05-05-shores-design.md` (overall product spec)
**Successor milestone:** M4 — Realtime, Push, Co-parent Invite (TBD scope; see §10)

---

## 1. Scope and milestone boundary

### 1.1 In scope

- **`star_ledger` table** — append-only audit log of every star delta. Source of truth for kid balances per overall spec §3.1.
- **`streaks` table** — one row per kid; tracks current streak, longest streak, and last completion date.
- **`approve_chore(instance_id)` RPC** — single Postgres transaction: chore_instance → `'approved'` + ledger insert + streaks upsert. Atomic, idempotent on already-approved instances.
- **`reject_chore(instance_id, reason)` RPC** — single transaction: chore_instance → `'rejected'` with `rejection_reason`. Reason is optional. No ledger or streaks change. Idempotent on already-rejected instances.
- **`current_streak(profile_id)` SQL function** — lazy streak read: returns 0 if `last_completion_date < current_date - 1`, else `current_count`.
- **Parent Approvals tab** (new `mobile/app/(app)/parent/approvals.tsx`) — list of `'submitted'` chore_instances with Approve/Reject buttons + photo viewer + reject-reason modal.
- **Activity tab updates** — pending submissions move out (now in Approvals); only `'approved'` and `'rejected'` show; rejected rows render their reason.
- **Kid home additions** — `⭐ <n>` balance pill and `🔥 <n>` streak flame in the header. Today's chores filter widens to include `'rejected'` instances rendered as dimmed cards with the reason.

### 1.2 Out of scope (deferred)

- **M4** (next milestone, scope TBD): realtime broadcasts (kid sees instant approval feedback), push notifications, co-parent invite, the four M2 dev-infra carry-overs (cron idempotency, type quirks, gen-types stdout, FK aliases), and the three M1 known issues (pin_hash typing, parent-mutation RLS hole, create_family race).
- **M5** (gamification polish): achievements catalog, leaderboard, family co-op goals, confetti / sounds / haptics.
- **Cloud-prep slot before M8 ship**: real Supabase cloud project, email verification on, Sentry, account-deletion flow (App Store requirement), and re-verification of the four M2 carry-overs against cloud.

### 1.3 Exit criteria

A solo parent + kid can:
1. Kid completes today's chore → it shows in the parent's Approvals tab.
2. Parent approves one chore → kid's home immediately reflects the new ⭐ balance and `🔥 1` streak on next pull.
3. Parent rejects another chore with a reason → kid's home shows a dimmed `✗ Rejected: <reason>` card.
4. (Time-travel test) Approval with `last_completion_date = yesterday` → streak goes from 1 to 2.
5. CI green; pgTAP, Jest, and tsc all green.

After acceptance, tag `m3-approvals-ledger`.

---

## 2. Data model

### 2.1 New tables

```text
star_ledger                                    -- append-only audit log
  id                  uuid pk default gen_random_uuid()
  family_id           uuid not null fk → families on delete cascade   -- denormalized for RLS
  profile_id          uuid not null fk → profiles on delete cascade   -- always a kid in M3
  delta               int  not null            -- +ve for chore_approved (only reason in M3)
  reason              text not null check (reason in
                       ('chore_approved','redemption','manual_grant','manual_revoke'))
  source_id           uuid                     -- chore_instance.id (M3); redemption.id (M4+)
  created_at          timestamptz not null default now()

  index (profile_id)                           -- fast SUM for balance reads
  index (family_id, created_at desc)           -- future activity queries

streaks                                        -- one row per kid
  profile_id          uuid pk fk → profiles on delete cascade
  family_id           uuid not null fk → families on delete cascade   -- denormalized for RLS
  current_count       int not null default 0
  longest_count       int not null default 0
  last_completion_date date
```

### 2.2 No schema changes to existing M2 tables

`chore_instances` already has `approved_by`, `approved_at`, `stars_awarded`, and `rejection_reason` columns from the M2 schema. M3 fills them in.

### 2.3 Schema design choices

- **`family_id` denormalized** on both new tables so RLS policies are a simple `family_id = caller's family` predicate (matches the chore_instances pattern from M2).
- **`source_id`** is plain `uuid` with no FK constraint. It intentionally references different tables (`chore_instances` in M3, `redemptions` in M4) depending on `reason` — we trade referential integrity for the polymorphism the spec calls for. The check constraint on `reason` is the only enforced shape.
- **`delta int`** (not `numeric`) — star values are bounded 1–999 per chore. No fractional stars.
- **No FK from `chore_instances.stars_awarded` to anywhere** — it's a snapshot of the chore's `star_value` at approval time, not a foreign reference.
- **Streak counters are int**, capped only by Postgres (effectively unbounded for human use).

### 2.4 Migration order

1. `star_ledger` table + indexes + RLS
2. `streaks` table + RLS
3. `current_streak` SQL function
4. `approve_chore` RPC
5. `reject_chore` RPC

---

## 3. Server-side logic

### 3.1 `approve_chore(instance_id uuid) → void`

`security definer`, called by parent mode's Approve button.

```text
1. Resolve caller's parent profile id and family. Raise if caller is not a parent.
2. SELECT chore_instance FOR UPDATE. Raise if missing or family mismatch.
3. If status = 'approved' already: no-op (idempotent re-call).
4. If status != 'submitted': raise 'instance is not submitted'.
5. Look up chore.star_value (joined on chore_id).
6. UPDATE chore_instances SET status='approved', approved_by=<caller_profile>,
                                 approved_at=now(), stars_awarded=<star_value>.
7. INSERT INTO star_ledger(family_id, profile_id, delta, reason, source_id)
       VALUES (<family_id>, <instance.completed_by>, <star_value>,
               'chore_approved', <instance_id>).
8. Streak upsert keyed on profile_id = <instance.completed_by>:
     - No row → INSERT (current_count=1, longest_count=1, last_completion_date=current_date)
     - last_completion_date = current_date → no-op (already counted today)
     - last_completion_date = current_date - 1
         → current_count += 1
         → longest_count = greatest(longest_count, current_count)
         → last_completion_date = current_date
     - else (gap of 2+ days)
         → current_count = 1
         → last_completion_date = current_date
         → longest_count unchanged
```

The `FOR UPDATE` lock + idempotent status check eliminate the double-approve race when two parents tap Approve simultaneously (M4 concern, but the lock is in M3 because it's free).

### 3.2 `reject_chore(instance_id uuid, reason text default '') → void`

`security definer`, called by parent mode's Reject button.

```text
1. Resolve caller's parent family. Raise if caller is not a parent.
2. SELECT chore_instance FOR UPDATE. Raise if missing or family mismatch.
3. If status = 'rejected': no-op (idempotent).
4. If status != 'submitted': raise.
5. UPDATE chore_instances SET status='rejected',
                                 approved_by=<caller_profile>, approved_at=now(),
                                 rejection_reason=<reason>.
```

`approved_by`/`approved_at` are reused as "decided_by"/"decided_at" — they record who made the call and when. `rejection_reason` is an empty string when the parent doesn't supply one (no NULL handling complexity in the kid UI).

### 3.3 `current_streak(profile_id uuid) → int` SQL function

```sql
create or replace function public.current_streak(p uuid)
  returns int
  language sql
  stable
as $$
  select coalesce(
    (select case
       when last_completion_date is null then 0
       when last_completion_date < (current_date - 1) then 0
       else current_count
     end
     from public.streaks where profile_id = p),
    0
  );
$$;
```

Outer `coalesce` collapses both the "no row exists" case and the in-row NULL case to `0`, so callers never have to handle NULL. `stable` (not `immutable`) because `current_date` changes across UTC days. `security invoker` (default) so a parent in a different family gets `0` regardless of arg — RLS hides the row from the inner SELECT.

### 3.4 RLS

```sql
-- star_ledger
alter table public.star_ledger enable row level security;

create policy star_ledger_select_own_family on public.star_ledger
  for select using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.type = 'parent' and p.family_id = star_ledger.family_id)
  );
-- No INSERT/UPDATE/DELETE policies. Mutations only via approve_chore (security definer).

-- streaks
alter table public.streaks enable row level security;

create policy streaks_select_own_family on public.streaks
  for select using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.type = 'parent' and p.family_id = streaks.family_id)
  );
-- No mutations policies. Same pattern as star_ledger.
```

The append-only invariant on `star_ledger` is enforced by the *absence* of UPDATE and DELETE policies — even a parent can't rewrite a ledger row.

### 3.5 Validation paths that raise

| RPC            | Condition                                | Error message                          |
|----------------|------------------------------------------|----------------------------------------|
| both           | caller has no parent profile             | `caller is not a parent`               |
| both           | instance.id missing                       | `instance % not found`                 |
| both           | instance.family_id ≠ caller's family     | `instance % not in caller family`      |
| approve_chore  | instance.status not in ('submitted','approved') | `instance % is not submitted`   |
| reject_chore   | instance.status not in ('submitted','rejected') | `instance % is not submitted`   |

Idempotent re-calls on the terminal status (already approved / rejected) silently no-op.

---

## 4. Mobile UI

### 4.1 Parent mode tabs

`mobile/app/(app)/parent/_layout.tsx` adds one tab. Order: `Chores | Approvals | Activity | Settings`.

```typescript
<Tabs screenOptions={{ headerShown: false }}>
  <Tabs.Screen name="index"     options={{ title: 'Chores' }} />
  <Tabs.Screen name="approvals" options={{ title: 'Approvals' }} />
  <Tabs.Screen name="activity"  options={{ title: 'Activity' }} />
  <Tabs.Screen name="settings"  options={{ title: 'Settings' }} />
</Tabs>
```

### 4.2 Approvals tab (`parent/approvals.tsx`)

- **Query:** `chore_instances` where `status='submitted'` AND `family_id = current parent's family`. Joined to `chores` (title, verification_mode, star_value) and `profiles` (kid avatar + name) via `chore_instances_completed_by_fkey`. Ordered by `completed_at` ascending.
- **Row:** kid avatar/name, chore title, ⭐ value, relative timestamp, photo thumbnail (only for `verification_mode='photo'`), Approve and Reject buttons.
- **Photo thumbnail:** tap opens a 60-second signed-URL viewer (lifted from M2's Activity viewer; same code path).
- **Approve flow:** `useMutation` calls `approve_chore(instance_id)` → on success, `invalidateQueries` for `['approvals']`, `['kid-today', kidId]`, `['balance', kidId]`, `['streak', kidId]`.
- **Reject flow:** opens a `<RejectModal>` → user types reason or leaves empty → submits → `useMutation` calls `reject_chore(instance_id, reason)` → on success, invalidates `['approvals']`, `['activity']`, `['kid-today', kidId]`.
- **Empty state:** "No pending approvals — nice work 🌟"
- **Loading / error:** `<ActivityIndicator>` and red error text, matching M2 conventions.

### 4.3 Reject modal (`mobile/src/components/RejectModal.tsx`)

Single-input modal: TextField labeled "Why? (optional)" + `Reject` (red, secondary) and `Cancel` buttons. `onConfirm: (reason: string) => void` prop. Empty string is valid input.

### 4.4 Activity tab updates (`parent/activity.tsx`)

- **Query change:** `status IN ('approved', 'rejected')` (was `('submitted','approved')` in M2).
- **Footer removed:** "Approvals coming next milestone" gone.
- **Rejected row format:** `✗ <kid_emoji> <kid_name> · <chore_title> · <time> — "<reason>"`. Reason omitted when empty.
- **Approved row format:** unchanged from M2.

### 4.5 Kid home updates (`kid/[profileId]/index.tsx`)

- **Header additions:**
  - **Balance pill** — `⭐ <n>`. Query: `select coalesce(sum(delta),0) from star_ledger where profile_id = <profileId>`. Cache key `['balance', profileId]`.
  - **Streak flame** — `🔥 <n>`. Query: `select coalesce(current_streak(<profileId>), 0)`. Cache key `['streak', profileId]`. Hidden when `0`.
- **Today's chores filter widens** from `status IN ('pending','submitted')` to `status IN ('pending','submitted','rejected')`.
- **Rejected card:** dimmed (50% opacity), no Done button, label `✗ Rejected` + italic reason if non-empty.
- **No optimistic balance/streak updates** — kid only sees them refresh after parent acts. Avoids race UX where a number appears then bounces.

### 4.6 Files touched

| File                                                 | Status   |
|------------------------------------------------------|----------|
| `mobile/app/(app)/parent/_layout.tsx`                | Modified |
| `mobile/app/(app)/parent/approvals.tsx`              | New      |
| `mobile/src/components/RejectModal.tsx`              | New      |
| `mobile/app/(app)/parent/activity.tsx`               | Modified |
| `mobile/app/(app)/kid/[profileId]/index.tsx`         | Modified |
| `mobile/src/types/database.ts`                       | Regenerated |

---

## 5. Testing strategy

### 5.1 pgTAP (extends `supabase/tests/`)

- **`approve_chore`** — happy path (status flip + ledger row + streak row); idempotency on second approve (no extra ledger row, streak unchanged); cross-family rejection; non-submitted-status rejection; streak math: first approval, same-day double-approve (no bump), consecutive-day (`current_count = 2`), 2-day gap (`current_count = 1`, `longest_count` preserved at 5 from a prior 5-day streak), 7-day walk that crosses `longest_count`.
- **`reject_chore`** — happy path; idempotency; cross-family rejection; reason empty + reason provided both succeed.
- **`current_streak()`** — returns `current_count` when `last_completion_date >= current_date - 1`; returns 0 when older; returns NULL/0 for missing row.
- **RLS isolation** — User A from Family 1 cannot SELECT Family 2's `star_ledger` or `streaks`.
- **Balance computation** — `SUM(delta)` returns the correct total across multiple ledger rows including a manual_revoke negative entry (synthetic — the schema accepts it though M3 doesn't ship a UI to insert one).

### 5.2 Jest

Stays at 13 tests. M3 has no client-side math worth unit-testing in isolation; the RPC math is covered by pgTAP. The Approvals UI is integration-territory (would require mocking TanStack Query + Supabase) — not worth the maintenance cost in M3.

### 5.3 Manual M3 acceptance

1. Fresh sign-up → onboarding → 5 seed chores (M2 behavior).
2. Add a kid; trigger generator (`curl.exe -X POST http://127.0.0.1:54321/functions/v1/generate_chore_instances`).
3. Kid home shows today's chores; tap Done on three: one auto, one photo (with photo capture), one approval.
4. Parent → Approvals tab shows two pending (auto already at 'approved'); approve the photo one; reject the approval one with reason "needs another look".
5. Kid home — balance reflects approved chores (`auto + photo`); streak shows `🔥 1`; rejected card dimmed with the reason.
6. Time-travel test: in psql, `update streaks set last_completion_date = current_date - 1 where profile_id = <kid>;` then have parent approve another submission → streak goes to `🔥 2`.
7. CI green; pgTAP, Jest, tsc all green locally.

### 5.4 M3 exit criteria

- All migrations apply cleanly to a fresh DB and to a DB at the `m2-chore-loop` tag (forward-compatible).
- pgTAP green (M2's 46 + ~12 new = ~58 tests).
- Jest 13/13 green; `tsc --noEmit` clean.
- Manual flow above passes on Android emulator.
- Tag `m3-approvals-ledger` after acceptance.

---

## 6. Open questions / known deferrals

- **Realtime + push** (M4) — without them, the kid's balance/streak only refresh on next foreground or pull-to-refresh. Acceptable for M3; users will notice the lag if they keep both apps open simultaneously.
- **Co-parent invite** (M4 first task) — not in M3.
- **Achievements** (M5) — `star_ledger` carries enough information to unlock badges retroactively; no schema change needed when M5 ships.
- **Manual stars adjust UI** — `star_ledger` accepts `manual_grant` / `manual_revoke` reasons but M3 ships no UI for them. Future polish if beta families ask for "give bonus stars."
- **Streak grace period** — current rule is "miss one day → reset on next approval." A weekend grace pattern (Duolingo-style) is plausible later but not in M3.
- **Star ledger compaction** — at scale (years of use), `star_ledger` rows could grow large. Not a concern for v1 launch; revisit when balances start taking >50 ms to compute.
- **The four M2 dev-infra carry-overs** + **three M1 known issues** — bundled into the cloud-prep slot before M8 ship.

---

**End of M3 spec.**
