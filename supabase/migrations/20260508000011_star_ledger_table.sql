create table public.star_ledger (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  delta       int  not null,
  reason      text not null check (reason in
               ('chore_approved','redemption','manual_grant','manual_revoke')),
  source_id   uuid,
  created_at  timestamptz not null default now()
);

create index star_ledger_profile_idx on public.star_ledger(profile_id);
create index star_ledger_family_recent_idx on public.star_ledger(family_id, created_at desc);

alter table public.star_ledger enable row level security;

create policy star_ledger_select_own_family on public.star_ledger
  for select using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.type = 'parent' and p.family_id = star_ledger.family_id)
  );
-- No INSERT/UPDATE/DELETE policies. Mutations only via approve_chore (security definer).
-- Append-only is enforced by absence of UPDATE/DELETE.
