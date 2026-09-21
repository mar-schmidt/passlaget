-- Run once after deploying portal and configuring the two Vault values documented in docs/sportadmin.md.
-- No SportAdmin credentials belong in this file or in cron.job.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.schedule('passlaget-sportadmin-hourly', '17 * * * *', $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='passlaget_sportadmin_endpoint'),
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := jsonb_build_object('action','sportadmin_cron','workerSecret',
      (select decrypted_secret from vault.decrypted_secrets where name='passlaget_sportadmin_worker_secret')),
    timeout_milliseconds := 120000
  ) where exists(select 1 from vault.secrets where name='passlaget_sportadmin_worker_secret')
    and exists(select 1 from vault.secrets where name='passlaget_sportadmin_endpoint');
$job$);
