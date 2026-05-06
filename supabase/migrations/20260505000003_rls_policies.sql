-- Enable RLS on both tables (default deny).
alter table public.families enable row level security;
alter table public.profiles enable row level security;

-- Helper: which family does the calling auth.uid() belong to?
-- Returns the family_id of the parent profile, or null if none.
create or replace function public.current_family_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select family_id from public.profiles
  where user_id = auth.uid() and type = 'parent'
  limit 1
$$;

comment on function public.current_family_id is
  'Returns the family_id of the calling authenticated user (parent). Null if no profile.';

-- families: members can read their own family.
create policy families_select_own
  on public.families for select
  using (id = public.current_family_id());

-- families: only parents can update their own family. Insert is via RPC (Task 7).
create policy families_update_own
  on public.families for update
  using (id = public.current_family_id())
  with check (id = public.current_family_id());

-- profiles: members can read profiles in their own family.
create policy profiles_select_own_family
  on public.profiles for select
  using (family_id = public.current_family_id());

-- profiles: parents can update profiles in their family. Insert is via RPC (Task 8).
create policy profiles_update_own_family
  on public.profiles for update
  using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

-- profiles: parents can delete kid profiles in their family.
create policy profiles_delete_kid_in_own_family
  on public.profiles for delete
  using (
    family_id = public.current_family_id()
    and type = 'kid'
  );
