# M2 — Core Chore Loop — Design Spec

**Date:** 2026-05-08
**Status:** Approved (pending user review of this written doc)
**Predecessor:** `docs/superpowers/specs/2026-05-05-shores-design.md` (overall product spec), `docs/superpowers/plans/2026-05-05-m1-foundations.md` (M1 plan)
**Successor milestone:** M3 — Approvals & Ledger

---

## 1. Scope and milestone boundary

### 1.1 In scope

- **Chore CRUD** by parents (title, description, ⭐ value, assignee, recurrence, verification mode, soft-delete via `active=false`).
- **Full recurrence engine:** one-off, daily, weekly-with-specific-days. Single SQL helper drives both initial `next_due_at` and the cron generator.
- **All three verification modes** (`auto`, `photo`, `approval`) at the submission layer.
- **Kid mode entry:** avatar lock screen on every app open. Sectioned layout — small "Parents" row above larger "Kids" tiles.
- **Kid home:** today's chores list + per-card "Done" button. Switch button to return to lock screen.
- **Photo capture:** native camera (no gallery), client-side compression to ~1 MB, retry-on-failure.
- **Parent mode:** bottom-tab nav with Chores | Activity | Settings. Read-only activity feed of recent submissions (no approve/reject buttons yet).
- **Onboarding seed chores:** 5 starter chores at family creation. One-time backfill for the existing M1 family.
- **GitHub Actions CI:** type-check, Jest, pgTAP on every push and PR.

### 1.2 Out of scope (deferred to M3 or later)

- `star_ledger` table and writes — `auto`-mode chores reach `status='approved'` but no ledger row is inserted; no stars are computed or displayed in M2.
- Approve/reject UI in the activity feed.
- `approve_chore` Edge Function, streaks, achievements, push notifications, realtime broadcasts.
- Co-parent invite (M3 first task).
- Parent PIN/biometric at the avatar lock — tapping the parent tile enters parent mode immediately.
- Hardening of the three M1 known issues (revisit alongside co-parent invite).

### 1.3 Exit criteria

A solo parent can:
1. Create a family and have 5 starter chores auto-seeded.
2. Add at least one kid.
3. Sign out, sign back in, land on the avatar lock screen.
4. Tap a kid tile and see today's chores; tap "Done" on each verification-mode variant and observe correct status transitions.
5. Tap Switch, tap their parent tile, see new submissions in the Activity tab, edit/archive seed chores, and create a new weekly chore.
6. The next morning (or after a triggered run of the cron Edge Function), see the new instance appear on the assigned kid's home.

CI green, `tsc --noEmit` clean, pgTAP green, Jest green, all migrations apply both to a fresh DB and to a DB at the `m1-foundations` tag.

---

## 2. Data model

### 2.1 New tables (per overall spec §3)

```text
chores
  id (uuid pk, default gen_random_uuid())
  family_id (fk → families on delete cascade)
  title (text not null)
  description (text)
  star_value (int not null check (star_value between 1 and 999))
  assignee_profile_id (fk → profiles, nullable; null = "anyone")
  verification_mode (text not null check (verification_mode in ('auto','photo','approval')))
  recurrence (jsonb not null)              -- {"type":"once"|"daily"|"weekly", "days":[0..6]?, "due":"YYYY-MM-DD"?}
  next_due_at (timestamptz)                -- nullable; null when one-off has been generated already
  active (bool not null default true)
  created_by (fk → profiles not null)
  created_at (timestamptz not null default now())

  index (family_id) where active = true
  index (next_due_at) where active = true and next_due_at is not null

chore_instances
  id (uuid pk, default gen_random_uuid())
  chore_id (fk → chores on delete cascade)
  family_id (fk → families on delete cascade)   -- denormalized for RLS
  assignee_profile_id (fk → profiles, nullable) -- snapshot of chores.assignee at generation time
  due_at (timestamptz not null)
  status (text not null default 'pending'
          check (status in ('pending','submitted','approved','rejected')))
  completed_by (fk → profiles, nullable)
  completed_at (timestamptz, nullable)
  photo_url (text, nullable)
  approved_by (fk → profiles, nullable)         -- stays NULL throughout M2
  approved_at (timestamptz, nullable)           -- stays NULL throughout M2
  rejection_reason (text, nullable)             -- stays NULL throughout M2
  stars_awarded (int, nullable)                 -- stays NULL throughout M2

  unique (chore_id, due_at)                     -- idempotent generation guard
  index (family_id, status)
  index (assignee_profile_id, due_at) where status in ('pending','submitted')
```

The four `approved_*` / `stars_awarded` columns are present in M2 because the M3 work writes them; shipping the schema now means M3 doesn't need a migration.

### 2.2 Recurrence jsonb shape

| `type`   | Required keys     | Example                                     | Behavior                                        |
|----------|-------------------|---------------------------------------------|-------------------------------------------------|
| `once`   | `due`             | `{"type":"once","due":"2026-05-09"}`        | One instance generated on `due`, then `next_due_at = NULL`. |
| `daily`  | (none)            | `{"type":"daily"}`                          | One instance per day starting from chore creation. |
| `weekly` | `days` (int[0..6], non-empty)| `{"type":"weekly","days":[1,3,5]}` | One instance per matching weekday (0=Sun…6=Sat). Empty `days` is rejected by `create_chore` validation. |

Validation lives inside the `create_chore` / `update_chore` RPCs (RAISE EXCEPTION on bad shape) — the column is plain `jsonb` so we can evolve without migrations.

### 2.3 Storage bucket

- New private bucket `chore-proofs`. Path convention: `family/{family_id}/chore-proofs/{instance_id}.jpg`.
- Read access via signed URLs only (parent mode generates a signed URL on demand to view the photo in the activity feed).
- Retention: indefinite in M2; the spec's 30-day cleanup policy is M7 work.

---

## 3. Server-side logic

### 3.1 SQL helper

```sql
-- Computes the next due timestamp from a recurrence jsonb and a reference time.
-- Returns NULL when there is no further occurrence (one-off after first generation).
create or replace function next_occurrence(rec jsonb, after timestamptz)
  returns timestamptz
  language plpgsql immutable;
```

Used in two places only:
- `create_chore` / `update_chore` to seed `next_due_at` at creation/edit time.
- The `generate_chore_instances` Edge Function to advance `next_due_at` after each instance is inserted.

Client never does recurrence math.

### 3.2 RPCs (all `security definer`)

- `create_chore(family_id, title, description, star_value, assignee_profile_id, verification_mode, recurrence)` — parent-only, validates family membership and that assignee (if non-null) is in the same family. Computes initial `next_due_at` via `next_occurrence(recurrence, now())`.
- `update_chore(chore_id, ...patchable fields)` — parent-only, family-scoped. Recomputes `next_due_at` if `recurrence` changed.
- `archive_chore(chore_id)` — parent-only; sets `active=false`. In-flight instances continue and resolve normally.
- `complete_chore(instance_id, kid_profile_id, photo_url default null)` — runs from kid mode (auth principal is still the parent's session).
  - Validates: instance belongs to a family the caller is a parent of; `kid_profile_id` is in that family with `type='kid'`; instance status is `'pending'`; assignee match **against the instance snapshot** (`chore_instances.assignee_profile_id IS NULL OR chore_instances.assignee_profile_id = kid_profile_id`). Using the instance snapshot, not `chores.assignee_profile_id`, lets a parent reassign a chore mid-day without invalidating already-generated instances.
  - Branches by `verification_mode` (looked up via the joined chore row):
    - `auto` → sets `status='approved'`, `completed_by=kid_profile_id`, `completed_at=now()`. **No ledger row** (M3 concern).
    - `photo` → requires `photo_url`; sets `status='submitted'`, `photo_url`, `completed_by`, `completed_at`.
    - `approval` → sets `status='submitted'`, `completed_by`, `completed_at`. `photo_url` ignored.
- `seed_starter_chores(family_id)` — parent-only, idempotent. No-op when the family already has any chore. Inserts 5 daily, approval-mode, 10 ⭐, "Anyone" chores: "Make bed", "Brush teeth", "Feed pet", "Tidy room", "Homework".

### 3.3 Edge Function

`generate_chore_instances` (Deno):
- Triggered daily at **00:05 UTC** by `pg_cron`.
- Selects active chores where `next_due_at IS NOT NULL AND next_due_at <= now() + interval '24 hours'`.
- For each chore, in a single transaction:
  1. Insert one `chore_instance` for that `due_at` (idempotency guarded by the `(chore_id, due_at)` unique index — `ON CONFLICT DO NOTHING`).
  2. Compute `next_occurrence(recurrence, next_due_at)` and update `chores.next_due_at`.
- If a chore's `next_due_at` is more than 24 h in the past (missed cron run), the loop iterates within that chore until `next_due_at` is in the future, generating one instance per missed day. Bounded so a runaway can't insert thousands of rows: cap at 14 iterations per chore per run; log and skip beyond that.

### 3.4 RLS

- `chores`, `chore_instances`: SELECT/INSERT/UPDATE allowed where `family_id` matches a row in `profiles` with the caller's `auth.uid()` and `type='parent'`. No DELETE policy — soft delete only.
- All kid-side mutations go through `complete_chore` (security definer); kids have no `auth.uid()` so RLS would never grant them anything.

### 3.5 Storage policies

- INSERT on `chore-proofs`: path matches `family/{family_id}/chore-proofs/*` AND caller is a parent in that family (joined via `profiles`).
- SELECT (for signed-URL generation): same predicate.
- DELETE: not exposed in M2.

### 3.6 Migration order

1. `chores` table + indexes
2. `chore_instances` table + indexes
3. `next_occurrence` SQL helper
4. CRUD RPCs (`create_chore`, `update_chore`, `archive_chore`, `complete_chore`)
5. `seed_starter_chores` RPC + one-shot backfill (`SELECT seed_starter_chores(id) FROM families;`)
6. `chore-proofs` storage bucket + policies
7. `pg_cron` schedule for `generate_chore_instances`

---

## 4. Routing and screen structure

```
mobile/app/
  _layout.tsx                  (auth+family gate; unchanged from M1)
  index.tsx                    (redirect to login; unchanged)
  (auth)/...                   (unchanged)
  (onboarding)/
    create-family.tsx          (calls seed_starter_chores after create_family)
    add-kid.tsx                (unchanged)
  (app)/
    _layout.tsx                (unchanged)
    index.tsx                  (REPURPOSED → avatar lock screen, replacing M1's family list)
    kid/
      _layout.tsx              (Stack — kid-mode chrome)
      [profileId]/
        index.tsx              (kid home — today's chores)
        chore/[instanceId]/photo.tsx   (camera + preview + retry)
    parent/
      _layout.tsx              (Tabs — bottom nav)
      index.tsx                (Chores tab — list + FAB)
      chores/
        new.tsx                (create-chore form)
        [id].tsx               (edit-chore form)
      activity.tsx             (read-only submissions feed)
      settings.tsx             (sign out, switch profile, future stubs)
```

**Active profile encoding:** route param. Tapping a kid tile on the lock screen → `router.replace('/(app)/kid/{profileId}')`. Tapping the parent tile → `router.replace('/(app)/parent')`. No global "current profile" state; cold start always lands on the lock screen.

**Switch profile:** every kid screen header has a Switch button that `router.replace('/(app)')`. Parent settings has an equivalent.

**Existing `app/_layout.tsx` redirect rules don't need changes:** `has-family + in (auth)` → `/(app)` still routes through to the lock screen, which is now `(app)/index.tsx`.

---

## 5. Kid mode UX

### 5.1 Avatar lock screen (`(app)/index.tsx`)

- Greeting + "Tap your tile" subtitle.
- "Parents" row above a divider: small ~40 px tiles, single-tap → `router.replace('/(app)/parent')`.
- "Kids" grid below: large ~56 px tiles. Tap → if `pin_hash` is set, modal with 4-digit pad; on correct PIN (plain-text compare in M2 — hashing is M3 per known-issues), `router.replace('/(app)/kid/{profileId}')`. If unset, navigate immediately.
- Wrong PIN: shake animation, clear, stay on lock screen. No lockout in M2.
- Sign out is NOT here — only in parent settings.

### 5.2 Kid home (`(app)/kid/[profileId]/index.tsx`)

- Header: kid avatar + name + Switch button (top-right). No streak / star balance — those land in M3.
- Body: today's chores as fat cards (each card: title, ⭐ value, big "Done" button).
  - `auto` → Done = direct `complete_chore` call → card animates out, toast "✓ Done!".
  - `approval` → Done = direct call → card moves to a dimmed "Waiting for parent ✋" state at the bottom; visible until next-day refresh.
  - `photo` → Done = `router.push('/(app)/kid/{profileId}/chore/{instanceId}/photo')`.
- Empty state: "All done — great job! 🌟" (text only; confetti / sounds are M5 polish).
- Data: TanStack Query loading recent (`status='pending'`) chore_instances where `assignee_profile_id IN (kidProfileId, NULL)` and `due_at::date = today`. (TanStack Query is introduced in M2 — M1's three Supabase calls used plain `useEffect`. M2 sets up the QueryClient provider in `app/_layout.tsx` as part of the kid-home task.)

### 5.3 Photo capture (`(app)/kid/[profileId]/chore/[instanceId]/photo.tsx`)

- `expo-image-picker.launchCameraAsync({ allowsEditing: false, quality: 1, mediaTypes: 'Images' })` — native camera, no gallery.
- Returned URI run through `expo-image-manipulator.manipulateAsync(uri, [{ resize: { width: 1280 } }], { compress: 0.6, format: 'jpeg' })` → typically 600 KB – 1 MB.
- Preview + Retake + Send buttons.
- Send pipeline:
  1. Get a signed upload URL (or use the Supabase JS Storage `upload()` directly with the parent's session) for `family/{family_id}/chore-proofs/{instance_id}.jpg`.
  2. Upload (overwrite if exists — `upsert: true`; instance_id is unique so collisions only happen on retry of the same submission).
  3. Call `complete_chore(instance_id, kid_profile_id, photo_url)`.
- Failure handling: 3 retries with exponential backoff (1s/3s/9s). On final failure, toast "Couldn't upload — try again later"; the submission stays in TanStack Query's mutation cache and retries once on next foreground. The chore stays at `status='pending'` until success.

### 5.4 Switch button

Top-right of every kid screen header. Tap → `router.replace('/(app)')`. No confirmation in M2 — nothing destructive to confirm.

---

## 6. Parent mode UX

### 6.1 Tabs (`(app)/parent/_layout.tsx`)

`<Tabs>` with three screens:
- `index` → **Chores** (default landing)
- `activity` → **Activity**
- `settings` → **Settings**

### 6.2 Chores tab (`parent/index.tsx`)

- Header: "Chores" + `+` FAB (→ `parent/chores/new`).
- List of all `active=true` chores. Each row:
  - Title, ⭐ value
  - Assignee (kid avatar + name, or "Anyone")
  - Recurrence summary via `formatRecurrence(jsonb)` helper: "Daily", "Mon · Wed · Fri", "Once on May 9", etc.
- Tap row → `parent/chores/[id]` (edit form).
- Swipe-to-archive (`archive_chore` RPC).
- Empty state: "No chores yet — tap + to add one."

### 6.3 Create / edit chore form (`parent/chores/new.tsx`, `parent/chores/[id].tsx`)

- Title (required), description (optional)
- Star value (numeric input, default 10, min 1, max 999)
- Assignee picker: dropdown listing each kid + "Anyone"
- Verification mode: 3-button segmented (Auto / Photo / Approval), with one-line descriptions under each
- Recurrence picker:
  - "Repeats" toggle
  - Off → date picker for due date (one-off)
  - On → Daily / Weekly segmented; Weekly reveals 7 day-of-week chips (multi-select; defaults to today's weekday)
- Save / Cancel; edit form adds Archive button.
- Both forms call `create_chore` / `update_chore` RPCs.

### 6.4 Activity tab (`parent/activity.tsx`)

- Reverse-chronological list of `chore_instances` with `status` in (`'submitted'`, `'approved'`), paginated (last 30 days), via TanStack Query infinite scroll.
- Row format: kid avatar + name · chore title · status icon · relative timestamp.
  - `auto`-approved: "✓ Sara · Brush teeth · 2 hr ago"
  - `photo` submitted: "📸 Leo · Make bed · 5 min ago — tap to view photo"
  - `approval` submitted: "✋ Sara · Tidy room · 10 min ago"
- Tap a `photo` row → opens a viewer with a freshly fetched signed URL.
- Footer note: "Approvals coming next milestone" so parents understand the read-only state.
- Empty state: "No activity yet."

### 6.5 Settings tab (`parent/settings.tsx`)

- Sign out button (was on M1 family-list home; moved here).
- Switch profile → `router.replace('/(app)')`.
- Family info readout (name, member count) — pulled via the existing M1 `useFamily` hook plus a quick profiles count.
- Stubbed sections labelled "coming soon" for Notifications, Co-parents, Subscription.

---

## 7. Onboarding additions

### 7.1 Seed chores at create-family

`mobile/app/(onboarding)/create-family.tsx` — after the existing `create_family` RPC succeeds and `refetchFamily()` runs, also call `seed_starter_chores(family_id)`. The RPC is idempotent so a retry after a partial failure is safe.

If the seed call errors, the family is still created — the parent simply sees an empty Chores tab and can add their own. Not a blocking failure.

### 7.2 Backfill for the existing M1 family

The migration that defines `seed_starter_chores` ends with:

```sql
do $$
declare f record;
begin
  for f in select id from families loop
    perform seed_starter_chores(f.id);
  end loop;
end $$;
```

Idempotent on re-run.

---

## 8. CI

`.github/workflows/ci.yml`:
- Triggers: `push` (any branch) + `pull_request`
- Job: `ubuntu-latest`
- Steps:
  1. `actions/checkout`
  2. `actions/setup-node` (Node 20, npm cache keyed on `mobile/package-lock.json`)
  3. `supabase/setup-cli`
  4. `supabase start`
  5. `supabase db reset` (applies all migrations including the seed backfill)
  6. `supabase test db` (pgTAP)
  7. `cd mobile && npm ci`
  8. `cd mobile && npx tsc --noEmit`
  9. `cd mobile && npm test`
- Branch protection on `main`: configured in the GitHub UI (not in the workflow file) to require this job green before merge.

Expected wall-clock per run: ~3–4 min once caches are warm.

---

## 9. Testing strategy

### 9.1 pgTAP (extends `supabase/tests/`)

- `next_occurrence()`: one-off (returns NULL after first), daily (+1 day), weekly with various `days` arrays (including today-matches and today-doesn't-match), edge cases (empty days array, all 7 days).
- `create_chore` / `update_chore` / `archive_chore`: parent-only, family-scoped, assignee-must-be-in-family, recurrence shape validation.
- `complete_chore`: each verification mode, assignee match (specific kid + "Anyone"), rejection on cross-family instance_id, rejection on non-pending status.
- `seed_starter_chores` idempotency: call twice, count stays at 5.
- RLS isolation: User A from Family 1 cannot SELECT or UPDATE Family 2's chores or chore_instances.

### 9.2 Jest (extends `mobile/src/__tests__/`)

- `formatRecurrence(jsonb)` for each variant (one-off date format, daily, weekly with sorted day rendering).
- Recurrence picker ↔ jsonb round-trip (form state in / form state out matches input).
- PIN compare helper (plain-text in M2; the test stays valid in M3 because it tests the boundary, not the cipher).
- Photo compression target size (mock `expo-image-manipulator`, assert resize/quality params).

### 9.3 Edge Function tests

- Run `generate_chore_instances` against a local Supabase seeded with chores in each recurrence mode.
- Idempotency: invoke twice, no duplicate instances.
- Backfill: simulate a 3-day-stale `next_due_at`, single invocation generates 3 instances per daily chore; cap at 14 iterations enforced.
- Weekly: with `days=[1,3,5]`, runs on Tue/Thu/Sat skip; runs on Mon/Wed/Fri generate.

### 9.4 Manual acceptance (the M2 analog of M1's Task 24)

1. Fresh signup → create family → confirm 5 starter chores auto-seeded.
2. Add 2 kids; assign one chore to each, leave one as "Anyone".
3. Sign out, sign back in → land on avatar lock.
4. Tap kid tile (no PIN) → kid home shows today's chores including the one assigned to "Anyone".
5. Tap Done on each verification-mode variant → confirm UX (auto vanishes, approval moves to "waiting", photo opens camera).
6. Switch → parent → Activity tab shows all submissions with correct icons.
7. Edit a seed chore (change to `weekly`, `[1,3,5]`); create a new one-off chore for tomorrow.
8. Trigger generator manually (`npx supabase functions invoke generate_chore_instances`) or wait for the 00:05 UTC cron; verify next-day instance appears on the right kid's home.
9. CI green; type-check + Jest + pgTAP all green locally.

---

## 10. Open questions / known deferrals

- **Family-local timezone for cron:** still UTC per overall spec §10. Revisit after beta.
- **Chore-proof photo retention:** indefinite for now; 30-day cleanup is M7 work.
- **Stale `submitted` chores:** if a kid submits in `photo`/`approval` mode during M2 and parent never approves (because there's no UI to), the row sits at `'submitted'` indefinitely. M3's approval queue will surface them. Acceptable.
- **PIN hashing:** still plain-text in M2; M3 swaps to bcrypt-via-Edge-Function alongside the rest of the security work.
- **Three M1 known issues** (`pin_hash` typing, parent-mutation RLS hole, `create_family` race): none touched in M2; all wait for M3 when co-parent invite makes them load-bearing.
- **`star_ledger` schema:** not created in M2. M3's first migration will add it. There is no M2 code that reads or writes it.

---

**End of M2 spec.**
