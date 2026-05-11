create unique index profiles_one_parent_per_user_idx
  on public.profiles(user_id)
  where type = 'parent';
