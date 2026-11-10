-- D-110 Adoption report: for HR / Admin, the state of take-up across everyone — who is signed up, who has the app, who is
--  using it, and, per team, how many have a complete profile vs still pending. Built from operational signals (account
--  status, install/last-seen for reminders, profile completeness). No behavioural tracking of anything outside CRUX.
create or replace function public.adoption_report(p_days int default 7) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_cut timestamptz := app.clock() - make_interval(days => greatest(1, least(coalesce(p_days, 7), 90)));
        v_overall jsonb; v_teams jsonb; v_people jsonb;
begin
  if not (app.is_admin() or app.has_role('hr_admin')) then raise exception 'Only HR and Admin can see the adoption report.' using errcode = '42501'; end if;

  with b as (
    select p.id, p.full_name, p.designation, p.status, p.resource_type,
           p.auth_user_id is not null activated,
           h.completed_at is not null profile_complete,
           cs.last_seen, cs.last_standalone is not null installed,
           (cs.last_seen is not null and cs.last_seen >= v_cut) active
      from public.persons p
      left join public.hr_profiles h on h.person_id = p.id
      left join public.client_seen cs on cs.person_id = p.id
     where p.status in ('active', 'invited'))
  select jsonb_build_object(
    'total', count(*),
    'invited', count(*) filter (where status = 'invited' or not activated),
    'activated', count(*) filter (where activated),
    'installed', count(*) filter (where installed),
    'browser_only', count(*) filter (where activated and not installed and last_seen is not null),
    'never_opened', count(*) filter (where activated and last_seen is null),
    'active', count(*) filter (where active),
    'inactive', count(*) filter (where activated and not active),
    'profile_complete', count(*) filter (where profile_complete),
    'profile_pending', count(*) filter (where not profile_complete)
  ) into v_overall from b;

  -- by team: the operations manager each person reports to
  with b as (
    select p.id, (h.completed_at is not null) profile_complete, (p.auth_user_id is not null) activated,
           (cs.last_seen is not null and cs.last_seen >= v_cut) active,
           (select r.manager_id from public.reporting_lines r where r.person_id = p.id and r.function = 'operations' and r.valid @> app.today() limit 1) mgr
      from public.persons p
      left join public.hr_profiles h on h.person_id = p.id
      left join public.client_seen cs on cs.person_id = p.id
     where p.status = 'active')
  select jsonb_agg(jsonb_build_object('manager_id', mgr, 'manager', m.full_name, 'members', cnt,
            'activated', act, 'active', acv, 'profile_complete', comp, 'profile_pending', cnt - comp) order by (cnt - comp) desc, m.full_name)
    into v_teams
    from (select mgr, count(*) cnt, count(*) filter (where profile_complete) comp, count(*) filter (where activated) act, count(*) filter (where active) acv
            from b where mgr is not null group by mgr) t
    join public.persons m on m.id = t.mgr;

  with b as (
    select p.id, p.full_name, p.designation, p.status, p.auth_user_id is not null activated,
           h.completed_at is not null profile_complete, cs.last_seen, cs.last_standalone is not null installed,
           (cs.last_seen is not null and cs.last_seen >= v_cut) active,
           (select mm.full_name from public.reporting_lines r join public.persons mm on mm.id = r.manager_id
              where r.person_id = p.id and r.function = 'operations' and r.valid @> app.today() limit 1) manager
      from public.persons p
      left join public.hr_profiles h on h.person_id = p.id
      left join public.client_seen cs on cs.person_id = p.id
     where p.status in ('active', 'invited'))
  select jsonb_agg(jsonb_build_object('person_id', id, 'full_name', full_name, 'designation', designation, 'status', status,
            'manager', manager, 'activated', activated, 'installed', installed, 'active', active, 'profile_complete', profile_complete,
            'last_seen', last_seen) order by activated, active, full_name)
    into v_people from b;

  return jsonb_build_object('days', p_days, 'overall', v_overall, 'teams', coalesce(v_teams, '[]'), 'people', coalesce(v_people, '[]'));
end $$;
revoke all on function public.adoption_report(int) from public, anon;
grant execute on function public.adoption_report(int) to authenticated;

-- Lighten the agreement wording per the owner's instruction: keep it honest but not a spotlight on hours/duration.
update public.agreement_versions
   set body = replace(body,
     'CRUX also records how you use the App itself — including the times of day you are active and how long you spend in it — to run reminders and to understand and improve adoption. This covers the App only; the App does not and cannot access other apps on your device.',
     'CRUX records your activity in the App (for example when you are active and whether you have installed it) to run reminders and understand adoption. This covers the App only; it does not and cannot access other apps, files or anything else on your device.')
 where version = 'v1' and body like '%times of day you are active%';
