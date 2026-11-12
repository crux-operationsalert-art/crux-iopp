-- D-140  Set up a team in one go: copy one person's KPIs (with targets) and attributes to others.
create or replace function public.scorecard_copy(p_from uuid, p_to uuid[]) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_today date := app.today(); v_kpis jsonb; v_attrs uuid[]; v_p uuid; v_done int := 0; v_fail jsonb := '[]'::jsonb;
begin
  if app.me() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not app.can_setup_scorecard(p_from) then raise exception 'Only the reporting manager or HR/Admin can copy this scorecard.' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('kpi_id', a.kpi_id, 'target', a.target, 'cadence', a.cadence, 'higher_better', a.higher_better)), '[]'::jsonb) into v_kpis
    from public.kpi_assignment a where a.person_id = p_from and a.valid @> v_today;
  select coalesce(array_agg(a.attribute_id), '{}') into v_attrs from public.person_attributes a where a.person_id = p_from and a.valid @> v_today;
  if jsonb_array_length(v_kpis) < 3 or cardinality(v_attrs) < 3 then raise exception 'Set this person''s own KPIs and attributes first, then copy them.' using errcode = 'P0001'; end if;
  foreach v_p in array coalesce(p_to, '{}') loop
    continue when v_p = p_from;
    begin
      perform public.scorecard_save(v_p, null, v_kpis, v_attrs); v_done := v_done + 1;
    exception when others then
      v_fail := v_fail || jsonb_build_object('name', (select full_name from public.persons where id = v_p), 'why', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('done', v_done, 'failed', v_fail);
end $$;
revoke all on function public.scorecard_copy(uuid, uuid[]) from public, anon;
grant execute on function public.scorecard_copy(uuid, uuid[]) to authenticated;
