-- D-68 refinement (owner: "escalate to the top — the Operations Head and HR"): the weekly police-verification alarm climbs
-- the reporting line and stops at the Operations Head (it does not go on to the Board).
do $do$
declare f text; o text;
begin
  f := pg_get_functiondef('app.sync_police_verification()'::regprocedure); o := f;
  f := replace(f, 'exit when v_m is null; v_chain := v_chain || v_m; v_p := v_m;',
                  'exit when v_m is null; v_chain := v_chain || v_m; v_p := v_m;
          exit when exists (select 1 from public.role_assignments ra where ra.person_id = v_m and ra.role = ''ops_head'' and ra.valid @> app.today());');
  if f = o then raise exception 'sync_police_verification anchor not found'; end if;
  execute f;
end $do$;
