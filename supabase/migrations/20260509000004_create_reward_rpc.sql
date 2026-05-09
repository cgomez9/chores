create or replace function public.create_reward(
  family_id   uuid,
  title       text,
  description text,
  star_cost   int,
  icon_id     smallint
) returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  caller_profile uuid;
  new_id uuid;
begin
  select id into caller_profile
  from public.profiles
  where user_id = auth.uid() and type = 'parent' and profiles.family_id = create_reward.family_id;
  if caller_profile is null then
    raise exception 'caller is not a parent in family %', family_id;
  end if;

  insert into public.rewards(family_id, title, description, star_cost, icon_id, created_by)
  values (create_reward.family_id, create_reward.title, create_reward.description,
          create_reward.star_cost, create_reward.icon_id, caller_profile)
  returning id into new_id;

  return new_id;
end;
$$;
