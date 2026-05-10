begin;
select plan(5);

insert into auth.users(id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.com');
insert into public.families(id, name) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Family A');
insert into public.profiles(id, family_id, type, display_name, avatar_id, user_id) values
  ('a1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'parent', 'Alice', 1, '11111111-1111-1111-1111-111111111111'),
  ('a2222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'kid',    'Sara',  2, null);
insert into public.rewards(id, family_id, title, star_cost, icon_id, created_by) values
  ('aaa11111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Ice Cream', 50, 2, 'a1111111-1111-1111-1111-111111111111');
insert into public.redemptions(id, family_id, reward_id, kid_profile_id, star_cost_snapshot) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaa11111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222', 50),
  ('22222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaa11111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222', 50);

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- 1-3. Deny with reason.
select lives_ok(
  $$ select public.deny_redemption('11111111-1111-1111-1111-111111111111', 'not before homework') $$,
  'deny with reason succeeds'
);
select is((select status from public.redemptions where id = '11111111-1111-1111-1111-111111111111'), 'denied', 'status denied');
select is((select parent_note from public.redemptions where id = '11111111-1111-1111-1111-111111111111'), 'not before homework', 'reason recorded');

-- 4-5. Deny without reason.
select lives_ok(
  $$ select public.deny_redemption('22222222-2222-2222-2222-222222222222') $$,
  'deny without reason succeeds'
);
select is((select parent_note from public.redemptions where id = '22222222-2222-2222-2222-222222222222'), '', 'empty reason recorded');

select * from finish();
rollback;
