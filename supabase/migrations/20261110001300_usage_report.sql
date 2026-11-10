-- D-109 Admin usage report: in-app engagement across everyone, to view and share (CSV). In-app time only (the app cannot
--  and does not see other apps on a device). HR / Admin only.
create or replace function public.usage_report(p_days int default 21) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_from date := app.today() - greatest(1, least(coalesce(p_days, 21), 90)); v_people jsonb; v_hours jsonb; v_total bigint; v_active int;
begin
  if not (app.is_admin() or app.has_role('hr_admin')) then raise exception 'Only HR and Admin can see the usage report.' using errcode = '42501'; end if;
  select coalesce(sum(seconds), 0) into v_total from public.app_activity where day >= v_from;
  with h as (select hour, sum(seconds) s from public.app_activity where day >= v_from group by hour)
  select jsonb_agg(coalesce((select s from h where h.hour = g), 0) order by g) into v_hours from generate_series(0, 23) g;
  with act as (
    select a.person_id, sum(a.seconds) secs, count(distinct a.day) days,
           (array_agg(a.hour order by a.seconds desc))[1] busy
      from public.app_activity a where a.day >= v_from group by a.person_id)
  select jsonb_agg(jsonb_build_object('person_id', p.id, 'full_name', p.full_name, 'designation', p.designation,
            'total_seconds', coalesce(act.secs, 0), 'days_active', coalesce(act.days, 0), 'busiest_hour', act.busy,
            'installed', cs.last_standalone is not null, 'last_active', cs.last_active) order by coalesce(act.secs, 0) desc, p.full_name)
    into v_people
    from public.persons p
    left join act on act.person_id = p.id
    left join public.client_seen cs on cs.person_id = p.id
   where p.status = 'active' and p.auth_user_id is not null;
  v_active := (select count(distinct person_id) from public.app_activity where day >= v_from);
  return jsonb_build_object('from', v_from, 'days', p_days, 'total_seconds', v_total, 'by_hour', coalesce(v_hours, '[]'),
    'total_people', (select count(*) from public.persons where status = 'active' and auth_user_id is not null),
    'active_people', v_active, 'people', coalesce(v_people, '[]'));
end $$;
revoke all on function public.usage_report(int) from public, anon;
grant execute on function public.usage_report(int) to authenticated;
