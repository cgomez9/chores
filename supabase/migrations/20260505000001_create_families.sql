-- families: top-level tenant. Every parent and kid belongs to exactly one family.
create table public.families (
  id                       uuid primary key default gen_random_uuid(),
  name                     text not null check (char_length(name) between 1 and 80),
  subscription_tier        text not null default 'free' check (subscription_tier in ('free','pro')),
  subscription_expires_at  timestamptz,
  created_at               timestamptz not null default now()
);

comment on table public.families is 'A household. Owns all chores, profiles, rewards, etc.';
