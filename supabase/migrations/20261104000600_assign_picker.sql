-- D-64 support: who the signed-in person may assign a task to (for the picker), and the due date carried in the task detail.
create or replace function public.assignable_people()
returns table(id uuid, full_name text, designation text, relation text)
language sql stable security definer set search_path = public, app, pg_temp as $$
  with mgr as (select r.manager_id id from public.reporting_lines r where r.person_id = app.me() and r.valid @> app.today()),
  peers as (select b.person_id id from public.reporting_lines a join public.reporting_lines b on b.manager_id = a.manager_id and b.function = a.function
             where a.person_id = app.me() and a.valid @> app.today() and b.valid @> app.today()),
  team as (select unnest(app.my_people()) id)
  select p.id, p.full_name, p.designation,
         case when p.id in (select id from mgr) then 'My manager' when p.id in (select id from team) then 'My team'
              when p.id in (select id from peers) then 'Peer' else 'Organisation' end
    from public.persons p
   where p.status in ('active','invited') and p.id <> app.me() and app.can_assign_to(p.id)
   order by case when p.id in (select id from team) then 1 when p.id in (select id from mgr) then 2 when p.id in (select id from peers) then 3 else 4 end, p.full_name
$$;
grant execute on function public.assignable_people() to authenticated;
revoke all on function public.assignable_people() from public, anon;

do $do$
declare f text; o text;
begin
  f := pg_get_functiondef('public.assign_task(uuid[],text,text,date)'::regprocedure); o := f;
  f := replace(f, '''for'', v_for, ''for_name''', '''due'', p_due, ''for'', v_for, ''for_name''');
  if f = o then raise exception 'assign_task anchor not found'; end if;
  execute f;
end $do$;

-- Admin ends an EA or Product Head assignment the same way as any other dated assignment.
do $do$
declare f text; o text;
begin
  f := pg_get_functiondef('public.end_assignment(text,uuid,date,text)'::regprocedure); o := f;
  f := replace(f, '''reporting_lines'',''allocations'',''role_assignments'',''branch_zones'',''client_locations'')',
                  '''reporting_lines'',''allocations'',''role_assignments'',''branch_zones'',''client_locations'',''ea_assignments'',''product_heads'')');
  if f = o then raise exception 'end_assignment anchor not found'; end if;
  execute f;
end $do$;
