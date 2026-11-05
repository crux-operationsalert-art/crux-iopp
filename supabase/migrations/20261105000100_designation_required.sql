-- D-73 Designation is compulsory for every person (owner, 05 Nov): checked by the database on every new or changed
-- person (single add, bulk upload, Admin edit), and the add-member forms require it.
alter table public.persons add constraint persons_designation_required check (coalesce(btrim(designation), '') <> '') not valid;
do $$ begin
  if not exists (select 1 from public.persons where coalesce(btrim(designation), '') = '') then
    alter table public.persons validate constraint persons_designation_required;
  end if;
end $$;
