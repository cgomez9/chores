create or replace function public.current_streak(p uuid)
  returns int
  language sql
  stable
as $$
  select coalesce(
    (select case
       when last_completion_date is null then 0
       when last_completion_date < (current_date - 1) then 0
       else current_count
     end
     from public.streaks where profile_id = p),
    0
  );
$$;
