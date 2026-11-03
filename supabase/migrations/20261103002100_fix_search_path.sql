-- Pin search_path on two pure helper functions (Supabase linter 0011).
alter function app.att_category(text) set search_path = pg_catalog, public;
alter function app.att_sub(text) set search_path = pg_catalog, public;
