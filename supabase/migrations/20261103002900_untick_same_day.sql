-- D-47: Unticking a client the same day it was ticked (or before it starts), with no figures entered today,
-- removes the allocation straight away. Previously it stayed active "until tomorrow", so the client kept
-- showing in My day after it was unticked.
create or replace function public.set_service_active(p_client_location uuid, p_active boolean, p_person uuid default null,
                                                     p_reason text default null)
returns text
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_p uuid := coalesce(p_person, app.me()); v_d date := app.today(); v_a public.allocations; v_end date; v_lines boolean;
begin
  if app.me() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if v_p <> app.me() then
    if not (app.is_admin() or app.has_role('hr_admin')
            or exists (select 1 from app.subtree(app.me(), 'operations', v_d) s where s.person_id = v_p)) then
      raise exception 'You can only change clients for yourself or your team.' using errcode = '42501';
    end if;
    if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required when changing someone else''s clients.' using errcode = 'P0001'; end if;
  end if;
  perform set_config('app.reason', coalesce(nullif(trim(p_reason), ''), case when p_active then 'started working on client' else 'stopped working on client' end), true);
  select * into v_a from public.allocations a where a.person_id = v_p and a.client_location_id = p_client_location
     and a.function = 'operations' and (a.valid @> v_d or lower(a.valid) > v_d or upper(a.valid) = v_d)
   order by lower(a.valid) desc limit 1;
  if p_active then
    if v_a.id is not null then
      update public.allocations set valid = daterange(least(lower(valid), v_d), null) where id = v_a.id;
    else
      insert into public.allocations(person_id, client_location_id, function, valid) values (v_p, p_client_location, 'operations', daterange(v_d, null));
    end if;
    return 'active';
  end if;
  if v_a.id is null or not upper_inf(v_a.valid) then return 'inactive'; end if;
  v_lines := exists (select 1 from public.productivity_lines l where l.person_id = v_p
                      and l.work_date = v_d and l.client_location_id = p_client_location);
  if lower(v_a.valid) >= v_d and not v_lines then
    delete from public.allocations where id = v_a.id;   -- started today or later, nothing entered: undo the tick (audited)
    return 'inactive';
  end if;
  v_end := case when v_lines then v_d + 1 else v_d end;
  update public.allocations set valid = daterange(lower(valid), v_end) where id = v_a.id;
  return case when v_end = v_d then 'inactive' else 'inactive from tomorrow' end;
end $$;
