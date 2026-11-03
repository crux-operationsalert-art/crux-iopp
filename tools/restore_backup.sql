-- Restore an Admin backup (Admin → Month close & backup → Download backup) into a NEW, empty CRUX IOPP database that already
-- has every migration applied. Run as the database owner (the Supabase SQL editor works; no superuser rights needed):
--   1. run this file;
--   2. select restore_backup('<contents of the backup .json>'::jsonb);
-- Tables load parents-first (following foreign keys) and the tool's own triggers (audit, guards) are paused per table while
-- its rows load. A second argument restores into another schema (used for the restore check on the live database, into
-- tables created LIKE public.*).
create or replace function public.restore_backup(p jsonb, p_schema text default 'public') returns jsonb
language plpgsql as $$
declare t text; cols text; n int; res jsonb := '{}'; rel regclass; todo text[]; done text[] := '{}'; progress boolean;
begin
  if p->>'format' <> 'crux-iopp-backup-v1' then raise exception 'Not a CRUX IOPP backup'; end if;
  select array_agg(k) into todo from jsonb_object_keys(p->'tables') k where to_regclass(quote_ident(p_schema) || '.' || quote_ident(k)) is not null;
  while coalesce(array_length(todo, 1), 0) > 0 loop
    progress := false;
    foreach t in array todo loop
      -- wait until every parent table (by foreign key in public) that is part of the backup has been loaded
      continue when exists (select 1 from pg_constraint c
                             where c.contype = 'f' and c.conrelid = ('public.' || quote_ident(t))::regclass and c.confrelid <> c.conrelid
                               and (select relname from pg_class where oid = c.confrelid) = any(todo));
      rel := (quote_ident(p_schema) || '.' || quote_ident(t))::regclass;
      select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into cols
        from pg_attribute a where a.attrelid = rel and a.attnum > 0 and not a.attisdropped and a.attgenerated = '';
      execute format('alter table %s disable trigger user', rel);
      execute format('insert into %s (%s) overriding system value select %s from jsonb_populate_recordset(null::%s, $1)', rel, cols, cols, rel) using p->'tables'->t;
      get diagnostics n = row_count;
      execute format('alter table %s enable trigger user', rel);
      res := res || jsonb_build_object(t, n);
      done := done || t; todo := array_remove(todo, t); progress := true;
    end loop;
    if not progress then raise exception 'Circular references between tables: %', todo; end if;
  end loop;
  return res;
end $$;
