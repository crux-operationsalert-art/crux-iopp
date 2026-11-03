-- Tracker tables are written only by the import functions (RLS also has no write policies).
revoke insert, update, delete, truncate on public.import_batches, public.import_rows, public.tracker_monthly from authenticated;
