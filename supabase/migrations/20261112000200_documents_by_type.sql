-- D-129  Papers by kind of person. Agreements and security cheques belong to Business Associates / partners;
-- CRUX employees have employment papers (offer / appointment letter, increment letter, relieving letter, joining form).

do $$
declare c text;
begin
  select conname into c from pg_constraint where conrelid = 'public.person_documents'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%doc_type%';
  if c is not null and pg_get_constraintdef((select oid from pg_constraint where conrelid = 'public.person_documents'::regclass and conname = c)) not like '%relieving_letter%' then
    execute format('alter table public.person_documents drop constraint %I', c);
    alter table public.person_documents add constraint person_documents_doc_type_check check (doc_type in ('aadhaar','pan','address_proof','qualification','bank','photo','police_verification','agreement','kyc_other','other',
      'security_cheque','partner_agreement','gst_certificate','cancelled_cheque','offer_letter','increment_letter','relieving_letter','joining_form'));
  end if;
end $$;

-- the papers that can be uploaded for a person, in the order the form lists them
create or replace function app.doc_types_for(p_person uuid) returns text[]
language sql stable security definer set search_path = public, app, pg_temp as $$
  select case when (select resource_type::text from public.persons where id = p_person) = 'partner'
    then array['partner_agreement','security_cheque','aadhaar','pan','address_proof','gst_certificate','cancelled_cheque','bank','photo','qualification','police_verification','kyc_other','other']
    else array['offer_letter','increment_letter','relieving_letter','joining_form','aadhaar','pan','address_proof','qualification','bank','photo','police_verification','kyc_other','other'] end;
$$;

create or replace function public.document_types(p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  if app.me() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  return jsonb_build_object('partner', (select resource_type::text = 'partner' from public.persons where id = p_person), 'types', to_jsonb(app.doc_types_for(p_person)));
end $$;
grant execute on function public.document_types(uuid) to authenticated;

do $mig$
declare f text := pg_get_functiondef('public.register_document(uuid,text,text,text,text,integer)'::regprocedure); o text := f;
begin
  if position('app.doc_types_for' in f) = 0 then
    f := replace(f, E'  if split_part(p_path, ''/'', 1) <> p_person::text',
      E'  if not (p_type = any (app.doc_types_for(p_person))) then\n    raise exception ''%'', case when p_type in (''partner_agreement'', ''security_cheque'', ''gst_certificate'', ''cancelled_cheque'')\n      then ''Agreements and security cheques are for Business Associates / partners. For an employee, upload the offer or appointment letter.''\n      else ''That paper is for CRUX employees. For a Business Associate, upload the agreement and the security cheque.'' end using errcode = ''22023'';\n  end if;\n  if split_part(p_path, ''/'', 1) <> p_person::text');
    if f = o then raise exception 'register_document anchor not found'; end if;
    execute f;
  end if;
end $mig$;
