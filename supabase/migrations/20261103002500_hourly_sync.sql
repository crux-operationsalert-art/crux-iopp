-- Hourly server-side refresh of misses and to-dos (missed reports, uncertified teams, missing collections, onboarding, salary, rates),
-- so reminders appear even if nobody opens the app. Skipped where pg_cron is unavailable (local tests).
do $do$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron not available: %', sqlerrm; return;
  end;
  perform cron.schedule('iopp-sync-tasks', '7 * * * *', 'select app.sync_all()');
end $do$;
