-- Restore an Admin backup (Admin → Backup → Download) into a NEW, empty CRUX IOPP database that already has every
-- migration applied. Run as the database owner:
--   1. psql "$DB" -f tools/restore_backup.sql
--   2. psql "$DB" -c "select restore_backup(pg_read_file('/path/backup.json')::jsonb)"   (or pass the JSON as a parameter)
-- Triggers and foreign keys are suspended while rows load (session_replication_role = replica) and then re-enabled.
create or replace function public.restore_backup(p jsonb) returns jsonb
language plpgsql as $$
declare t text; cols text; n int; res jsonb := '{}';
begin
  if p->>'format' <> 'crux-iopp-backup-v1' then raise exception 'Not a CRUX IOPP backup'; end if;
  perform set_config('session_replication_role', 'replica', true);
  for t in select jsonb_object_keys(p->'tables') loop
    if to_regclass('public.' || quote_ident(t)) is null then continue; end if;
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into cols
      from pg_attribute a where a.attrelid = ('public.' || quote_ident(t))::regclass and a.attnum > 0 and not a.attisdropped and a.attgenerated = '';
    execute format('insert into public.%I (%s) overriding system value select %s from jsonb_populate_recordset(null::public.%I, $1)', t, cols, cols, t) using p->'tables'->t;
    get diagnostics n = row_count;
    res := res || jsonb_build_object(t, n);
  end loop;
  perform set_config('session_replication_role', 'origin', true);
  return res;
end $$;
