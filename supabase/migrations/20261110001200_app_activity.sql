-- D-105 In-app engagement: how long each person spends in CRUX, and in which hour of the day (Asia/Kolkata), so Admin can
--  see adoption on the person's profile. This records time spent in THIS app only — a web app cannot see other apps on a
--  phone, and nothing here attempts to. It is noted in the user agreement; it is not hidden from the people it measures.

create table if not exists public.app_activity (
  person_id uuid not null references public.persons(id),
  day date not null,
  hour int not null check (hour between 0 and 23),
  seconds int not null default 0,
  primary key (person_id, day, hour)
);
alter table public.app_activity enable row level security;
revoke all on public.app_activity from anon, authenticated;   -- written and read only through the functions below

/** The app calls this every so often while open and in front; it adds the time to the current hour's bucket (IST). */
create or replace function public.record_activity(p_seconds int) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); v_now timestamptz := app.clock(); v_day date; v_hour int; v_s int := greatest(0, least(coalesce(p_seconds, 0), 900));
begin
  if v_me is null or v_s = 0 then return; end if;
  v_day := (v_now at time zone app.tz())::date;
  v_hour := extract(hour from v_now at time zone app.tz())::int;
  insert into public.app_activity(person_id, day, hour, seconds) values (v_me, v_day, v_hour, v_s)
  on conflict (person_id, day, hour) do update set seconds = public.app_activity.seconds + v_s;
  -- keep presence fresh even when Chat is not open
  insert into public.client_seen as c (person_id, last_seen, last_active) values (v_me, v_now, v_now)
  on conflict (person_id) do update set last_active = v_now, last_seen = greatest(c.last_seen, v_now);
end $$;
revoke all on function public.record_activity(int) from public, anon;
grant execute on function public.record_activity(int) to authenticated;

/** Admin / HR: one person's in-app time — total, by day, and by hour of day — for the last p_days days. */
create or replace function public.person_activity(p_person uuid, p_days int default 21) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_from date := app.today() - greatest(1, least(coalesce(p_days, 21), 90)); v_hours jsonb; v_days jsonb; v_total bigint;
begin
  if not (app.is_admin() or app.has_role('hr_admin')) then raise exception 'Only HR and Admin can see app usage.' using errcode = '42501'; end if;
  select coalesce(sum(seconds), 0) into v_total from public.app_activity where person_id = p_person and day >= v_from;
  with h as (select hour, sum(seconds) s from public.app_activity where person_id = p_person and day >= v_from group by hour)
  select jsonb_agg(coalesce((select s from h where h.hour = g), 0) order by g) into v_hours from generate_series(0, 23) g;
  with d as (select day, sum(seconds) s from public.app_activity where person_id = p_person and day >= v_from group by day)
  select coalesce(jsonb_agg(jsonb_build_object('day', day, 'seconds', s) order by day), '[]') into v_days from d;
  return jsonb_build_object('total_seconds', v_total, 'days', v_days, 'by_hour', coalesce(v_hours, '[]'), 'from', v_from,
    'last_active', (select last_active from public.client_seen where person_id = p_person),
    'busiest_hour', (select hour from public.app_activity where person_id = p_person and day >= v_from group by hour order by sum(seconds) desc limit 1));
end $$;
revoke all on function public.person_activity(uuid, int) from public, anon;
grant execute on function public.person_activity(uuid, int) to authenticated;

-- Note the in-app activity recording in the agreement text (transparency; the App measures only itself).
update public.agreement_versions
   set body = replace(body,
     'Your own profile data is used by CRUX for employment / engagement, payroll / payout and compliance purposes and is visible only to you, HR and Admin (salary also to your manager).',
     'Your own profile data is used by CRUX for employment / engagement, payroll / payout and compliance purposes and is visible only to you, HR and Admin (salary also to your manager). CRUX also records how you use the App itself — including the times of day you are active and how long you spend in it — to run reminders and to understand and improve adoption. This covers the App only; the App does not and cannot access other apps on your device.')
 where version = 'v1' and body not like '%does not and cannot access other apps%';
