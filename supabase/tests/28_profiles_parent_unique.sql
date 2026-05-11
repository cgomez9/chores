begin;
select plan(2);

insert into auth.users(id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.com');
insert into public.families(id, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Family A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Family B');

insert into public.profiles(family_id, type, display_name, avatar_id, user_id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'parent', 'Alice', 1, '11111111-1111-1111-1111-111111111111');

select pass('first parent profile inserts cleanly');

prepare second_parent as
  insert into public.profiles(family_id, type, display_name, avatar_id, user_id)
  values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'parent', 'Alice2', 1, '11111111-1111-1111-1111-111111111111');
select throws_ok('second_parent', '23505', null, 'second parent profile for same user_id raises unique-violation');

select * from finish();
rollback;
