begin;
select plan(2);

insert into auth.users(id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.com'),
  ('22222222-2222-2222-2222-222222222222', 'b@test.com');
insert into public.families(id, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Family A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Family B');
insert into public.profiles(id, family_id, type, display_name, avatar_id, user_id) values
  ('a1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'parent', 'Alice', 1, '11111111-1111-1111-1111-111111111111'),
  ('a2222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'kid',    'Sara',  2, null),
  ('b2222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'parent', 'Bob',   1, '22222222-2222-2222-2222-222222222222'),
  ('b9999999-9999-9999-9999-999999999999', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'kid',    'Otto',  3, null);
insert into public.rewards(id, family_id, title, star_cost, icon_id, created_by) values
  ('aaa11111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'A-rew', 50, 2, 'a1111111-1111-1111-1111-111111111111'),
  ('bbb11111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'B-rew', 50, 2, 'b2222222-2222-2222-2222-222222222222');
insert into public.redemptions(family_id, reward_id, kid_profile_id, star_cost_snapshot) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaa11111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222', 50),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbb11111-1111-1111-1111-111111111111', 'b9999999-9999-9999-9999-999999999999', 50);

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is(
  (select count(*)::int from public.redemptions), 1,
  'Alice sees only her family''s redemption'
);

select is_empty(
  $$ select * from public.redemptions where family_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' $$,
  'Alice cannot see Family B redemptions'
);

select * from finish();
rollback;
