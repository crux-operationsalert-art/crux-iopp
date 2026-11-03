// iopp-push: sends phone notifications (web push) for new notifications. Called every few minutes by a scheduled job
// in the database with a shared token; the VAPID private key and the token are kept in Supabase Vault, never in the repo.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const PUBLIC = 'BKUkGdBfn-J9Wkv_KOY3H8FtDxXbTKZY3NeFocd0zb2pbMDzSDqcL669YUgcG9wfzZfdsta-j6nMeN3g6UYAZuk';
let cfg: Record<string, string> | null = null;

Deno.serve(async (req) => {
  if (!cfg) { const { data } = await sb.rpc('push_config'); cfg = data ?? {};
    webpush.setVapidDetails('mailto:operations.alert@cruxindia.co.in', PUBLIC, cfg!.iopp_vapid_private); }
  if (!cfg!.iopp_push_token || req.headers.get('x-cron-token') !== cfg!.iopp_push_token) return new Response('forbidden', { status: 403 });
  const { data, error } = await sb.rpc('push_batch', { p_limit: 200 });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  let sent = 0, failed = 0;
  for (const m of (data ?? []) as any[]) {
    try {
      await webpush.sendNotification({ endpoint: m.endpoint, keys: { p256dh: m.p256dh, auth: m.auth } },
        JSON.stringify({ title: m.title, body: m.body, url: m.url }), { TTL: 86400 });
      sent++; await sb.rpc('push_result', { p_endpoint: m.endpoint, p_ok: true });
    } catch (e) {
      failed++;
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await sb.rpc('push_result', { p_endpoint: m.endpoint, p_ok: false });   // phone unsubscribed
    }
  }
  return new Response(JSON.stringify({ sent, failed }), { headers: { 'Content-Type': 'application/json' } });
});
