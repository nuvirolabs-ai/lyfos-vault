// Lyfos — monthly balance-sheet reminder
//
// Runs on the 1st of every month via Supabase scheduled triggers. Finds
// authenticated users whose vault_blobs.client_updated_at is older than
// the start of the current month, and sends a calm reminder email.
//
// Privacy: the server CANNOT see what's inside the vault — only when it
// was last pushed. The reminder text says nothing specific about the
// user's data.
//
// Deploy:
//   supabase functions deploy monthly-reminder
//   supabase secrets set RESEND_API_KEY=re_xxx
//   # Schedule via Database > Cron in the Supabase dashboard, or:
//   # select cron.schedule('monthly-reminder', '0 9 1 * *',
//   #   $$ select net.http_post('https://<ref>.supabase.co/functions/v1/monthly-reminder',
//   #        headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.cron_secret'))) $$);
//
// Env required:
//   SUPABASE_URL                   (auto)
//   SUPABASE_SERVICE_ROLE_KEY      (auto — DO NOT log)
//   RESEND_API_KEY                 (you set via `supabase secrets set`)
//   FROM_EMAIL                     (you set; defaults to "Lyfos <hello@lyfos.in>")
//   APP_URL                        (you set; defaults to "https://app.lyfos.in")

// @ts-ignore Deno-style imports work at deploy time; types are unavailable locally
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.2";
import { requireExternalAppUrl } from "../_shared/public-app-url.ts";

// @ts-ignore Deno global available at runtime
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
// @ts-ignore
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// @ts-ignore
const RESEND_KEY   = Deno.env.get("RESEND_API_KEY") ?? "";
// @ts-ignore
const FROM_EMAIL   = Deno.env.get("FROM_EMAIL") ?? "Lyfos <hello@lyfos.in>";
// @ts-ignore
const APP_URL      = requireExternalAppUrl(Deno.env.get("APP_URL") ?? "https://app.lyfos.in");

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

serve(async (req) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response("method not allowed", { status: 405 });
  }

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const monthLabel = now.toLocaleString("en-US", { month: "long" });

  // 1. Find vault_blobs not updated since the start of this month.
  const { data: stale, error } = await admin
    .from("vault_blobs")
    .select("user_id, client_updated_at")
    .lt("client_updated_at", monthStart);

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  }

  // 2. Pull email addresses from auth.users for the affected user_ids.
  //    auth.admin.listUsers paginates; we need only ones with the matching
  //    id. For current scale (<1000 users) a single listUsers page covers
  //    most cases; a real production version paginates fully.
  const emails: Record<string, string> = {};
  const { data: usersResp } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  for (const u of usersResp?.users ?? []) {
    if (u.email) emails[u.id] = u.email;
  }

  // 3. Send the reminder for each stale user with an email.
  let sent = 0;
  let failed = 0;
  for (const row of stale ?? []) {
    const email = emails[row.user_id];
    if (!email) continue;
    const ok = await sendReminder(email, monthLabel);
    if (ok) {
      sent += 1;
      await admin.from("audit_log").insert({
        user_id: row.user_id,
        event_type: "monthly_reminder_sent",
        event_meta: { month: monthLabel }
      });
    } else {
      failed += 1;
    }
  }

  return new Response(JSON.stringify({ ok: true, sent, failed, monthLabel }), {
    headers: { "content-type": "application/json" }
  });
});

async function sendReminder(toEmail: string, monthLabel: string): Promise<boolean> {
  if (!RESEND_KEY) {
    console.warn("[lyfos] RESEND_API_KEY not set — would have emailed:", toEmail);
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: toEmail,
        subject: `Five minutes for ${monthLabel} numbers`,
        html: buildHtml(monthLabel),
        text: buildText(monthLabel)
      })
    });
    return res.ok;
  } catch (err) {
    console.warn("[lyfos] reminder send failed:", err);
    return false;
  }
}

function buildText(monthLabel: string): string {
  return [
    `It's the start of ${monthLabel}.`,
    "",
    "Take five minutes to update your account balances. Your sparkline moves a little, your future self thanks you.",
    "",
    `Open Lyfos: ${APP_URL}`,
    "",
    "—",
    "If you'd rather not get these, you can turn off reminders in Settings."
  ].join("\n");
}

function buildHtml(monthLabel: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:48px 24px;background:#fbfbfd;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif;color:#1d1d1f;-webkit-font-smoothing:antialiased">
  <div style="max-width:520px;margin:0 auto">
    <p style="font-size:11px;font-weight:600;letter-spacing:0.18em;color:#86868b;text-transform:uppercase;margin:0 0 16px">Lyfos</p>
    <h1 style="font-size:36px;font-weight:600;letter-spacing:-0.01em;line-height:1.15;margin:0 0 16px">Five minutes for ${monthLabel}.</h1>
    <p style="font-size:15px;line-height:1.65;color:#1d1d1f;margin:0 0 28px">Update your account balances when you have a quiet moment. Your sparkline moves a little, you get a calm picture of the month.</p>
    <p style="margin:0 0 32px"><a href="${APP_URL}" style="display:inline-block;padding:12px 22px;border-radius:9999px;background:#1d1d1f;color:#fff;text-decoration:none;font-size:14px;font-weight:600">Update ${monthLabel}</a></p>
    <hr style="border:none;border-top:1px solid rgba(0,0,0,0.08);margin:32px 0" />
    <p style="font-size:11px;color:#a1a1a6;line-height:1.55;margin:0">You're getting this because your last vault update was before ${monthLabel} 1. Turn off these reminders in Settings inside the app.</p>
  </div>
</body></html>`;
}
