begin;
select plan(4);

insert into auth.users(id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.com'),
  ('22222222-2222-2222-2222-222222222222', 'b@test.com');
insert into public.families(id, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Family A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Family B');
insert into public.profiles(id, family_id, type, display_name, avatar_id, user_id) values
  ('a1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'parent', 'Alice', 1, '11111111-1111-1111-1111-111111111111'),
  ('b2222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'parent', 'Bob',   1, '22222222-2222-2222-2222-222222222222');
insert into public.chores(id, family_id, title, star_value, verification_mode, recurrence, created_by) values
  ('c1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Make bed', 10, 'approval', '{"type":"daily"}'::jsonb, 'a1111111-1111-1111-1111-111111111111');

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select lives_ok(
  $$ select public.update_chore(chore_id := 'c1111111-1111-1111-1111-111111111111', title := 'Tidy bed') $$,
  'update_chore patches title'
);
select is((select title from public.chores where id = 'c1111111-1111-1111-1111-111111111111'), 'Tidy bed', 'title was updated');

select lives_ok(
  $$ select public.update_chore(chore_id := 'c1111111-1111-1111-1111-111111111111', recurrence := '{"type":"weekly","days":[1]}'::jsonb) $$,
  'update_chore patches recurrence'
);

set local "request.jwt.claims" to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
prepare cross_update as select public.update_chore(chore_id := 'c1111111-1111-1111-1111-111111111111', title := 'HACKED');
select throws_ok('cross_update', null, null, 'Bob cannot update Family A chore');

select * from finish();
rollback;
