create or replace function public.next_occurrence(rec jsonb, after timestamptz)
  returns timestamptz
  language plpgsql immutable
as $$
declare
  rtype text := rec->>'type';
  due_str text;
  due_ts timestamptz;
  i int;
  d int;
  candidate timestamptz;
begin
  if rtype = 'once' then
    due_str := rec->>'due';
    if due_str is null then
      raise exception 'recurrence type=once requires "due"';
    end if;
    due_ts := (due_str::date)::timestamptz;
    if due_ts > after then
      return due_ts;
    else
      return null;
    end if;

  elsif rtype = 'daily' then
    return ((after::date) + interval '1 day')::timestamptz;

  elsif rtype = 'weekly' then
    if jsonb_array_length(coalesce(rec->'days', '[]'::jsonb)) = 0 then
      raise exception 'recurrence type=weekly requires non-empty "days"';
    end if;
    for i in 1..7 loop
      candidate := ((after::date) + (i || ' days')::interval)::timestamptz;
      d := extract(dow from candidate)::int;
      if exists (select 1 from jsonb_array_elements_text(rec->'days') x where x.value::int = d) then
        return candidate;
      end if;
    end loop;
    raise exception 'next_occurrence: no matching weekday found in 7-day search (impossible)';

  else
    raise exception 'unknown recurrence type: %', rtype;
  end if;
end;
$$;
