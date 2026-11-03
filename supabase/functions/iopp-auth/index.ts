// iopp-auth: email-free account activation and admin suspension (D-13).
// - activate: { login, code, password } → redeems a one-time activation code, then creates or updates the
//   Supabase Auth user with the person's login identifier and their own chosen password. No email is sent.
// - suspend:  { person_id } with the caller's JWT → Admin/HR only; bans the auth user and revokes sessions.
// The service-role key never leaves this function.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed' });
  let body: Record<string, string>;
  try { body = await req.json(); } catch { return reply(400, { error: 'Invalid request.' }); }
  const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

  if (body.action === 'activate') {
    const login = String(body.login ?? '').trim();
    const code = String(body.code ?? '').trim();
    const password = String(body.password ?? '');
    if (!login || !code) return reply(400, { error: 'Enter your mobile number (or email) and activation code.' });
    if (password.length < 10 || /^\d+$/.test(password)) {
      return reply(400, { error: 'Choose a password of at least 10 characters that is not only numbers.' });
    }
    const { data, error } = await admin.rpc('redeem_activation', { p_login: login, p_code: code });
    if (error) return reply(500, { error: 'Activation is temporarily unavailable. Try again shortly.' });
    const row = Array.isArray(data) ? data[0] : null;
    if (!row) {
      return reply(400, { error: 'That activation code is not valid, has expired, or was already used. Ask your manager or Admin for a new one.' });
    }
    let uid: string | null = row.auth_user_id;
    if (uid) {
      const { error: e } = await admin.auth.admin.updateUserById(uid, {
        email: row.login_email, password, email_confirm: true, ban_duration: 'none',
      });
      if (e) return reply(500, { error: 'Could not update your account. Ask Admin for a new code.' });
    } else {
      const { data: u, error: e } = await admin.auth.admin.createUser({
        email: row.login_email, password, email_confirm: true, user_metadata: { full_name: row.full_name },
      });
      if (e || !u.user) return reply(500, { error: 'Could not create your account. Ask Admin for a new code.' });
      uid = u.user.id;
    }
    const { error: le } = await admin.rpc('link_person_auth', { p_person: row.person_id, p_uid: uid });
    if (le) return reply(500, { error: 'Account created but not linked. Ask Admin to re-issue a code.' });
    return reply(200, { ok: true, login_email: row.login_email, full_name: row.full_name });
  }

  if (body.action === 'suspend') {
    const auth = req.headers.get('Authorization') ?? '';
    const caller = createClient(URL_, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: uid, error } = await caller.rpc('auth_user_for_suspension', { p_person: body.person_id });
    if (error) return reply(403, { error: 'Not permitted.' });
    if (!uid) return reply(200, { ok: true, note: 'No sign-in account linked, or not permitted.' });
    const { error: e } = await admin.auth.admin.updateUserById(uid as string, { ban_duration: '876000h' });
    if (e) return reply(500, { error: 'Could not suspend sign-in.' });
    // Ban blocks token refresh; the person is also marked exited, which removes all data access at once.
    return reply(200, { ok: true });
  }

  return reply(400, { error: 'Unknown action.' });
});
