-- D-143 (server side): while a function is paused, the actions that belong to it are refused for signed-in users.
-- Background jobs (no signed-in user) are not stopped here; their tasks and notifications are already held back.
do $mig$
declare r record; f text; g text;
begin
  for r in select v.module, p.oid, v.fn from (values
      ('attendance', 'cancel_leave'), ('attendance', 'decide_leave'), ('attendance', 'request_leave'), ('attendance', 'set_attendance'), ('plan', 'self_check_in'),
      ('plan', 'check_in'), ('plan', 'close_plan'), ('plan', 'save_plan'),
      ('payroll', 'declare_salary'), ('payroll', 'decide_salary_declaration'), ('payroll', 'payroll_adjust'), ('payroll', 'payroll_decide'), ('payroll', 'payroll_override'),
      ('payroll', 'payroll_prepare'), ('payroll', 'payroll_set_status'), ('payroll', 'propose_penalty'), ('payroll', 'decide_penalty'), ('payroll', 'respond_penalty'),
      ('payroll', 'set_salary'), ('payroll', 'set_on_crux_payroll'),
      ('hr_docs', 'register_document'), ('hr_docs', 'save_identity'), ('hr_docs', 'confirm_identity'), ('hr_docs', 'verify_document'), ('hr_docs', 'doc_check_done'),
      ('hr_docs', 'set_police_verification'),
      ('letters', 'letter_issue'), ('letters', 'letter_issue_bulk'), ('letters', 'letter_issue_with'), ('letters', 'letter_sign'), ('letters', 'letter_close'),
      ('letters', 'letter_template_save'), ('letters', 'role_profile_save'), ('letters', 'payslip_history_upload')
    ) v(module, fn)
    join pg_proc p on p.proname = v.fn join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
    join pg_language l on l.oid = p.prolang and l.lanname = 'plpgsql' loop
    f := pg_get_functiondef(r.oid);
    if f like '%app.module_paused(%' then continue; end if;
    if position(E'\nbegin\n' in f) = 0 then raise notice 'module guard: % has no anchor', r.fn; continue; end if;
    g := format(E'\nbegin\n  if app.module_paused(%L) and app.me() is not null then raise exception ''This function is paused by Admin for now.'' using errcode = ''42501''; end if;   -- D-143\n', r.module);
    execute regexp_replace(f, E'\nbegin\n', g);
  end loop;
end $mig$;
