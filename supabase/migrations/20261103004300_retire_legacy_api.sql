-- Final audit: retire API entry points left from earlier designs that no screen uses any more (no dead logic reachable
-- by users). Data and history stay; the functions remain for Admin / service use only. Superseded by:
--   check_in / check_out → attendance from reporting (milestone 4); save_collection / save_bill / save_money_day /
--   submit_collections_day / my_collection_rows / collections_board / collections_summary / collections_rollup
--   → daily collections in My day and Performance → Collections (D-43, D-57).
revoke execute on function public.check_in(), public.check_out(),
  public.save_collection(date,uuid,numeric,numeric,uuid,uuid,text,text,uuid,uuid,text),
  public.save_bill(date,uuid,integer,numeric,uuid,uuid,text,date,date,text,uuid,text),
  public.save_money_day(date,jsonb), public.submit_collections_day(date,uuid,text), public.my_collection_rows(date),
  public.collections_board(date,date), public.collections_summary(date,date,text,uuid,uuid,uuid),
  public.collections_rollup(date,date,text,uuid,uuid,uuid)
  from authenticated, anon, public;

-- Security advisor: functions added this week were still callable without signing in (default PUBLIC grant).
revoke execute on function public.decide_extra_work(uuid,boolean,text), public.extra_work_report(date,date), public.my_collection_others(date),
  public.my_mfa_status(), public.save_extra_work(date,time,time,int,text), public.save_targets(date,jsonb,boolean,text),
  public.target_template(date), public.team_targets(date,uuid) from public, anon;
grant execute on function public.decide_extra_work(uuid,boolean,text), public.extra_work_report(date,date), public.my_collection_others(date),
  public.my_mfa_status(), public.save_extra_work(date,time,time,int,text), public.save_targets(date,jsonb,boolean,text),
  public.target_template(date), public.team_targets(date,uuid) to authenticated;
alter function app.recon_status(numeric, numeric) set search_path = pg_catalog;
revoke execute on function app.login_change_guard(), app.manages(uuid,date), app.ops_blind(), app.can_review_ar(), app.mfa_pending() from public, anon;
grant execute on function app.manages(uuid,date), app.ops_blind(), app.can_review_ar(), app.mfa_pending() to authenticated;
