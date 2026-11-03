-- D-55 (SOW 10.5 / acceptance 17): Sunday / holiday work — start, end, break and hours, manager approval, and an
-- approved-work report for HR. The pay rule (full day or hours) is a setting kept for the report only: nothing is
-- added to or deducted from pay by the tool.
create table if not exists public.extra_work (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id),
  work_date date not null,
  start_time time not null, end_time time not null,
  break_minutes int not null default 0 check (break_minutes between 0 and 600),
  minutes int generated always as (greatest(0, (extract(epoch from (end_time - start_time)) / 60)::int - break_minutes)) stored,
  note text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by uuid references public.persons(id), decided_at timestamptz, decision_note text,
  created_at timestamptz not null default now(),
  unique (person_id, work_date),
  check (end_time > start_time)
);
alter table public.extra_work enable row level security;
create policy read_extra_work on public.extra_work for select to authenticated
  using (app.can_view_person(person_id, work_date, 'operations') or app.has_role('hr_admin'));
grant select on public.extra_work to authenticated;
create trigger trg_audit after insert or update on public.extra_work for each row execute function app.audit();

insert into public.settings(key, value, description, label, help, kind, section, editable)
values ('extra_work_basis', '"full_day"', 'How Sunday / holiday work is counted in the HR report (D-55)', 'Sunday / holiday work counted as',
        'For the HR report only — full_day or hours. Nothing is added to pay by the tool until HR / Legal approve a policy.', 'choice:full_day,hours', 'Attendance', true)
on conflict (key) do nothing;

create or replace function public.save_extra_work(p_date date, p_start time, p_end time, p_break int default 0, p_note text default null)
returns public.extra_work language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v public.extra_work;
begin
  if app.me() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if app.is_working_day(p_date) then raise exception '% is a normal working day — extra work is only for Sundays and holidays.', to_char(p_date, 'DD Mon') using errcode = 'P0001'; end if;
  if p_date > app.today() or p_date < app.today() - 31 then raise exception 'Record extra work within 31 days.' using errcode = 'P0001'; end if;
  if p_end <= p_start then raise exception 'End time must be after the start time.' using errcode = '22023'; end if;
  if exists (select 1 from public.extra_work where person_id = app.me() and work_date = p_date and status <> 'pending') then
    raise exception 'This day was already decided by your manager.' using errcode = 'P0001'; end if;
  insert into public.extra_work(person_id, work_date, start_time, end_time, break_minutes, note)
  values (app.me(), p_date, p_start, p_end, coalesce(p_break, 0), nullif(trim(p_note), ''))
  on conflict (person_id, work_date) do update set start_time = excluded.start_time, end_time = excluded.end_time,
    break_minutes = excluded.break_minutes, note = excluded.note
  returning * into v;
  insert into public.notifications(person_id, kind, message, link)
  select r.manager_id, 'extra_work', (select full_name from public.persons where id = app.me()) || ' worked on ' || to_char(p_date, 'DD Mon') || ' (' || round(v.minutes / 60.0, 1) || ' h). Please approve.', '/attendance'
    from public.reporting_lines r where r.person_id = app.me() and r.function = 'operations' and r.valid @> p_date;
  return v;
end $$;

create or replace function public.decide_extra_work(p_id uuid, p_approve boolean, p_note text default null)
returns public.extra_work language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v public.extra_work;
begin
  select * into v from public.extra_work where id = p_id;
  if v.id is null then raise exception 'Not found.' using errcode = 'P0002'; end if;
  if v.person_id = app.me() or not (app.is_admin() or app.has_role('hr_admin')
       or exists (select 1 from public.reporting_lines r where r.person_id = v.person_id and r.manager_id = app.me() and r.valid @> v.work_date)) then
    raise exception 'Only the person''s manager, HR or Admin can decide this.' using errcode = '42501'; end if;
  if not p_approve and coalesce(trim(p_note), '') = '' then raise exception 'Give a reason for rejecting.' using errcode = 'P0001'; end if;
  update public.extra_work set status = case when p_approve then 'approved' else 'rejected' end, decided_by = app.me(), decided_at = now(),
         decision_note = nullif(trim(p_note), '') where id = p_id returning * into v;
  insert into public.notifications(person_id, kind, message, link)
  values (v.person_id, 'extra_work', 'Your work on ' || to_char(v.work_date, 'DD Mon') || ' was ' || v.status || coalesce(': ' || v.decision_note, '') || '.', '/attendance');
  return v;
end $$;

-- People's extra work in your scope (the HR report): who, when, hours, status, counted as.
create or replace function public.extra_work_report(p_from date, p_to date)
returns table(id uuid, person_id uuid, full_name text, work_date date, start_time time, end_time time, break_minutes int, hours numeric,
              status text, note text, decided_by text, decision_note text, counted_as text, can_decide boolean)
language sql stable security definer set search_path = public, app, pg_temp as $$
  select e.id, e.person_id, p.full_name, e.work_date, e.start_time, e.end_time, e.break_minutes, round(e.minutes / 60.0, 2), e.status, e.note,
         (select full_name from public.persons where id = e.decided_by), e.decision_note,
         case when (app.setting('extra_work_basis') #>> '{}') = 'hours' then round(e.minutes / 60.0, 2) || ' h' else '1 day' end,
         e.person_id <> app.me() and (app.is_admin() or app.has_role('hr_admin')
           or exists (select 1 from public.reporting_lines r where r.person_id = e.person_id and r.manager_id = app.me() and r.valid @> e.work_date))
    from public.extra_work e join public.persons p on p.id = e.person_id
   where e.work_date between p_from and p_to
     and (app.can_view_person(e.person_id, e.work_date, 'operations') or app.has_role('hr_admin'))
   order by e.work_date desc, p.full_name
$$;
grant execute on function public.save_extra_work(date, time, time, int, text), public.decide_extra_work(uuid, boolean, text), public.extra_work_report(date, date) to authenticated;
revoke all on function public.save_extra_work(date, time, time, int, text), public.decide_extra_work(uuid, boolean, text), public.extra_work_report(date, date) from anon;
