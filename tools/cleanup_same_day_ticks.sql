-- One-off, run manually (needs confirmation): removes ticks left active by the pre-D-47 behaviour.
-- Clean up ticks that were left active by the old behaviour: same-day allocations ending tomorrow with no figures.
delete from public.allocations a
 where a.function = 'operations' and lower(a.valid) = app.today() and upper(a.valid) = app.today() + 1
   and not exists (select 1 from public.productivity_lines l where l.person_id = a.person_id
                    and l.client_location_id = a.client_location_id and l.work_date = app.today());
