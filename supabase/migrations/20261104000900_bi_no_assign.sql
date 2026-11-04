-- D-56 kept (owner: BI & Growth "can't assign targets or anything to ops or collections"): the BI & Growth role can give
-- tasks only within its own team, its peers and its manager, and cannot send alerts. Leadership keeps the org-wide right.
do $do$
declare f text; o text;
begin
  f := pg_get_functiondef('app.can_assign_to(uuid)'::regprocedure); o := f;
  f := replace(f, 'app.is_admin() or app.has_role(''auditor'') or app.has_role(''hr_admin'')',
                  'app.is_admin() or app.has_role(''leadership'') or app.has_role(''hr_admin'')');
  if f = o then raise exception 'can_assign_to anchor not found'; end if;
  execute f;
  f := pg_get_functiondef('public.send_alert(uuid[],text,text)'::regprocedure); o := f;
  f := replace(f, 'if not (app.is_admin() or app.has_role(''auditor'') or', 'if not (app.is_admin() or app.has_role(''leadership'') or');
  if f = o then raise exception 'send_alert anchor not found'; end if;
  execute f;
end $do$;
