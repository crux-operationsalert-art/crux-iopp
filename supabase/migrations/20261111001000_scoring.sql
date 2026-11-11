-- D-114  Weekly review + monthly performance score out of 10.
-- Final /10 = weights.kpi * KPI_final + weights.attr * Attr_final  (default 0.75 / 0.25).
-- KPI: manager gives a base 0-10, the system ADJUSTS it from measured numbers (achievement, TAT,
--      commitment, attendance) so a hand-given score stays fair.
-- Attributes: manager gives a base 0-10, four default factors (self shrinkage, team shrinkage,
--      team performance, growth) always add or subtract — so even 10/10 moves.
-- Flow: a report's manager (or a head/admin/HR) scores -> HR/Admin locks -> the person sees it.
-- Bands and weights live in public.scoring_config (company-owned), not hardcoded.

-- ---------------------------------------------------------------- config (one row, tunable)
create table if not exists public.scoring_config (
  id boolean primary key default true check (id),
  cfg jsonb not null,
  updated_by uuid references public.persons(id),
  updated_at timestamptz not null default now()
);
alter table public.scoring_config enable row level security;
revoke all on public.scoring_config from anon, authenticated;

insert into public.scoring_config (id, cfg) values (true, jsonb_build_object(
  'weights', jsonb_build_object('kpi', 0.75, 'attr', 0.25),
  'kpi', jsonb_build_object(
     -- achievement % of target -> delta: [threshold_at_or_above, delta] highest first
     'achievement', jsonb_build_array(jsonb_build_array(110,1.0), jsonb_build_array(100,0.5),
                                       jsonb_build_array(80,0.0), jsonb_build_array(60,-1.0), jsonb_build_array(0,-2.0)),
     -- TAT = share of reported days that were late
     'tat', jsonb_build_object('clean_at_or_below',0.05,'clean',0.5,'mild_at_or_below',0.20,'mild',-0.5,'heavy',-1.5),
     -- commitment % (plan vs done)
     'commitment', jsonb_build_object('good_at_or_above',90,'good',0.5,'weak_below',60,'weak',-0.5),
     -- attendance = share of required days missed
     'attendance', jsonb_build_object('repeated_above',0.10,'repeated',-0.5)),
  'attr', jsonb_build_object(
     'self_shrinkage_max', 2.0,   -- - up to 2 for own missed days
     'team_shrinkage_max', 2.0,   -- - up to 2 for team attrition this month
     'team_perf', jsonb_build_object('strong_at_or_above',100,'strong',1.0,'weak_below',80,'weak',-1.0),
     'growth', jsonb_build_object('up_delta_pp',5,'up',1.0,'down_delta_pp',-5,'down',-1.0))
)) on conflict (id) do nothing;

create or replace function app.scoring_cfg() returns jsonb
language sql stable security definer set search_path = public, app, pg_temp as $$
  select cfg from public.scoring_config where id;
$$;

-- ---------------------------------------------------------------- raw measures (internal, no auth re-check)
-- Average achievement % across a person's current person-level targets for the month (null if none).
create or replace function app.person_achievement(p_person uuid, p_month date) returns numeric
language sql stable security definer set search_path = public, app, pg_temp as $$
  with m as (select date_trunc('month', p_month)::date as m0),
  t as (
    select ta.amount,
           app.metric_actual(ta.metric, (select m0 from m),
             least(app.today(), ((select m0 from m) + interval '1 month - 1 day')::date),
             'person', ta.zone_id, ta.branch_id, ta.person_id, ta.client_id) as actual
      from public.target_allocations ta
     where ta.is_current and ta.level = 'person' and ta.person_id = p_person
       and ta.month = (select m0 from m) and ta.amount > 0)
  select round(avg(actual / amount * 100)::numeric, 1) from t;
$$;

-- Attendance / TAT / commitment counts for one person over a month (to min(today, month end)).
create or replace function app.person_discipline(p_person uuid, p_month date) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_m0 date := date_trunc('month', p_month)::date;
        v_end date := least(app.today(), (v_m0 + interval '1 month - 1 day')::date);
        v_ontime int := 0; v_late int := 0; v_miss int := 0; v_manager int := 0;
        v_cpct numeric; v_cn int := 0; v_csum numeric := 0; r record;
begin
  for r in select g::date d from generate_series(v_m0, v_end, interval '1 day') g loop
    case app.day_result(p_person, r.d)
      when 'ontime' then v_ontime := v_ontime + 1;
      when 'late' then v_late := v_late + 1;
      when 'miss' then v_miss := v_miss + 1;
      when 'manager' then v_manager := v_manager + 1;
      else null; -- skip / open: not counted
    end case;
    v_cpct := app.commitment_pct(p_person, r.d);
    if v_cpct is not null then v_cn := v_cn + 1; v_csum := v_csum + v_cpct; end if;
  end loop;
  return jsonb_build_object(
    'ontime', v_ontime, 'late', v_late, 'miss', v_miss, 'manager', v_manager,
    'reported', v_ontime + v_late + v_manager,
    'required', v_ontime + v_late + v_miss + v_manager,
    'late_share', case when v_ontime + v_late + v_manager > 0 then round(v_late::numeric / (v_ontime + v_late + v_manager), 3) else null end,
    'miss_share', case when v_ontime + v_late + v_miss + v_manager > 0 then round(v_miss::numeric / (v_ontime + v_late + v_miss + v_manager), 3) else null end,
    'commitment_avg', case when v_cn > 0 then round(v_csum / v_cn, 1) else null end);
end $$;

-- Direct reports of a person (ops + collections) overlapping the month.
create or replace function app.direct_reports(p_person uuid, p_month date) returns setof uuid
language sql stable security definer set search_path = public, app, pg_temp as $$
  select distinct rl.person_id from public.reporting_lines rl
   where rl.manager_id = p_person
     and rl.valid && daterange(date_trunc('month', p_month)::date, (date_trunc('month', p_month) + interval '1 month')::date);
$$;

-- ---------------------------------------------------------------- KPI score (given -> adjusted)
create or replace function app.kpi_score(p_person uuid, p_month date, p_given numeric) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare cfg jsonb := app.scoring_cfg();
        v_ach numeric := app.person_achievement(p_person, p_month);
        v_disc jsonb := app.person_discipline(p_person, p_month);
        v_late numeric := (v_disc->>'late_share')::numeric;
        v_miss numeric := (v_disc->>'miss_share')::numeric;
        v_cmt numeric := (v_disc->>'commitment_avg')::numeric;
        d_ach numeric := 0; d_tat numeric := 0; d_cmt numeric := 0; d_att numeric := 0;
        band jsonb; v_final numeric;
begin
  -- achievement band (first threshold the value is >=)
  if v_ach is not null then
    for band in select * from jsonb_array_elements(cfg->'kpi'->'achievement') loop
      if v_ach >= (band->>0)::numeric then d_ach := (band->>1)::numeric; exit; end if;
    end loop;
  end if;
  -- TAT (late share of reported days)
  if v_late is not null then
    if v_late <= (cfg->'kpi'->'tat'->>'clean_at_or_below')::numeric then d_tat := (cfg->'kpi'->'tat'->>'clean')::numeric;
    elsif v_late <= (cfg->'kpi'->'tat'->>'mild_at_or_below')::numeric then d_tat := (cfg->'kpi'->'tat'->>'mild')::numeric;
    else d_tat := (cfg->'kpi'->'tat'->>'heavy')::numeric; end if;
  end if;
  -- commitment
  if v_cmt is not null then
    if v_cmt >= (cfg->'kpi'->'commitment'->>'good_at_or_above')::numeric then d_cmt := (cfg->'kpi'->'commitment'->>'good')::numeric;
    elsif v_cmt < (cfg->'kpi'->'commitment'->>'weak_below')::numeric then d_cmt := (cfg->'kpi'->'commitment'->>'weak')::numeric; end if;
  end if;
  -- attendance (missed share)
  if v_miss is not null and v_miss > (cfg->'kpi'->'attendance'->>'repeated_above')::numeric then
    d_att := (cfg->'kpi'->'attendance'->>'repeated')::numeric;
  end if;
  v_final := greatest(0, least(10, round(coalesce(p_given,0) + d_ach + d_tat + d_cmt + d_att, 1)));
  return jsonb_build_object(
    'given', p_given,
    'measures', jsonb_build_object('achievement_pct', v_ach, 'late_share', v_late, 'miss_share', v_miss, 'commitment_avg', v_cmt,
                                   'reported_days', (v_disc->>'reported')::int, 'required_days', (v_disc->>'required')::int),
    'adjustments', jsonb_build_object('achievement', d_ach, 'tat', d_tat, 'commitment', d_cmt, 'attendance', d_att),
    'final', v_final);
end $$;

-- ---------------------------------------------------------------- Attributes score (given -> adjusted)
create or replace function app.attr_score(p_person uuid, p_month date, p_given numeric) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare cfg jsonb := app.scoring_cfg();
        v_m0 date := date_trunc('month', p_month)::date;
        v_disc jsonb := app.person_discipline(p_person, p_month);
        v_miss numeric := coalesce((v_disc->>'miss_share')::numeric, 0);
        v_team int := 0; v_exits int := 0; v_attr numeric; v_teamperf numeric; v_tn int := 0; v_tsum numeric := 0;
        v_ach_now numeric := app.person_achievement(p_person, p_month);
        v_ach_prev numeric := app.person_achievement(p_person, (v_m0 - interval '1 month')::date);
        v_is_mgr boolean; r uuid; a numeric;
        d_self numeric := 0; d_tshr numeric := 0; d_tperf numeric := 0; d_growth numeric := 0; v_final numeric;
begin
  -- self shrinkage: own missed-day share scaled to [-max, 0]
  d_self := -round(v_miss * (cfg->'attr'->>'self_shrinkage_max')::numeric, 2);

  -- manager factors
  select count(*) into v_team from app.direct_reports(p_person, p_month) x;
  v_is_mgr := v_team > 0;
  if v_is_mgr then
    for r in select * from app.direct_reports(p_person, p_month) loop
      if exists (select 1 from public.persons pp where pp.id = r and pp.status = 'exited'
                   and pp.exited_on >= v_m0 and pp.exited_on < (v_m0 + interval '1 month')) then
        v_exits := v_exits + 1;
      end if;
      a := app.person_achievement(r, p_month);
      if a is not null then v_tn := v_tn + 1; v_tsum := v_tsum + a; end if;
    end loop;
    v_attr := case when v_team > 0 then v_exits::numeric / v_team else 0 end;
    d_tshr := -round(v_attr * (cfg->'attr'->>'team_shrinkage_max')::numeric, 2);
    v_teamperf := case when v_tn > 0 then round(v_tsum / v_tn, 1) else null end;
    if v_teamperf is not null then
      if v_teamperf >= (cfg->'attr'->'team_perf'->>'strong_at_or_above')::numeric then d_tperf := (cfg->'attr'->'team_perf'->>'strong')::numeric;
      elsif v_teamperf < (cfg->'attr'->'team_perf'->>'weak_below')::numeric then d_tperf := (cfg->'attr'->'team_perf'->>'weak')::numeric; end if;
    end if;
  end if;

  -- growth: this month vs last month achievement (applies to everyone with both figures)
  if v_ach_now is not null and v_ach_prev is not null then
    if v_ach_now - v_ach_prev >= (cfg->'attr'->'growth'->>'up_delta_pp')::numeric then d_growth := (cfg->'attr'->'growth'->>'up')::numeric;
    elsif v_ach_now - v_ach_prev <= (cfg->'attr'->'growth'->>'down_delta_pp')::numeric then d_growth := (cfg->'attr'->'growth'->>'down')::numeric; end if;
  end if;

  v_final := greatest(0, least(10, round(coalesce(p_given,0) + d_self + d_tshr + d_tperf + d_growth, 1)));
  return jsonb_build_object(
    'given', p_given, 'is_manager', v_is_mgr,
    'measures', jsonb_build_object('miss_share', v_miss, 'team_size', v_team, 'team_exits', v_exits,
                                   'team_achievement', v_teamperf, 'achievement_now', v_ach_now, 'achievement_prev', v_ach_prev),
    'adjustments', jsonb_build_object('self_shrinkage', d_self, 'team_shrinkage', d_tshr, 'team_performance', d_tperf, 'growth', d_growth),
    'final', v_final);
end $$;

-- Combine into a full sheet (pure computation; no storage).
create or replace function app.score_sheet(p_person uuid, p_month date, p_kpi_given numeric, p_attr_given numeric) returns jsonb
language sql stable security definer set search_path = public, app, pg_temp as $$
  select jsonb_build_object(
    'kpi', k, 'attr', a,
    'weights', (app.scoring_cfg())->'weights',
    'final', round( ((app.scoring_cfg())->'weights'->>'kpi')::numeric * (k->>'final')::numeric
                  + ((app.scoring_cfg())->'weights'->>'attr')::numeric * (a->>'final')::numeric, 1))
  from (select app.kpi_score(p_person, p_month, p_kpi_given) k, app.attr_score(p_person, p_month, p_attr_given) a) s;
$$;

-- ---------------------------------------------------------------- stored scores
create table if not exists public.monthly_scores (
  person_id uuid not null references public.persons(id),
  month date not null,
  kpi_given numeric check (kpi_given between 0 and 10),
  attr_given numeric check (attr_given between 0 and 10),
  kpi_final numeric, attr_final numeric, final numeric,
  breakdown jsonb,
  note text,
  status text not null default 'draft' check (status in ('draft','submitted','locked')),
  scored_by uuid references public.persons(id), scored_at timestamptz,
  locked_by uuid references public.persons(id), locked_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (person_id, month)
);
alter table public.monthly_scores enable row level security;
revoke all on public.monthly_scores from anon, authenticated;

create table if not exists public.weekly_reviews (
  person_id uuid not null references public.persons(id),
  week_start date not null,
  commitment_pct numeric, achievement_pct numeric,
  review_note text, focus_note text,
  reviewed_by uuid references public.persons(id),
  updated_at timestamptz not null default now(),
  primary key (person_id, week_start)
);
alter table public.weekly_reviews enable row level security;
revoke all on public.weekly_reviews from anon, authenticated;

-- Who may score a person for a month: their manager (ops or collections scope), a head, admin or HR.
create or replace function app.can_score(p_person uuid, p_month date) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select app.is_admin() or app.has_role('hr_admin')
      or app.can_view_person(p_person, least(app.today(), (date_trunc('month', p_month) + interval '1 month - 1 day')::date), 'operations')
      or app.can_view_person(p_person, least(app.today(), (date_trunc('month', p_month) + interval '1 month - 1 day')::date), 'collections');
$$;

-- Scorer preview: computed sheet for the given (or already-saved, or 7 as a neutral base) scores + saved row.
create or replace function public.score_preview(p_person uuid, p_month date default null,
    p_kpi_given numeric default null, p_attr_given numeric default null) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_m date := date_trunc('month', coalesce(p_month, app.today()))::date; row public.monthly_scores;
        v_kg numeric; v_ag numeric;
begin
  if not app.can_score(p_person, v_m) then raise exception 'Not permitted.' using errcode = '42501'; end if;
  select * into row from public.monthly_scores where person_id = p_person and month = v_m;
  v_kg := coalesce(p_kpi_given, row.kpi_given, 7);
  v_ag := coalesce(p_attr_given, row.attr_given, 7);
  return jsonb_build_object(
    'person_id', p_person, 'month', v_m,
    'full_name', (select full_name from public.persons where id = p_person),
    'designation', (select designation from public.persons where id = p_person),
    'status', coalesce(row.status, 'none'),
    'kpi_given', row.kpi_given, 'attr_given', row.attr_given, 'note', row.note,
    'locked', row.status = 'locked',
    'sheet', app.score_sheet(p_person, v_m, v_kg, v_ag));
end $$;

create or replace function public.save_score(p_person uuid, p_month date, p_kpi_given numeric,
    p_attr_given numeric, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_m date := date_trunc('month', p_month)::date; v_sheet jsonb; v_me uuid := app.me();
begin
  if not app.can_score(p_person, v_m) then raise exception 'Not permitted.' using errcode = '42501'; end if;
  if exists (select 1 from public.monthly_scores where person_id = p_person and month = v_m and status = 'locked')
     and not (app.is_admin() or app.has_role('hr_admin')) then
    raise exception 'This month is locked. Ask HR/Admin to reopen it.' using errcode = '42501';
  end if;
  if p_kpi_given is null or p_kpi_given < 0 or p_kpi_given > 10 or p_attr_given is null or p_attr_given < 0 or p_attr_given > 10 then
    raise exception 'Scores must be between 0 and 10.' using errcode = '22023';
  end if;
  v_sheet := app.score_sheet(p_person, v_m, p_kpi_given, p_attr_given);
  insert into public.monthly_scores as s (person_id, month, kpi_given, attr_given, kpi_final, attr_final, final,
            breakdown, note, status, scored_by, scored_at, updated_at)
  values (p_person, v_m, p_kpi_given, p_attr_given, (v_sheet->'kpi'->>'final')::numeric,
          (v_sheet->'attr'->>'final')::numeric, (v_sheet->>'final')::numeric, v_sheet, p_note, 'submitted', v_me, now(), now())
  on conflict (person_id, month) do update set
     kpi_given = excluded.kpi_given, attr_given = excluded.attr_given, kpi_final = excluded.kpi_final,
     attr_final = excluded.attr_final, final = excluded.final, breakdown = excluded.breakdown, note = excluded.note,
     status = case when s.status = 'locked' then 'locked' else 'submitted' end,
     scored_by = v_me, scored_at = now(), updated_at = now();
  return jsonb_build_object('ok', true, 'sheet', v_sheet);
end $$;

create or replace function public.lock_score(p_person uuid, p_month date) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_m date := date_trunc('month', p_month)::date;
begin
  if not (app.is_admin() or app.has_role('hr_admin')) then raise exception 'Only HR/Admin can lock.' using errcode = '42501'; end if;
  update public.monthly_scores set status = 'locked', locked_by = app.me(), locked_at = now(), updated_at = now()
   where person_id = p_person and month = v_m;
  if not found then raise exception 'No score to lock. Score it first.' using errcode = 'P0002'; end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.reopen_score(p_person uuid, p_month date) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_m date := date_trunc('month', p_month)::date;
begin
  if not (app.is_admin() or app.has_role('hr_admin')) then raise exception 'Only HR/Admin can reopen.' using errcode = '42501'; end if;
  update public.monthly_scores set status = 'submitted', locked_by = null, locked_at = null, updated_at = now()
   where person_id = p_person and month = v_m;
  return jsonb_build_object('ok', true);
end $$;

-- The person's own score — only once HR/Admin has locked it.
create or replace function public.my_score(p_month date default null) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_m date := date_trunc('month', coalesce(p_month, app.today()))::date; row public.monthly_scores; v_me uuid := app.me();
begin
  select * into row from public.monthly_scores where person_id = v_me and month = v_m and status = 'locked';
  if not found then return jsonb_build_object('month', v_m, 'available', false); end if;
  return jsonb_build_object('month', v_m, 'available', true, 'final', row.final,
    'kpi_final', row.kpi_final, 'attr_final', row.attr_final, 'note', row.note, 'breakdown', row.breakdown,
    'locked_at', row.locked_at);
end $$;

-- Manager / HR / Admin: their team's scores for a month (status + finals).
create or replace function public.team_scores(p_month date default null) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_m date := date_trunc('month', coalesce(p_month, app.today()))::date; v_me uuid := app.me();
        v_end date := least(app.today(), (v_m + interval '1 month - 1 day')::date); v_rows jsonb;
begin
  with team as (
    select distinct p.id, p.full_name, p.designation
      from public.persons p
     where p.status in ('active','suspended')
       and (app.is_admin() or app.has_role('hr_admin')
            or app.can_view_person(p.id, v_end, 'operations') or app.can_view_person(p.id, v_end, 'collections'))
       and p.id <> v_me)
  select coalesce(jsonb_agg(jsonb_build_object(
           'person_id', t.id, 'full_name', t.full_name, 'designation', t.designation,
           'status', coalesce(ms.status, 'none'), 'final', ms.final,
           'kpi_final', ms.kpi_final, 'attr_final', ms.attr_final) order by t.full_name), '[]'::jsonb)
    into v_rows
    from team t left join public.monthly_scores ms on ms.person_id = t.id and ms.month = v_m;
  return jsonb_build_object('month', v_m, 'rows', v_rows, 'can_lock', app.is_admin() or app.has_role('hr_admin'));
end $$;

-- ---------------------------------------------------------------- weekly review
create or replace function public.save_weekly_review(p_person uuid, p_week_start date, p_review text default null,
    p_focus text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_ws date := date_trunc('week', p_week_start)::date; v_we date := v_ws + 6;
        v_cn int := 0; v_csum numeric := 0; v_c numeric; r record; v_ach numeric;
begin
  if not app.can_score(p_person, v_ws) then raise exception 'Not permitted.' using errcode = '42501'; end if;
  for r in select g::date d from generate_series(v_ws, least(v_we, app.today()), interval '1 day') g loop
    v_c := app.commitment_pct(p_person, r.d);
    if v_c is not null then v_cn := v_cn + 1; v_csum := v_csum + v_c; end if;
  end loop;
  v_ach := app.person_achievement(p_person, v_ws);
  insert into public.weekly_reviews (person_id, week_start, commitment_pct, achievement_pct, review_note, focus_note, reviewed_by, updated_at)
  values (p_person, v_ws, case when v_cn > 0 then round(v_csum / v_cn, 1) else null end, v_ach, p_review, p_focus, app.me(), now())
  on conflict (person_id, week_start) do update set commitment_pct = excluded.commitment_pct, achievement_pct = excluded.achievement_pct,
     review_note = excluded.review_note, focus_note = excluded.focus_note, reviewed_by = app.me(), updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.weekly_reviews(p_person uuid, p_weeks int default 6) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_end date := least(app.today(), (date_trunc('month', app.today()) + interval '1 month - 1 day')::date);
begin
  if not app.can_score(p_person, app.today()) and p_person <> app.me() then raise exception 'Not permitted.' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('week_start', w.week_start, 'commitment_pct', w.commitment_pct,
            'achievement_pct', w.achievement_pct, 'review_note', w.review_note, 'focus_note', w.focus_note) order by w.week_start desc), '[]'::jsonb)
    from public.weekly_reviews w where w.person_id = p_person
      and w.week_start > (date_trunc('week', app.today()) - (p_weeks || ' weeks')::interval)::date);
end $$;

grant execute on function public.score_preview(uuid, date, numeric, numeric), public.save_score(uuid, date, numeric, numeric, text),
  public.lock_score(uuid, date), public.reopen_score(uuid, date), public.my_score(date), public.team_scores(date),
  public.save_weekly_review(uuid, date, text, text), public.weekly_reviews(uuid, int) to authenticated;
