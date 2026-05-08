-- supabase/migrations/20260508000010_chore_generator_cron.sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'generate_chore_instances_daily',
  '5 0 * * *',  -- 00:05 UTC every day
  $$
  select net.http_post(
    url := current_setting('app.settings.functions_base_url', true) || '/generate_chore_instances',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
      'Content-Type',  'application/json'
    ),
    body := '{}'::jsonb
  ) $$
);
