-- Leader "My team → People" list: everyone in my reporting subtree (both functions), with role, login ID,
-- activation state and current allocations. Admin / HR see everyone. Read-only; additive.
create or replace function public.my_team_people()
returns table(person_id uuid, full_name text, designation text, mobile text, email text, resource_type text, status text,
              roles text[], function text, manager_id uuid, manager_name text, depth int, allocations text[])
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); v_d date := app.today(); v_all boolean;
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  v_all := app.is_admin() or app.has_role('hr_admin');
  return query
  with scope as (
    select s.person_id, min(s.depth) depth from (
      select x.person_id, x.depth from app.subtree(v_me, 'operations', v_d) x
      union all select x.person_id, x.depth from app.subtree(v_me, 'collections', v_d) x
      union all select p.id, 99 from public.persons p where v_all and p.id <> v_me) s
    group by s.person_id)
  select p.id, p.full_name, p.designation, p.mobile, p.personal_email, p.resource_type, p.status,
         (select coalesce(array_agg(distinct r.role::text), '{}') from public.role_assignments r where r.person_id = p.id and r.valid @> v_d),
         rl.function::text, rl.manager_id, m.full_name, sc.depth,
         (select coalesce(array_agg(c.name || ' · ' || l.name order by c.name, l.name), '{}')
            from public.allocations a join public.client_locations cl on cl.id = a.client_location_id
            join public.clients c on c.id = cl.client_id join public.locations l on l.id = cl.location_id
           where a.person_id = p.id and a.valid @> v_d)
    from scope sc join public.persons p on p.id = sc.person_id
    left join lateral (select r.function, r.manager_id from public.reporting_lines r
                        where r.person_id = p.id and r.valid @> v_d order by r.function limit 1) rl on true
    left join public.persons m on m.id = rl.manager_id
   where p.status <> 'exited'
   order by sc.depth, p.full_name;
end $$;
revoke all on function public.my_team_people() from public, anon;
grant execute on function public.my_team_people() to authenticated;
