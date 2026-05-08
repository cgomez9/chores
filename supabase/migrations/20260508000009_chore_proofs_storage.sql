-- supabase/migrations/20260508000009_chore_proofs_storage.sql
insert into storage.buckets (id, name, public) values ('chore-proofs', 'chore-proofs', false)
  on conflict (id) do nothing;

-- Path convention: family/{family_id}/chore-proofs/{instance_id}.jpg
-- storage.foldername(name) returns the directory parts as an array;
-- index 1 = 'family', 2 = the family_id text.

create policy "chore_proofs_insert_own_family" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chore-proofs'
    and (storage.foldername(name))[1] = 'family'
    and exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid()
        and p.type = 'parent'
        and p.family_id::text = (storage.foldername(name))[2]
    )
  );

create policy "chore_proofs_select_own_family" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chore-proofs'
    and (storage.foldername(name))[1] = 'family'
    and exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid()
        and p.type = 'parent'
        and p.family_id::text = (storage.foldername(name))[2]
    )
  );
