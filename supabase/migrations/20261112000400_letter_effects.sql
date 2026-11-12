-- D-133  A letter can carry its effect: a salary revision letter updates the salary record when it is sent,
-- and an exit letter records the last working day so HR is prompted to mark the exit once that day has passed.

alter table public.letters add column if not exists effect jsonb;

create or replace function public.letter_issue_with(p_person uuid, p_kind text, p_title text, p_body text, p_needs_signature boolean,
    p_new_gross numeric default null, p_effective date default null, p_last_day date default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare r jsonb; v_eff jsonb := '{}'::jsonb;
begin
  r := public.letter_issue(p_person, p_kind, p_title, p_body, p_needs_signature);     -- HR only; checks the text
  if p_new_gross is not null then
    if p_effective is null then raise exception 'Give the date the revised salary starts from.' using errcode = 'P0001'; end if;
    perform public.set_compensation(p_person, p_new_gross, p_effective, 'increment', p_title || ' ' || (r ->> 'ref_no'));
    v_eff := v_eff || jsonb_build_object('new_gross', p_new_gross, 'effective', p_effective);
  end if;
  if p_last_day is not null then v_eff := v_eff || jsonb_build_object('last_day', p_last_day); end if;
  if v_eff <> '{}'::jsonb then update public.letters set effect = v_eff where id = (r ->> 'id')::uuid; end if;
  return r || jsonb_build_object('effect', v_eff);
end $$;

create or replace function public.letters_list(p_person uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_hr boolean := app.is_hr();
begin
  if app.me() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'ref_no', l.ref_no, 'person_id', l.person_id, 'person', p.full_name, 'designation', p.designation,
            'kind', l.kind, 'title', l.title, 'status', l.status, 'needs_signature', l.needs_signature, 'issued_at', l.issued_at, 'signed_at', l.signed_at,
            'closed_reason', l.closed_reason)
            || case when v_hr then jsonb_build_object('last_day', l.effect ->> 'last_day',
                 'exit_due', l.status <> 'withdrawn' and p.status <> 'exited' and (l.effect ->> 'last_day')::date < app.today()) else '{}'::jsonb end
            order by l.issued_at desc), '[]'::jsonb)
            from public.letters l join public.persons p on p.id = l.person_id
           where case when v_hr and p_person is null then true when v_hr then l.person_id = p_person
                      else l.person_id = app.me() and l.status <> 'withdrawn' end);
end $$;
grant execute on function public.letter_issue_with(uuid, text, text, text, boolean, numeric, date, date) to authenticated;
