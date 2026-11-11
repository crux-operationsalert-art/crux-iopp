-- D-117  Attachments (multi-select) on chat messages and tasks.
-- Files go to a private 'attachments' bucket under <parent_type>/<parent_id>/<uuid>-<name>.
-- You can attach to, and open attachments on, any chat message in a thread you're in,
-- or any task you can see (owner, visible manager, team member, HR/Admin).

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  parent_type text not null check (parent_type in ('chat','task')),
  parent_id text not null,
  storage_path text not null unique,
  file_name text not null,
  mime text, size int,
  uploaded_by uuid references public.persons(id),
  created_at timestamptz not null default now()
);
create index if not exists attachments_parent on public.attachments (parent_type, parent_id);
alter table public.attachments enable row level security;
revoke all on public.attachments from anon, authenticated;

-- Can the signed-in person see / attach to this parent?
create or replace function app.can_see_attach(p_type text, p_id text) returns boolean
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_thread uuid; v_owner uuid; v_subject uuid;
begin
  if app.me() is null then return false; end if;
  if p_type = 'chat' then
    if p_id !~ '^[0-9]+$' then return false; end if;
    select thread_id into v_thread from public.chat_messages where id = p_id::bigint;
    return v_thread is not null and app.chat_member(v_thread);
  elsif p_type = 'task' then
    if p_id !~ '^[0-9a-f-]{36}$' then return false; end if;
    select owner_id, subject_id into v_owner, v_subject from public.tasks where id = p_id::uuid;
    return found and (app.task_visible(v_owner, v_subject) or app.is_task_member(p_id::uuid));
  end if;
  return false;
end $$;
revoke all on function app.can_see_attach(text, text) from public, anon;
grant execute on function app.can_see_attach(text, text) to authenticated;

create policy read_attachments on public.attachments for select to authenticated
  using (app.can_see_attach(parent_type, parent_id));
grant select on public.attachments to authenticated;

-- storage.objects policy: a path is readable/writable if its parent is visible to the caller.
create or replace function app.attach_path_ok(p_name text) returns boolean
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare a text[] := string_to_array(p_name, '/');
begin
  if cardinality(a) <> 3 then return false; end if;
  return app.can_see_attach(a[1], a[2]);
end $$;
revoke all on function app.attach_path_ok(text) from public, anon;
grant execute on function app.attach_path_ok(text) to authenticated;

do $do$
begin
  if to_regclass('storage.buckets') is null then return; end if;
  insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
    values ('attachments', 'attachments', false, 10485760,
      array['application/pdf','image/jpeg','image/png','image/webp','image/heic','image/gif',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv','text/plain'])
    on conflict (id) do nothing;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='attachments_read') then
    execute $s$create policy attachments_read on storage.objects for select to authenticated using (bucket_id = 'attachments' and app.attach_path_ok(name))$s$;
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='attachments_write') then
    execute $s$create policy attachments_write on storage.objects for insert to authenticated with check (bucket_id = 'attachments' and app.attach_path_ok(name))$s$;
  end if;
end $do$;

-- Record a file after it is uploaded to the bucket.
create or replace function public.register_attachment(p_parent_type text, p_parent_id text, p_path text,
    p_file_name text, p_mime text default null, p_size int default null) returns uuid
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_id uuid;
begin
  if app.me() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not app.can_see_attach(p_parent_type, p_parent_id) then raise exception 'Not permitted.' using errcode = '42501'; end if;
  if p_path not like p_parent_type || '/' || p_parent_id || '/%' then raise exception 'Bad path.' using errcode = '22023'; end if;
  insert into public.attachments(parent_type, parent_id, storage_path, file_name, mime, size, uploaded_by)
  values (p_parent_type, p_parent_id, p_path, left(btrim(p_file_name), 200), p_mime, p_size, app.me())
  returning id into v_id;
  return v_id;
end $$;

-- All attachments for a set of parents of one type (only those the caller can see).
create or replace function public.attachments_for(p_parent_type text, p_parent_ids text[])
returns table(id uuid, parent_id text, file_name text, mime text, size int, storage_path text, by_name text, created_at timestamptz)
language sql stable security definer set search_path = public, app, pg_temp as $$
  select a.id, a.parent_id, a.file_name, a.mime, a.size, a.storage_path, p.full_name, a.created_at
    from public.attachments a left join public.persons p on p.id = a.uploaded_by
   where a.parent_type = p_parent_type and a.parent_id = any(p_parent_ids)
     and app.can_see_attach(a.parent_type, a.parent_id)
   order by a.created_at;
$$;

revoke all on function public.register_attachment(text, text, text, text, text, int), public.attachments_for(text, text[]) from public, anon;
grant execute on function public.register_attachment(text, text, text, text, text, int), public.attachments_for(text, text[]) to authenticated;
