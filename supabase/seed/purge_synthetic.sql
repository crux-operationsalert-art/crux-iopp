-- Removes every SYNTH record (and the temporary QA sign-ins) from the database.
-- Audit rows about them remain (audit is append-only by design). Needs a confirmed run (destructive).
begin;
create temp table sp as select id from persons where full_name like 'SYNTH %';
delete from notifications where person_id in (select id from sp);
delete from penalty_ledger where person_id in (select id from sp);
delete from target_allocations where reason = 'SYNTH' or person_id in (select id from sp);
delete from bill_entries where person_id in (select id from sp);
delete from collection_entries where person_id in (select id from sp);
delete from certifications where manager_id in (select id from sp);
delete from day_status where person_id in (select id from sp);
delete from productivity_lines where person_id in (select id from sp);
delete from wip_openings where person_id in (select id from sp);
delete from reopen_grants where person_id in (select id from sp);
delete from app.activation_codes where person_id in (select id from sp);
delete from allocations where person_id in (select id from sp);
delete from reporting_lines where person_id in (select id from sp) or manager_id in (select id from sp);
delete from role_assignments where person_id in (select id from sp);
delete from persons where id in (select id from sp);
delete from partner_share_rules where reason like 'SYNTH%';
delete from rate_cards where reason = 'SYNTH rate';
delete from client_locations where client_id in (select id from clients where code like 'S-%');
delete from branch_zones where branch_id in (select id from branches where code like 'S-%');
delete from clients where code like 'S-%'; delete from locations where code like 'S-%';
delete from branches where code like 'S-%'; delete from zones where code like 'S-%'; delete from processes where code like 'S-%';
delete from penalty_rules where code = 'MISSED_REPORT' and amount is null;
do $$ begin
  if to_regclass('auth.identities') is not null then
    delete from auth.identities where user_id in (select id from auth.users where email like '%@example.invalid' or email like 'm77000000%@login.crux-iopp.app');
    delete from auth.users where email like '%@example.invalid' or email like 'm77000000%@login.crux-iopp.app';
  end if;
end $$;
commit;
