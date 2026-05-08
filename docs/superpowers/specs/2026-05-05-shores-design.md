# Shores — Design Spec

**Date:** 2026-05-05
**Status:** Approved (pending user review of this written doc)
**Author:** Brainstorm session

---

## 1. Product summary

**Shores** is a mobile app (iOS + Android) for families to assign, complete, and reward household chores with a gamified, kid-friendly UX. Parents define chores and rewards; kids complete chores to earn ⭐ stars; stars are redeemed for parent-fulfilled rewards (screen time, treats, cash, prizes). The app is designed to feel like a game — streaks, achievements, leaderboards, confetti, sounds — to motivate kids to participate.

### 1.1 Core loop

1. A **parent** creates a family, adds **kid profiles** (avatar + name, no kid login), and optionally invites a **co-parent**.
2. Parents define **chores** with a title, optional description, ⭐ value, assignee (specific kid or "anyone"), due date, recurrence, and a **verification mode** (auto-credit, photo proof, or parent approval).
3. Parents define a **rewards catalog** (e.g., "30 min screen time = 50 ⭐", "Ice cream = 100 ⭐", "$5 cash = 200 ⭐").
4. **Kids** open the app, tap their avatar (PIN if set) to enter their profile, see today's chores, and tap "Done." Depending on verification mode, the chore either auto-credits, prompts for a photo, or goes into the parent's approval queue.
5. **Parents** approve completions in a queue, see the family **leaderboard**, view recent activity.
6. **Kids** tap a reward in the catalog to request redemption → parent gets notified → parent approves → stars deducted → parent fulfills the reward in real life.
7. Background gamification — streaks, achievements/badges, family co-op goals, and juicy feedback (confetti, sounds, haptics) — make it feel like a game.

### 1.2 Goals

- Real product to launch publicly on iOS App Store and Google Play.
- Freemium subscription business model.
- Cross-platform from day one.
- Kid-friendly: usable by a 4-year-old; engaging through a 12-year-old.
- COPPA-safe by collecting no personal data on kids (kid profiles only, no kid logins in MVP).

### 1.3 Non-goals (v2+, explicitly out of MVP)

- Custom avatar customization with unlock economy
- Quests / daily challenges
- Levels / XP
- Per-kid sign-in for older kids
- Cross-household / divorced-parent support
- Chore rotation logic (assignee rotates by day)
- Free-form redemption requests (catalog only)
- Web companion
- Apple/Google Family integration
- Localization beyond English
- Automated photo moderation

---

## 2. User roles and accounts

| Role | Has account? | Can do |
|------|--------------|--------|
| **Parent (admin)** | Yes — Supabase Auth (email/password, Sign in with Apple, Sign in with Google) | Everything: manage family, create/edit/delete chores and rewards, approve completions and redemptions, invite co-parents, view all activity. |
| **Co-parent (admin)** | Yes — invited via email, accepts invite, joins same family | Same as parent. Both are equal admins. |
| **Kid (profile)** | **No** — a profile inside the parent's family. Kid taps their avatar on a shared device to "be" them. Optional 4-digit PIN per profile so siblings can't impersonate. | View own chores, mark done, attach photos, view own ⭐ balance / streak / badges, view leaderboard, request redemptions. |

**Family unit:** every account belongs to exactly one **family**. Co-parents join an existing family via invite link/code. Kids are profiles under that family. Multi-family per account is out of scope for MVP.

**Auth specifics for MVP:**
- Email + password via Supabase Auth.
- Magic-link password reset.
- Sign in with Apple (required by App Store if any social login is offered).
- Sign in with Google.

---

## 3. Data model

All tables live in a single Postgres database (Supabase). Row-Level Security (RLS) enforces family isolation on every table that holds family data, keyed off `family_id`.

```text
families
  id (uuid pk)
  name
  created_at
  subscription_tier         -- 'free' | 'pro'
  subscription_expires_at

profiles                    -- both parents and kids
  id (uuid pk)
  family_id (fk → families)
  type                      -- 'parent' | 'kid'
  display_name
  avatar_id                 -- references one of 8 preset avatars
  pin_hash                  -- nullable; for kid profiles only
  user_id (fk → auth.users) -- nullable; null for kids, set for parents
  push_token                -- nullable; Expo push token (parents only in MVP)
  created_at

chores
  id (uuid pk)
  family_id (fk → families)
  title
  description (nullable)
  star_value                -- int, ⭐ awarded on completion
  assignee_profile_id (fk → profiles, nullable)  -- null = "anyone"
  verification_mode         -- 'auto' | 'photo' | 'approval'
  recurrence                -- jsonb: {type:'once'|'daily'|'weekly', days:[1,3,5], ...}
  next_due_at               -- denormalized for query speed
  active                    -- bool, soft delete
  created_by (fk → profiles)
  created_at

chore_instances             -- one row per actual occurrence
  id (uuid pk)
  chore_id (fk → chores)
  family_id (fk → families) -- denormalized for RLS
  assignee_profile_id (fk → profiles, nullable)
  due_at
  status                    -- 'pending' | 'submitted' | 'approved' | 'rejected'
  completed_by (fk → profiles, nullable)
  completed_at (nullable)
  photo_url (nullable)      -- Supabase Storage URL
  approved_by (fk → profiles, nullable)
  approved_at (nullable)
  rejection_reason (nullable)
  stars_awarded (nullable)  -- snapshot of star_value at award time

rewards
  id (uuid pk)
  family_id (fk → families)
  title
  description (nullable)
  star_cost
  icon                      -- preset icon enum
  active                    -- bool
  created_at

redemptions
  id (uuid pk)
  family_id (fk → families)
  reward_id (fk → rewards)
  kid_profile_id (fk → profiles)
  star_cost_snapshot        -- snapshot at request time
  status                    -- 'pending' | 'approved' | 'denied' | 'fulfilled'
  requested_at
  resolved_by (fk → profiles, nullable)
  resolved_at (nullable)
  parent_note (nullable)

star_ledger                 -- append-only audit log of every star change
  id (uuid pk)
  family_id (fk → families)
  profile_id (fk → profiles)
  delta                     -- positive (earned) or negative (redeemed/revoked)
  reason                    -- 'chore_approved'|'redemption'|'manual_grant'|'manual_revoke'
  source_id                 -- chore_instance.id or redemption.id
  created_at

streaks
  profile_id (fk → profiles, pk)
  current_count
  longest_count
  last_completion_date

achievements
  id (uuid pk)
  profile_id (fk → profiles)
  achievement_key           -- 'first_100_stars', 'week_streak', etc.
  unlocked_at

family_goals                -- co-op goals
  id (uuid pk)
  family_id (fk → families)
  title
  star_target
  star_progress
  status                    -- 'active' | 'completed' | 'archived'
  created_at
  completed_at
```

### 3.1 Key data design choices

- **`star_ledger` is the source of truth for every kid's balance.** The current balance is computed via `SUM(delta) WHERE profile_id = X`. This avoids drift bugs from caching balances. UI may cache the computed value but never authoritatively persist it elsewhere.
- **`chore_instances` are separate from `chores`.** `chores` is the template; `chore_instances` are concrete occurrences. This is what makes recurrence handling clean and produces a real history.
- **`family_id` is denormalized** on every table that needs RLS so policies are simple and fast.
- **No separate `kids` and `parents` tables** — both live in `profiles` discriminated by `type`. Saves joins and consolidates role logic.

---

## 4. Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│  Mobile App (Expo / React Native + TypeScript)              │
│  ──────────────────────────────────────────────────────────  │
│   • Screens: Home, Chores, Leaderboard, Rewards, Profile     │
│   • State: TanStack Query (server cache) + Zustand (UI)      │
│   • Realtime: Supabase Realtime channels per family          │
│   • Storage: Expo SecureStore for tokens, MMKV for prefs     │
│   • Push: Expo Notifications (wraps APNs + FCM)              │
│   • Subscriptions: RevenueCat SDK                            │
└────────┬─────────────────────────────────────────────────────┘
         │ HTTPS / WebSocket
         ▼
┌──────────────────────────────────────────────────────────────┐
│  Supabase                                                    │
│  ──────────────────────────────────────────────────────────  │
│   • Postgres (data + RLS)                                    │
│   • Auth (email/password, Apple, Google)                     │
│   • Storage (chore-proof photos, signed URLs)                │
│   • Realtime (postgres_changes channels per family)          │
│   • Edge Functions (Deno/TS):                                │
│       - generate_chore_instances (cron, daily)               │
│       - send_push (called from triggers)                     │
│       - approve_chore (atomic: status + ledger + streak +    │
│                        achievement check + broadcast)        │
│       - approve_redemption (atomic: status + ledger)         │
│       - check_achievements                                   │
│       - revenuecat_webhook (sync subscription state)         │
│   • pg_cron triggers daily instance generation               │
└────────┬─────────────────────────────────────────────────────┘
         │
         ▼  (Apple Push / FCM via Expo Push Service)
   📱 Push notifications
```

### 4.1 Key flow — Kid completes a chore (photo verification)

1. Kid opens app, taps avatar (enters PIN if set), sees today's chores.
2. Taps "Done" on a `verification_mode='photo'` chore → camera opens.
3. Photo is compressed to ~1 MB and uploaded to Supabase Storage at `family/{family_id}/chore-proofs/{instance_id}.jpg`.
4. Client updates `chore_instances` row: `status='submitted'`, `photo_url`, `completed_by`, `completed_at`.
5. Postgres trigger fires → calls `send_push` Edge Function → both parents receive a push: "Sara completed 'Make bed' 📸".
6. Parent opens approval queue, taps Approve → `approve_chore` Edge Function runs as a single Postgres transaction:
   - Updates `chore_instances.status='approved'` (with `SELECT ... FOR UPDATE` for idempotency).
   - Inserts `star_ledger` row (positive delta).
   - Updates `streaks` (extend or reset based on `last_completion_date`).
   - Calls `check_achievements` (may unlock badges).
   - Broadcasts realtime event on the family channel.
7. Kid's app receives realtime update → confetti, ⭐ animation, achievement unlock celebration if any.

### 4.2 Key flow — Recurring chore instance generation

- A `pg_cron` job runs daily.
- `generate_chore_instances` Edge Function queries every active recurring chore where `next_due_at <= now() + 24h`, creates the next `chore_instance` row, and advances `next_due_at`. Idempotent: skips inserts if an instance for that date already exists.
- MVP uses UTC for the cron schedule; family-local timezone is a v2 concern (documented limitation).
- If a cron run is missed, the next run back-fills any missed dates.

### 4.3 Key flow — Redemption

1. Kid taps a reward → "Spend 50⭐ on Ice Cream?" → confirms.
2. `redemptions` row inserted with `status='pending'`, `star_cost_snapshot=50`. **Stars are not yet deducted.**
3. Push to parent: "Leo wants Ice Cream (50⭐)".
4. Parent approves → `approve_redemption` Edge Function transactionally: sets `status='approved'`, inserts negative `star_ledger` entry, broadcasts realtime.
5. Parent fulfills the reward IRL, then taps "Fulfilled" → `status='fulfilled'`. Stars are already gone — this is bookkeeping.
6. Parent can also **deny** → no ledger entry, kid sees "Request denied" with optional note.

### 4.4 Why Edge Functions for approve flows

The client doing 4 inserts (status update + ledger + streak + achievements) can fail halfway and corrupt state. Edge Functions wrap them in one Postgres transaction — atomic.

---

## 5. Subscription tiers and feature gating

Freemium model. Free tier is generous enough that small families never need to pay; medium/large families hit limits and upgrade.

| Feature | Free | Pro ($4.99/mo, $39.99/yr) |
|---------|------|----------------------------|
| Family members | 2 parents + 2 kids | Unlimited |
| Active chores | Up to 10 | Unlimited |
| Rewards in catalog | Up to 5 | Unlimited |
| Photo proofs | ✅ | ✅ |
| Recurring chores | ✅ | ✅ |
| Leaderboard | ✅ | ✅ |
| Streaks | ✅ | ✅ |
| Achievements | First 5 only | Full set |
| Family co-op goals | 1 active | Unlimited |
| Activity history | Last 30 days | Unlimited |
| Custom avatars (post-MVP) | Locked | Unlocked |

**Implementation:**

- **RevenueCat** wraps Apple / Google IAP. Saves ~2 weeks of receipt-validation, restore-purchases, and cross-platform entitlement plumbing. Free up to $2.5k MTR.
- `families.subscription_tier` and `subscription_expires_at` are mirrored from RevenueCat via a `revenuecat_webhook` Edge Function. Source of truth is RevenueCat; DB is a cache for fast feature-gate checks.
- Feature gates checked **client-side** (UX — show paywall before user attempts the action) AND **server-side** (RLS / Edge Functions — security; cannot bypass via direct API calls).
- **Free trial:** 7 days.

---

## 6. UX and screen architecture

The app has two modes — **Kid Mode** (game-y, simple, big tap targets) and **Parent Mode** (admin tools, approvals). One install. Kids tap their avatar to enter their mode; parents enter via PIN/biometric.

### 6.1 Top-level navigation

```text
KID MODE                          PARENT MODE
┌─────────────────────┐           ┌─────────────────────────┐
│ 🏠 Home             │           │ 🏠 Home                 │
│    (today's chores  │           │   (overview + approval  │
│     + ⭐ + streak)  │           │    queue badge)         │
│                     │           │                         │
│ 🏆 Leaderboard      │           │ ✓ Approvals             │
│                     │           │   (chores + redemptions)│
│ 🎁 Rewards          │           │                         │
│   (catalog +        │           │ 📋 Manage               │
│    my stars)        │           │   (chores, rewards,kids)│
│                     │           │                         │
│ 👤 Me               │           │ 📊 Activity & Family    │
│   (profile, badges, │           │                         │
│    streaks)         │           │ ⚙ Settings              │
│                     │           │   (subscription,        │
│ 🚪 Switch           │           │    co-parents, profile) │
└─────────────────────┘           └─────────────────────────┘
```

### 6.2 Key screens

- **Avatar Picker / Lock screen** — first thing on app open. Big tappable avatars for each family member. Tapping a kid → optional PIN → kid mode. Tapping a parent → PIN/biometric → parent mode. Designed to be usable by a 4-year-old.
- **Kid Home** — today's chores as fat cards with ⭐ values. Streak flame at top. Big "Done" button on each card. Confetti on tap (Lottie animation). Empty state: "All done — great job! 🌟".
- **Photo capture** — when verification mode is `photo`. Native camera, not in-app picker. Preview, retake, or send. Compression to ~1 MB before upload.
- **Parent Approvals** — single feed mixing chore submissions and redemption requests, with a badge count on the tab. Swipe to approve/reject (or buttons). Photo preview inline.
- **Manage / Chores** — list with FAB to add. Add/edit form: title, description, ⭐ value, assignee dropdown (or "anyone"), recurrence picker, verification-mode picker.
- **Rewards Catalog** — kids see this as visual cards with ⭐ price; cards appear locked if the kid can't afford. Parents see the same list with edit/delete affordances.
- **Onboarding** — 3-screen welcome → "Create your family" → add first kid profile → seed 5 starter chores ("Make bed", "Brush teeth", "Feed pet", "Tidy room", "Homework") and 3 starter rewards ("Screen time", "Treat", "$1 cash"). Skip available.
- **Paywall** — triggered when hitting a limit. Standard Apple-style: features list, monthly/yearly toggle, restore-purchases link, T&Cs link.

### 6.3 Visual direction

Colorful, rounded, playful. Big type. Bright accent colors for stars and streaks. Closer in feel to **Duolingo / Habitica** than **Todoist**.

---

## 7. Notifications

Push is critical: without it, parents miss approvals and kids lose the dopamine hit. Done badly, push is a top reason for uninstalls.

**Stack:** Expo Notifications → Expo Push Service → APNs (iOS) + FCM (Android). Tokens stored on `profiles.push_token` per parent. Sent server-side from Edge Functions triggered by DB events.

### 7.1 Push events for MVP

| Trigger | Recipient | Example copy | Quiet hours? |
|---------|-----------|--------------|--------------|
| Kid submits chore (photo or approval mode) | All parents | "Sara completed 'Make bed' 📸" | Yes |
| Kid requests redemption | All parents | "Leo wants Ice Cream (50⭐)" | Yes |
| Parent approves chore | Kid (via parent device) | "+25⭐! Great job on Make bed 🎉" | Yes |
| Parent denies chore | Kid (via parent device) | "'Make bed' needs another look" | Yes |
| Parent approves redemption | Kid (via parent device) | "Ice Cream approved! 🍦" | Yes |
| Streak milestone (7, 30, 100 days) | Kid + parents | "Sara is on a 7-day streak! 🔥" | Yes |
| Achievement unlocked | Kid + parents | "Leo unlocked 'First 100 Stars'!" | Yes |
| Family goal reached | Everyone | "Pizza Night earned!! 🍕" | Yes |
| Daily morning summary (opt-in) | Kid | "You have 3 chores today! ⭐⭐⭐" | n/a — scheduled 7 am |
| Chore overdue (24 h after due) | Assignee | "'Take out trash' is overdue" | Yes |

### 7.2 Notification behaviors

- **Quiet hours** are per-family (default 9 pm – 7 am). Notifications during quiet hours are queued and delivered at 7 am.
- **Kid-targeted pushes** in MVP go to the parents' devices (kids don't have logins). Lock-screen copy is kid-friendly enough that a parent seeing it isn't a problem; the in-app surfaces them inside the kid's profile when next opened.
- **Per-recipient mute** — every parent can mute notification categories individually in settings.
- **Realtime in-app celebrations** are separate from push. When the kid is in the app, confetti is driven by Supabase Realtime — not push round-trip. Both fire; the client de-dupes.

### 7.3 Implementation

Postgres triggers on `chore_instances` / `redemptions` status changes call the `send_push` Edge Function, which resolves recipient tokens, formats the message, respects quiet hours, and posts to Expo's Push API.

---

## 8. Error handling, edge cases, testing

### 8.1 Error categories and handling

| Failure | Strategy |
|---------|----------|
| Network blip during chore completion | Optimistic UI update + retry queue (TanStack Query mutation cache + persistence). After 30 s + on next foreground, soft toast "Reconnecting..." but kid is not blocked. |
| Photo upload fails | Local cache the image, show "uploading..." state, retry on backoff (3 attempts then on next foreground). User isn't blocked; chore enters a "pending upload" state. |
| Stars race condition (double-approve) | Edge Function uses `SELECT ... FOR UPDATE` on the `chore_instance` row; idempotent on `status='approved'`. Second approve becomes a no-op. |
| Subscription expired mid-action | RLS denies the action; client receives error → shows paywall sheet. Existing data stays readable; only "create new" actions blocked above limits. |
| Recurrence cron job missed | `generate_chore_instances` generates "today" plus back-fills missed prior days. Idempotent: `WHERE NOT EXISTS` guard before inserts. |
| Parent deletes a chore mid-completion | Soft delete only (`active=false`). The chore disappears from the active list; existing in-flight instances continue and resolve normally. There is no hard-delete UI in MVP. |
| Kid forgets PIN | Parent unlocks from parent mode → "Reset PIN" on kid profile. Not recoverable; just overwriteable. |
| Photo of inappropriate content | Out of scope for MVP. Trust parent review before approval. |
| App offline at midnight | Recurrence is generated server-side regardless of client state. On reconnect, client pulls today's instances. No client-side missed-chore logic. |
| Two co-parents approve different things simultaneously | RLS allows both; ledger is append-only; no conflict. Both approvals proceed. |

### 8.2 Testing strategy

- **Unit tests (Jest)** — pure logic: streak calculation, achievement-unlock conditions, recurrence date math, balance computation from ledger. Ruthless and fast.
- **Integration tests (Vitest + Supabase local)** — Edge Functions, especially `approve_chore`, `approve_redemption`, `generate_chore_instances`, `check_achievements`. Use `supabase start` for a local Postgres + run Edge Functions against it. Verify ledger correctness, idempotency, RLS boundary enforcement.
- **RLS policy tests** — explicit tests: "User A from Family 1 cannot read/write Family 2 data." Security backbone.
- **E2E (Maestro or Detox)** — critical happy paths only: onboarding → create chore → kid completes → parent approves → ⭐ shows up. Don't try to E2E everything.
- **Manual playtest** — pre-release, run through the app as a parent and as a 6-year-old (or stand-in). The "feels like a game" claim is not testable by code; it must be played.

---

## 9. MVP scope and milestones

### 9.1 In scope for v1.0 (App Store launch)

- Family creation, parent auth (email/password + Apple + Google)
- Co-parent invite (1 free; gate >2 parents)
- Kid profiles (8 preset avatars, optional PIN)
- Chores: one-off + daily / weekly / specific-days recurrence
- Three verification modes per chore (auto / photo / approval)
- Rewards catalog (parent-defined)
- Redemptions flow (request → approve/deny → fulfill)
- Star ledger + balance display
- Streaks
- Achievements (predefined catalog of ~15 badges)
- Family co-op goals (1 active free / unlimited Pro)
- Family leaderboard (this week + all time)
- Push notifications (full table from §7.1)
- Realtime in-app updates (confetti, ⭐ animations, sounds, haptics)
- Subscription via RevenueCat (monthly + yearly + 7-day trial)
- Activity feed (last 30 days free / unlimited Pro)
- Onboarding with seed chores/rewards
- Quiet hours; per-parent notification mute settings

### 9.2 Out of MVP (v2+)

- Custom avatars / unlock economy
- Quests / daily challenges
- Levels / XP
- Per-kid sign-in (older kids with their own logins)
- Cross-household / divorced parents
- Chore rotation logic
- Free-form redemption requests
- Web companion
- Apple/Google Family integration
- Localization beyond English (i18n scaffolding in place; ship en only for v1)
- Photo content moderation

### 9.3 Milestones

| Milestone | Scope | Estimate |
|-----------|-------|----------|
| **M1 — Foundations** | Expo skeleton, Supabase project, schema + RLS, auth (email + Apple + Google), family creation, profile creation | ~2 weeks |
| **M2 — Core chore loop** | Chore CRUD, recurrence engine + cron, chore instances, kid mode UI, complete-chore flow (all 3 verification modes), photo upload | ~3 weeks |
| **M3 — Approvals & ledger** | Approval queue, `approve_chore` Edge Function with ledger + streak update, realtime broadcasts, push notifications | ~2 weeks |
| **M4 — Rewards & redemptions** | Rewards catalog CRUD, redemption flow, balance display | ~1.5 weeks |
| **M5 — Gamification polish** | Achievements engine, leaderboard, family goals, juicy feedback (confetti / sounds / haptics), onboarding | ~2 weeks |
| **M6 — Subscription + paywall** | RevenueCat integration, feature gates (client + RLS + Edge Functions), paywall screen | ~1.5 weeks |
| **M7 — Pre-launch** | Settings, quiet hours, mute, activity feed, error states, accessibility pass, App Store assets, privacy policy, App Review prep | ~2 weeks |
| **M8 — Beta + Ship** | TestFlight + Google Play closed beta with 5–10 real families, fix what breaks, submit for review | ~2 weeks |

**Total: ~16 weeks (~4 months)** focused full-time work for one developer. Realistic plan: **5–6 months** with buffer for first-time stack overhead and unknowns. Beta with 5–10 real families before public launch is non-negotiable.

---

## 10. Open questions / assumptions to revisit

These are deliberately deferred but worth flagging:

- **Family-local timezone for recurrence cron.** MVP uses UTC. May be acceptable; revisit after beta if families complain.
- **Kid-targeted push notifications.** MVP delivers them to parent devices since kids don't have logins. May want a "kid device pairing" flow before launch if beta families ask for it.
- **Photo retention policy.** Storage costs scale with photo count. Reasonable default: keep approved photos for 30 days, then delete. To be confirmed before launch.
- **Star ledger compaction.** After ~years of use, `star_ledger` rows could grow large. Not a concern for MVP/v1; may need a periodic snapshot strategy at scale.
- **Account / family deletion.** Required by App Store as of 2024 — must be implementable in the app. Scope for M7.
- **Content assets to define during planning.** The exact set of 8 preset avatars (illustrations), the predefined ~15 achievement/badge catalog (keys, copy, unlock conditions), and the reward icon enum need to be enumerated before implementation. Listed here so they aren't lost.

---

**End of spec.**
