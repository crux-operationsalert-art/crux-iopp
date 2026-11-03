-- Advisor follow-up after the import (03 Nov 2026).
alter function app.slug(text) set search_path = public, app, pg_temp;
-- The upload path is opened only for the duration of an import (re-grant in that import's runbook).
revoke execute on function public.stage_import_rows(uuid, text, jsonb) from anon, authenticated;
-- Email-claim sign-up is replaced by activation codes (D-13).
revoke execute on function public.claim_my_person() from authenticated;
