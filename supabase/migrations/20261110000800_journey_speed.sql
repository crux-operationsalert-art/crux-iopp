-- D-98 speed: work out the 120 days once per person (was twice) — the Home screen calls this on every visit.
do $do$
declare f text := pg_get_functiondef('app.journey(uuid)'::regprocedure);
        a1 text := $a$declare r record; $a$;
        b1 text := $b$declare r record; v_days jsonb; $b$;
        a2 text := $a$  for r in select * from app.journey_days(p_person, 120) loop$a$;
        b2 text := $b$  select jsonb_agg(jsonb_build_object('d', x.d, 'result', x.result, 'early', x.early) order by x.d desc) into v_days from app.journey_days(p_person, 120) x;
  for r in select (e->>'d')::date d, e->>'result' result, (e->>'early')::boolean early from jsonb_array_elements(coalesce(v_days, '[]')) e loop$b$;
        a3 text := $a$  for r in select * from app.journey_days(p_person, 120) order by d loop$a$;
        b3 text := $b$  for r in select (e->>'d')::date d, e->>'result' result from jsonb_array_elements(coalesce(v_days, '[]')) e order by 1 loop$b$;
begin
  if position(a1 in f) = 0 or position(a2 in f) = 0 or position(a3 in f) = 0 then raise exception 'journey anchors not found'; end if;
  execute replace(replace(replace(f, a1, b1), a2, b2), a3, b3);
end $do$;
