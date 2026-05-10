begin;
select plan(4);

insert into auth.users(id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.com');
insert into public.families(id, name) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Family A');
insert into public.profiles(id, family_id, type, display_name, avatar_id, user_id) values
  ('a1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'parent', 'Alice', 1, '11111111-1111-1111-1111-111111111111'),
  ('a2222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'kid',    'Sara',  2, null);
insert into public.rewards(id, family_id, title, star_cost, icon_id, created_by) values
  ('aaa11111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Ice Cream', 50, 2, 'a1111111-1111-1111-1111-111111111111');
-- One approved redemption ready to fulfill, one still pending.
insert into public.redemptions(id, family_id, reward_id, kid_profile_id, star_cost_snapshot, status, resolved_by, resolved_at) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaa11111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222', 50, 'approved', 'a1111111-1111-1111-1111-111111111111', now()),
  ('22222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaa11111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222', 50, 'pending', null, null);

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- 1-2. Happy path.
select lives_ok(
  $$ select public.fulfill_redemption('11111111-1111-1111-1111-111111111111') $$,
  'fulfill_redemption succeeds on approved'
);
select is(
  (select status from public.redemptions where id = '11111111-1111-1111-1111-111111111111'),
  'fulfilled', 'status fulfilled'
);

-- 3. Idempotency.
select lives_ok(
  $$ select public.fulfill_redemption('11111111-1111-1111-1111-111111111111') $$,
  'idempotent re-call'
);

-- 4. Cannot fulfill a pending redemption.
prepare fulfill_pending as select public.fulfill_redemption('22222222-2222-2222-2222-222222222222');
select throws_ok('fulfill_pending', null, null, 'fulfill on pending raises');

select * from finish();
rollback;
