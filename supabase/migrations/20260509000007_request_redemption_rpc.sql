create or replace function public.request_redemption(reward_id uuid, kid_profile_id uuid)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  caller_family uuid;
  rew           public.rewards%rowtype;
  kid_family    uuid;
  kid_type      text;
  balance       int;
  new_id        uuid;
begin
  -- caller must be a parent
  select profiles.family_id into caller_family
  from public.profiles where user_id = auth.uid() and type = 'parent';
  if caller_family is null then raise exception 'caller is not a parent'; end if;

  -- kid must be a kid in same family
  select profiles.family_id, profiles.type into kid_family, kid_type
  from public.profiles where id = kid_profile_id;
  if kid_family is null or kid_family <> caller_family or kid_type <> 'kid' then
    raise exception 'kid_profile_id % not a kid in family', kid_profile_id;
  end if;

  -- reward must exist, be active, and be in same family
  select * into rew from public.rewards where id = reward_id for update;
  if rew.id is null or rew.family_id <> caller_family or not rew.active then
    raise exception 'reward % not available', reward_id;
  end if;

  -- balance check
  select coalesce(sum(delta), 0)::int into balance
  from public.star_ledger where profile_id = kid_profile_id;
  if balance < rew.star_cost then
    raise exception 'insufficient stars (balance=%, cost=%)', balance, rew.star_cost;
  end if;

  insert into public.redemptions(family_id, reward_id, kid_profile_id, star_cost_snapshot)
  values (caller_family, reward_id, kid_profile_id, rew.star_cost)
  returning id into new_id;

  return new_id;
end;
$$;
