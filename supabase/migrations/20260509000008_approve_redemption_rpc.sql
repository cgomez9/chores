create or replace function public.approve_redemption(redemption_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  caller_profile uuid;
  caller_family  uuid;
  red            public.redemptions%rowtype;
  balance        int;
begin
  select id, profiles.family_id into caller_profile, caller_family
  from public.profiles where user_id = auth.uid() and type = 'parent';
  if caller_profile is null then raise exception 'caller is not a parent'; end if;

  select * into red from public.redemptions where id = redemption_id for update;
  if red.id is null then raise exception 'redemption % not found', redemption_id; end if;
  if red.family_id <> caller_family then raise exception 'redemption % not in caller family', redemption_id; end if;
  if red.status = 'approved' then return; end if;
  if red.status <> 'pending' then raise exception 'redemption % is not pending (status=%)', redemption_id, red.status; end if;

  -- Defense-in-depth: re-check balance against current ledger.
  select coalesce(sum(delta), 0)::int into balance
  from public.star_ledger where profile_id = red.kid_profile_id;
  if balance < red.star_cost_snapshot then
    raise exception 'insufficient stars at approve time (balance=%, cost=%)', balance, red.star_cost_snapshot;
  end if;

  update public.redemptions
    set status='approved', resolved_by=caller_profile, resolved_at=now()
    where id = redemption_id;

  insert into public.star_ledger(family_id, profile_id, delta, reason, source_id)
  values (red.family_id, red.kid_profile_id, -red.star_cost_snapshot, 'redemption', redemption_id);
end;
$$;
