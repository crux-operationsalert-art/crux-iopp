-- STAGING ONLY. SYNTHETIC DATA — not CRUX actuals. Every name starts with "SYNTH" and every code with "S-".
-- Remove with supabase/seed/purge_synthetic.sql before any real data is loaded.
-- Run as the database owner (SQL editor / MCP), never from the app.
do $$
declare
  z_w uuid; z_e uuid; b_pun uuid; b_nsk uuid; b_kol uuid; c_bom uuid; c_sbi uuid; c_idbi uuid;
  l_pun uuid; l_nsk uuid; l_kol uuid; p_rv uuid; oh uuid; ch uuid; zm1 uuid; zm2 uuid; bm uuid; ba uuid; bk uuid;
  e uuid; i int; d date; cl record; people uuid[] := '{}';
begin
  insert into zones(code,name) values ('S-W','SYNTH West Zone') returning id into z_w;
  insert into zones(code,name) values ('S-E','SYNTH East Zone') returning id into z_e;
  insert into branches(code,name,branch_type,state) values ('S-PUN','SYNTH Pune Branch','own','MH') returning id into b_pun;
  insert into branches(code,name,branch_type,state) values ('S-NSK','SYNTH Nashik Partner','partner','MH') returning id into b_nsk;
  insert into branches(code,name,branch_type,state) values ('S-KOL','SYNTH Kolkata Branch','own','WB') returning id into b_kol;
  insert into branch_zones(branch_id,zone_id,valid) values (b_pun,z_w,'[2026-10-01,)'),(b_nsk,z_w,'[2026-10-01,)'),(b_kol,z_e,'[2026-10-01,)');
  insert into clients(code,name,client_family) values ('S-BOM','SYNTH Bank A','SYNTH PSU') returning id into c_bom;
  insert into clients(code,name,client_family) values ('S-SBI','SYNTH Bank B','SYNTH PSU') returning id into c_sbi;
  insert into clients(code,name,client_family) values ('S-IDBI','SYNTH Bank C','SYNTH Private') returning id into c_idbi;
  insert into locations(code,name,state) values ('S-LPUN','SYNTH Pune','MH') returning id into l_pun;
  insert into locations(code,name,state) values ('S-LNSK','SYNTH Nashik','MH') returning id into l_nsk;
  insert into locations(code,name,state) values ('S-LKOL','SYNTH Kolkata','WB') returning id into l_kol;
  insert into processes(code,name) values ('S-RV','SYNTH Residence verification') returning id into p_rv;
  insert into client_locations(client_id,location_id,process_id,branch_id,valid) values
    (c_bom,l_pun,p_rv,b_pun,'[2026-10-01,)'),(c_sbi,l_pun,p_rv,b_pun,'[2026-10-01,)'),
    (c_bom,l_nsk,p_rv,b_nsk,'[2026-10-01,)'),(c_idbi,l_nsk,p_rv,b_nsk,'[2026-10-01,)'),(c_sbi,l_kol,p_rv,b_kol,'[2026-10-01,)');
  insert into rate_cards(client_id,location_id,process_id,billable_event,rate,valid,reason) values
    (c_bom,l_pun,p_rv,'closure',750,'[2026-10-01,)','SYNTH rate'),(c_sbi,l_pun,p_rv,'closure',225,'[2026-10-01,)','SYNTH rate'),
    (c_bom,l_nsk,p_rv,'closure',750,'[2026-10-01,)','SYNTH rate'),(c_idbi,l_nsk,p_rv,'closure',750,'[2026-10-01,)','SYNTH rate'),
    (c_sbi,l_kol,p_rv,'closure',260,'[2026-10-01,)','SYNTH rate');
  insert into partner_share_rules(branch_id,crux_share_pct,partner_share_pct,valid,reason)
    values (b_nsk,80,20,'[2026-10-01,)','SYNTH ratio — direction NOT confirmed (D-04)');

  insert into persons(full_name,personal_email,resource_type,designation,status,invite_expires_at) values
    ('SYNTH Operations Head','synth.oh@example.invalid','own_employee','Operations Head','invited','2026-01-01') returning id into oh;
  insert into persons(full_name,personal_email,resource_type,designation,status,invite_expires_at) values
    ('SYNTH Collections Head','synth.ch@example.invalid','own_employee','Collections Head','invited','2026-01-01') returning id into ch;
  insert into persons(full_name,personal_email,resource_type,designation,status,invite_expires_at) values
    ('SYNTH ZM West','synth.zm1@example.invalid','own_employee','Zonal Manager','invited','2026-01-01') returning id into zm1;
  insert into persons(full_name,personal_email,resource_type,designation,status,invite_expires_at) values
    ('SYNTH ZM East','synth.zm2@example.invalid','own_employee','Zonal Manager','invited','2026-01-01') returning id into zm2;
  insert into persons(full_name,personal_email,resource_type,designation,status,invite_expires_at) values
    ('SYNTH BM Pune','synth.bm@example.invalid','own_employee','Branch Manager','invited','2026-01-01') returning id into bm;
  insert into persons(full_name,personal_email,resource_type,designation,status,invite_expires_at) values
    ('SYNTH BA Nashik','synth.ba@example.invalid','partner','Business Associate','invited','2026-01-01') returning id into ba;
  insert into persons(full_name,personal_email,resource_type,designation,status,invite_expires_at) values
    ('SYNTH BM Kolkata','synth.bk@example.invalid','own_employee','Branch Manager','invited','2026-01-01') returning id into bk;
  insert into role_assignments(person_id,role,zone_id,valid) values (oh,'ops_head',null,'[2026-10-01,)'),(ch,'collections_head',null,'[2026-10-01,)'),
    (zm1,'zm',z_w,'[2026-10-01,)'),(zm2,'zm',z_e,'[2026-10-01,)'),(bm,'bm',null,'[2026-10-01,)'),(ba,'ba',null,'[2026-10-01,)'),(bk,'bm',null,'[2026-10-01,)');
  insert into reporting_lines(person_id,manager_id,function,valid) values (zm1,oh,'operations','[2026-10-01,)'),(zm2,oh,'operations','[2026-10-01,)'),
    (bm,zm1,'operations','[2026-10-01,)'),(ba,zm1,'operations','[2026-10-01,)'),(bk,zm2,'operations','[2026-10-01,)');

  for i in 1..9 loop
    insert into persons(full_name,personal_email,resource_type,designation,status,invite_expires_at)
    values ('SYNTH Executive ' || i, 'synth.e' || i || '@example.invalid', case when i between 4 and 6 then 'partner' else 'own_employee' end,
            'Executive','invited','2026-01-01') returning id into e;
    people := people || e;
    insert into role_assignments(person_id,role,valid) values (e,'executive','[2026-10-01,)');
    insert into reporting_lines(person_id,manager_id,function,valid)
      values (e, case when i <= 3 then bm when i <= 6 then ba else bk end, 'operations', '[2026-10-01,)');
    if i in (1,2) then insert into reporting_lines(person_id,manager_id,function,valid) values (e,ch,'collections','[2026-10-01,)'); end if;
    for cl in select c.id from client_locations c where c.branch_id = case when i <= 3 then b_pun when i <= 6 then b_nsk else b_kol end loop
      insert into allocations(person_id,client_location_id,function,valid) values (e, cl.id, 'operations', '[2026-10-01,)');
    end loop;
  end loop;

  -- 1 Oct .. 2 Nov 2026 synthetic history (working days only), all submitted and certified-free.
  for d in select g::date from generate_series('2026-10-01'::date, '2026-11-02'::date, interval '1 day') g loop
    continue when not app.is_working_day(d);
    insert into productivity_lines(person_id,work_date,client_location_id,entry,closure,cancelled,source,reason)
      select a.person_id, d, a.client_location_id, (3 + floor(random()*9))::int, (2 + floor(random()*8))::int,
             (case when random() < .15 then 1 else 0 end), 'import', 'SYNTH generated'
        from allocations a where a.person_id = any(people);
    insert into day_status(person_id,work_date,function,status,submitted_at)
      select p, d, 'operations', 'submitted', (d + time '18:30') at time zone 'Asia/Kolkata' from unnest(people) p;
    insert into collection_entries(person_id,collection_date,client_id,branch_id,amount_received,amount_reconciled,source,remarks)
      select p, d, c_sbi, b_pun, (20000 + floor(random()*30000))::numeric, (15000 + floor(random()*15000))::numeric, 'import', 'SYNTH'
        from unnest(people[1:2]) p;
  end loop;
  insert into bill_entries(person_id,bill_date,client_id,branch_id,bill_count,bill_amount,source,remarks)
    values (people[1],'2026-10-31',c_bom,b_pun,42,31500,'import','SYNTH'),(people[2],'2026-10-31',c_sbi,b_pun,18,4050,'import','SYNTH');
  insert into target_allocations(month,metric,level,amount,reason) values ('2026-11-01','revenue','org',900000,'SYNTH');
  insert into target_allocations(month,metric,level,zone_id,amount,reason) values ('2026-11-01','revenue','zone',z_w,600000,'SYNTH'),('2026-11-01','revenue','zone',z_e,250000,'SYNTH');
  insert into penalty_rules(code,description,trigger_description,amount,active)
    values ('MISSED_REPORT','Missed daily report (candidate rule — amount not approved)','No submission or status by the 10:00 grace deadline',null,true);
end $$;
