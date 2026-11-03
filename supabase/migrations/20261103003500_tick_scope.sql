-- D-52 (cont.): ticking a client can no longer open up a location you are not part of. You can tick clients only at
-- locations where you, someone in your team, or your manager already works or is the head. Admin / HR unchanged.
create or replace function app.allowed_branches(p_person uuid, p_date date)
returns setof uuid language sql stable security definer set search_path = public, app, pg_temp as $$
  with ppl as (select p_person pid
               union select s.person_id from app.subtree(p_person, 'operations', p_date) s
               union select s.person_id from app.subtree(p_person, 'collections', p_date) s
               union select r.manager_id from public.reporting_lines r where r.person_id = p_person and r.valid @> p_date)
  select distinct cl.branch_id from public.allocations a join ppl on ppl.pid = a.person_id
    join public.client_locations cl on cl.id = a.client_location_id where a.valid @> p_date
  union
  select distinct h.branch_id from public.location_heads h join ppl on ppl.pid = h.person_id where h.valid @> p_date
$$;
revoke all on function app.allowed_branches(uuid, date) from public, anon, authenticated;

do $do$
declare f text; o text;
begin
  f := pg_get_functiondef('public.my_services(uuid)'::regprocedure); o := f;
  f := replace(f, '   where cl.valid @> v_d and c.active and l.active',
                  '   where cl.valid @> v_d and c.active and l.active
     and (app.is_admin() or app.has_role(''hr_admin'') or mine.client_location_id is not null
          or cl.branch_id in (select app.allowed_branches(v_p, v_d)))');
  if f = o then raise exception 'my_services anchor not found'; end if;
  execute f;

  f := pg_get_functiondef('public.set_service_active(uuid,boolean,uuid,text)'::regprocedure); o := f;
  f := replace(f, '  if p_active then
    if v_a.id is not null then',
'  if p_active and v_a.id is null and not (app.is_admin() or app.has_role(''hr_admin''))
     and (select cl.branch_id from public.client_locations cl where cl.id = p_client_location) not in (select app.allowed_branches(v_p, v_d)) then
    raise exception ''This location is not assigned to you or your team. Ask your manager or Admin to add it.'' using errcode = ''42501'';
  end if;
  if p_active then
    if v_a.id is not null then');
  if f = o then raise exception 'set_service_active anchor not found'; end if;
  execute f;
end $do$;
