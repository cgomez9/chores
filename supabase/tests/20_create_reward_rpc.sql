begin;
select plan(3);

insert into auth.users(id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.com');
insert into public.families(id, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Family A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Family B');
insert into public.profiles(id, family_id, type, display_name, avatar_id, user_id) values
  ('a1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'parent', 'Alice', 1, '11111111-1111-1111-1111-111111111111');

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select isnt(
  public.create_reward('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Ice Cream', null, 50, 2::smallint),
  null,
  'create_reward returns id on happy path'
);

prepare cross_family as select public.create_reward(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Stolen', null, 50, 2::smallint);
select throws_ok('cross_family', null, null, 'cannot create reward in another family');

prepare bad_icon as select public.create_reward(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Bad Icon', null, 50, 99::smallint);
select throws_ok('bad_icon', null, null, 'icon_id check rejects 99');

select * from finish();
rollback;
