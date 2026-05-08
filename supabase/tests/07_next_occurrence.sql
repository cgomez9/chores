begin;
select plan(8);

select is(
  public.next_occurrence('{"type":"once","due":"2099-01-15"}'::jsonb, '2026-05-08T00:00:00Z'::timestamptz)::date,
  '2099-01-15'::date,
  'once: future date returned'
);

select is(
  public.next_occurrence('{"type":"once","due":"2020-01-01"}'::jsonb, '2026-05-08T00:00:00Z'::timestamptz),
  null::timestamptz,
  'once: past date returns null'
);

select is(
  public.next_occurrence('{"type":"daily"}'::jsonb, '2026-05-08T15:30:00Z'::timestamptz)::date,
  '2026-05-09'::date,
  'daily: next day'
);

select is(
  public.next_occurrence('{"type":"weekly","days":[1]}'::jsonb, '2026-05-08T12:00:00Z'::timestamptz)::date,
  '2026-05-11'::date,
  'weekly: Mon-only after Fri'
);

select is(
  public.next_occurrence('{"type":"weekly","days":[5]}'::jsonb, '2026-05-08T12:00:00Z'::timestamptz)::date,
  '2026-05-15'::date,
  'weekly: same-weekday returns next week'
);

select is(
  public.next_occurrence('{"type":"weekly","days":[1,3,5]}'::jsonb, '2026-05-08T12:00:00Z'::timestamptz)::date,
  '2026-05-11'::date,
  'weekly: M/W/F from Fri returns Mon'
);

prepare empty_days as select public.next_occurrence('{"type":"weekly","days":[]}'::jsonb, now());
select throws_ok('empty_days', null, null, 'weekly: empty days raises');

prepare bad_type as select public.next_occurrence('{"type":"yearly"}'::jsonb, now());
select throws_ok('bad_type', null, null, 'unknown type raises');

select * from finish();
rollback;
