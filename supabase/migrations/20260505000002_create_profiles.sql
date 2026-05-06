-- profiles: both parents and kids. Parents have a user_id (auth.users); kids do not.
create type public.profile_type as enum ('parent', 'kid');

create table public.profiles (
  id              uuid primary key default gen_random_uuid(),
  family_id       uuid not null references public.families(id) on delete cascade,
  type            public.profile_type not null,
  display_name    text not null check (char_length(display_name) between 1 and 40),
  avatar_id       smallint not null check (avatar_id between 1 and 8),
  pin_hash        text,
  user_id         uuid references auth.users(id) on delete set null,
  push_token      text,
  created_at      timestamptz not null default now(),

  -- A user_id (parent) belongs to exactly one profile per family.
  constraint profiles_one_parent_per_family unique (family_id, user_id),
  -- Parents must have a user_id; kids must not.
  constraint profiles_parent_has_user check (
    (type = 'parent' and user_id is not null) or
    (type = 'kid' and user_id is null)
  ),
  -- Pin only on kids.
  constraint profiles_pin_only_on_kids check (
    pin_hash is null or type = 'kid'
  )
);

create index profiles_family_id_idx on public.profiles(family_id);
create index profiles_user_id_idx on public.profiles(user_id) where user_id is not null;

comment on table public.profiles is 'Parents (auth-backed) and kids (profile-only) within a family.';
