-- D-49 (SOW 6.3): partner / BA commercial details per partner branch — agreement signed and received (with dates and a
-- link to the document kept in the company drive), security cheque (amount, cheque number, bank name). No bank account
-- numbers are stored. Restricted: Admin writes; Admin, Operations Head and Leadership / Auditor read. Every change audited.
create table if not exists public.partner_agreements (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null unique references public.branches(id),
  agreement_signed boolean not null default false,
  signed_on date,
  agreement_received boolean not null default false,
  received_on date,
  document_link text check (document_link is null or document_link ~* '^https://'),
  cheque_received boolean not null default false,
  cheque_amount numeric(14,2) check (cheque_amount is null or cheque_amount >= 0),
  cheque_number text check (cheque_number is null or cheque_number ~ '^[0-9]{6}$'),
  cheque_bank text,
  note text,
  updated_by uuid references public.persons(id) default app.me(),
  updated_at timestamptz not null default now(),
  check (cheque_received or (cheque_amount is null and cheque_number is null and cheque_bank is null))
);
alter table public.partner_agreements enable row level security;
create policy read_partner_agreements on public.partner_agreements for select to authenticated
  using (app.is_admin() or app.has_role('ops_head') or app.has_role('auditor'));
create policy admin_write_partner_agreements on public.partner_agreements for all to authenticated
  using (app.is_admin()) with check (app.is_admin());
grant select, insert, update on public.partner_agreements to authenticated;
create trigger trg_audit after insert or update on public.partner_agreements for each row execute function app.audit();
