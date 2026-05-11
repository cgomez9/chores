begin;
select plan(7);

insert into auth.users(id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.com'),
  ('22222222-2222-2222-2222-222222222222', 'b@test.com'),
  ('33333333-3333-3333-3333-333333333333', 'c@test.com');
insert into public.families(id, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Family A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Family B');
insert into public.profiles(id, family_id, type, display_name, avatar_id, user_id) values
  ('a1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'parent', 'Alice', 1, '11111111-1111-1111-1111-111111111111'),
  ('b2222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'parent', 'Bob',   1, '22222222-2222-2222-2222-222222222222');

insert into public.family_invites(id, family_id, code, created_by, expires_at) values
  ('111aaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '100100', 'a1111111-1111-1111-1111-111111111111', now() + interval '1 day'),
  ('222aaaaa-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '200200', 'a1111111-1111-1111-1111-111111111111', now() - interval '1 hour'),
  ('333aaaaa-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '300300', 'a1111111-1111-1111-1111-111111111111', now() + interval '1 day');

-- Mark the third invite as already used.
update public.family_invites set used_by = 'b2222222-2222-2222-2222-222222222222', used_at = now()
  where id = '333aaaaa-3333-3333-3333-333333333333';

-- 1. Happy path: Carlos accepts a valid code.
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select isnt(
  public.accept_invite('100100', 'Carl', 1::smallint),
  null,
  'accept_invite returns new profile id'
);

-- 2. Profile actually inserted into Family A.
set local role postgres;
select is(
  (select count(*)::int from public.profiles
    where user_id = '33333333-3333-3333-3333-333333333333' and family_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1, 'Carl is now a parent in Family A'
);

-- 3. Invite marked used.
select isnt(
  (select used_by from public.family_invites where id = '111aaaaa-1111-1111-1111-111111111111'),
  null, 'invite used_by populated'
);

-- 4. Already-a-parent guard: re-accepting another code fails.
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
prepare already_parent as select public.accept_invite('200200', 'Carl2', 1::smallint);
select throws_ok('already_parent', null, null, 'cannot accept twice');

-- 5. Bob (already a parent in Family B) cannot accept Family A's code.
set local role postgres;
-- Clear used_by references before deleting Carl's profile to avoid FK violation.
update public.family_invites set used_by = null, used_at = null
  where used_by in (select id from public.profiles where user_id = '33333333-3333-3333-3333-333333333333');
delete from public.profiles where user_id = '33333333-3333-3333-3333-333333333333';
insert into public.family_invites(family_id, code, created_by, expires_at) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '400400', 'a1111111-1111-1111-1111-111111111111', now() + interval '1 day');
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
prepare bob_accept as select public.accept_invite('400400', 'Bob2', 1::smallint);
select throws_ok('bob_accept', null, null, 'parent in another family cannot accept');

-- 6. Expired invite raises (user with no existing profile).
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
prepare expired as select public.accept_invite('200200', 'Carl3', 1::smallint);
select throws_ok('expired', null, null, 'expired invite raises');

-- 7. Already-used invite raises.
prepare used as select public.accept_invite('300300', 'Carl4', 1::smallint);
select throws_ok('used', null, null, 'already-used invite raises');

select * from finish();
rollback;
