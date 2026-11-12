-- D-127  Backfill: HR can run the on-device reader over every upload that has no details. What it reads with certainty is
-- saved as "read from the document" (not "checked by HR") and the file stays unverified, so each one still goes to
-- "To compare" for a person in HR to confirm against the image.
do $mig$
declare f text := pg_get_functiondef('public.save_identity(uuid,jsonb)'::regprocedure); o text := f;
begin
  if position('''auto''' in f) = 0 then
    f := replace(f, 'v_src := case when p_person <> v_me then ''hr''',
                    'v_src := case when p_person <> v_me and coalesce((p->>''auto'')::boolean, false) then ''scan'' when p_person <> v_me then ''hr''');
    if f = o then raise exception 'save_identity anchor not found'; end if;
    execute f;
  end if;
end $mig$;
