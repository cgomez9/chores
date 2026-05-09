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
