create or replace function public.accept_invite(
  code         text,
  display_name text,
  avatar_id    smallint
) returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  caller_user_id uuid := auth.uid();
  inv            public.family_invites%rowtype;
  new_profile_id uuid;
begin
  if caller_user_id is null then raise exception 'must be authenticated'; end if;

  if exists (select 1 from public.profiles where user_id = caller_user_id and type = 'parent') then
    raise exception 'already a parent in another family';
  end if;

  select * into inv from public.family_invites where family_invites.code = accept_invite.code for update;
  if inv.id is null then raise exception 'invite not found'; end if;
  if now() > inv.expires_at then raise exception 'invite expired'; end if;
  if inv.used_by is not null then raise exception 'invite already used'; end if;

  insert into public.profiles(family_id, type, display_name, avatar_id, user_id)
  values (inv.family_id, 'parent', accept_invite.display_name, accept_invite.avatar_id, caller_user_id)
  returning id into new_profile_id;

  update public.family_invites
    set used_by = new_profile_id, used_at = now()
    where id = inv.id;

  return new_profile_id;
end;
$$;
