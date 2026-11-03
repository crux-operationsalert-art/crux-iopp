-- Email-free sign-in (D-13 revised): Admin/HR/manager issues a one-time activation code; the person
-- sets their own password through the iopp-auth Edge Function. Login ID = mobile number (or email if no mobile).
-- No plaintext password or code is stored: only a bcrypt hash of the code, which expires after 48 working hours.

create extension if not exists pgcrypto with schema extensions;

create table app.activation_codes (
  person_id uuid primary key references public.persons(id),
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  issued_by uuid references public.persons(id),
  issued_at timestamptz not null default now(),
  used_at timestamptz
);
revoke all on app.activation_codes from public, anon, authenticated;

-- Supabase Auth needs an email-shaped identifier; mobile logins map to a non-deliverable address.
create or replace function app.login_email(p_mobile text, p_email text) returns text
language sql immutable set search_path = public, app, pg_temp as $$
  select case when coalesce(regexp_replace(p_mobile, '\D', '', 'g'), '') <> ''
              then 'm' || right(regexp_replace(p_mobile, '\D', '', 'g'), 10) || '@login.crux-iopp.app'
              else lower(trim(p_email)) end
$$;

create or replace function app.issue_activation_internal(p_person uuid, p_issued_by uuid) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_p public.persons; v_code text; v_exp timestamptz;
begin
  select * into v_p from public.persons where id = p_person;
  if v_p.id is null or v_p.status = 'exited' then raise exception 'Person not found or has exited.' using errcode = 'P0001'; end if;
  if v_p.mobile is null and v_p.personal_email is null then
    raise exception 'Add a mobile number or email before issuing an activation code.' using errcode = 'P0001';
  end if;
  v_code := upper(encode(extensions.gen_random_bytes(5), 'hex'));      -- 10 hex chars, shown as XXXXX-XXXXX
  v_exp := app.invite_expiry(app.clock());
  insert into app.activation_codes(person_id, code_hash, expires_at, attempts, issued_by, issued_at, used_at)
  values (p_person, extensions.crypt(v_code, extensions.gen_salt('bf')), v_exp, 0, p_issued_by, now(), null)
  on conflict (person_id) do update set code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0,
        issued_by = excluded.issued_by, issued_at = now(), used_at = null;
  insert into public.audit_events(actor_uid, actor_person, table_name, row_id, action, reason)
  values (auth.uid(), p_issued_by, 'activation_codes', p_person::text, 'issue', 'activation code issued (code not stored)');
  return jsonb_build_object('code', substr(v_code,1,5) || '-' || substr(v_code,6,5), 'login_id', coalesce(v_p.mobile, v_p.personal_email), 'expires_at', v_exp,
                            'full_name', v_p.full_name);
end $$;
revoke all on function app.issue_activation_internal(uuid, uuid) from public, anon, authenticated;

-- Admin / HR for anyone; a manager for people in their own tree (never themselves).
create or replace function public.issue_activation(p_person uuid) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if app.me() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not (app.is_admin() or app.has_role('hr_admin')
          or (p_person <> app.me() and exists (
                select 1 from unnest(array['operations','collections']::app.fn[]) f, lateral app.subtree(app.me(), f, app.today()) s
                 where s.person_id = p_person))) then
    raise exception 'You can only issue activation codes for your own team.' using errcode = '42501';
  end if;
  return app.issue_activation_internal(p_person, app.me());
end $$;

-- Called only by the Edge Function (service role). Five wrong codes lock the code until a new one is issued.
-- Returns no row on any failure (never raises), so the attempt counter is not rolled back.
create or replace function public.redeem_activation(p_login text, p_code text)
returns table(person_id uuid, auth_user_id uuid, login_email text, full_name text)
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_p public.persons; v_c app.activation_codes; v_login text := lower(trim(p_login));
begin
  select p.* into v_p from public.persons p
   where p.status <> 'exited'
     and ( (v_login !~ '@' and p.mobile is not null
            and right(regexp_replace(p.mobile, '\D', '', 'g'), 10) = right(regexp_replace(v_login, '\D', '', 'g'), 10))
        or (v_login ~ '@' and lower(p.personal_email) = v_login) )
   limit 1;
  if v_p.id is null then return; end if;
  select * into v_c from app.activation_codes c where c.person_id = v_p.id for update;
  if v_c.person_id is null or v_c.used_at is not null or v_c.expires_at < app.clock() or v_c.attempts >= 5 then
    return;
  end if;
  if extensions.crypt(upper(regexp_replace(p_code, '[^0-9A-Za-z]', '', 'g')), v_c.code_hash) <> v_c.code_hash then
    update app.activation_codes set attempts = attempts + 1 where app.activation_codes.person_id = v_p.id;
    return;
  end if;
  update app.activation_codes set used_at = now() where app.activation_codes.person_id = v_p.id;
  return query select v_p.id, v_p.auth_user_id, app.login_email(v_p.mobile, v_p.personal_email), v_p.full_name;
end $$;

create or replace function public.link_person_auth(p_person uuid, p_uid uuid) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  perform set_config('app.reason', 'account activated', true);
  update public.persons set auth_user_id = p_uid, status = 'active' where id = p_person;
end $$;

-- Who may be suspended by the caller (used by the Edge Function before banning an auth user).
create or replace function public.auth_user_for_suspension(p_person uuid) returns uuid
language sql stable security definer set search_path = public, app, pg_temp as $$
  select case when app.is_admin() or app.has_role('hr_admin') then (select auth_user_id from public.persons where id = p_person) end
$$;

revoke all on function public.redeem_activation(text, text) from public, anon, authenticated;
revoke all on function public.link_person_auth(uuid, uuid) from public, anon, authenticated;
revoke all on function public.issue_activation(uuid) from public, anon;
revoke all on function public.auth_user_for_suspension(uuid) from public, anon;
grant execute on function public.issue_activation(uuid) to authenticated;
grant execute on function public.auth_user_for_suspension(uuid) to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.redeem_activation(text, text) to service_role';
    execute 'grant execute on function public.link_person_auth(uuid, uuid) to service_role';
  end if;
end $$;

-- An admin changing someone's mobile/email invalidates the old login: they must be re-activated.
create or replace function app.login_change_guard() returns trigger
language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if app.login_email(old.mobile, old.personal_email) is distinct from app.login_email(new.mobile, new.personal_email)
     and new.auth_user_id is not null then
    delete from app.activation_codes where person_id = new.id;
  end if;
  return new;
end $$;
create trigger trg_login_change before update of mobile, personal_email on public.persons
  for each row execute function app.login_change_guard();
