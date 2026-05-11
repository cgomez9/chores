begin;
select plan(2);

insert into auth.users(id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.com');
insert into public.families(id, name) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Family A');
insert into public.profiles(id, family_id, type, display_name, avatar_id, user_id) values
  ('a1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'parent', 'Alice', 1, '11111111-1111-1111-1111-111111111111'),
  ('a2222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'kid',    'Sara',  2, null);
insert into public.rewards(id, family_id, title, star_cost, icon_id, created_by) values
  ('aaa11111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Ice Cream', 10, 2, 'a1111111-1111-1111-1111-111111111111');
insert into public.redemptions(id, family_id, reward_id, kid_profile_id, star_cost_snapshot, status, resolved_by, resolved_at) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaa11111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222', 10, 'approved', 'a1111111-1111-1111-1111-111111111111', now());

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select lives_ok(
  $$ select public.fulfill_redemption('11111111-1111-1111-1111-111111111111') $$,
  'fulfill_redemption succeeds'
);

set local role postgres;
select is(
  (select count(*)::int from public.achievements
    where profile_id = 'a2222222-2222-2222-2222-222222222222' and achievement_key = 'first_reward'),
  1, 'first_reward achievement created by fulfill_redemption'
);

select * from finish();
rollback;
