-- D-103 Banks in India: a fixed list keyed by the IFSC institution code (first four letters). The bank name is taken
--  from the IFSC, never from free text, so an invalid name (e.g. "bango bango") cannot be saved. When the IFSC's code is
--  not in the list, the person must pick the bank from the list; a typed name that is not a real bank is refused.

create table if not exists public.banks (
  ifsc_code text primary key,            -- first four letters of the IFSC
  name text not null,
  kind text not null default 'bank',     -- psb | private | sfb | payments | foreign | coop | rrb
  sort int not null default 100
);
alter table public.banks enable row level security;
revoke all on public.banks from anon, authenticated;
grant select on public.banks to authenticated;   -- needed for the bank picker; the list is public knowledge
drop policy if exists banks_read on public.banks;
create policy banks_read on public.banks for select to authenticated using (true);

insert into public.banks(ifsc_code, name, kind, sort) values
  -- public sector
  ('SBIN', 'State Bank of India', 'psb', 1), ('PUNB', 'Punjab National Bank', 'psb', 1), ('BARB', 'Bank of Baroda', 'psb', 1),
  ('CNRB', 'Canara Bank', 'psb', 1), ('UBIN', 'Union Bank of India', 'psb', 1), ('BKID', 'Bank of India', 'psb', 1),
  ('MAHB', 'Bank of Maharashtra', 'psb', 1), ('CBIN', 'Central Bank of India', 'psb', 1), ('IOBA', 'Indian Overseas Bank', 'psb', 1),
  ('IDIB', 'Indian Bank', 'psb', 1), ('UCBA', 'UCO Bank', 'psb', 1), ('PSIB', 'Punjab & Sind Bank', 'psb', 1),
  -- private
  ('HDFC', 'HDFC Bank', 'private', 2), ('ICIC', 'ICICI Bank', 'private', 2), ('UTIB', 'Axis Bank', 'private', 2),
  ('KKBK', 'Kotak Mahindra Bank', 'private', 2), ('YESB', 'Yes Bank', 'private', 2), ('INDB', 'IndusInd Bank', 'private', 2),
  ('IDFB', 'IDFC First Bank', 'private', 2), ('FDRL', 'Federal Bank', 'private', 2), ('KARB', 'Karnataka Bank', 'private', 2),
  ('SIBL', 'South Indian Bank', 'private', 2), ('RATN', 'RBL Bank', 'private', 2), ('DCBL', 'DCB Bank', 'private', 2),
  ('JAKA', 'Jammu & Kashmir Bank', 'private', 2), ('KVBL', 'Karur Vysya Bank', 'private', 2), ('CIUB', 'City Union Bank', 'private', 2),
  ('TMBL', 'Tamilnad Mercantile Bank', 'private', 2), ('DLXB', 'Dhanlaxmi Bank', 'private', 2), ('CSBK', 'CSB Bank', 'private', 2),
  ('NTBL', 'Nainital Bank', 'private', 2), ('BDBL', 'Bandhan Bank', 'private', 2), ('IBKL', 'IDBI Bank', 'private', 2),
  -- small finance banks
  ('AUBL', 'AU Small Finance Bank', 'sfb', 3), ('ESFB', 'Equitas Small Finance Bank', 'sfb', 3), ('UJVN', 'Ujjivan Small Finance Bank', 'sfb', 3),
  ('JSFB', 'Jana Small Finance Bank', 'sfb', 3), ('UTKS', 'Utkarsh Small Finance Bank', 'sfb', 3), ('SURY', 'Suryoday Small Finance Bank', 'sfb', 3),
  ('CLBL', 'Capital Small Finance Bank', 'sfb', 3), ('SMCB', 'Shivalik Small Finance Bank', 'sfb', 3), ('UNTY', 'Unity Small Finance Bank', 'sfb', 3),
  ('NESF', 'North East Small Finance Bank', 'sfb', 3),
  -- payments banks
  ('AIRP', 'Airtel Payments Bank', 'payments', 4), ('PYTM', 'Paytm Payments Bank', 'payments', 4), ('IPOS', 'India Post Payments Bank', 'payments', 4),
  ('FINO', 'Fino Payments Bank', 'payments', 4), ('NSPB', 'NSDL Payments Bank', 'payments', 4),
  -- foreign
  ('SCBL', 'Standard Chartered Bank', 'foreign', 5), ('CITI', 'Citibank', 'foreign', 5), ('HSBC', 'HSBC', 'foreign', 5),
  ('DBSS', 'DBS Bank India', 'foreign', 5), ('DEUT', 'Deutsche Bank', 'foreign', 5), ('BARC', 'Barclays Bank', 'foreign', 5),
  ('BOFA', 'Bank of America', 'foreign', 5), ('CHAS', 'JPMorgan Chase Bank', 'foreign', 5),
  -- cooperative (common)
  ('SVCB', 'SVC Co-operative Bank', 'coop', 6), ('COSB', 'Cosmos Co-operative Bank', 'coop', 6), ('SRCB', 'Saraswat Co-operative Bank', 'coop', 6),
  ('NKGS', 'NKGSB Co-operative Bank', 'coop', 6), ('TJSB', 'TJSB Sahakari Bank', 'coop', 6), ('ABHY', 'Abhyudaya Co-operative Bank', 'coop', 6),
  ('KJSB', 'Kalyan Janata Sahakari Bank', 'coop', 6), ('DNSB', 'Dombivli Nagari Sahakari Bank', 'coop', 6), ('GSCB', 'Gujarat State Co-operative Bank', 'coop', 6),
  ('MSNU', 'Mumbai District Central Co-operative Bank', 'coop', 6), ('PMEC', 'Punjab State Co-operative Bank', 'coop', 6),
  -- regional rural (major)
  ('APGB', 'Andhra Pragathi Grameena Bank', 'rrb', 7), ('MAHG', 'Maharashtra Gramin Bank', 'rrb', 7), ('PGBH', 'Prathama UP Gramin Bank', 'rrb', 7),
  ('BGGB', 'Baroda Gujarat Gramin Bank', 'rrb', 7), ('KLGB', 'Kerala Gramin Bank', 'rrb', 7), ('KARG', 'Karnataka Gramin Bank', 'rrb', 7)
on conflict (ifsc_code) do update set name = excluded.name, kind = excluded.kind, sort = excluded.sort;

/** The bank for an IFSC code, from the list (null when the four-letter code is not one we hold). */
create or replace function app.bank_for_ifsc(p_ifsc text) returns text
language sql stable set search_path = public, app, pg_temp as $$
  select name from public.banks where ifsc_code = upper(left(regexp_replace(coalesce(p_ifsc, ''), '[^A-Za-z0-9]', '', 'g'), 4))
$$;

/** True when a typed bank name matches a bank in the list (case / spacing / "co-op" tolerant). */
create or replace function app.is_known_bank(p_name text) returns boolean
language sql stable set search_path = public, app, pg_temp as $$
  with n as (select regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]', '', 'g') k)
  select (select k from n) <> '' and exists (
    select 1 from public.banks b, n
     where regexp_replace(lower(b.name), '[^a-z0-9]', '', 'g') = n.k
        or regexp_replace(lower(replace(b.name, ' Bank', '')), '[^a-z0-9]', '', 'g') = n.k)
$$;
revoke all on function app.bank_for_ifsc(text), app.is_known_bank(text) from public, anon;
grant execute on function app.bank_for_ifsc(text), app.is_known_bank(text) to authenticated;

/** The bank list for the picker (used when the IFSC code is not one we hold). */
create or replace function public.bank_list() returns table(ifsc_code text, name text, kind text)
language sql stable security definer set search_path = public, app, pg_temp as $$
  select ifsc_code, name, kind from public.banks order by sort, name
$$;
revoke all on function public.bank_list() from public, anon;
grant execute on function public.bank_list() to authenticated;

-- ---- save_identity: take the bank name from the IFSC; refuse an unrecognised typed name ----
do $do$
declare f text := pg_get_functiondef('public.save_identity(uuid, jsonb)'::regprocedure);
  a text := $a$    update public.hr_identity set bank_account_number = v_n, bank_ifsc = v_ifsc, bank_name = coalesce(nullif(btrim(coalesce(p->>'bank_name', '')), ''), bank_name),$a$;
  b text := $b$    v_bank := coalesce(app.bank_for_ifsc(v_ifsc), nullif(btrim(coalesce(p->>'bank_name', '')), ''));
    if v_bank is null then raise exception 'Choose your bank from the list.' using errcode = '22023'; end if;
    if app.bank_for_ifsc(v_ifsc) is null and not app.is_known_bank(v_bank) and not v_hr then
      raise exception 'We do not recognise "%" as a bank in India. Pick your bank from the list.', v_bank using errcode = '22023'; end if;
    v_bank := coalesce(app.bank_for_ifsc(v_ifsc), v_bank);
    update public.hr_identity set bank_account_number = v_n, bank_ifsc = v_ifsc, bank_name = v_bank,$b$;
  c text := $c$    update public.hr_profiles set bank_account_last4 = right(v_n, 4), bank_ifsc = v_ifsc,
           bank_name = coalesce(nullif(btrim(coalesce(p->>'bank_name', '')), ''), bank_name), updated_at = now() where person_id = p_person;$c$;
  d text := $d$    update public.hr_profiles set bank_account_last4 = right(v_n, 4), bank_ifsc = v_ifsc,
           bank_name = v_bank, updated_at = now() where person_id = p_person;$d$;
begin
  if position(a in f) = 0 or position(c in f) = 0 then raise exception 'save_identity bank anchors not found'; end if;
  f := replace(f, a, b); f := replace(f, c, d);
  f := replace(f, 'v_ifsc text; v_name text', 'v_ifsc text; v_bank text; v_name text');
  execute f;
end $do$;

-- ---- fix bank names already saved: take them from the IFSC where we can; flag the rest for correction ----
update public.hr_identity i set bank_name = app.bank_for_ifsc(i.bank_ifsc)
 where i.bank_ifsc is not null and app.bank_for_ifsc(i.bank_ifsc) is not null
   and coalesce(i.bank_name, '') is distinct from app.bank_for_ifsc(i.bank_ifsc);
update public.hr_profiles h set bank_name = app.bank_for_ifsc(h.bank_ifsc)
 where h.bank_ifsc is not null and app.bank_for_ifsc(h.bank_ifsc) is not null
   and coalesce(h.bank_name, '') is distinct from app.bank_for_ifsc(h.bank_ifsc);

/** Admin adds a bank that is not yet in the list (for a genuine bank an IFSC we do not hold). */
create or replace function public.add_bank(p_ifsc_code text, p_name text, p_kind text default 'bank') returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if not app.is_admin() then raise exception 'Only Admin can add a bank.' using errcode = '42501'; end if;
  if upper(regexp_replace(coalesce(p_ifsc_code, ''), '[^A-Za-z]', '', 'g')) !~ '^[A-Z]{4}$' then raise exception 'The IFSC bank code is the first four letters of the IFSC.' using errcode = '22023'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'Give the bank name.' using errcode = 'P0001'; end if;
  insert into public.banks(ifsc_code, name, kind) values (upper(left(regexp_replace(p_ifsc_code, '[^A-Za-z]', '', 'g'), 4)), btrim(p_name), coalesce(nullif(p_kind,''),'bank'))
  on conflict (ifsc_code) do update set name = excluded.name, kind = excluded.kind;
end $$;
revoke all on function public.add_bank(text, text, text) from public, anon;
grant execute on function public.add_bank(text, text, text) to authenticated;

-- co-operative banks found in live data that the base list did not include
insert into public.banks(ifsc_code, name, kind, sort) values
  ('TBSB', 'Thane Bharat Sahakari Bank', 'coop', 6),
  ('SDCE', 'Satara District Central Co-operative Bank', 'coop', 6)
on conflict (ifsc_code) do nothing;
