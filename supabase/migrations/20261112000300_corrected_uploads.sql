-- D-128  A corrected copy of an earlier upload (turned upright, straightened, cropped; file name "corrected-…") is a
-- tidy-up, not a new submission: it becomes the current file for that document without sending HR another "please verify".
do $mig$
declare f text := pg_get_functiondef('public.register_document(uuid,text,text,text,text,integer)'::regprocedure); o text := f;
begin
  if position('corrected-' in f) = 0 then
    f := replace(f, 'if v_hr is not null and v_hr <> app.me() then', 'if v_hr is not null and v_hr <> app.me() and p_file_name not like ''corrected-%'' then');
    if f = o then raise exception 'register_document anchor not found'; end if;
    execute f;
  end if;
end $mig$;
