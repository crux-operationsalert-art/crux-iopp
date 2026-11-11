-- D-115  Review corrections (11 Nov):
--  (1) Self-review + self-score initiates the month; then the DIRECT manager scores.
--  (2) Only the direct manager may score (HR/Admin lock, never score) — closes the "HR scores everyone" leak.
--  (3) Monthly scorecard opens only 25th → 5th; outside that, only the weekly review is active.
--  (4) Commitment shown on the person profile HR/managers see.

-- self scores + a widened status (self -> scored -> locked)
alter table public.monthly_scores add column if not exists self_kpi numeric check (self_kpi between 0 and 10);
alter table public.monthly_scores add column if not exists self_attr numeric check (self_attr between 0 and 10);
alter table public.monthly_scores add column if not exists self_note text;
alter table public.monthly_scores add column if not exists self_at timestamptz;
alter table public.monthly_scores drop constraint if exists monthly_scores_status_check;
alter table public.monthly_scores add constraint monthly_scores_status_check check (status in ('self','scored','locked'));

-- Which month (if any) is open for monthly scoring today: 25th..end -> this month; 1st..5th -> previous month; else closed.
create or replace function app.scoring_window(p_today date default null) returns date
language sql stable security definer set search_path = public, app, pg_temp as $$
  select case
    when extract(day from coalesce(p_today, app.today())) >= 25 then date_trunc('month', coalesce(p_today, app.today()))::date
    when extract(day from coalesce(p_today, app.today())) <= 5  then (date_trunc('month', coalesce(p_today, app.today())) - interval '1 month')::date
    else null end;
$$;
create or replace function app.scoring_open(p_month date) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select coalesce(app.scoring_window(app.today()) = date_trunc('month', p_month)::date, false);
$$;

-- Only the direct manager may score (ops or collections line). HR/Admin lock, they do not score.
create or replace function app.can_score(p_person uuid, p_month date) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select app.direct_mgr(p_person);
$$;

-- The person's own self-review (initiates the month). Window-gated; cannot change once locked.
create or replace function public.self_score(p_month date, p_kpi numeric, p_attr numeric, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_m date := date_trunc('month', p_month)::date; v_me uuid := app.me(); v_sheet jsonb;
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not app.scoring_open(v_m) then raise exception 'Monthly scoring is open only from the 25th to the 5th.' using errcode = '42501'; end if;
  if p_kpi is null or p_kpi < 0 or p_kpi > 10 or p_attr is null or p_attr < 0 or p_attr > 10 then
    raise exception 'Scores must be between 0 and 10.' using errcode = '22023'; end if;
  if exists (select 1 from public.monthly_scores where person_id = v_me and month = v_m and status = 'locked') then
    raise exception 'This month is locked.' using errcode = '42501'; end if;
  v_sheet := app.score_sheet(v_me, v_m, p_kpi, p_attr);
  insert into public.monthly_scores as s (person_id, month, self_kpi, self_attr, self_note, self_at, status, updated_at)
  values (v_me, v_m, p_kpi, p_attr, p_note, now(), 'self', now())
  on conflict (person_id, month) do update set self_kpi = excluded.self_kpi, self_attr = excluded.self_attr,
     self_note = excluded.self_note, self_at = now(), updated_at = now(),
     status = case when s.status = 'locked' then 'locked' else s.status end;
  return jsonb_build_object('ok', true, 'sheet', v_sheet);
end $$;

-- What the person sees/edits for their own review: the window, their self scores, and (once locked) the final.
create or replace function public.my_review(p_month date default null) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_m date := date_trunc('month', coalesce(p_month, app.scoring_window(app.today()), app.today()))::date;
        v_me uuid := app.me(); row public.monthly_scores;
begin
  select * into row from public.monthly_scores where person_id = v_me and month = v_m;
  return jsonb_build_object(
    'month', v_m,
    'window_open', app.scoring_open(v_m),
    'open_month', app.scoring_window(app.today()),
    'self_done', row.self_at is not null,
    'self_kpi', row.self_kpi, 'self_attr', row.self_attr, 'self_note', row.self_note,
    'locked', row.status = 'locked',
    'final', case when row.status = 'locked' then row.final end,
    'kpi_final', case when row.status = 'locked' then row.kpi_final end,
    'attr_final', case when row.status = 'locked' then row.attr_final end,
    'manager_note', case when row.status = 'locked' then row.note end,
    'breakdown', case when row.status = 'locked' then row.breakdown end,
    'sheet', app.score_sheet(v_me, v_m, coalesce(row.self_kpi, 7), coalesce(row.self_attr, 7)));
end $$;

-- Scorer preview: direct manager (or HR/Admin, read-only) — now carries self scores + window.
create or replace function public.score_preview(p_person uuid, p_month date default null,
    p_kpi_given numeric default null, p_attr_given numeric default null) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_m date := date_trunc('month', coalesce(p_month, app.scoring_window(app.today()), app.today()))::date;
        row public.monthly_scores; v_kg numeric; v_ag numeric;
begin
  if not (app.direct_mgr(p_person) or app.is_admin() or app.has_role('hr_admin')) then
    raise exception 'Not permitted.' using errcode = '42501'; end if;
  select * into row from public.monthly_scores where person_id = p_person and month = v_m;
  v_kg := coalesce(p_kpi_given, row.kpi_given, row.self_kpi, 7);
  v_ag := coalesce(p_attr_given, row.attr_given, row.self_attr, 7);
  return jsonb_build_object(
    'person_id', p_person, 'month', v_m,
    'full_name', (select full_name from public.persons where id = p_person),
    'designation', (select designation from public.persons where id = p_person),
    'status', coalesce(row.status, 'none'),
    'window_open', app.scoring_open(v_m),
    'can_edit', app.direct_mgr(p_person),
    'self_done', row.self_at is not null,
    'self_kpi', row.self_kpi, 'self_attr', row.self_attr, 'self_note', row.self_note,
    'kpi_given', row.kpi_given, 'attr_given', row.attr_given, 'note', row.note,
    'locked', row.status = 'locked',
    'sheet', app.score_sheet(p_person, v_m, v_kg, v_ag));
end $$;

-- Manager scores — needs the self-review first, the window open, and the direct line.
create or replace function public.save_score(p_person uuid, p_month date, p_kpi_given numeric,
    p_attr_given numeric, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_m date := date_trunc('month', p_month)::date; v_sheet jsonb; v_me uuid := app.me(); v_row public.monthly_scores;
begin
  if not app.direct_mgr(p_person) then raise exception 'Only the direct manager can score this person.' using errcode = '42501'; end if;
  if not app.scoring_open(v_m) then raise exception 'Monthly scoring is open only from the 25th to the 5th.' using errcode = '42501'; end if;
  select * into v_row from public.monthly_scores where person_id = p_person and month = v_m;
  if v_row.status = 'locked' then raise exception 'This month is locked. Ask HR/Admin to reopen it.' using errcode = '42501'; end if;
  if v_row.self_at is null then raise exception 'Waiting for their self-review — the person starts the review first.' using errcode = '42501'; end if;
  if p_kpi_given is null or p_kpi_given < 0 or p_kpi_given > 10 or p_attr_given is null or p_attr_given < 0 or p_attr_given > 10 then
    raise exception 'Scores must be between 0 and 10.' using errcode = '22023'; end if;
  v_sheet := app.score_sheet(p_person, v_m, p_kpi_given, p_attr_given);
  update public.monthly_scores set kpi_given = p_kpi_given, attr_given = p_attr_given,
     kpi_final = (v_sheet->'kpi'->>'final')::numeric, attr_final = (v_sheet->'attr'->>'final')::numeric,
     final = (v_sheet->>'final')::numeric, breakdown = v_sheet, note = p_note, status = 'scored',
     scored_by = v_me, scored_at = now(), updated_at = now()
   where person_id = p_person and month = v_m;
  return jsonb_build_object('ok', true, 'sheet', v_sheet);
end $$;

-- HR/Admin lock — needs a manager score on record.
create or replace function public.lock_score(p_person uuid, p_month date) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_m date := date_trunc('month', p_month)::date; v_row public.monthly_scores;
begin
  if not (app.is_admin() or app.has_role('hr_admin')) then raise exception 'Only HR/Admin can lock.' using errcode = '42501'; end if;
  select * into v_row from public.monthly_scores where person_id = p_person and month = v_m;
  if not found or v_row.scored_at is null then raise exception 'No manager score to lock yet.' using errcode = 'P0002'; end if;
  update public.monthly_scores set status = 'locked', locked_by = app.me(), locked_at = now(), updated_at = now()
   where person_id = p_person and month = v_m;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.reopen_score(p_person uuid, p_month date) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_m date := date_trunc('month', p_month)::date;
begin
  if not (app.is_admin() or app.has_role('hr_admin')) then raise exception 'Only HR/Admin can reopen.' using errcode = '42501'; end if;
  update public.monthly_scores set status = 'scored', locked_by = null, locked_at = null, updated_at = now()
   where person_id = p_person and month = v_m and status = 'locked';
  return jsonb_build_object('ok', true);
end $$;

-- Direct manager sees their reports to score; HR/Admin see everyone to lock (read-only on the scores).
create or replace function public.team_scores(p_month date default null) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_m date := date_trunc('month', coalesce(p_month, app.scoring_window(app.today()), app.today()))::date;
        v_me uuid := app.me(); v_hr boolean := app.is_admin() or app.has_role('hr_admin'); v_rows jsonb;
begin
  with team as (
    select p.id, p.full_name, p.designation from public.persons p
     where p.status in ('active','suspended') and p.id <> v_me
       and (v_hr or p.id in (select app.direct_reports(v_me, v_m))))
  select coalesce(jsonb_agg(jsonb_build_object(
           'person_id', t.id, 'full_name', t.full_name, 'designation', t.designation,
           'status', coalesce(ms.status, 'none'),
           'self_done', ms.self_at is not null,
           'can_edit', app.direct_mgr(t.id),
           'final', ms.final, 'kpi_final', ms.kpi_final, 'attr_final', ms.attr_final) order by t.full_name), '[]'::jsonb)
    into v_rows
    from team t left join public.monthly_scores ms on ms.person_id = t.id and ms.month = v_m;
  return jsonb_build_object('month', v_m, 'rows', v_rows, 'can_lock', v_hr,
    'window_open', app.scoring_open(v_m), 'open_month', app.scoring_window(app.today()), 'hr_view', v_hr);
end $$;

-- weekly review: the direct manager writes; the person and HR/Admin can read.
create or replace function public.save_weekly_review(p_person uuid, p_week_start date, p_review text default null,
    p_focus text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_ws date := date_trunc('week', p_week_start)::date; v_we date := v_ws + 6;
        v_cn int := 0; v_csum numeric := 0; v_c numeric; r record; v_ach numeric;
begin
  if not app.direct_mgr(p_person) then raise exception 'Only the direct manager can add a weekly review.' using errcode = '42501'; end if;
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

create or replace function public.weekly_reviews(p_person uuid, p_weeks int default 8) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  if not (app.direct_mgr(p_person) or p_person = app.me() or app.is_admin() or app.has_role('hr_admin')) then
    raise exception 'Not permitted.' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('week_start', w.week_start, 'commitment_pct', w.commitment_pct,
            'achievement_pct', w.achievement_pct, 'review_note', w.review_note, 'focus_note', w.focus_note) order by w.week_start desc), '[]'::jsonb)
    from public.weekly_reviews w where w.person_id = p_person
      and w.week_start > (date_trunc('week', app.today()) - (p_weeks || ' weeks')::interval)::date);
end $$;

grant execute on function public.self_score(date, numeric, numeric, text), public.my_review(date),
  app.scoring_window(date), app.scoring_open(date) to authenticated;

-- Commitment on the person profile (the highlight HR/managers see).
do $mig$
declare f text := pg_get_functiondef('public.person_profile(uuid)'::regprocedure); o text;
begin
  o := f;
  f := replace(f, '''progress'', app.profile_progress(p_person));',
    '''progress'', app.profile_progress(p_person),
    ''commitment'', jsonb_build_object(
       ''today'', app.commitment_pct(p_person, app.today()),
       ''month_avg'', (app.person_discipline(p_person, app.today())->>''commitment_avg'')::numeric,
       ''checked_in'', exists (select 1 from public.day_plan dp where dp.person_id = p_person and dp.work_date = app.today() and dp.checked_in_at is not null)));');
  if f = o then raise exception 'person_profile commitment anchor not found'; end if;
  execute f;
end $mig$;
