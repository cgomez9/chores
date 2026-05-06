begin;
select plan(4);

-- Setup: two auth users, two families, two parent profiles.
insert into auth.users(id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.com'),
  ('22222222-2222-2222-2222-222222222222', 'b@test.com');

insert into public.families(id, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Family A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Family B');

insert into public.profiles(family_id, type, display_name, avatar_id, user_id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'parent', 'Alice', 1, '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'parent', 'Bob',   1, '22222222-2222-2222-2222-222222222222');

-- Impersonate Alice (Family A).
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- 1. Alice can read Family A.
select results_eq(
  $$ select name from public.families where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  $$ values ('Family A') $$,
  'Alice can read Family A'
);

-- 2. Alice cannot read Family B (RLS hides the row).
select is_empty(
  $$ select * from public.families where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' $$,
  'Alice cannot read Family B (RLS hides it)'
);

-- 3. Alice cannot update Family B.
prepare attempt_update as
  update public.families set name = 'HACKED' where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
select lives_ok('attempt_update', 'Update against Family B does not error (RLS just affects 0 rows)');

-- Verify Family B is unchanged. Switch role to bypass RLS for verification.
reset role;
select results_eq(
  $$ select name from public.families where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' $$,
  $$ values ('Family B') $$,
  'Family B name is unchanged after Alice attempted to update it'
);

select * from finish();
rollback;
