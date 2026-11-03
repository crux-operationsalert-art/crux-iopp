-- Milestone 7 (owner feedback 03-Nov, 20:50):
--  * Collections entry simplified to totals per client (no bill numbers / dates / notes), compulsory like operations.
--  * Billed per case (bills raised ÷ cases actioned) in the collections view.
--  * Phone notifications (web push) for everyone who installs the app and allows notifications.

-- ------------------------------------------------------------------ simpler collections
alter table public.collection_daily drop constraint if exists collection_daily_check;    -- promised date no longer asked
alter table public.collection_daily drop constraint if exists collection_daily_check1;   -- bill numbers no longer asked
alter table public.collection_daily alter column bill_count set default 0;

create or replace function public.save_collection_day(p_date date, p_rows jsonb) returns int
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare r jsonb; v_me uuid := app.me(); n int := 0; v_b uuid; v_c uuid;
  f text; req text[] := array['bill_amount','received','reconciled','followups','promised_amount','out_0_30','out_31_60','out_61_90','out_90p'];
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  perform app.require_writable(v_me, p_date, 'operations');
  perform set_config('app.reason', 'daily collections', true);
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]')) loop
    v_b := (r->>'branch_id')::uuid; v_c := (r->>'client_id')::uuid;
    if not exists (select 1 from app.money_pairs(v_me, p_date) k where k.branch_id = v_b and k.client_id = v_c) then
      raise exception 'You do not report collections for that client at that location.' using errcode = '42501';
    end if;
    foreach f in array req loop
      if r->>f is null or r->>f = '' then raise exception 'Every collections box is required (enter 0 if none): %', replace(f, '_', ' ') using errcode = 'P0001'; end if;
    end loop;
    insert into public.collection_daily as d (person_id, entry_date, branch_id, client_id, bill_count, bill_amount, received, reconciled,
      followups, promised_amount, out_0_30, out_31_60, out_61_90, out_90p, entered_by)
    values (v_me, p_date, v_b, v_c, coalesce((r->>'bill_count')::int, 0), (r->>'bill_amount')::numeric, (r->>'received')::numeric, (r->>'reconciled')::numeric,
      (r->>'followups')::int, (r->>'promised_amount')::numeric, (r->>'out_0_30')::numeric, (r->>'out_31_60')::numeric, (r->>'out_61_90')::numeric,
      (r->>'out_90p')::numeric, v_me)
    on conflict (person_id, entry_date, branch_id, client_id) do update set
      bill_amount = excluded.bill_amount, received = excluded.received, reconciled = excluded.reconciled, followups = excluded.followups,
      promised_amount = excluded.promised_amount, out_0_30 = excluded.out_0_30, out_31_60 = excluded.out_31_60, out_61_90 = excluded.out_61_90,
      out_90p = excluded.out_90p, updated_at = now();
    update public.bill_entries set bill_amount = (r->>'bill_amount')::numeric
     where person_id = v_me and bill_date = p_date and branch_id = v_b and client_id = v_c and reference = 'daily';
    if not found then
      insert into public.bill_entries(person_id, bill_date, client_id, branch_id, bill_count, bill_amount, reference, entered_by)
      values (v_me, p_date, v_c, v_b, 0, (r->>'bill_amount')::numeric, 'daily', v_me);
    end if;
    update public.collection_entries set amount_received = (r->>'received')::numeric, amount_reconciled = (r->>'reconciled')::numeric
     where person_id = v_me and collection_date = p_date and branch_id = v_b and client_id = v_c and reference = 'daily';
    if not found then
      insert into public.collection_entries(person_id, collection_date, client_id, branch_id, amount_received, amount_reconciled, reference, source, entered_by)
      values (v_me, p_date, v_c, v_b, (r->>'received')::numeric, (r->>'reconciled')::numeric, 'daily', 'self', v_me);
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Billed per case: bills raised in the period ÷ cases actioned (incoming − cancelled) in the period, per location × client.
do $do$
declare d text;
begin
  d := pg_get_functiondef('public.collections_board(date,date)'::regprocedure);
  d := replace(d, $r$'out_0_30', l.out_0_30,$r$,
    $r$'cases', (select coalesce(sum(m.entry - m.cancelled), 0) from public.v_line_metrics m where m.branch_id = k.branch_id and m.client_id = k.client_id and m.work_date between p_from and p_to),
        'out_0_30', l.out_0_30,$r$);
  if position($r$'cases'$r$ in d) = 0 then raise exception 'collections_board anchor not found'; end if;
  execute d;
end $do$;

-- ------------------------------------------------------------------ phone notifications (web push)
alter table public.notifications add column if not exists pushed_at timestamptz;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_sent_at timestamptz,
  disabled_at timestamptz
);
alter table public.push_subscriptions enable row level security;
create policy own_push_subscriptions on public.push_subscriptions for select to authenticated using (person_id = app.me() or app.is_admin());
grant select on public.push_subscriptions, public.collection_daily to authenticated;

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if app.me() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  insert into public.push_subscriptions(person_id, endpoint, p256dh, auth, user_agent)
  values (app.me(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update set person_id = excluded.person_id, p256dh = excluded.p256dh, auth = excluded.auth,
    user_agent = excluded.user_agent, disabled_at = null;
  insert into public.notifications(person_id, kind, message, link)
  values (app.me(), 'welcome', 'Notifications are on. You will get reminders for your daily report, tasks and misses here.', '/notifications');
end $$;

create or replace function public.stop_push_subscription(p_endpoint text) returns void
language sql security definer set search_path = public, app, pg_temp as $$
  update public.push_subscriptions set disabled_at = now() where endpoint = p_endpoint and (person_id = app.me() or app.is_admin())
$$;

-- New tasks and misses notify the person they are for (and the person they are about).
create or replace function app.notify_on_task() returns trigger
language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  insert into public.notifications(person_id, kind, message, link)
  select distinct x, case when new.category = 'miss' then 'miss' else 'task' end, new.title, '/tasks'
    from unnest(array[new.owner_id, new.subject_id]) x where x is not null;
  return new;
end $$;
create trigger trg_notify_on_task after insert on public.tasks for each row execute function app.notify_on_task();

-- Called by the push sender (Edge Function, service role only): unsent notifications for people with a phone subscription.
create or replace function public.push_batch(p_limit int default 200) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v jsonb;
begin
  with n as (select n.* from public.notifications n where n.pushed_at is null and n.created_at > now() - interval '2 days'
              order by n.created_at limit p_limit for update skip locked),
  out as (select jsonb_build_object('notification_id', n.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth,
                   'title', case n.kind when 'miss' then 'Miss — needs your reply' when 'task' then 'New task' else 'CRUX Productivity' end,
                   'body', n.message, 'url', '#' || coalesce(n.link, '/notifications')) o
            from n join public.push_subscriptions s on s.person_id = n.person_id and s.disabled_at is null and s.created_at <= n.created_at + interval '1 minute'),
  mark as (update public.notifications x set pushed_at = now() where x.id in (select id from n) returning 1)
  select coalesce(jsonb_agg(o), '[]') into v from out, (select count(*) from mark) m;
  return coalesce(v, '[]');
end $$;
create or replace function public.push_result(p_endpoint text, p_ok boolean) returns void
language sql security definer set search_path = public, app, pg_temp as $$
  update public.push_subscriptions set last_sent_at = case when p_ok then now() else last_sent_at end,
         disabled_at = case when p_ok then disabled_at else now() end where endpoint = p_endpoint
$$;

revoke all on function public.save_push_subscription(text, text, text, text), public.stop_push_subscription(text),
  public.push_batch(int), public.push_result(text, boolean) from public, anon, authenticated;
grant execute on function public.save_push_subscription(text, text, text, text), public.stop_push_subscription(text) to authenticated;
grant execute on function public.push_batch(int), public.push_result(text, boolean) to service_role;
revoke all on function app.notify_on_task() from public, anon;

do $do$
begin
  begin create extension if not exists pg_net; exception when others then raise notice 'pg_net not available: %', sqlerrm; end;
end $do$;

-- Push sender settings live in Supabase Vault (values set on the server, never in this repository).
create or replace function public.push_config() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return (select jsonb_object_agg(name, decrypted_secret) from vault.decrypted_secrets where name in ('iopp_vapid_private', 'iopp_push_token'));
end $$;
revoke all on function public.push_config() from public, anon, authenticated;
grant execute on function public.push_config() to service_role;
