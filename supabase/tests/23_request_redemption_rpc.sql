begin;
select plan(6);

insert into auth.users(id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.com');
insert into public.families(id, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Family A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Family B');
insert into public.profiles(id, family_id, type, display_name, avatar_id, user_id) values
  ('a1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'parent', 'Alice', 1, '11111111-1111-1111-1111-111111111111'),
  ('a2222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'kid',    'Sara',  2, null),
  ('b9999999-9999-9999-9999-999999999999', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'kid',    'Otto',  3, null);
insert into public.rewards(id, family_id, title, star_cost, icon_id, active, created_by) values
  ('aaa11111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Ice Cream', 50, 2, true,  'a1111111-1111-1111-1111-111111111111'),
  ('aaa22222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Archived',  10, 2, false, 'a1111111-1111-1111-1111-111111111111');

-- give Sara a starting balance of 60 stars
insert into public.star_ledger(family_id, profile_id, delta, reason) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a2222222-2222-2222-2222-222222222222', 60, 'manual_grant');

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- 1. Happy path returns id.
select isnt(
  public.request_redemption('aaa11111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222'),
  null,
  'request_redemption returns id on happy path'
);

-- 2. Snapshot captured at request time.
select is(
  (select star_cost_snapshot from public.redemptions where kid_profile_id = 'a2222222-2222-2222-2222-222222222222' limit 1),
  50, 'star_cost_snapshot captured'
);

-- 3. Insufficient balance raises (Sara has 60 - 50 already pending = 10? No, request doesn't deduct.
-- Sara has 60. Add a 200-cost reward and try.
insert into public.rewards(id, family_id, title, star_cost, icon_id, created_by) values
  ('aaa33333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Cash', 200, 4, 'a1111111-1111-1111-1111-111111111111');
prepare too_expensive as select public.request_redemption(
  'aaa33333-3333-3333-3333-333333333333', 'a2222222-2222-2222-2222-222222222222');
select throws_ok('too_expensive', null, null, 'insufficient balance raises');

-- 4. Archived reward raises.
prepare archived as select public.request_redemption(
  'aaa22222-2222-2222-2222-222222222222', 'a2222222-2222-2222-2222-222222222222');
select throws_ok('archived', null, null, 'archived reward raises');

-- 5. Cross-family kid raises (Otto is in Family B).
prepare cross_kid as select public.request_redemption(
  'aaa11111-1111-1111-1111-111111111111', 'b9999999-9999-9999-9999-999999999999');
select throws_ok('cross_kid', null, null, 'kid not in family raises');

-- 6. Balance computation includes negative ledger entries.
-- star_ledger has no INSERT policy (writes only via SD RPCs); switch to postgres for setup.
set local role postgres;
insert into public.star_ledger(family_id, profile_id, delta, reason) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a2222222-2222-2222-2222-222222222222', -50, 'redemption');
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
-- Sara now has 60 - 50 = 10. Request a 50-cost reward — should raise.
prepare now_too_expensive as select public.request_redemption(
  'aaa11111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222');
select throws_ok('now_too_expensive', null, null, 'balance includes prior negative deltas');

select * from finish();
rollback;
