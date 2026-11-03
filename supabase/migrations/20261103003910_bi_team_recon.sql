-- D-56: Business Intelligence & Growth (BI&G) = the audit and admin team. Its members hold the auditor role: they see
-- all data (read), but cannot set targets for Operations / Collections and do not report daily figures.
-- Leadership (Chairman, MD) keep target-setting; that power now checks the leadership role itself, not auditor.
create or replace function app.can_set_target(p_level text, p_metric text, p_zone uuid, p_branch uuid, p_person uuid, p_month date)
returns boolean language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_fn app.fn := app.metric_function(p_metric); v_head app.role_code; v_d date := greatest(p_month, app.today());
begin
  if app.is_admin() then return true; end if;
  v_head := case when v_fn = 'collections' then 'collections_head' else 'ops_head' end;
  if p_level in ('org','zone') then return app.has_role(v_head) or app.has_role('leadership'); end if;
  if p_level = 'branch' then
    return ((app.has_role(v_head) or app.has_role('leadership')) and p_branch in (select app.visible_branches(v_d)))
        or exists (select 1 from public.role_assignments r join public.branch_zones bz on bz.zone_id = r.zone_id
                    where r.person_id = app.me() and r.role = 'zm' and r.valid @> app.today()
                      and bz.branch_id = p_branch and bz.valid @> p_month);
  end if;
  return exists (select 1 from app.subtree(app.me(), 'operations', v_d) s where s.person_id = p_person)
      or exists (select 1 from app.subtree(app.me(), 'collections', v_d) s where s.person_id = p_person);
end $$;

-- Auditors do not tick clients or report daily figures.
do $do$
declare f text; o text;
begin
  f := pg_get_functiondef('public.set_service_active(uuid,boolean,uuid,text)'::regprocedure); o := f;
  f := replace(f, '  if p_active and v_a.id is null and not (app.is_admin() or app.has_role(''hr_admin''))',
'  if p_active and exists (select 1 from public.role_assignments r where r.person_id = v_p and r.role = ''auditor'' and r.valid @> v_d)
     and not exists (select 1 from public.role_assignments r where r.person_id = v_p and r.valid @> v_d and r.role::text not in (''auditor'',''admin'')) then
    raise exception ''Business Intelligence & Growth does not report daily figures.'' using errcode = ''P0001'';
  end if;
  if p_active and v_a.id is null and not (app.is_admin() or app.has_role(''hr_admin''))');
  if f = o then raise exception 'set_service_active anchor not found'; end if;
  execute f;
end $do$;

-- Behind-target misses use the same location roll-up as everything else (branch target, else the people's sum).
do $do$
declare s text; f text; o text;
begin
  foreach s in array array['app.sync_core(boolean)', 'public.sync_tasks(boolean)'] loop
    if to_regprocedure(s) is null then continue; end if;
    f := pg_get_functiondef(s::regprocedure); o := f;
    f := regexp_replace(f, 'from public\.target_allocations t join public\.branches b on b\.id = t\.branch_id join public\.clients c on c\.id = t\.client_id\s+where t\.is_current and t\.month = v_m and t\.metric = ''entry'' and t\.level = ''branch'' and t\.amount > 0',
                           'from app.loc_targets(v_m, ''entry'') t join public.branches b on b.id = t.branch_id join public.clients c on c.id = t.client_id
              where t.amount > 0');
    if f <> o then execute f; end if;
  end loop;
end $do$;

-- D-57 Reconciliation (SOW 6.4): status per client · location for the month, from the daily entries.
--   Reconciled = everything received is matched (reconciled may go over: earlier receipts matched this month).
--   Partially reconciled / Pending / Nothing yet. A gap still open after 2 working days becomes a task for the head.
create or replace function app.recon_status(p_rcv numeric, p_rec numeric) returns text
language sql immutable as $$
  select case when coalesce(p_rcv, 0) = 0 and coalesce(p_rec, 0) = 0 then 'nothing_yet'
              when coalesce(p_rec, 0) > coalesce(p_rcv, 0) then 'reconciled_over'
              when coalesce(p_rec, 0) = coalesce(p_rcv, 0) then 'reconciled'
              when coalesce(p_rec, 0) = 0 then 'pending'
              else 'partially_reconciled' end
$$;

create or replace function app.sync_recon_gaps() returns int
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_d date := app.today(); v_m date := date_trunc('month', app.today())::date; v_cut date; r record; n int := 0;
        v_live date := coalesce((app.setting('go_live_date') #>> '{}')::date, v_m);
begin
  -- receipts up to two working days ago must be matched by yesterday's reconciliations
  select max(g)::date into v_cut from generate_series(v_m, v_d - 1, interval '1 day') g
   where app.working_days_between(g::date, v_d - 1) >= 3;
  if v_cut is null or v_d <= v_live then return 0; end if;
  for r in
    select x.branch_id, x.client_id, b.name branch, c.name client,
           sum(x.rcv_lt30 + x.rcv_30_90 + x.rcv_90_180 + x.rcv_gt180) filter (where x.entry_date <= v_cut) rcv_old,
           sum(x.rec_lt30 + x.rec_30_90 + x.rec_90_180 + x.rec_gt180) filter (where x.entry_date <= v_d - 1) rec
      from public.collection_daily x join public.branches b on b.id = x.branch_id join public.clients c on c.id = x.client_id
     where x.entry_date between v_m and v_d - 1 group by 1, 2, 3, 4
  loop
    if coalesce(r.rcv_old, 0) > coalesce(r.rec, 0) then
      perform app.task_upsert('recon_gap', 'task', 'recon_gap:' || r.branch_id || ':' || r.client_id || ':' || v_m,
        coalesce(app.head_of(r.branch_id, r.client_id, 'branch_head', v_d), app.head_of(r.branch_id, r.client_id, 'zonal_manager', v_d)), null,
        r.branch || ' · ' || r.client || ': ' || to_char(r.rcv_old - coalesce(r.rec, 0), 'FM99,99,99,990') || ' received this month is not reconciled yet',
        jsonb_build_object('received', r.rcv_old, 'reconciled', coalesce(r.rec, 0), 'as_of', v_d - 1), r.branch_id, r.client_id, null, v_m);
      n := n + 1;
    else
      update public.tasks set condition_cleared = true, updated_at = now()
       where dedupe_key = 'recon_gap:' || r.branch_id || ':' || r.client_id || ':' || v_m and status <> 'resolved' and not condition_cleared;
    end if;
  end loop;
  return n;
end $$;
revoke all on function app.sync_recon_gaps() from public, anon, authenticated;

do $do$
declare f text;
begin
  f := pg_get_functiondef('app.sync_all()'::regprocedure);
  if position('perform app.sync_absence_streaks();' in f) = 0 then raise exception 'sync_all anchor not found'; end if;
  f := replace(f, 'perform app.sync_absence_streaks();', 'perform app.sync_absence_streaks();
  perform app.sync_recon_gaps();');
  execute f;
end $do$;
