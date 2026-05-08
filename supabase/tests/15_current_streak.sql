begin;
select plan(4);

insert into public.families(id, name) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Family A');
insert into public.profiles(id, family_id, type, display_name, avatar_id) values
  ('a2222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'kid', 'Sara', 2),
  ('a3333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'kid', 'Leo',  3),
  ('a4444444-4444-4444-4444-444444444444', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'kid', 'Mia',  4);

insert into public.streaks(profile_id, family_id, current_count, longest_count, last_completion_date) values
  ('a2222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 5, 7, current_date),
  ('a3333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 3, 3, current_date - interval '3 days'),
  ('a4444444-4444-4444-4444-444444444444', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 0, 0, null);

select is(public.current_streak('a2222222-2222-2222-2222-222222222222'), 5, 'Sara: today completed → returns current_count 5');
select is(public.current_streak('a3333333-3333-3333-3333-333333333333'), 0, 'Leo: 3 days stale → returns 0');
select is(public.current_streak('a4444444-4444-4444-4444-444444444444'), 0, 'Mia: null last_completion_date → returns 0');
select is(public.current_streak('99999999-9999-9999-9999-999999999999'), 0, 'No row → returns 0');

select * from finish();
rollback;
