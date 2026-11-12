-- D-134  Letters and policies redrafted to a senior corporate standard; policy documents for employees and
-- Business Associates to sign; company seal on the letterhead. The drafts are a starting point for the Company's
-- legal review, not legal advice.

do $$
declare c text;
begin
  select conname into c from pg_constraint where conrelid = 'public.letter_templates'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%kind%';
  if c is not null and pg_get_constraintdef((select oid from pg_constraint where conrelid = 'public.letter_templates'::regclass and conname = c)) not like '%policy%' then
    execute format('alter table public.letter_templates drop constraint %I', c);
    alter table public.letter_templates add constraint letter_templates_kind_check check (kind in ('offer','appointment','confirmation','increment','appraisal','promotion','transfer',
      'pip','warning','show_cause','resignation_acceptance','relieving','experience','full_final','policy','partner','other'));
  end if;
  select conname into c from pg_constraint where conrelid = 'public.company_assets'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%letterhead%';
  if c is not null and pg_get_constraintdef((select oid from pg_constraint where conrelid = 'public.company_assets'::regclass and conname = c)) not like '%seal%' then
    execute format('alter table public.company_assets drop constraint %I', c);
    alter table public.company_assets add constraint company_assets_key_check check (key in ('letterhead', 'signature', 'seal'));
  end if;
end $$;
alter table public.letter_templates add column if not exists audience text not null default 'employee' check (audience in ('employee', 'partner', 'all'));

insert into public.settings(key, value, description, label, help, kind, section, editable) values
  ('legal_jurisdiction', '"Thane, Maharashtra"', 'Courts named in letters (D-134)', 'Jurisdiction for letters', 'The place whose courts are named in letters and undertakings.', 'text', 'Company', true)
on conflict (key) do nothing;

create or replace function public.company_asset_set(p_key text, p_data_url text) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if not app.is_hr() then raise exception 'Only HR/Admin can change the letterhead.' using errcode = '42501'; end if;
  if p_key not in ('letterhead', 'signature', 'seal') then raise exception 'Unknown item.' using errcode = '22023'; end if;
  if p_data_url is null or p_data_url = '' then
    update public.company_assets set data_url = 'data:image/png;base64,', updated_by = app.me(), updated_at = now() where key = p_key;
    return;
  end if;
  if p_data_url not like 'data:image/%' or length(p_data_url) > 700000 then raise exception 'Use a PNG or JPG image under 500 KB.' using errcode = '22023'; end if;
  insert into public.company_assets(key, data_url, updated_by) values (p_key, p_data_url, app.me())
  on conflict (key) do update set data_url = excluded.data_url, updated_by = excluded.updated_by, updated_at = now();
end $$;

do $mig$
declare f text; o text;
begin
  f := pg_get_functiondef('public.letterhead()'::regprocedure); o := f;
  if position('''seal''' in f) = 0 then
    f := replace(f, '''signature'', (select nullif(data_url, ''data:image/png;base64,'') from public.company_assets where key = ''signature''));',
      '''signature'', (select nullif(data_url, ''data:image/png;base64,'') from public.company_assets where key = ''signature''),' || E'\n    ' ||
      '''seal'', (select nullif(data_url, ''data:image/png;base64,'') from public.company_assets where key = ''seal''));');
    if f = o then raise exception 'letterhead anchor not found'; end if; execute f;
  end if;
  f := pg_get_functiondef('app.letter_merge(text,uuid,jsonb)'::regprocedure); o := f;
  if position('first_name' in f) = 0 then
    f := replace(f, '''name'', p.full_name,', '''name'', p.full_name, ''first_name'', split_part(btrim(p.full_name), '' '', 1), ''jurisdiction'', app.setting(''legal_jurisdiction'') #>> ''{}'',');
    if f = o then raise exception 'letter_merge anchor not found'; end if; execute f;
  end if;
  f := pg_get_functiondef('public.letter_setup()'::regprocedure); o := f;
  if position('t.audience' in f) = 0 then
    f := replace(f, '''active'', t.active)', '''active'', t.active, ''audience'', t.audience)');
    if f = o then raise exception 'letter_setup anchor not found'; end if; execute f;
  end if;
end $mig$;

create or replace function public.letter_template_audience(p_id uuid, p_audience text) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if not app.is_hr() then raise exception 'HR only.' using errcode = '42501'; end if;
  if p_audience not in ('employee', 'partner', 'all') then raise exception 'Unknown audience.' using errcode = '22023'; end if;
  update public.letter_templates set audience = p_audience, updated_by = app.me(), updated_at = now() where id = p_id;
end $$;
grant execute on function public.letter_template_audience(uuid, text) to authenticated;

-- ---------------------------------------------------------------- the documents
-- Layout marks: "# Heading", "=== Annexure title" (new page), "1. clause", "- bullet", "Label | Value" (table).
-- A draft HR has already edited (updated_by set) is never overwritten.
insert into public.letter_templates (kind, name, needs_signature, audience, body) values
('offer', 'Offer letter', true, 'employee', $t$Dear {{first_name}},

Further to your recent discussions with us, we are delighted to offer you employment with {{company_name}} (the "Company") on the terms summarised below.

Position | {{designation}}
Department | {{department}}
Reporting to | {{reporting_manager}}
Place of posting | {{place_of_posting}}
Date of joining | {{joining_date}}
Monthly gross salary | {{monthly_salary}}
Annual gross salary | {{annual_salary}}

# Conditions of this offer
1. This offer is subject to satisfactory verification of your identity, address, education, previous employment and references, and to a satisfactory police verification where the role requires it.
2. Statutory deductions, including Provident Fund, Employees' State Insurance, Professional Tax and income tax, will be made as applicable.
3. On joining you will receive a Letter of Appointment setting out the detailed terms of your employment, together with the Company policies you will be asked to read and accept.
4. The terms of this offer are confidential and must not be shared with anyone other than your immediate family or professional advisers.

# Acceptance
This offer remains open for {{acceptance_days}} days from the date of this letter, after which it will lapse unless extended by the Company in writing. To accept, please sign below.

We look forward to welcoming you to the Company and wish you a long and rewarding career with us.$t$),

('appointment', 'Appointment letter with roles and responsibilities', true, 'employee', $t$Dear {{first_name}},

We are pleased to confirm your appointment with {{company_name}} (the "Company") on the terms set out in this letter and its annexures, which together form your contract of employment.

# 1. Position and commencement
1.1 You are appointed as {{designation}} in the {{department}} department with effect from {{joining_date}}.
1.2 You will report to {{reporting_manager}} or to any other person the Company may designate.
1.3 Your duties are described in Annexure B. The Company may reasonably vary your duties, reporting line or place of work in line with business requirements.

# 2. Remuneration
2.1 Your monthly gross salary is {{monthly_salary}} ({{annual_salary}} per annum), payable monthly in arrears, as detailed in Annexure A.
2.2 Statutory deductions and contributions will be made as required by law.
2.3 Any variable pay, incentive or bonus is governed by the Company policy in force and is not guaranteed unless stated in writing.
2.4 Your remuneration is strictly confidential.

# 3. Probation and confirmation
3.1 You will be on probation for {{probation_months}} months from your date of joining. The Company may extend the probation where it considers this necessary.
3.2 Your employment will be treated as confirmed only when the Company confirms it in writing.

# 4. Working hours, leave and holidays
You will follow the working hours, weekly offs, holidays and leave rules set out in the Company policies, which are available in the CRUX app and may be revised from time to time.

# 5. Confidentiality and data protection
5.1 You will keep confidential, during and after your employment, all information relating to the Company, its clients and their customers, and will use it only to perform your duties.
5.2 You will handle personal data strictly in accordance with the Company's instructions, client requirements and applicable law.
5.3 You will sign the Company's Confidentiality, Information Security and Data Privacy undertakings, which form part of your terms.

# 6. Conduct and compliance
You will observe the Company's Code of Conduct and all policies in force, including those on anti-bribery, conflict of interest, prevention of sexual harassment and information security. A breach may lead to disciplinary action, including termination.

# 7. Exclusive service
During your employment you will devote your full working time to the Company and will not, without written consent, engage in any other employment, business or assignment.

# 8. Company property and intellectual property
8.1 All property, documents, data and equipment provided to you remain the Company's and must be returned on demand or on separation.
8.2 All work product created in the course of your employment belongs to the Company.

# 9. Termination
9.1 During probation either party may end the employment by giving 15 days' written notice or salary in lieu.
9.2 After confirmation either party may end the employment by giving {{notice_days}} days' written notice or salary in lieu, subject to Company policy.
9.3 The Company may terminate the employment without notice for misconduct, breach of confidentiality, fraud, falsification of records or submission of false information.
9.4 On separation you will complete a full handover and obtain clearance before your final settlement is released.

# 10. General
10.1 The information and documents you have provided are a condition of this appointment. If any is found to be untrue, the Company may terminate the employment without notice.
10.2 This letter is governed by the laws of India and the courts at {{jurisdiction}} shall have jurisdiction.
10.3 This letter is issued, accepted and stored electronically; your electronic signature below has the same effect as a handwritten signature.

Please sign below to confirm that you have read, understood and accept these terms. We welcome you to the Company and wish you every success.

=== Annexure A – Remuneration
Monthly gross salary | {{monthly_salary}}
Annual gross salary | {{annual_salary}}
Statutory deductions | Provident Fund, ESI, Professional Tax and income tax, as applicable
Payment | Monthly, by bank transfer to your salary account
Salary slip | Available every month in the CRUX app

The break-up of your salary into its components appears on your monthly salary slip. The Company may change the structure of your salary, without reducing the total, to comply with law.

=== Annexure B – Roles and responsibilities
As {{designation}}, your principal responsibilities are:

{{responsibilities}}

These responsibilities are indicative and not exhaustive. Your performance will be measured against the key performance indicators and attributes set for you in the CRUX app and reviewed periodically.$t$),

('confirmation', 'Confirmation of employment', true, 'employee', $t$Dear {{first_name}},

We are pleased to inform you that, following a review of your performance and conduct during your probation, your employment with {{company_name}} as {{designation}} is confirmed with effect from {{effective_date}}.

All other terms and conditions of your appointment remain unchanged.

We appreciate the commitment you have shown and look forward to your continued contribution to the Company's growth.$t$),

('increment', 'Salary revision letter', true, 'employee', $t$Dear {{first_name}},

We are pleased to inform you that, in recognition of your performance, contribution and commitment to the organisation, the Management has decided to revise your compensation with effect from {{effective_date}}.

Revised annual Cost to Company (CTC) | {{revised_annual_ctc}}
Performance Linked Bonus (PLB) | {{revised_plb}}
Effective date | {{effective_date}}

# Terms
1. The revised CTC is inclusive of the employer's contributions towards Provident Fund, ESI and other statutory components, wherever applicable. Employee-side statutory and other applicable deductions will be made as per prevailing rules.
2. The PLB component is governed by the Company's Performance Linked Bonus policy and is payable on the achievement of assigned targets, performance evaluation and the other conditions of that policy.
3. All other terms and conditions of your employment remain unchanged.
4. Your compensation is strictly confidential and must not be discussed with other employees.

Please confirm your acceptance of the revised compensation by signing below.

We wish you continued success and look forward to your dedication and valuable contribution towards the organisation's growth and objectives.$t$),

('appraisal', 'Appraisal letter', true, 'employee', $t$Dear {{first_name}},

Thank you for your contribution during the review period. The outcome of your performance appraisal is set out below.

Review period | {{review_period}}
Overall rating | {{rating}}

# Strengths
{{strengths}}

# Areas for development
{{improvement_areas}}

# Outcome
{{appraisal_outcome}}

This appraisal has been discussed with you by your reporting manager. Please sign below to acknowledge that you have received it. Your acknowledgement confirms receipt and does not prevent you from recording your comments with Human Resources.

We value your work and look forward to supporting your growth in the period ahead.$t$),

('promotion', 'Promotion letter', true, 'employee', $t$Dear {{first_name}},

Congratulations. In recognition of your performance and potential, we are pleased to promote you as set out below.

New designation | {{new_designation}}
Effective date | {{effective_date}}
Reporting to | {{reporting_manager}}
Revised monthly gross salary | {{revised_monthly_salary}}

# Your responsibilities
{{responsibilities}}

Your performance in the new role will be measured against the key performance indicators set for you in the CRUX app. All other terms and conditions of your employment remain unchanged.

Please sign below to confirm your acceptance. We are confident you will meet the demands of your new role and wish you every success.$t$),

('transfer', 'Transfer letter', true, 'employee', $t$Dear {{first_name}},

In line with business requirements, you are transferred as set out below.

New place of posting | {{new_location}}
Effective date | {{effective_date}}
Reporting to | {{new_reporting_manager}}

Please complete the handover of your current responsibilities before the effective date and report at the new location on that date. All other terms and conditions of your employment remain unchanged.

Please sign below to acknowledge this transfer. We wish you success in your new assignment.$t$),

('pip', 'Performance improvement plan', true, 'employee', $t$Dear {{first_name}},

This letter records the discussion held with you regarding your performance, which is currently below the standard expected of your role. The purpose of this plan is to help you return to the required standard, with clear goals and support.

Plan period | {{pip_start}} to {{pip_end}}
Reviewed by | {{reporting_manager}}

# What is expected
{{pip_goals}}

# How you will be supported
- Regular review meetings with your reporting manager during the plan period.
- Guidance, training or resources reasonably needed to meet the goals above.

# Outcome
At the end of the plan period your performance will be reviewed against these goals. If the required standard is met and sustained, the plan will be closed. If it is not, the Company may extend the plan or take further action in line with its policies, which may include termination of employment.

Please sign below to acknowledge that this plan has been discussed with you. We are committed to supporting you and trust you will make full use of this opportunity.$t$),

('warning', 'Warning letter', true, 'employee', $t$Dear {{first_name}},

This letter is a formal warning regarding the following matter:

{{concern}}

This conduct is contrary to the standards required by the Company's Code of Conduct and policies. You are advised to correct it with immediate effect.

Please note that any repetition, or any other breach of Company policy, may lead to further disciplinary action, up to and including termination of employment. A copy of this letter will be placed on your personal file.

Please sign below to acknowledge receipt of this letter. If you wish to respond, you may do so in writing to Human Resources within three working days.$t$),

('show_cause', 'Show cause notice', true, 'employee', $t$Dear {{first_name}},

It has been reported that on or about {{incident_date}} the following occurred:

{{concern}}

If established, this would amount to misconduct under the Company's Code of Conduct and policies.

You are required to explain in writing, within {{response_days}} days of this notice, why disciplinary action should not be taken against you. Your explanation should be sent to Human Resources. If no explanation is received within this period, the Company will proceed on the basis of the information available.

This notice is issued without prejudice to the Company's rights. Please sign below to acknowledge receipt; your acknowledgement is not an admission.$t$),

('resignation_acceptance', 'Acceptance of resignation', true, 'employee', $t$Dear {{first_name}},

We refer to your resignation dated {{resignation_date}} from the position of {{designation}}. Your resignation is accepted and you will be relieved from the services of the Company at the close of working hours on {{last_working_day}}.

# Before your last working day
1. Complete the handover of your responsibilities, files and pending work to {{handover_to}}.
2. Return all Company property, including identity card, documents, devices, data and access credentials.
3. Download your signed letters and salary slips from the CRUX app; your access will end on your last working day.

# After you leave
4. Your full and final settlement will be processed in line with Company policy once clearance is complete.
5. Your obligations of confidentiality towards the Company, its clients and their customers continue after your employment ends.

We thank you for your contribution to the Company and wish you every success in your future endeavours.$t$),

('relieving', 'Relieving letter', false, 'employee', $t$To whomsoever it may concern,

This is to certify that {{name}} was employed with {{company_name}} from {{joining_date}} to {{last_working_day}}, and last held the position of {{designation}}.

{{name}} resigned from the services of the Company and has been relieved of all duties at the close of working hours on {{last_working_day}}.

We thank {{name}} for the services rendered and wish them every success in their future endeavours.$t$),

('experience', 'Experience letter', false, 'employee', $t$To whomsoever it may concern,

This is to certify that {{name}} worked with {{company_name}} from {{joining_date}} to {{last_working_day}}.

Last designation | {{designation}}
Department | {{department}}

During this period we found {{name}} to be {{conduct_remark}}.

This certificate is issued at the request of the employee. We wish {{name}} every success in their future endeavours.$t$),

('full_final', 'Full and final settlement', true, 'employee', $t$Dear {{first_name}},

With reference to your separation from the Company with effect from {{last_working_day}}, your full and final settlement has been computed as below.

Net amount payable | {{settlement_amount}}
Details | {{settlement_details}}

# Declaration
1. I confirm that the above amount is in full and final settlement of all my dues from the Company, including salary, leave encashment, bonus and any other claim arising from my employment or its cessation.
2. I confirm that I have returned all Company property, documents and data, and that I hold no copies.
3. I confirm that my obligations of confidentiality towards the Company, its clients and their customers continue.
4. I have no further claim of any nature against the Company, its directors or employees.

Please sign below to accept this settlement.$t$),

-- ----------------------------------------------- policies an employee signs
('policy', 'Code of Conduct and Business Ethics', true, 'all', $t$Dear {{first_name}},

{{company_name}} (the "Company") is trusted by banks and financial institutions with sensitive work. That trust depends on how each of us behaves. This Code sets out the standards expected of everyone who works for or with the Company.

# 1. Integrity
1.1 Act honestly and lawfully in everything you do for the Company.
1.2 Record and report information truthfully. Never falsify, alter or fabricate a record, report, visit, signature or photograph.
1.3 Do not misuse your position, Company funds or Company property for personal gain.

# 2. Respect and fairness
2.1 Treat colleagues, clients, customers and members of the public with dignity and courtesy.
2.2 The Company does not tolerate discrimination, harassment, intimidation or abuse in any form.
2.3 Do not be under the influence of alcohol or drugs while on duty.

# 3. Clients and their customers
3.1 Follow each client's processes and instructions exactly.
3.2 Do not accept or ask for money, gifts or favours from a customer, applicant or any person whose case you handle.
3.3 Do not disclose the purpose or result of a verification to anyone not authorised to know it.

# 4. Confidential information and assets
4.1 Protect all Company, client and customer information and use it only for your work.
4.2 Use Company devices, systems and accounts responsibly and only as authorised.

# 5. Conflicts of interest
Disclose in writing any personal, financial or family interest that could influence, or appear to influence, your work for the Company.

# 6. Speaking up
Report any suspected breach of this Code, fraud or unsafe practice to your reporting manager, Human Resources or senior management. Reports made in good faith will be treated in confidence and no one will suffer retaliation for making them.

# 7. Consequences
A breach of this Code may lead to disciplinary action, up to and including termination of employment or engagement, and legal action where warranted.

# Acknowledgement
I confirm that I have read and understood this Code of Conduct and Business Ethics and agree to comply with it.$t$),

('policy', 'Confidentiality, Non-Disclosure and Intellectual Property Undertaking', true, 'employee', $t$Dear {{first_name}},

In the course of your work with {{company_name}} (the "Company") you will have access to confidential information. This undertaking sets out your obligations.

# 1. Confidential information
"Confidential Information" means all non-public information, in any form, relating to the Company, its clients and their customers, including personal and financial data, case files, verification reports, client names and processes, rates, targets, revenue, business plans, software, and the personal and salary information of colleagues.

# 2. My undertakings
2.1 I will keep all Confidential Information strictly confidential and use it only to perform my duties.
2.2 I will not copy, photograph, forward, download, remove or share Confidential Information, by any means, except as my duties require and the Company permits.
2.3 I will not discuss Confidential Information in public places, on social media or with any person not authorised to receive it.
2.4 I will immediately report any actual or suspected loss, leak or unauthorised access.
2.5 On separation, or earlier on request, I will return all Confidential Information and Company property and will delete any copies in my possession.

# 3. Intellectual property
All documents, data, reports, processes, software and other work created by me in the course of my employment belong to the Company, and I assign all rights in them to the Company.

# 4. Duration
These obligations apply throughout my employment and continue after it ends, for as long as the information remains confidential.

# 5. Non-solicitation
For twelve months after my employment ends I will not, directly or indirectly, solicit any client or employee of the Company with whom I dealt in my last twelve months of service.

# 6. Remedies
I understand that a breach may cause serious and irreparable harm to the Company and its clients, and that the Company may take disciplinary action, seek injunctive relief and recover its losses. This undertaking is governed by the laws of India and the courts at {{jurisdiction}} shall have jurisdiction.

# Acknowledgement
I confirm that I have read and understood this undertaking and agree to be bound by it.$t$),

('policy', 'Information Security and Acceptable Use Policy', true, 'all', $t$Dear {{first_name}},

This policy explains how the systems, devices and data of {{company_name}} (the "Company") and its clients must be used and protected.

# 1. Accounts and passwords
1.1 Your login to the CRUX app and to any client system is personal. Never share your password or one-time passcode, and never use another person's login.
1.2 Lock your device when unattended and report a lost or stolen device immediately.

# 2. Devices and data
2.1 Use only authorised devices, applications and channels for Company and client work.
2.2 Do not store client or customer data on personal email, personal cloud storage or messaging groups not approved by the Company.
2.3 Do not take screenshots or photographs of client systems or data unless your duties require it.
2.4 Dispose of documents and data only in the manner the Company directs.

# 3. Acceptable use
3.1 Do not use Company systems to access, store or send unlawful, offensive or inappropriate material.
3.2 Do not install unauthorised software or attempt to bypass security controls.

# 4. Monitoring
To protect the Company and its clients, activity within the CRUX app and on Company systems is recorded and may be reviewed, as described in the app.

# 5. Reporting incidents
Report immediately any suspected data breach, phishing attempt, virus or unauthorised access to your reporting manager and the Company's IT administrator.

# Acknowledgement
I confirm that I have read and understood this policy and agree to comply with it. I understand that a breach may lead to disciplinary action, including termination, and legal action.$t$),

('policy', 'Data Privacy and Client Data Handling Undertaking', true, 'all', $t$Dear {{first_name}},

{{company_name}} (the "Company") handles the personal and financial data of its clients' customers. This data is entrusted to us for a specific purpose and is protected by law, including the Digital Personal Data Protection Act, 2023, and by our contracts with clients.

# I undertake that
1. I will collect, view and use personal data only for the specific case or task assigned to me, and only as the Company and the client instruct.
2. I will not collect more information than the task requires.
3. I will not disclose personal data to any person, including the customer's relatives, neighbours or employer, beyond what the verification process expressly permits.
4. I will not retain copies of customer documents, photographs or data on my personal phone, email or storage once they have been submitted through the authorised channel.
5. I will not use any customer's data to contact them for any purpose other than the assigned task.
6. I will keep physical documents secure and will hand them over or destroy them as directed.
7. I will report any loss, wrongful disclosure or misuse of personal data to my reporting manager immediately.

I understand that a breach of this undertaking may expose the Company and me personally to legal liability, and may result in disciplinary action, termination and recovery of losses.

# Acknowledgement
I confirm that I have read and understood this undertaking and agree to comply with it.$t$),

('policy', 'Prevention of Sexual Harassment (POSH) Policy – Acknowledgement', true, 'all', $t$Dear {{first_name}},

{{company_name}} (the "Company") is committed to a workplace that is safe, respectful and free from sexual harassment, in accordance with the Sexual Harassment of Women at Workplace (Prevention, Prohibition and Redressal) Act, 2013.

# 1. What is prohibited
Sexual harassment includes any unwelcome physical contact or advances, a demand or request for sexual favours, sexually coloured remarks, showing pornography, and any other unwelcome physical, verbal or non-verbal conduct of a sexual nature. It applies at the workplace, during travel and field work, at client sites and in any communication connected with work, including messages and calls.

# 2. Our commitment
2.1 The Company has zero tolerance for sexual harassment by or against any employee, associate, client representative or visitor.
2.2 The Company has constituted an Internal Committee to receive and inquire into complaints.
2.3 Complaints are handled confidentially, fairly and within the timelines prescribed by law.
2.4 No one will suffer retaliation for making a complaint in good faith or assisting in an inquiry.

# 3. How to raise a complaint
A complaint may be made in writing to the Internal Committee or to Human Resources, ordinarily within three months of the incident. Details of the Internal Committee are available from Human Resources and in the CRUX app.

# 4. Consequences
A person found to have committed sexual harassment will face disciplinary action, which may include termination. A complaint found to be deliberately false or malicious may also lead to action.

# Acknowledgement
I confirm that I have read and understood the Company's policy on prevention of sexual harassment and agree to comply with it.$t$),

('policy', 'Anti-Bribery, Gifts and Conflict of Interest Declaration', true, 'all', $t$Dear {{first_name}},

{{company_name}} (the "Company") conducts its business honestly and without the use of bribes or improper influence.

# 1. Anti-bribery
1.1 I will not offer, give, ask for or accept any bribe, facilitation payment, commission or other improper advantage, directly or through another person.
1.2 I will not accept money, gifts, hospitality or favours from any customer, applicant, vendor or person whose case, verification or payment I am involved in.
1.3 I will not alter, delay, expedite or influence the outcome of any verification, report or collection in return for any benefit.

# 2. Gifts and hospitality
Modest festival gifts of nominal value may be accepted only where permitted by Company policy and declared to my reporting manager. Cash or cash equivalents must never be accepted.

# 3. Conflict of interest
3.1 I will disclose to the Company in writing any outside employment, business interest, or close relative working with a client, competitor or vendor of the Company.
3.2 I will not handle a case involving myself, a relative or a close associate; I will report it to my reporting manager so that it can be reassigned.

# 4. Reporting
I will report any request for, or offer of, a bribe to my reporting manager or Human Resources immediately.

# Declaration
I confirm that I have read and understood this policy, that I will comply with it, and that I have no conflict of interest other than any I have disclosed to the Company in writing.$t$),

('policy', 'Field Verification Integrity Undertaking', true, 'all', $t$Dear {{first_name}},

Clients of {{company_name}} (the "Company") take credit and business decisions on the strength of our verification reports. A false or careless report can cause financial loss to the client, harm to a customer and serious damage to the Company. I therefore undertake as follows.

1. I will personally carry out every visit, call and check assigned to me, at the stated address, and will not delegate it to any unauthorised person.
2. I will report only what I have actually seen, heard and verified. I will never report a visit that did not take place, nor record a finding I did not verify.
3. I will capture photographs, location and documents only in the manner the process requires, and will never reuse, edit or fabricate them.
4. I will not accept money, gifts or favours from the applicant or any person connected with the case, and will not disclose or promise any result.
5. I will not conduct a verification for myself, a relative or a close associate; I will report it so that it can be reassigned.
6. I will behave courteously at every visit and will identify myself truthfully as required by the process.
7. I will record the day's figures in the CRUX app accurately and on the same day.
8. I will immediately report any suspected fraud, pressure, threat or inducement to my reporting manager.

I understand that any falsification or breach of this undertaking is gross misconduct, for which the Company may terminate my employment or engagement without notice, recover its losses and initiate legal action.

# Acknowledgement
I confirm that I have read and understood this undertaking and agree to comply with it.$t$),

('policy', 'Attendance, Leave and Working Hours – Acknowledgement', true, 'employee', $t$Dear {{first_name}},

This document summarises the rules on attendance, working hours and leave at {{company_name}} (the "Company"). The detailed rules, holiday list and current leave entitlements are available in the CRUX app and may be revised from time to time.

# 1. Attendance and working hours
1.1 Mark your attendance and complete your check-in in the CRUX app every working day.
1.2 Be available and working during your notified shift hours.
1.3 Submit your daily update before the day closes. Your manager reviews and certifies it.

# 2. Leave
2.1 Apply for planned leave in advance through the CRUX app and proceed on leave only after it is approved.
2.2 In an emergency, inform your reporting manager before your shift begins and apply for the leave on return.
2.3 Absence without approval or information is treated as unauthorised absence and is unpaid.
2.4 Continuous unauthorised absence may be treated as abandonment of employment in line with Company policy.

# 3. Accuracy
Attendance and daily figures must be true. Marking attendance for another person, or recording false attendance or figures, is misconduct.

# Acknowledgement
I confirm that I have read and understood these rules and agree to follow them.$t$),

('policy', 'Performance Linked Bonus (PLB) Policy – Acknowledgement', true, 'employee', $t$Dear {{first_name}},

This document explains how the Performance Linked Bonus ("PLB") of {{company_name}} (the "Company") works where it forms part of your compensation.

1. PLB is a variable component. It is not guaranteed and is payable only on the conditions of this policy.
2. PLB is linked to the achievement of the targets and key performance indicators assigned to you, your performance evaluation, and the Company's performance.
3. Your targets, achievement and monthly score are recorded in the CRUX app, where you complete your self-evaluation and your manager records the score.
4. PLB is computed and paid at the intervals the Company notifies. The Company's computation is final.
5. To be eligible, you must be in active service and not serving notice on the date of payment, unless the Company decides otherwise in writing.
6. PLB may be withheld or recovered where it was paid on the basis of incorrect data, or in cases of misconduct or breach of Company policy.
7. The Company may revise or withdraw this policy with reasonable notice.

# Acknowledgement
I confirm that I have read and understood this policy.$t$),

-- ----------------------------------------------- documents a Business Associate signs
('partner', 'Business Associate – Code of Conduct and Compliance Undertaking', true, 'partner', $t$Dear {{first_name}},

This undertaking is given by you as a Business Associate of {{company_name}} (the "Company") and forms part of, and is to be read with, your Business Associate Agreement.

# 1. Standards of conduct
1.1 You and every person working for you ("Associate Staff") will act honestly, lawfully and courteously in all work done for the Company.
1.2 You will follow the Company's and each client's processes, turnaround times and quality standards.
1.3 You will not sub-contract or assign any work to a third party without the Company's written consent.

# 2. Integrity of work
2.1 Every visit and check will be carried out in person by trained Associate Staff and reported truthfully. No report, photograph, signature or record will be fabricated or altered.
2.2 Neither you nor your Associate Staff will ask for or accept money, gifts or favours from any applicant, customer or other person connected with a case.

# 3. Associate Staff
3.1 You will engage only persons whose identity, address and background you have verified, and will arrange police verification where the Company requires it.
3.2 You are the employer of your Associate Staff and are solely responsible for their remuneration and for compliance with all laws applicable to them.
3.3 You will ensure that Associate Staff accept the Company's policies and record their work in the CRUX app as required.

# 4. Records and audit
You will maintain accurate records and allow the Company and its clients to inspect and audit them on reasonable notice.

# 5. Reporting
You will report to the Company immediately any suspected fraud, data incident, complaint, or breach of this undertaking.

# 6. Consequences
A breach entitles the Company to suspend or terminate the engagement, withhold amounts relating to affected work, recover its losses and invoke any security held, in accordance with the Business Associate Agreement.

# Acknowledgement
I confirm that I have read and understood this undertaking and agree to be bound by it, for myself and my Associate Staff.$t$),

('partner', 'Business Associate – Confidentiality and Data Protection Undertaking', true, 'partner', $t$Dear {{first_name}},

In performing services for {{company_name}} (the "Company") you and your staff will handle confidential information and personal data belonging to the Company, its clients and their customers. This undertaking forms part of your Business Associate Agreement.

# I undertake that I and my staff will
1. Keep all such information strictly confidential and use it only to perform the services.
2. Process personal data only on the Company's instructions and in accordance with applicable law, including the Digital Personal Data Protection Act, 2023.
3. Use only the channels and applications authorised by the Company to receive, store and submit case data.
4. Not retain copies of customer documents, photographs or data on personal devices, email or storage after submission.
5. Keep physical documents secure and return or destroy them as directed.
6. Limit access to those staff who need it for the assigned work and who are bound by the same obligations.
7. Report any loss, wrongful disclosure or unauthorised access to the Company immediately, and cooperate fully in its investigation.
8. On termination of the engagement, or earlier on request, return or securely destroy all information and confirm this in writing.

# Liability
I accept that I am responsible for any breach of this undertaking by me or my staff, and will indemnify the Company against losses, claims and penalties arising from it. These obligations survive the end of the engagement. This undertaking is governed by the laws of India and the courts at {{jurisdiction}} shall have jurisdiction.

# Acknowledgement
I confirm that I have read and understood this undertaking and agree to be bound by it.$t$),

('partner', 'Business Associate – Security Cheque Acknowledgement and Undertaking', true, 'partner', $t$Dear {{first_name}},

This document records the security cheque provided by you to {{company_name}} (the "Company") under your Business Associate Agreement.

Location / branch | {{branch_location}}
Cheque number | {{cheque_number}}
Drawn on | {{cheque_bank}}
Amount | {{cheque_amount}}

# Terms
1. The cheque is given voluntarily as security for the due performance of your obligations under the Business Associate Agreement, including the integrity of work, the protection of data and the settlement of any amounts due to the Company.
2. The Company will hold the cheque as security and will not present it in the ordinary course.
3. The Company may present the cheque only to recover amounts that have become due from you under the Agreement and remain unpaid after written notice to you.
4. You will keep the account on which the cheque is drawn in operation, and will replace the cheque on request if it becomes stale or the account is changed or closed.
5. On termination of the engagement and settlement of all dues, the Company will return the cheque to you.

# Acknowledgement
I confirm that the details above are correct and that I have provided the security cheque on these terms.$t$),

('partner', 'Business Associate – Associate Staff Compliance Declaration', true, 'partner', $t$Dear {{first_name}},

As a Business Associate of {{company_name}} (the "Company"), I declare and undertake as follows in respect of every person I engage to work on the Company's assignments ("Associate Staff").

1. I have verified the identity and address of each Associate Staff member and hold copies of their identity documents.
2. I have obtained, or have applied for, police verification for each Associate Staff member where the Company requires it, and will share the certificate with the Company.
3. Each Associate Staff member has been trained on the client's process, on the confidentiality and integrity of verification work, and on courteous conduct.
4. Each Associate Staff member has been added to the CRUX app under my team and has accepted the Company's policies in the app.
5. I will inform the Company immediately when a person joins or leaves, and will ensure that a person who has left no longer has access to any case data.
6. I am the employer of my Associate Staff. I am solely responsible for their wages and for compliance with all labour and other laws applicable to them, and I will keep the Company indemnified against any claim by or in respect of them.

# Declaration
I confirm that the above is true and that I will keep it true throughout my engagement with the Company.$t$)
on conflict (name) do update set kind = excluded.kind, body = excluded.body, needs_signature = excluded.needs_signature, audience = excluded.audience, updated_at = now()
  where public.letter_templates.updated_by is null;
