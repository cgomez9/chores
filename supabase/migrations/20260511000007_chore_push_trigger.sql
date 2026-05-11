create or replace function public.notify_push_chore() returns trigger
  language plpgsql security definer as $$
declare event_kind text;
begin
  if OLD.status = 'pending' and NEW.status = 'submitted' then
    event_kind := 'chore_submitted';
  elsif NEW.status = 'approved' and OLD.status <> 'approved' then
    event_kind := 'chore_approved';
  elsif NEW.status = 'rejected' and OLD.status <> 'rejected' then
    event_kind := 'chore_rejected';
  else
    return NEW;
  end if;

  begin
    perform net.http_post(
      url := current_setting('app.settings.functions_base_url', true) || '/send_push',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
        'Content-Type',  'application/json'
      ),
      body := jsonb_build_object(
        'event', event_kind,
        'family_id', NEW.family_id,
        'instance_id', NEW.id,
        'kid_profile_id', NEW.completed_by
      )
    );
  exception when others then
    null; -- silently swallow errors when functions_base_url is unset
  end;
  return NEW;
end;
$$;

create trigger chore_instances_push_trigger
  after update on public.chore_instances
  for each row execute function notify_push_chore();
