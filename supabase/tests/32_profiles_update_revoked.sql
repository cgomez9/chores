begin;
select plan(2);

insert into auth.users(id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.com'),
  ('22222222-2222-2222-2222-222222222222', 'b@test.com');
insert into public.families(id, name) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Family A');
insert into public.profiles(id, family_id, type, display_name, avatar_id, user_id) values
  ('a1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'parent', 'Alice', 1, '11111111-1111-1111-1111-111111111111'),
  ('a2222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'parent', 'Alice2', 2, '22222222-2222-2222-2222-222222222222');

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

prepare hack as update public.profiles set type = 'kid' where id = 'a2222222-2222-2222-2222-222222222222';
select lives_ok('hack', 'UPDATE call does not error (RLS just affects 0 rows now)');

reset role;
select is(
  (select type::text from public.profiles where id = 'a2222222-2222-2222-2222-222222222222'),
  'parent', 'Alice2 is still a parent (no policy permits UPDATE)'
);

select * from finish();
rollback;
