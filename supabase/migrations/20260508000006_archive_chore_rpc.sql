create or replace function public.archive_chore(chore_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare caller_family uuid; target_family uuid;
begin
  select profiles.family_id into caller_family
  from public.profiles where user_id = auth.uid() and type = 'parent';
  if caller_family is null then raise exception 'caller is not a parent'; end if;

  select c.family_id into target_family from public.chores c where c.id = archive_chore.chore_id;
  if target_family is null or target_family <> caller_family then
    raise exception 'chore % not in caller family', chore_id;
  end if;

  update public.chores set active = false, next_due_at = null where id = archive_chore.chore_id;
end;
$$;
