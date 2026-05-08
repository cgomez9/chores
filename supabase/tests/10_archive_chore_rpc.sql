begin;
select plan(3);

insert into auth.users(id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.com'),
  ('22222222-2222-2222-2222-222222222222', 'b@test.com');
insert into public.families(id, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Family A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Family B');
insert into public.profiles(id, family_id, type, display_name, avatar_id, user_id) values
  ('a1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'parent', 'Alice', 1, '11111111-1111-1111-1111-111111111111'),
  ('b2222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'parent', 'Bob',   1, '22222222-2222-2222-2222-222222222222');
insert into public.chores(id, family_id, title, star_value, verification_mode, recurrence, created_by, next_due_at) values
  ('c1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'X', 10, 'approval', '{"type":"daily"}'::jsonb, 'a1111111-1111-1111-1111-111111111111', now() + interval '1 day');

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select lives_ok(
  $$ select public.archive_chore('c1111111-1111-1111-1111-111111111111') $$,
  'archive_chore succeeds for parent of family'
);
select is((select active from public.chores where id = 'c1111111-1111-1111-1111-111111111111'), false, 'active is false');
select is((select next_due_at from public.chores where id = 'c1111111-1111-1111-1111-111111111111'), null::timestamptz, 'next_due_at cleared');

select * from finish();
rollback;
