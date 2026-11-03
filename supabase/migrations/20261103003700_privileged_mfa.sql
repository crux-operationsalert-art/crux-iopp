-- D-54 (SOW 13.3 / 17): two-step sign-in (authenticator app, Supabase Auth TOTP — free) for privileged accounts.
-- When the setting is on, Admin, HR, Leadership / Auditor powers work only in a session verified with the 6-digit code
-- (JWT aal2). Other roles (Operations Head, managers, executives) are unaffected. Off by default; Admin can turn it on
-- only after setting up their own authenticator, so nobody is locked out.
insert into public.settings(key, value, description, label, help, kind, section, editable)
values ('privileged_mfa_required', 'false', 'Require two-step sign-in for Admin, HR and Leadership (D-54)',
        'Two-step sign-in for Admin, HR and Leadership',
        'When on, Admin, HR and Leadership powers need the 6-digit code from an authenticator app at sign-in. Set up your own code in My profile first.',
        'toggle', 'Sign-in', true)
on conflict (key) do nothing;

create or replace function app.mfa_pending() returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select coalesce((app.setting('privileged_mfa_required') #>> '{}')::boolean, false)
     and coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal', 'aal1') <> 'aal2'
$$;

create or replace function app.has_role(p_role app.role_code, p_date date default null)
returns boolean language sql stable security definer set search_path = public, app, pg_temp as $$
  select exists (select 1 from public.role_assignments r
                  where r.person_id = app.me()
                    and (r.role = p_role or (p_role = 'auditor' and r.role::text = 'leadership'))
                    and r.valid @> coalesce(p_date, app.today())
                    and not (r.role::text in ('admin','hr_admin','auditor','leadership') and app.mfa_pending()))
$$;

-- Turning it on needs your own verified authenticator.
do $do$
declare f text; o text;
begin
  f := pg_get_functiondef('public.set_setting(text,jsonb)'::regprocedure); o := f;
  f := replace(f, '  perform set_config(''app.reason'', ''setting changed: '' || p_key, true);',
'  if p_key = ''privileged_mfa_required'' and p_value = ''true''::jsonb
     and not exists (select 1 from auth.mfa_factors m where m.user_id = auth.uid() and m.status = ''verified'') then
    raise exception ''Set up two-step sign-in for your own account first (My profile → Two-step sign-in), then turn this on.'' using errcode = ''P0001'';
  end if;
  perform set_config(''app.reason'', ''setting changed: '' || p_key, true);');
  if f = o then raise exception 'set_setting anchor not found'; end if;
  execute f;
end $do$;

-- What the app needs to ask for the code.
create or replace function public.my_mfa_status() returns jsonb
language sql stable security definer set search_path = public, app, pg_temp as $$
  select jsonb_build_object(
    'required', coalesce((app.setting('privileged_mfa_required') #>> '{}')::boolean, false),
    'privileged', exists (select 1 from public.role_assignments r where r.person_id = app.me() and r.valid @> app.today()
                           and r.role::text in ('admin','hr_admin','auditor','leadership')),
    'aal', coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal', 'aal1'))
$$;
grant execute on function public.my_mfa_status() to authenticated;
revoke all on function public.my_mfa_status() from anon;
grant execute on function app.mfa_pending() to authenticated;
