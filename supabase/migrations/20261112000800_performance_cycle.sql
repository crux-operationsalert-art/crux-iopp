-- D-137  Performance cycle audit: the cycle now tells people when it is their turn, and keeps a record.
-- Before this, self-review, scoring, locking and weekly reviews sent no notification and nobody was reminded.

create table if not exists public.perf_nudges (
  person_id uuid not null references public.persons(id),
  kind text not null,
  ref_date date not null,
  created_at timestamptz not null default now(),
  primary key (person_id, kind, ref_date)
);
alter table public.perf_nudges enable row level security;
revoke all on public.perf_nudges from anon, authenticated;

alter table public.monthly_scores add column if not exists ack_at timestamptz;
alter table public.monthly_scores add column if not exists ack_note text;

create or replace function app.managers_of(p_person uuid) returns setof uuid
language sql stable security definer set search_path = public, app, pg_temp as $$
  select distinct r.manager_id from public.reporting_lines r join public.persons m on m.id = r.manager_id and m.status = 'active'
   where r.person_id = p_person and r.valid @> app.today();
$$;

-- ---------------------------------------------------------------- each step tells the next person
create or replace function app.score_notify() returns trigger
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_name text := (select full_name from public.persons where id = new.person_id); v_mon text := to_char(new.month, 'FMMonth YYYY');
begin
  if new.self_at is not null and (tg_op = 'INSERT' or old.self_at is null) then
    insert into public.notifications(person_id, kind, message, link)
    select m, 'review', v_name || ' has submitted their self-review for ' || v_mon || '. It is now your turn to score.', '/reviews' from app.managers_of(new.person_id) m;
  end if;
  if new.status = 'scored' and (tg_op = 'INSERT' or old.status is distinct from 'scored') then
    insert into public.notifications(person_id, kind, message, link)
    values (new.person_id, 'review', 'Your manager has scored your ' || v_mon || ' review. HR will confirm it; you will see the final score here.', '/reviews');
  end if;
  if new.status = 'locked' and tg_op = 'UPDATE' and old.status is distinct from 'locked' then
    insert into public.notifications(person_id, kind, message, link)
    values (new.person_id, 'review', 'Your ' || v_mon || ' score is final: ' || to_char(new.final, 'FM90.0') || ' out of 10. Open My review to see the details and acknowledge it.', '/reviews');
  end if;
  if tg_op = 'UPDATE' and old.status = 'locked' and new.status <> 'locked' then
    insert into public.notifications(person_id, kind, message, link)
    select x, 'review', 'The ' || v_mon || ' score of ' || v_name || ' has been reopened by HR for correction.', '/reviews'
      from (select new.person_id x union select m from app.managers_of(new.person_id) m) z;
  end if;
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'monthly_scores_notify') then
    create trigger monthly_scores_notify after insert or update on public.monthly_scores for each row execute function app.score_notify();
  end if;
end $$;

create or replace function app.weekly_notify() returns trigger
language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if tg_op = 'INSERT' or coalesce(new.review_note, '') is distinct from coalesce(old.review_note, '') or coalesce(new.focus_note, '') is distinct from coalesce(old.focus_note, '') then
    if not exists (select 1 from public.perf_nudges where person_id = new.person_id and kind = 'weekly_done' and ref_date = new.week_start) then
      insert into public.perf_nudges(person_id, kind, ref_date) values (new.person_id, 'weekly_done', new.week_start);
      insert into public.notifications(person_id, kind, message, link)
      values (new.person_id, 'review', 'Your weekly review for the week of ' || to_char(new.week_start, 'FMDD Mon') || ' is ready. See what went well and your focus for this week.', '/reviews');
    end if;
  end if;
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'weekly_reviews_notify') then
    create trigger weekly_reviews_notify after insert or update on public.weekly_reviews for each row execute function app.weekly_notify();
  end if;
end $$;

-- ---------------------------------------------------------------- reminders, once per person per kind per day
create or replace function app.perf_nudge(p_person uuid, p_kind text, p_message text, p_link text) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  insert into public.perf_nudges(person_id, kind, ref_date) values (p_person, p_kind, app.today()) on conflict do nothing;
  if found then insert into public.notifications(person_id, kind, message, link) values (p_person, 'review', p_message, p_link); end if;
end $$;

create or replace function app.performance_reminders() returns int
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare d date := app.today(); dd int := extract(day from d)::int; w date := app.scoring_window(d); v_mon text; r record; n int := 0; v_hr uuid := app.hr_owner();
begin
  -- KPIs and attributes must be in place before the scorecard opens
  if dd in (15, 20, 24) then
    for r in select rl.manager_id m, count(distinct rl.person_id) c from public.reporting_lines rl join public.persons p on p.id = rl.person_id and p.status = 'active'
              join public.persons mg on mg.id = rl.manager_id and mg.status = 'active'
              where rl.valid @> d and ((select count(*) from public.kpi_assignment k where k.person_id = rl.person_id and k.valid @> d) < 3
                                    or (select count(*) from public.person_attributes a where a.person_id = rl.person_id and a.valid @> d) < 3)
              group by 1 loop
      perform app.perf_nudge(r.m, 'scorecard_due', r.c || ' of your team do not have their KPIs and attributes set. Set 3 to 5 of each before the 25th, when the monthly scorecard opens.', '/kpis'); n := n + 1;
    end loop;
  end if;
  -- weekly review, every Monday for the week just ended
  if extract(isodow from d) = 1 then
    for r in select rl.manager_id m, count(distinct rl.person_id) c from public.reporting_lines rl join public.persons p on p.id = rl.person_id and p.status = 'active'
              join public.persons mg on mg.id = rl.manager_id and mg.status = 'active'
              where rl.valid @> d and not exists (select 1 from public.weekly_reviews wr where wr.person_id = rl.person_id and wr.week_start = d - 7) group by 1 loop
      perform app.perf_nudge(r.m, 'weekly_due', 'Weekly reviews are due for ' || r.c || ' of your team (week of ' || to_char(d - 7, 'FMDD Mon') || '). It takes a minute each.', '/reviews'); n := n + 1;
    end loop;
  end if;
  if w is not null then
    v_mon := to_char(w, 'FMMonth YYYY');
    if dd in (25, 28, 1, 4) then
      for r in select p.id from public.persons p where p.status = 'active' and exists (select 1 from app.managers_of(p.id))
                and not exists (select 1 from public.monthly_scores s where s.person_id = p.id and s.month = w and s.self_at is not null) loop
        perform app.perf_nudge(r.id, 'self_review', 'Your self-review for ' || v_mon || ' is open until the 5th. Score yourself first; your manager scores after you.', '/reviews'); n := n + 1;
      end loop;
    end if;
    if dd in (27, 30, 2, 4, 5) then
      for r in select m, count(*) c from public.monthly_scores s, app.managers_of(s.person_id) m where s.month = w and s.status = 'self' group by 1 loop
        perform app.perf_nudge(r.m, 'score_due', r.c || ' of your team have submitted their ' || v_mon || ' self-review and are waiting for your score. Scoring closes on the 5th.', '/reviews'); n := n + 1;
      end loop;
    end if;
  end if;
  if dd in (3, 5, 7, 10) and v_hr is not null and exists (select 1 from public.monthly_scores s where s.status = 'scored') then
    perform app.perf_nudge(v_hr, 'lock_due', (select count(*) from public.monthly_scores s where s.status = 'scored') || ' monthly scores are waiting for HR to confirm and lock.', '/reviews'); n := n + 1;
  end if;
  return n;
end $$;
revoke all on function app.performance_reminders(), app.perf_nudge(uuid, text, text, text), app.managers_of(uuid) from public, anon, authenticated;

do $mig$
declare v text; o text;
begin
  v := pg_get_functiondef('app.sync_all()'::regprocedure); o := v;
  if position('app.performance_reminders()' in v) = 0 then
    v := replace(v, '  perform app.task_update_reminders();', E'  perform app.task_update_reminders();\n  perform app.performance_reminders();');
    if v = o then raise exception 'sync_all anchor not found'; end if;
    execute v;
  end if;
exception when undefined_function then raise notice 'sync_all not present (local)';
end $mig$;

-- ---------------------------------------------------------------- the person closes the loop, and can look back
create or replace function public.ack_score(p_month date, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_m date := date_trunc('month', p_month)::date; v_hr uuid := app.hr_owner();
begin
  if app.me() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  update public.monthly_scores set ack_at = now(), ack_note = nullif(btrim(coalesce(p_note, '')), '') where person_id = app.me() and month = v_m and status = 'locked';
  if not found then raise exception 'There is no final score for that month yet.' using errcode = 'P0002'; end if;
  if nullif(btrim(coalesce(p_note, '')), '') is not null and v_hr is not null then
    insert into public.notifications(person_id, kind, message, link)
    values (v_hr, 'review', (select full_name from public.persons where id = app.me()) || ' commented on their ' || to_char(v_m, 'FMMonth YYYY') || ' score: ' || left(btrim(p_note), 300), '/reviews');
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.my_score_history() returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  if app.me() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('month', s.month, 'final', s.final, 'kpi', s.kpi_final, 'attr', s.attr_final, 'self_kpi', s.self_kpi, 'self_attr', s.self_attr,
            'ack_at', s.ack_at, 'ack_note', s.ack_note) order by s.month desc), '[]'::jsonb)
            from public.monthly_scores s where s.person_id = app.me() and s.status = 'locked');
end $$;
revoke all on function public.ack_score(date, text), public.my_score_history() from public, anon;
grant execute on function public.ack_score(date, text), public.my_score_history() to authenticated;
