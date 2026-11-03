-- Bulk upload: a new rate / partner-ratio version ends the open-ended previous version the day before
-- (effective-dated history is kept; the closed-month guard still applies). Additive: replaces app.bulk_row only.
create or replace function app.bulk_row(p_kind text, r jsonb) returns void
language plpgsql security definer set search_path = public, app, extensions, pg_temp as $$
declare v_id uuid; v_cl uuid; v_from date := coalesce(app.to_date(app.v(r,'valid_from')), app.today()); v_to date := app.to_date(app.v(r,'valid_to'));
        v_proc uuid;
begin
  case p_kind
  when 'zones' then
    insert into public.zones(code, name, region) values (coalesce(app.v(r,'code'), 'Z-' || app.slug(app.v(r,'name'))), app.v(r,'name'), app.v(r,'region'))
    on conflict (code) do update set name = excluded.name, region = coalesce(excluded.region, public.zones.region);
  when 'branches' then
    insert into public.branches(code, name, branch_type, type_confirmed, state, city)
    values (coalesce(app.v(r,'code'), 'B-' || app.slug(app.v(r,'name'))), app.v(r,'name'), coalesce(lower(app.v(r,'type')), 'own'),
            app.v(r,'type') is not null, app.v(r,'state'), app.v(r,'city'))
    on conflict (code) do update set name = excluded.name, branch_type = excluded.branch_type, type_confirmed = excluded.type_confirmed,
       state = coalesce(excluded.state, public.branches.state), city = coalesce(excluded.city, public.branches.city)
    returning id into v_id;
    if app.v(r,'zone') is not null and not exists (select 1 from public.branch_zones where branch_id = v_id and valid @> v_from) then
      insert into public.branch_zones(branch_id, zone_id, valid) values (v_id, app.find('zones', app.v(r,'zone')), daterange(v_from, null));
    end if;
  when 'locations' then
    insert into public.locations(code, name, city, state) values (coalesce(app.v(r,'code'), 'L-' || app.slug(app.v(r,'name'))), app.v(r,'name'), app.v(r,'city'), app.v(r,'state'))
    on conflict (code) do update set name = excluded.name, city = coalesce(excluded.city, public.locations.city), state = coalesce(excluded.state, public.locations.state);
  when 'clients' then
    insert into public.clients(code, name, client_family) values (coalesce(app.v(r,'code'), 'C-' || app.slug(app.v(r,'name'))), app.v(r,'name'), app.v(r,'family'))
    on conflict (code) do update set name = excluded.name, client_family = coalesce(excluded.client_family, public.clients.client_family);
  when 'services' then
    v_proc := coalesce(app.find('processes', app.v(r,'process'), false), (select id from public.processes where code = 'VER'));
    insert into public.client_locations(client_id, location_id, process_id, branch_id, valid)
    values (app.find('clients', app.v(r,'client')), app.find('locations', app.v(r,'location')), v_proc,
            app.find('branches', coalesce(app.v(r,'branch'), app.v(r,'location'))), daterange(v_from, case when v_to is null then null else v_to + 1 end));
  when 'rates' then
    v_proc := coalesce(app.find('processes', app.v(r,'process'), false), (select id from public.processes where code = 'VER'));
    -- A new version supersedes the open-ended earlier one: the old rate ends the day before (never rewritten).
    update public.rate_cards set valid = daterange(lower(valid), v_from)
     where client_id = app.find('clients', app.v(r,'client')) and location_id = app.find('locations', app.v(r,'location'))
       and process_id = v_proc and upper_inf(valid) and lower(valid) < v_from;
    insert into public.rate_cards(client_id, location_id, process_id, billable_event, rate, valid, reason)
    values (app.find('clients', app.v(r,'client')), app.find('locations', app.v(r,'location')), v_proc,
            coalesce(lower(app.v(r,'earns_on')), 'entry'), app.v(r,'rate')::numeric,
            daterange(v_from, case when v_to is null then null else v_to + 1 end), coalesce(app.v(r,'reason'), 'bulk upload'));
  when 'people' then
    if app.v(r,'mobile') is not null and exists (select 1 from public.persons where right(regexp_replace(mobile, '\D', '', 'g'), 10) = right(regexp_replace(app.v(r,'mobile'), '\D', '', 'g'), 10)) then
      raise exception 'Mobile % already exists.', app.v(r,'mobile');
    end if;
    perform public.create_team_member(app.v(r,'full_name'), app.v(r,'email'), app.v(r,'mobile'),
      case when lower(coalesce(app.v(r,'type'), 'own')) like 'partner%' then 'partner' else 'own_employee' end,
      app.v(r,'designation'), lower(coalesce(app.v(r,'role'), 'executive'))::app.role_code,
      app.find('persons', app.v(r,'reports_to_mobile'), false), lower(coalesce(app.v(r,'function'), 'operations'))::app.fn, v_from,
      app.find('zones', app.v(r,'zone'), false), app.find('branches', app.v(r,'branch'), false));
  when 'allocations' then
    v_proc := coalesce(app.find('processes', app.v(r,'process'), false), (select id from public.processes where code = 'VER'));
    select id into v_cl from public.client_locations where client_id = app.find('clients', app.v(r,'client'))
       and location_id = app.find('locations', app.v(r,'location')) and process_id = v_proc and valid @> v_from;
    if v_cl is null then raise exception 'No service for % at % on % — add it under Services first.', app.v(r,'client'), app.v(r,'location'), v_from; end if;
    perform public.allocate(app.find('persons', app.v(r,'mobile')), v_cl, v_from, v_to, lower(coalesce(app.v(r,'function'), 'operations'))::app.fn);
  when 'targets' then
    perform public.set_target(app.to_date(app.v(r,'month') || case when app.v(r,'month') ~ '^\d{4}-\d{2}$' then '-01' else '' end),
      lower(app.v(r,'metric')), lower(app.v(r,'level')), app.v(r,'amount')::numeric,
      app.find('zones', app.v(r,'zone'), false), app.find('branches', app.v(r,'branch'), false),
      app.find('persons', app.v(r,'mobile'), false), app.find('clients', app.v(r,'client'), false), coalesce(app.v(r,'reason'), 'bulk upload'));
  when 'holidays' then
    insert into public.holidays(holiday_date, name, scope, state, branch_id)
    values (app.to_date(app.v(r,'date')), app.v(r,'name'), coalesce(lower(app.v(r,'scope')), 'national'), app.v(r,'state'),
            app.find('branches', app.v(r,'branch'), false))
    on conflict do nothing;
  when 'partner_ratios' then
    update public.partner_share_rules set valid = daterange(lower(valid), v_from)
     where branch_id = app.find('branches', app.v(r,'branch')) and upper_inf(valid) and lower(valid) < v_from;
    insert into public.partner_share_rules(branch_id, partner_share_pct, crux_share_pct, valid, agreement_ref, reason)
    values (app.find('branches', app.v(r,'branch')), app.v(r,'partner_pct')::numeric, 100 - app.v(r,'partner_pct')::numeric,
            daterange(v_from, null), app.v(r,'agreement_ref'), coalesce(app.v(r,'reason'), 'bulk upload'));
  when 'wip_openings' then
    select id into v_cl from public.client_locations where client_id = app.find('clients', app.v(r,'client'))
       and location_id = app.find('locations', app.v(r,'location')) and valid @> v_from limit 1;
    if v_cl is null then raise exception 'No service for % at %.', app.v(r,'client'), app.v(r,'location'); end if;
    insert into public.wip_openings(person_id, client_location_id, as_of, opening, reason, set_by)
    values (app.find('persons', app.v(r,'mobile')), v_cl, v_from, app.v(r,'opening')::int, coalesce(app.v(r,'reason'), 'bulk upload'), app.me())
    on conflict (person_id, client_location_id, as_of) do update set opening = excluded.opening, reason = excluded.reason;
  else raise exception 'Unknown upload type %.', p_kind;
  end case;
end $$;

revoke all on function app.bulk_row(text, jsonb) from public, anon, authenticated;
