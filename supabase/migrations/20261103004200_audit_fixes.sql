-- Final audit fixes.
-- 1. A team member with no clients and no team in Operations (e.g. a leader who only manages Collections) has nothing
--    to report: they no longer block their manager's certification and show as "No clients".
-- 2. Receivables message matches the rule (Collections Head or Admin, D-52).
do $do$
declare f text; o text;
begin
  f := pg_get_functiondef('public.team_status(date,app.fn,uuid)'::regprocedure); o := f;
  f := replace(f, 'coalesce(d.status, ''pending''), d.reason,',
    'coalesce(d.status, case when p_function = ''operations'' and not app.has_reports(p.id, p_function, p_work_date)
                                  and not exists (select 1 from public.allocations a where a.person_id = p.id and a.function = ''operations'' and a.valid @> p_work_date)
                             then ''no_clients'' else ''pending'' end), d.reason,');
  f := replace(f, '              else coalesce(d.status in (''submitted'',''manager_entered'',''absent'',''on_leave'',''non_operational'',''exception''), false) end,',
    '              when p_function = ''operations'' and not exists (select 1 from public.allocations a where a.person_id = p.id and a.function = ''operations'' and a.valid @> p_work_date) then true
              else coalesce(d.status in (''submitted'',''manager_entered'',''absent'',''on_leave'',''non_operational'',''exception''), false) end,');
  if f = o or position('no_clients' in f) = 0 or position('then true
              else coalesce' in f) = 0 then raise exception 'team_status anchors not found'; end if;
  execute f;

  f := pg_get_functiondef('public.review_ar(date,uuid,uuid,jsonb,text)'::regprocedure); o := f;
  f := replace(f, 'Only the Collections Head, Operations Head or Admin can change receivables.', 'Only the Collections Head or Admin can change receivables.');
  if f <> o then execute f; end if;
end $do$;
