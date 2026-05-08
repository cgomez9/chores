create table public.chore_instances (
  id                  uuid primary key default gen_random_uuid(),
  chore_id            uuid not null references public.chores(id) on delete cascade,
  family_id           uuid not null references public.families(id) on delete cascade,
  assignee_profile_id uuid references public.profiles(id),
  due_at              timestamptz not null,
  status              text not null default 'pending'
                       check (status in ('pending','submitted','approved','rejected')),
  completed_by        uuid references public.profiles(id),
  completed_at        timestamptz,
  photo_url           text,
  approved_by         uuid references public.profiles(id),
  approved_at         timestamptz,
  rejection_reason    text,
  stars_awarded       int,
  unique (chore_id, due_at)
);

create index chore_instances_family_status_idx on public.chore_instances(family_id, status);
create index chore_instances_open_assignee_idx on public.chore_instances(assignee_profile_id, due_at)
  where status in ('pending','submitted');

alter table public.chore_instances enable row level security;

create policy chore_instances_select_own_family on public.chore_instances
  for select using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.type = 'parent' and p.family_id = chore_instances.family_id)
  );

create policy chore_instances_update_own_family on public.chore_instances
  for update using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.type = 'parent' and p.family_id = chore_instances.family_id)
  ) with check (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.type = 'parent' and p.family_id = chore_instances.family_id)
  );
-- No INSERT policy: instances are inserted by the generate_chore_instances Edge Function (service role).
-- No DELETE policy: chore_instances are append-only.
