begin;
select plan(8);

insert into auth.users(id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.com');
insert into public.families(id, name) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Family A');
insert into public.profiles(id, family_id, type, display_name, avatar_id, user_id) values
  ('a1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'parent', 'Alice', 1, '11111111-1111-1111-1111-111111111111'),
  ('a2222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'kid',    'Sara',  2, null);
insert into public.rewards(id, family_id, title, star_cost, icon_id, created_by) values
  ('aaa11111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Ice Cream', 50, 2, 'a1111111-1111-1111-1111-111111111111');
-- Sara has 60 stars.
insert into public.star_ledger(family_id, profile_id, delta, reason) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a2222222-2222-2222-2222-222222222222', 60, 'manual_grant');
-- Two pending redemptions: 50 each (total 100, exceeds balance).
insert into public.redemptions(id, family_id, reward_id, kid_profile_id, star_cost_snapshot) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaa11111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222', 50),
  ('22222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaa11111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222', 50);

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- 1-4. First approve happy path.
select lives_ok(
  $$ select public.approve_redemption('11111111-1111-1111-1111-111111111111') $$,
  'first approve succeeds'
);
select is(
  (select status from public.redemptions where id = '11111111-1111-1111-1111-111111111111'),
  'approved', 'status approved'
);
select isnt(
  (select resolved_at from public.redemptions where id = '11111111-1111-1111-1111-111111111111'),
  null, 'resolved_at is set'
);
select is(
  (select count(*)::int from public.star_ledger
    where source_id = '11111111-1111-1111-1111-111111111111' and reason = 'redemption' and delta = -50),
  1, 'one negative ledger row inserted'
);

-- 5-6. Idempotent re-call.
select lives_ok(
  $$ select public.approve_redemption('11111111-1111-1111-1111-111111111111') $$,
  'idempotent re-call'
);
select is(
  (select count(*)::int from public.star_ledger where source_id = '11111111-1111-1111-1111-111111111111'),
  1, 'still one ledger row'
);

-- 7. Defense-in-depth: second pending redemption now exceeds remaining balance (60 - 50 = 10 < 50).
prepare second_approve as select public.approve_redemption('22222222-2222-2222-2222-222222222222');
select throws_ok('second_approve', null, null, 'insufficient stars at approve time raises');

-- 8. Unchanged status on second.
select is(
  (select status from public.redemptions where id = '22222222-2222-2222-2222-222222222222'),
  'pending', 'second redemption still pending'
);

select * from finish();
rollback;
