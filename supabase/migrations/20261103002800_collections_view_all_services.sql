-- Collections view lists every client served at a location (so managers can set targets before any figures exist).
do $do$
declare d text;
begin
  d := pg_get_functiondef('public.collections_view(date)'::regprocedure);
  d := replace(d, $r$union select branch_id, client_id from public.target_allocations where$r$,
                  $r$union select branch_id, client_id from public.client_locations where valid @> v_e
            union select branch_id, client_id from public.target_allocations where$r$);
  if position('client_locations where valid' in d) = 0 then raise exception 'collections_view anchor not found'; end if;
  execute d;
end $do$;
