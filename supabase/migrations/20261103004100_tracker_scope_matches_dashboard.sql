-- Final audit fix: the Zonal Tracker download for managers with locations (ZM, Operations Head, Collections Head with
-- operations) covers exactly the locations their dashboard covers — their own and their whole team's — not only the
-- locations they head personally. Totals now agree with the performance dashboard for every designation.
do $do$
declare f text; o text;
begin
  f := pg_get_functiondef('public.tracker_export(date)'::regprocedure); o := f;
  f := replace(f, 'when app.has_role(''zm'') or exists',
                  'when app.has_role(''zm'') or app.has_role(''ops_head'') or app.has_role(''collections_head'') or exists');
  f := replace(f, '    union select h.branch_id, h.client_id from public.location_heads h
     where v_mode = ''zm'' and h.person_id = v_me and h.valid && daterange(v_m, v_d + 1)),',
                  '    union select vb, null::uuid from app.visible_branches(v_d) vb where v_mode = ''zm''),');
  if f = o or position('app.visible_branches(v_d) vb' in f) = 0 or position('app.has_role(''ops_head'') or app.has_role(''collections_head'') or exists' in f) = 0 then
    raise exception 'tracker_export anchors not found'; end if;
  execute f;
end $do$;
