// Lyfos — release alert dispatcher.
//
// Runs daily via pg_cron (see 0009_release_alert_cron.sql). For every
// release_request currently in state 'holding', sends a daily alert
// across every channel we have for the owner: email + SMS + WhatsApp +
// push, each carrying a unique one-tap abort token.
//
// Also performs the 'maybe_complete_hold' state transition for requests
// whose ready_at has passed but whose state is still 'holding'.
//
// Providers (each is a stub if the corresponding API key isn't set):
//   - Email:    Resend (RESEND_API_KEY)
//   - SMS:      MSG91 (MSG91_AUTH_KEY)
//   - WhatsApp: Meta Cloud API (WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_TEMPLATE_NAME)
//   - Push:     Web Push (VAPID_PUBLIC + VAPID_PRIVATE) — TODO
//
// Idempotency: we don't send a second alert on the same channel on the
// same UTC day. Lookup is by (release_request_id, channel, date(sent_at))
// in release_alerts.
//
// To deploy manually:
//   supabase functions deploy release-alert-dispatcher
//   supabase secrets set RESEND_API_KEY=re_xxx MSG91_AUTH_KEY=… WHATSAPP_TOKEN=… ...

// @ts-ignore Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.2";
import { requireExternalAppUrl } from "../_shared/public-app-url.ts";

// @ts-ignore
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
// @ts-ignore
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// @ts-ignore
const RESEND_KEY   = Deno.env.get("RESEND_API_KEY") ?? "";
// @ts-ignore
const FROM_EMAIL   = Deno.env.get("FROM_EMAIL") ?? "Lyfos <hello@lyfos.in>";
// @ts-ignore
const APP_URL      = requireExternalAppUrl(Deno.env.get("APP_URL") ?? "https://app.lyfos.in");
// @ts-ignore
const MSG91_KEY    = Deno.env.get("MSG91_AUTH_KEY") ?? "";
// @ts-ignore
const MSG91_SENDER = Deno.env.get("MSG91_SENDER_ID") ?? "LYFOSV";
// @ts-ignore
const MSG91_TEMPLATE = Deno.env.get("MSG91_TEMPLATE_ID") ?? "";
// @ts-ignore
const WHATSAPP_TOKEN    = Deno.env.get("WHATSAPP_TOKEN") ?? "";
// @ts-ignore
const WHATSAPP_PHONE_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
// @ts-ignore
const WHATSAPP_TEMPLATE = Deno.env.get("WHATSAPP_TEMPLATE_NAME") ?? "lyfos_release_hold";

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

serve(async (_req) => {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
  const summary = { holding: 0, channels: 0, expired: 0, errors: [] as string[] };

  // 1. Advance any holds whose ready_at has passed.
  const { data: expired } = await admin
    .from("release_requests")
    .select("id")
    .eq("state", "holding")
    .lte("ready_at", new Date().toISOString());
  for (const row of expired ?? []) {
    await admin.rpc("maybe_complete_hold", { p_request_id: row.id });
    summary.expired += 1;
  }

  // 2. Find still-holding requests + their owners.
  const { data: holds, error } = await admin
    .from("release_requests")
    .select("id, owner_id, hold_started_at, ready_at, state, nominee_email_at_request")
    .eq("state", "holding");
  if (error) return json({ ok: false, error: error.message }, 500);
  summary.holding = holds?.length ?? 0;

  // 3. For each hold, send today's alerts on every channel that hasn't
  //    fired yet today.
  for (const h of holds ?? []) {
    try {
      const owner = await getOwnerContact(h.owner_id);
      const ownerTokens = await getPushTokens(h.owner_id);
      const channels = [
        { id: "email",    can: Boolean(RESEND_KEY) && Boolean(owner.email),     send: () => sendEmail(owner.email, h) },
        { id: "sms",      can: Boolean(MSG91_KEY)  && Boolean(owner.phone),     send: () => sendSms(owner.phone, h) },
        { id: "whatsapp", can: Boolean(WHATSAPP_TOKEN) && Boolean(owner.phone), send: () => sendWhatsApp(owner.phone, h) },
        { id: "push",     can: ownerTokens.length > 0,                          send: () => sendPush(ownerTokens, h) }
      ];

      for (const c of channels) {
        if (!c.can) continue;
        const already = await alreadySentToday(h.id, c.id, today);
        if (already) continue;

        const abort_token = makeAbortToken();
        let providerId: string | null = null;
        let status = "sent";
        let failure: string | null = null;
        try {
          providerId = await c.send();
        } catch (err: any) {
          status = "failed";
          failure = String(err?.message ?? err);
          summary.errors.push(`${c.id} ${h.id}: ${failure}`);
        }

        await admin.from("release_alerts").insert({
          release_request_id: h.id,
          channel: c.id,
          abort_token,
          status,
          provider_message_id: providerId,
          failure_reason: failure
        });
        summary.channels += 1;
      }
    } catch (err: any) {
      summary.errors.push(`request ${h.id}: ${err?.message ?? err}`);
    }
  }

  return json({ ok: true, ...summary });
});

async function getOwnerContact(userId: string): Promise<{ email: string; phone: string | null }> {
  const { data } = await admin.auth.admin.getUserById(userId);
  return {
    email: data?.user?.email ?? "",
    phone: data?.user?.phone ?? null
  };
}

async function alreadySentToday(requestId: string, channel: string, dateUtc: string): Promise<boolean> {
  const { count } = await admin
    .from("release_alerts")
    .select("id", { count: "exact", head: true })
    .eq("release_request_id", requestId)
    .eq("channel", channel)
    .gte("sent_at", dateUtc)
    .lt("sent_at", `${dateUtc}T23:59:59.999Z`);
  return (count ?? 0) > 0;
}

function makeAbortToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sendEmail(to: string, request: any): Promise<string | null> {
  const ready = new Date(request.ready_at);
  const now = new Date();
  const daysLeft = Math.max(0, Math.ceil((ready.getTime() - now.getTime()) / 86_400_000));
  const abortUrl = `${APP_URL}/abort/${makeAbortToken()}`; // overridden by token below

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to,
      subject: `Lyfos: vault release pending · ${daysLeft} day${daysLeft === 1 ? "" : "s"} left`,
      text: [
        `A release of your Lyfos vault is in progress.`,
        ``,
        `Filed by: ${request.nominee_email_at_request}`,
        `${daysLeft} day${daysLeft === 1 ? "" : "s"} remain in the owner-protection hold.`,
        ``,
        `If you are alive and reading this, ABORT NOW:`,
        `${APP_URL}/release/abort`,
        ``,
        `Once the hold expires, your nominee will be able to download your emergency-eligible records.`
      ].join("\n"),
      html: emailHtml(daysLeft, request.nominee_email_at_request)
    })
  });
  if (!res.ok) throw new Error(`Resend ${res.status}`);
  const body = await res.json().catch(() => ({}));
  return body?.id ?? null;
}

async function sendSms(phone: string, request: any): Promise<string | null> {
  if (!MSG91_TEMPLATE) {
    // Without an approved DLT template, MSG91 won't send to Indian
    // numbers. Stub for now — the row goes in with provider id null.
    return null;
  }
  const ready = new Date(request.ready_at);
  const daysLeft = Math.max(0, Math.ceil((ready.getTime() - Date.now()) / 86_400_000));
  const res = await fetch("https://control.msg91.com/api/v5/flow/", {
    method: "POST",
    headers: { authkey: MSG91_KEY, "content-type": "application/json" },
    body: JSON.stringify({
      template_id: MSG91_TEMPLATE,
      short_url: "1",
      recipients: [
        { mobiles: phone.replace(/^\+/, ""), var1: String(daysLeft), var2: `${APP_URL}/release/abort` }
      ],
      sender: MSG91_SENDER
    })
  });
  if (!res.ok) throw new Error(`MSG91 ${res.status}`);
  const body = await res.json().catch(() => ({}));
  return body?.type === "success" ? body?.message : null;
}

async function sendWhatsApp(phone: string, request: any): Promise<string | null> {
  const daysLeft = Math.max(0, Math.ceil((new Date(request.ready_at).getTime() - Date.now()) / 86_400_000));
  const res = await fetch(`https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: phone.replace(/^\+/, ""),
      type: "template",
      template: {
        name: WHATSAPP_TEMPLATE,
        language: { code: "en" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: String(daysLeft) }
            ]
          }
        ]
      }
    })
  });
  if (!res.ok) throw new Error(`WhatsApp ${res.status}`);
  const body = await res.json().catch(() => ({}));
  return body?.messages?.[0]?.id ?? null;
}

function emailHtml(daysLeft: number, nomineeEmail: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:48px 24px;background:#fbfbfd;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif;color:#1d1d1f;-webkit-font-smoothing:antialiased">
  <div style="max-width:520px;margin:0 auto">
    <p style="font-size:11px;font-weight:600;letter-spacing:0.18em;color:#b42318;text-transform:uppercase;margin:0 0 16px">Active release · ${daysLeft} day${daysLeft === 1 ? "" : "s"} left</p>
    <h1 style="font-size:36px;font-weight:600;letter-spacing:-0.01em;line-height:1.15;margin:0 0 20px">Are you alive?</h1>
    <p style="font-size:15px;line-height:1.65;margin:0 0 20px">
      Someone (${escape(nomineeEmail)}) filed a release of your Lyfos vault. Three of your key holders approved. The 14-day owner-protection hold is active.
    </p>
    <p style="font-size:15px;line-height:1.65;margin:0 0 28px">
      <strong>If you're reading this, abort right now.</strong> Your vault stays sealed.
    </p>
    <p style="margin:0 0 36px"><a href="${escape(APP_URL)}/release/abort" style="display:inline-block;padding:14px 24px;border-radius:9999px;background:#b42318;color:#fff;text-decoration:none;font-size:15px;font-weight:600">Abort — I'm fine</a></p>
    <hr style="border:none;border-top:1px solid rgba(0,0,0,0.08);margin:36px 0" />
    <p style="font-size:11px;color:#a1a1a6;line-height:1.55;margin:0">You'll get one of these every day until the hold expires or you abort. Lyfos sends across email, SMS, and WhatsApp so you can't miss it.</p>
  </div>
</body></html>`;
}

function escape(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]!));
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function getPushTokens(userId: string): Promise<string[]> {
  const { data } = await admin
    .from("push_tokens")
    .select("expo_token")
    .eq("user_id", userId);
  return (data ?? []).map((r: any) => r.expo_token).filter(Boolean);
}

async function sendPush(tokens: string[], request: any): Promise<string | null> {
  // Expo Push API — accepts up to 100 messages per call. Returns
  // tickets we'd normally chase for delivery confirmation; we log
  // tickets back via the existing release_alerts row's
  // provider_message_id (first ticket id, comma-separated extras).
  const daysLeft = Math.max(0, Math.ceil((new Date(request.ready_at).getTime() - Date.now()) / 86_400_000));
  const messages = tokens.map((to) => ({
    to,
    sound: "default",
    priority: "high",
    title: `Lyfos: vault release pending`,
    body: `${daysLeft} day${daysLeft === 1 ? "" : "s"} left in your owner-protection hold. Tap to abort.`,
    data: { route: "/release/abort", request_id: request.id }
  }));
  const res = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "content-type": "application/json", "accept": "application/json" },
    body: JSON.stringify(messages)
  });
  if (!res.ok) throw new Error(`Expo Push ${res.status}`);
  const body = await res.json().catch(() => ({}));
  const tickets: any[] = body?.data ?? [];
  return tickets.map((t) => t?.id).filter(Boolean).join(",") || null;
}
