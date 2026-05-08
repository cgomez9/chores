create or replace function public.update_chore(
  chore_id            uuid,
  title               text default null,
  description         text default null,
  star_value          int  default null,
  assignee_profile_id uuid default null,
  clear_assignee      boolean default false,
  verification_mode   text default null,
  recurrence          jsonb default null
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
  from public.profiles
  where user_id = auth.uid() and type = 'parent';
  if caller_family is null then
    raise exception 'caller is not a parent';
  end if;

  select c.family_id into target_family from public.chores c where c.id = chore_id;
  if target_family is null or target_family <> caller_family then
    raise exception 'chore % not in caller family', chore_id;
  end if;

  if assignee_profile_id is not null and not exists (
    select 1 from public.profiles
    where id = assignee_profile_id and profiles.family_id = caller_family
  ) then
    raise exception 'assignee % not in family', assignee_profile_id;
  end if;

  if recurrence is not null then
    perform public.next_occurrence(recurrence, now());
  end if;

  update public.chores set
    title             = coalesce(update_chore.title, chores.title),
    description       = coalesce(update_chore.description, chores.description),
    star_value        = coalesce(update_chore.star_value, chores.star_value),
    assignee_profile_id =
      case when clear_assignee then null
           when update_chore.assignee_profile_id is not null then update_chore.assignee_profile_id
           else chores.assignee_profile_id end,
    verification_mode = coalesce(update_chore.verification_mode, chores.verification_mode),
    recurrence        = coalesce(update_chore.recurrence, chores.recurrence),
    next_due_at       =
      case when update_chore.recurrence is not null
           then public.next_occurrence(update_chore.recurrence, now() - interval '1 second')
           else chores.next_due_at end
  where id = chore_id;
end;
$$;
