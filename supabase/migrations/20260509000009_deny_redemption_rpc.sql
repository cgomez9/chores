create or replace function public.deny_redemption(redemption_id uuid, parent_note text default '')
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  caller_profile uuid;
  caller_family  uuid;
  red            public.redemptions%rowtype;
begin
  select id, profiles.family_id into caller_profile, caller_family
  from public.profiles where user_id = auth.uid() and type = 'parent';
  if caller_profile is null then raise exception 'caller is not a parent'; end if;

  select * into red from public.redemptions where id = redemption_id for update;
  if red.id is null then raise exception 'redemption % not found', redemption_id; end if;
  if red.family_id <> caller_family then raise exception 'redemption % not in caller family', redemption_id; end if;
  if red.status = 'denied' then return; end if;
  if red.status <> 'pending' then raise exception 'redemption % is not pending (status=%)', redemption_id, red.status; end if;

  update public.redemptions
    set status='denied', resolved_by=caller_profile, resolved_at=now(),
        parent_note=coalesce(deny_redemption.parent_note, '')
    where id = redemption_id;
end;
$$;
