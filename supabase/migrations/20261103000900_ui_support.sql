-- Small read helpers for the UI (no business rule lives in the browser).
create or replace function public.target_lock_info(p_month date)
returns jsonb language sql stable security definer set search_path = public, app, pg_temp as $$
  select case when app.me() is null then null else jsonb_build_object(
    'month', date_trunc('month', p_month)::date,
    'lock_at', app.target_lock_at(p_month),
    'locked', app.clock() >= app.target_lock_at(p_month),
    'reopened', exists (select 1 from public.reopen_grants g where g.kind = 'target' and g.person_id = app.me()
                         and g.target_month = date_trunc('month', p_month)::date and g.revoked_at is null and g.expires_at > app.clock()))
  end
$$;
revoke all on function public.target_lock_info(date) from anon, public;
grant execute on function public.target_lock_info(date) to authenticated;
