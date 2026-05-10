create or replace function public.update_reward(
  reward_id   uuid,
  title       text default null,
  description text default null,
  star_cost   int  default null,
  icon_id     smallint default null
) returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  caller_family uuid;
  target_family uuid;
begin
  select profiles.family_id into caller_family
  from public.profiles where user_id = auth.uid() and type = 'parent';
  if caller_family is null then raise exception 'caller is not a parent'; end if;

  select r.family_id into target_family from public.rewards r where r.id = reward_id;
  if target_family is null or target_family <> caller_family then
    raise exception 'reward % not in caller family', reward_id;
  end if;

  update public.rewards set
    title       = coalesce(update_reward.title, rewards.title),
    description = coalesce(update_reward.description, rewards.description),
    star_cost   = coalesce(update_reward.star_cost, rewards.star_cost),
    icon_id     = coalesce(update_reward.icon_id, rewards.icon_id)
  where id = reward_id;
end;
$$;
