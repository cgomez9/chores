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
